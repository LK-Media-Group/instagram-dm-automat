// Zpětné doplnění `messages.payload` (meta tlačítek a kliků) pro zprávy odeslané před
// zavedením evidence (5. 9. 2026). Rekonstrukce ze šablon triggerů:
//  - odchozí zpráva (source rule) s NULL payloadem → najdi trigger/krok, jehož text
//    (bez disclosure prefixu) je shodný s textem zprávy → tlačítka + quick replies ze
//    šablony; web_url token = řádek `links` téže konverzace/triggeru/kroku (nejbližší v čase)
//  - prázdná příchozí zpráva hned po odchozí s postback tlačítky → klik na to tlačítko,
//    jehož krok následuje jako další odchozí zpráva (jinak první postback tlačítko)
// Idempotentní (bere jen řádky s payload IS NULL), dry-run bez `apply`.
import { getSetting } from './db.js';

const stripDisclosure = (text, disclosure) => {
  const t = String(text || '');
  const pre = disclosure + '\n\n';
  return t.startsWith(pre) ? t.slice(pre.length) : t;
};

export function backfillMessageMeta(db, { apply = false } = {}) {
  const disclosure = getSetting(db, 'disclosure_text', 'ℹ️ Toto je automatická zpráva.');
  // index: text šablony → [{trigId, key, tpl}] (root = 'root')
  const byText = new Map();
  for (const t of db.prepare('SELECT id, dm_template FROM triggers').all()) {
    let tpl; try { tpl = JSON.parse(t.dm_template || '{}'); } catch { continue; }
    const add = (key, node) => { if (!node || !node.text) return; const k = String(node.text).trim(); if (!byText.has(k)) byText.set(k, []); byText.get(k).push({ trigId: t.id, key, tpl: node }); };
    add('root', tpl);
    for (const [k, st] of Object.entries(tpl.steps || {})) add(k, st);
  }
  const stepPayload = (trigId, key) => /^t\d+:/.test(key) ? key : `t${trigId}:${key}`;
  const linkFor = db.prepare(`SELECT token FROM links WHERE conversation_id=? AND trigger_id=? AND (step_key=? OR step_key IS NULL) AND url=? ORDER BY ABS(created_at-?) LIMIT 1`);
  const upd = db.prepare('UPDATE messages SET payload=? WHERE id=?');
  const convos = db.prepare('SELECT DISTINCT conversation_id FROM messages WHERE payload IS NULL').all().map(r => r.conversation_id);
  const res = { out: 0, in: 0, skipped: 0 };
  for (const cid of convos) {
    const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id').all(cid);
    const metaOf = new Map(); // id → meta (i pro už existující payloady, kvůli párování kliků)
    for (const m of msgs) if (m.payload) { try { metaOf.set(m.id, JSON.parse(m.payload)); } catch { /* ignore */ } }
    // 1) odchozí
    for (const m of msgs) {
      if (m.direction !== 'out' || m.payload || m.source !== 'rule') continue;
      const cands = byText.get(stripDisclosure(m.text, disclosure).trim());
      if (!cands || !cands.length) { res.skipped++; continue; }
      // preferuj trigger, který konverzace naposledy použila
      const last = db.prepare('SELECT last_trigger_id FROM conversations WHERE id=?').get(cid)?.last_trigger_id;
      const c = cands.find(x => x.trigId === last) || cands[0];
      const buttons = (Array.isArray(c.tpl.buttons) ? c.tpl.buttons : []).filter(b => b && b.title && (b.url || b.payload)).slice(0, 3).map(b => {
        const title = String(b.title).slice(0, 20);
        if (b.type === 'web_url' || b.url) {
          const l = linkFor.get(cid, c.trigId, c.key, b.url, m.created_at);
          return { type: 'web_url', title, url: b.url, token: l?.token || null };
        }
        return { type: 'postback', title, payload: stepPayload(c.trigId, b.payload) };
      });
      const quick = (Array.isArray(c.tpl.quick_replies) ? c.tpl.quick_replies : []).slice(0, 13).map(q => ({ title: q.title, payload: stepPayload(c.trigId, q.payload) }));
      if (!buttons.length && !quick.length) { res.skipped++; continue; }
      const meta = { template: buttons.length ? 'button' : null, buttons, quick_replies: quick, backfilled: true };
      metaOf.set(m.id, meta); res.out++;
      if (apply) upd.run(JSON.stringify(meta), m.id);
    }
    // 2) prázdné příchozí = klik na postback tlačítko předchozí odchozí zprávy
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.direction !== 'in' || m.payload || (m.text || '').trim()) continue;
      let prev = null; for (let j = i - 1; j >= 0; j--) if (msgs[j].direction === 'out') { prev = msgs[j]; break; }
      const pm = prev && metaOf.get(prev.id);
      const pbs = (pm?.buttons || []).filter(b => b.type === 'postback');
      if (!pbs.length) { res.skipped++; continue; }
      const next = msgs.slice(i + 1).find(x => x.direction === 'out');
      const nextMeta = next && metaOf.get(next.id);
      // který krok následoval? podle textu dalšího odchozího vs. šablona kroku payloadu
      let hit = pbs[0];
      if (next) {
        for (const b of pbs) {
          const mm = /^t(\d+):(.+)$/.exec(b.payload); if (!mm) continue;
          const cands = byText.get(stripDisclosure(next.text, disclosure).trim()) || [];
          if (cands.some(c => c.trigId === Number(mm[1]) && c.key === mm[2])) { hit = b; break; }
        }
      }
      void nextMeta;
      const meta = { kind: 'postback', click: hit.payload, title: hit.title, backfilled: true };
      metaOf.set(m.id, meta); res.in++;
      if (apply) upd.run(JSON.stringify(meta), m.id);
    }
  }
  return res;
}
