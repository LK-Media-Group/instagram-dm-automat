import { getSetting } from './db.js';
import { matchTrigger, normalize } from './rules.js';
import { inc } from './stats.js';
import { DuplicatePrivateReplyError } from './sender.js';
import {
  upsertContact, getOrCreateConversation, recordInbound, recordOutbound,
  markUserMessage, setState, bumpAiCounter, saveEmail, needsDisclosure,
  history, windowOpen, nowSec,
} from './store.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HUMAN_RE = /(clovek|human|podpora|nechci bota|operator)/;

export function createFlows({ db, sender, jobs, ai, notifyTg, sse, links = null, log = console.error }) {
  const getAccount = igId => db.prepare('SELECT * FROM accounts WHERE ig_user_id=?').get(String(igId));
  const getConvoFull = id => db.prepare(
    `SELECT c.*, k.igsid, k.account_id, k.id AS contact_id FROM conversations c
     JOIN contacts k ON k.id = c.contact_id WHERE c.id=?`).get(id);

  // Šablona zprávy (dm_template i její kroky):
  //   { text, quick_replies?: [{title,payload}], buttons?: [{type:'web_url',title,url}|{type:'postback',title,payload}],
  //     steps?: { klíč: { ...stejná struktura..., ask_email?: true, next?: klíč } } }
  // Payloady tlačítek/quick replies se odesílají jako `t<triggerId>:<klíč kroku>`, aby šel krok
  // dohledat i bez stavu konverzace. Tlačítka = Instagram „button template" (max 3, text ≤ 640 znaků).
  const TEMPLATE_TEXT_MAX = 640;
  const stepPayload = (trigId, key) => (trigId && key && !/^t\d+:/.test(key)) ? `t${trigId}:${key}` : key;
  const parseStepPayload = p => { const m = /^t(\d+):(.+)$/.exec(p || ''); return m ? { trigId: Number(m[1]), key: m[2] } : null; };

  // web_url tlačítka jdou přes trackovaný redirect (links.wrap), pokud známe konverzaci.
  const trackUrl = (url, convoId, trigId, stepKey) =>
    (links && convoId) ? links.wrap(url, { convoId, triggerId: trigId, stepKey }) : url;

  // Vrací { msg (pro Meta API), text, meta } — meta = co se uloží k odchozí zprávě pro detail
  // konverzace (tlačítka s cílovou URL + token trackovaného odkazu / payload kroku, quick replies).
  function buildMessage(tpl, withDisclosure, trigId = null, convoId = null, stepKey = null) {
    let text = tpl.text || '';
    if (withDisclosure)
      text = getSetting(db, 'disclosure_text', 'ℹ️ Toto je automatická zpráva.') + '\n\n' + text;
    const metaButtons = [];
    const buttons = (Array.isArray(tpl.buttons) ? tpl.buttons : []).filter(b => b && b.title && (b.url || b.payload)).slice(0, 3)
      .map(b => {
        const title = String(b.title).slice(0, 20);
        if (b.type === 'web_url' || b.url) {
          const wrapped = trackUrl(b.url, convoId, trigId, stepKey);
          const token = wrapped !== b.url && wrapped.includes('/r/') ? wrapped.split('/r/')[1] : null;
          metaButtons.push({ type: 'web_url', title, url: b.url, token });
          return { type: 'web_url', title, url: wrapped };
        }
        const payload = stepPayload(trigId, b.payload);
        metaButtons.push({ type: 'postback', title, payload });
        return { type: 'postback', title, payload };
      });
    const msg = buttons.length
      ? { attachment: { type: 'template', payload: { template_type: 'button', text: text.slice(0, TEMPLATE_TEXT_MAX), buttons } } }
      : { text };
    const meta = { template: buttons.length ? 'button' : null, buttons: metaButtons, quick_replies: [] };
    if (Array.isArray(tpl.quick_replies) && tpl.quick_replies.length) {
      msg.quick_replies = tpl.quick_replies.slice(0, 13).map(q =>
        ({ content_type: q.content_type || 'text', title: q.title, payload: stepPayload(trigId, q.payload) }));
      meta.quick_replies = msg.quick_replies.map(q => ({ title: q.title, payload: q.payload }));
    }
    return { msg, text, meta: (metaButtons.length || meta.quick_replies.length) ? meta : null };
  }

  async function replyBot(acc, convo, tpl, source, trigId = null, stepKey = null) {
    const { msg, text, meta } = buildMessage(tpl, needsDisclosure(db, convo.id), trigId, convo.id, stepKey);
    await sender.sendDM(acc, convo, msg, source);
    recordOutbound(db, convo.id, { text, source, payload: meta });
    sse.broadcast('message', { convoId: convo.id });
  }

  const getTrigger = id => db.prepare('SELECT * FROM triggers WHERE id=?').get(id);
  const setPending = (convoId, val) => db.prepare('UPDATE conversations SET pending_step=? WHERE id=?')
    .run(val ? JSON.stringify(val) : null, convoId);

  // Odeslání kroku šablony (po kliknutí na tlačítko / po e-mailu). Vrací true, když se něco poslalo.
  async function sendStep(acc, convo, trig, key) {
    const tpl = JSON.parse(trig.dm_template || '{}');
    const step = tpl.steps?.[key];
    if (!step) return false;
    await replyBot(acc, convo, step, 'rule', trig.id, key);
    inc(db, trig.id, 'step_sent');
    db.prepare('UPDATE conversations SET last_trigger_id=? WHERE id=?').run(trig.id, convo.id);
    if (step.ask_email) setPending(convo.id, { trigger_id: trig.id, next: step.next || null });
    else {
      setPending(convo.id, null);
      const isFinal = !step.next && !(step.buttons || []).some(b => b.payload);
      if (isFinal) planFollowups(convo, trig);
    }
    return true;
  }

  // public_reply_text může být prostý text, nebo JSON pole variant → náhodný výběr (jako ManyChat).
  function pickPublicReply(raw) {
    if (!raw) return null;
    const t = String(raw).trim();
    if (t.startsWith('[')) {
      try { const arr = JSON.parse(t).filter(x => typeof x === 'string' && x.trim()); if (arr.length) return arr[Math.floor(Math.random() * arr.length)]; }
      catch { /* prostý text začínající hranatou závorkou */ }
    }
    return t;
  }

  function planFollowups(convo, trig) {
    JSON.parse(trig.followups || '[]').forEach((fu, i) =>
      jobs.enqueue('followup', nowSec() + (fu.delay_min || 60) * 60,
        { convoId: convo.id, triggerId: trig.id, step: i }, `fu:${convo.id}:${trig.id}:${i}`));
  }

  async function handoff(acc, convo, reason) {
    setState(db, convo.id, 'human');
    inc(db, convo.last_trigger_id, 'handoff');
    try {
      await replyBot(acc, convo, { text: getSetting(db, 'handoff_text', 'Předávám tě kolegovi, ozve se ti tu co nejdřív! 🙂') }, 'rule');
    } catch (e) { log(`handoff reply: ${e}`); }
    await notifyTg(`🙋 IG handoff: konverzace #${convo.id} — ${reason}`);
    sse.broadcast('convo', { id: convo.id });
  }

  async function onComment(acc, ev) {
    if (ev.ts && (nowSec() - ev.ts > 7 * 86400 || ev.ts > nowSec() + 300)) return;
    if (String(ev.fromId) === String(acc.ig_user_id)) return;
    if (db.prepare('SELECT 1 FROM private_replies WHERE comment_id=?').get(ev.commentId)) return;
    const trig = matchTrigger(db, acc.id, ev);
    if (!trig) return;
    const contact = upsertContact(db, acc.id, ev.fromId, ev.fromUsername);
    const convo = getOrCreateConversation(db, contact.id);
    if (convo.state === 'human') {
      await notifyTg(`💬 IG (režim člověk) #${convo.id} @${contact.username || ev.fromId} okomentoval: ${ev.text}`);
      return;
    }
    inc(db, trig.id, 'triggered');
    const pub = pickPublicReply(trig.public_reply_text);
    if (pub) {
      await sender.replyComment(acc, ev.commentId, pub);
      inc(db, trig.id, 'public_reply');
    }
    const { msg: tplMsg, text: tplText, meta: tplMeta } = buildMessage(JSON.parse(trig.dm_template || '{}'), needsDisclosure(db, convo.id), trig.id, convo.id, 'root');
    try {
      await sender.sendPrivateReply(acc, ev.commentId, tplMsg);
      inc(db, trig.id, 'dm_sent');
    } catch (e) {
      if (e instanceof DuplicatePrivateReplyError) return;
      throw e;
    }
    db.prepare('UPDATE conversations SET last_trigger_id=? WHERE id=?').run(trig.id, convo.id);
    recordOutbound(db, convo.id, { text: tplText, source: 'rule', payload: tplMeta });
    sse.broadcast('convo', { id: convo.id });
  }

  async function onMessage(acc, ev) {
    // klik na tlačítko (postback) / quick reply → uložit k příchozí zprávě, co bylo kliknuto
    const click = ev.kind === 'postback'
      ? { kind: 'postback', click: ev.payload, title: ev.title || '' }
      : (ev.quickReplyPayload ? { kind: 'quick_reply', click: ev.quickReplyPayload, title: ev.text || '' } : null);
    if (ev.kind === 'postback') ev = { ...ev, kind: 'dm', text: '', quickReplyPayload: ev.payload };
    const contact = upsertContact(db, acc.id, ev.igsid, null);
    const convoRow = getOrCreateConversation(db, contact.id);
    if (ev.mid && !recordInbound(db, convoRow.id, { mid: ev.mid, text: ev.text, payload: click })) return;
    const ts = ev.ts || nowSec();
    markUserMessage(db, convoRow.id, ts);
    const convo = { ...convoRow, last_user_msg_at: ts, igsid: ev.igsid, contact_id: contact.id };
    inc(db, convo.last_trigger_id, 'user_reply');
    sse.broadcast('message', { convoId: convo.id });

    if (convo.state === 'human') {
      await notifyTg(`💬 IG (režim člověk) #${convo.id} @${contact.username || ev.igsid}: ${ev.text || ev.kind}`);
      return;
    }
    // 0) kliknutí na tlačítko / quick reply s payloadem kroku → pošli krok
    const sp = parseStepPayload(ev.quickReplyPayload);
    if (sp) {
      const trig = getTrigger(sp.trigId);
      if (trig && trig.account_id === acc.id && trig.active && await sendStep(acc, convo, trig, sp.key)) return;
      if (ev.kind !== 'dm' || !ev.text) return; // neznámý krok/trigger → tiše ignorovat
    }
    const pending = (() => { try { return JSON.parse(convo.pending_step || 'null'); } catch { return null; } })();
    // 1) e-mail capture
    const trimmed = (ev.text || '').trim();
    if (ev.kind === 'dm' && EMAIL_RE.test(trimmed)) {
      saveEmail(db, contact.id, trimmed);
      jobs.enqueue('ecomail_sync', nowSec(), { contactId: contact.id }, `ecomail:${contact.id}:${trimmed}`);
      inc(db, convo.last_trigger_id, 'email_captured');
      await replyBot(acc, convo, { text: getSetting(db, 'email_thanks_text', 'Super, e-mail mám! 📩 Mrkni si do schránky (i do spamu).') }, 'rule');
      if (pending?.next) { const t = getTrigger(pending.trigger_id); setPending(convo.id, null); if (t) await sendStep(acc, convo, t, pending.next); }
      else if (pending) setPending(convo.id, null);
      return;
    }
    // 2) žádost o člověka
    if (HUMAN_RE.test(normalize(ev.text || ''))) return handoff(acc, convo, 'uživatel požádal o člověka');
    // 2b) čekali jsme na e-mail, uživatel napsal něco jiného → neblokovat, pokračovat dalším krokem
    if (pending && ev.kind === 'dm') {
      const t = getTrigger(pending.trigger_id); setPending(convo.id, null);
      if (t && pending.next && await sendStep(acc, convo, t, pending.next)) return;
    }
    // 3) trigger match
    const trig = matchTrigger(db, acc.id, ev);
    if (trig) {
      inc(db, trig.id, 'triggered');
      await replyBot(acc, convo, JSON.parse(trig.dm_template || '{}'), 'rule', trig.id);
      inc(db, trig.id, 'dm_sent');
      db.prepare('UPDATE conversations SET last_trigger_id=? WHERE id=?').run(trig.id, convo.id);
      const tpl = JSON.parse(trig.dm_template || '{}');
      if (!(tpl.buttons || []).some(b => b.payload) && !(tpl.quick_replies || []).some(q => q.payload && tpl.steps?.[q.payload]))
        planFollowups(convo, trig);
      return;
    }
    // 4) follow-upy z dřívějšího (comment) triggeru — plánují se první odpovědí uživatele
    if (convo.last_trigger_id) {
      const lastTrig = db.prepare('SELECT * FROM triggers WHERE id=?').get(convo.last_trigger_id);
      if (lastTrig) planFollowups(convo, lastTrig);
    }
    // 5) AI fallback; při vypnuté AI aspoň notifikace o nové konverzaci (spec §5.2)
    if (ev.kind === 'dm' && getSetting(db, 'ai_enabled', '0') === '1') {
      if (!bumpAiCounter(db, convo.id, Number(getSetting(db, 'ai_daily_limit', '10'))))
        return handoff(acc, convo, 'vyčerpán denní AI limit');
      const result = await ai.reply(convo, contact, history(db, convo.id));
      if (result.handoff) return handoff(acc, convo, result.handoff);
      await replyBot(acc, convo, { text: result.text }, 'ai');
      inc(db, convo.last_trigger_id, 'ai_reply');
    } else if (ev.kind === 'dm') {
      const n = db.prepare(`SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND direction='in'`).get(convo.id).n;
      if (n === 1) await notifyTg(`📥 Nová IG konverzace #${convo.id} @${contact.username || ev.igsid}: ${ev.text}`);
    }
  }

  async function onEvent(ev) {
    if (!ev || ev.kind === 'ignore') return;
    const acc = getAccount(ev.accountIgId);
    if (!acc || acc.status !== 'active') { log(`event pro neznámý účet ${ev.accountIgId}`); return; }
    if (ev.kind === 'comment') return onComment(acc, ev);
    return onMessage(acc, ev);
  }

  async function followupHandler({ convoId, triggerId, step }) {
    const convo = getConvoFull(convoId);
    if (!convo || convo.state === 'human') return;
    const trig = db.prepare('SELECT * FROM triggers WHERE id=?').get(triggerId);
    const fu = trig && JSON.parse(trig.followups || '[]')[step];
    if (!fu || !trig.active || trig.account_id !== convo.account_id) return;
    if (!windowOpen(convo)) { log(`followup #${convoId}/${step}: 24h okno zavřené, přeskočeno`); return; }
    if (links && links.clicked(convoId, triggerId)) { log(`followup #${convoId}/${step}: uživatel už klikl na odkaz, přeskočeno`); return; }
    const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(convo.account_id);
    await sender.sendDM(acc, convo, { text: fu.text }, 'rule');
    recordOutbound(db, convoId, { text: fu.text, source: 'rule' });
    inc(db, triggerId, 'followup_sent');
    sse.broadcast('message', { convoId });
  }

  return { onEvent, followupHandler };
}
