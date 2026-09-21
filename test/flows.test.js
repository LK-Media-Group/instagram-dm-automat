import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSetting } from '../lib/db.js';
import { createSender } from '../lib/sender.js';
import { createJobs } from '../lib/jobs.js';
import { createFlows } from '../lib/flows.js';
import { createLinks } from '../lib/links.js';

function setup({ ai, trackLinks } = {}) {
  const db = openDb(':memory:');
  setSetting(db, 'dry_run', '0');
  db.prepare(`INSERT INTO accounts (ig_user_id, access_token) VALUES ('178','tok')`).run();
  const sent = [];
  const fetchFn = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({}) }; };
  const sender = createSender({ db, fetchFn, paceMs: 0, log: () => {} });
  const notes = [];
  const jobs = createJobs({ db, handlers: {}, log: () => {} });
  const links = trackLinks ? createLinks({ db, publicBase: 'https://x.example/ig-webhook' }) : null;
  const flows = createFlows({ db, sender, jobs, links, ai: ai || { reply: async () => ({ text: 'AI odpověď' }) },
    notifyTg: async t => notes.push(t), sse: { broadcast: () => {} }, log: () => {} });
  return { db, sent, notes, flows, jobs, links };
}

const addTrigger = (db, t) => db.prepare(
  `INSERT INTO triggers (account_id, type, name, keywords, media_scope, public_reply_text, dm_template, followups)
   VALUES (1,?,?,?,?,?,?,?)`)
  .run(t.type, t.name, JSON.stringify(t.keywords || []), t.media_scope || null,
    t.public_reply_text || null, JSON.stringify(t.dm_template || {}), JSON.stringify(t.followups || []));

const commentEv = { kind: 'comment', accountIgId: '178', commentId: 'c1', mediaId: 'm1',
  text: 'CHCI TAKY', fromId: 'u1', fromUsername: 'pepa', ts: Math.floor(Date.now() / 1000) };
const dmEv = (text, extra = {}) => ({ kind: 'dm', accountIgId: '178', igsid: 'u1', mid: `m${Math.random()}`,
  text, quickReplyPayload: null, ts: Math.floor(Date.now() / 1000), ...extra });

test('comment flow: veřejná odpověď + private reply, dedup duplicitního webhooku', async () => {
  const { db, sent, flows } = setup();
  addTrigger(db, { type: 'comment_keyword', name: 'ebook', keywords: ['chci taky'],
    public_reply_text: 'Mrkni do DM! 📩', dm_template: { text: 'Tady je e-book: https://example.com/ebook' },
    followups: [{ delay_min: 60, text: 'Stihl jsi mrknout?' }] });
  await flows.onEvent(commentEv);
  assert.equal(sent.length, 2);
  assert.ok(sent[0].url.includes('/c1/replies'));
  assert.deepEqual(sent[1].body.recipient, { comment_id: 'c1' });
  assert.equal(db.prepare('SELECT last_trigger_id FROM conversations').get().last_trigger_id, 1);
  await flows.onEvent(commentEv); // duplicitní doručení webhooku
  assert.equal(sent.length, 2);
});

test('dm keyword: disclosure jen v první odpovědi', async () => {
  const { db, sent, flows } = setup();
  addTrigger(db, { type: 'dm_keyword', name: 'x', keywords: ['ebook'], dm_template: { text: 'Posílám!' } });
  await flows.onEvent(dmEv('Ebook prosím'));
  assert.ok(sent[0].body.message.text.includes('automatická'));
  await flows.onEvent(dmEv('ebook znovu'));
  assert.equal(sent[1].body.message.text, 'Posílám!');
});

test('email capture: uloží, zařadí ecomail job, poděkuje', async () => {
  const { db, sent, flows } = setup();
  await flows.onEvent(dmEv('pepa@seznam.cz'));
  assert.equal(db.prepare('SELECT email FROM contacts').get().email, 'pepa@seznam.cz');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM jobs WHERE type='ecomail_sync'`).get().n, 1);
  assert.equal(sent.length, 1);
});

test('žádost o člověka -> handoff: stav human, notifikace, AI mlčí', async () => {
  const { db, sent, notes, flows } = setup();
  await flows.onEvent(dmEv('Chci mluvit s člověkem'));
  assert.equal(db.prepare('SELECT state FROM conversations').get().state, 'human');
  assert.equal(notes.length, 1);
  const before = sent.length;
  await flows.onEvent(dmEv('haló?'));
  assert.equal(sent.length, before); // v human stavu bot neodpovídá
  assert.equal(notes.length, 2);     // ale notifikuje
});

test('AI fallback odpoví; AI handoff přepne stav', async () => {
  const { db, sent, flows } = setup();
  setSetting(db, 'ai_enabled', '1');
  await flows.onEvent(dmEv('Jak dlouho trvá kurz?'));
  assert.ok(sent.at(-1).body.message.text.includes('AI odpověď'));
  const h = setup({ ai: { reply: async () => ({ handoff: 'nejistota' }) } });
  setSetting(h.db, 'ai_enabled', '1');
  await h.flows.onEvent(dmEv('Chci vrátit peníze'));
  assert.equal(h.db.prepare('SELECT state FROM conversations').get().state, 'human');
});

test('followupy se plánují po odpovědi uživatele a handler pošle jen v okně', async () => {
  const { db, sent, flows } = setup();
  addTrigger(db, { type: 'comment_keyword', name: 'ebook', keywords: ['chci taky'],
    dm_template: { text: 'e-book' }, followups: [{ delay_min: 60, text: 'Stihl jsi mrknout?' }] });
  await flows.onEvent(commentEv);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM jobs WHERE type='followup'`).get().n, 0); // před odpovědí nic
  await flows.onEvent(dmEv('Jo, díky!'));
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM jobs WHERE type='followup'`).get().n, 1);
  const before = sent.length;
  await flows.followupHandler({ convoId: 1, triggerId: 1, step: 0 });
  assert.equal(sent.length, before + 1);
  assert.ok(sent.at(-1).body.message.text.includes('Stihl jsi'));
  // zavřené okno -> nic
  db.prepare('UPDATE conversations SET last_user_msg_at=1000 WHERE id=1').run();
  await flows.followupHandler({ convoId: 1, triggerId: 1, step: 0 });
  assert.equal(sent.length, before + 1);
});

test('komentář od kontaktu v režimu human nespouští automatiku', async () => {
  const { db, sent, notes, flows } = setup();
  addTrigger(db, { type: 'comment_keyword', name: 'ebook', keywords: ['chci taky'], dm_template: { text: 'e-book' } });
  db.prepare(`INSERT INTO contacts (account_id, igsid, username) VALUES (1,'u1','pepa')`).run();
  db.prepare(`INSERT INTO conversations (contact_id, state) VALUES (1,'human')`).run();
  await flows.onEvent(commentEv);
  assert.equal(sent.length, 0);
  assert.equal(notes.length, 1);
});

// ---------- v2 šablony: tlačítka, kroky, e-mail krok, náhodná veřejná odpověď ----------
const postbackEv = (payload) => ({ kind: 'postback', accountIgId: '178', igsid: 'u1', mid: `p${Math.random()}`,
  payload, ts: Math.floor(Date.now() / 1000) });

const MC_TEMPLATE = {
  text: 'Abychom ti mohli poslat odkaz, klikni na tlačítko:',
  buttons: [{ type: 'postback', title: 'Chci odkaz', payload: 'link' }],
  steps: {
    link: { text: 'Tady je odkaz.', buttons: [{ type: 'web_url', title: 'Otevřít', url: 'https://example.com/x' }] },
  },
};

test('button template: private reply = attachment button s disclosure v textu, tlačítka ≤3, payload prefixovaný triggerem', async () => {
  const { db, sent, flows } = setup();
  addTrigger(db, { type: 'comment_keyword', name: 'mc', keywords: ['chci taky'], dm_template: MC_TEMPLATE });
  await flows.onEvent(commentEv);
  const msg = sent[0].body.message;
  assert.equal(sent[0].body.recipient.comment_id, 'c1');
  assert.equal(msg.attachment.type, 'template');
  assert.equal(msg.attachment.payload.template_type, 'button');
  assert.ok(msg.attachment.payload.text.startsWith('ℹ️'));
  assert.ok(msg.attachment.payload.text.endsWith('klikni na tlačítko:'));
  assert.deepEqual(msg.attachment.payload.buttons, [{ type: 'postback', title: 'Chci odkaz', payload: 't1:link' }]);
  assert.equal(msg.text, undefined);
  const out = db.prepare(`SELECT text FROM messages WHERE direction='out'`).get();
  assert.ok(out.text.includes('klikni na tlačítko'));
});

test('postback t<id>:<krok> pošle krok (web_url tlačítko), naplánuje followupy a nastaví last_trigger_id', async () => {
  const { db, sent, flows } = setup();
  addTrigger(db, { type: 'comment_keyword', name: 'mc', keywords: ['chci taky'], dm_template: MC_TEMPLATE,
    followups: [{ delay_min: 30, text: 'Nezapomeň na odkaz!' }] });
  await flows.onEvent(commentEv);
  await flows.onEvent(postbackEv('t1:link'));
  assert.equal(sent.length, 2);
  const msg = sent[1].body.message;
  assert.deepEqual(sent[1].body.recipient, { id: 'u1' });
  assert.equal(msg.attachment.payload.text, 'Tady je odkaz.'); // disclosure už byla
  assert.deepEqual(msg.attachment.payload.buttons, [{ type: 'web_url', title: 'Otevřít', url: 'https://example.com/x' }]);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM jobs WHERE type='followup'`).get().n, 1);
  assert.equal(db.prepare('SELECT last_trigger_id FROM conversations').get().last_trigger_id, 1);
  assert.equal(db.prepare(`SELECT value FROM stats_daily WHERE metric='step_sent'`).get().value, 1);
  await flows.onEvent(postbackEv('t1:neexistuje')); // neznámý krok → nic
  assert.equal(sent.length, 2);
});

test('krok ask_email: čeká na e-mail, po e-mailu (i po ne-e-mailu) pokračuje dalším krokem', async () => {
  const { db, sent, flows } = setup();
  const tpl = { text: 'Klikni:', buttons: [{ type: 'postback', title: 'Chci', payload: 'email' }],
    steps: { email: { text: 'Nech mi e-mail 💌', ask_email: true, next: 'link' },
      link: { text: 'Tady je odkaz.', buttons: [{ type: 'web_url', title: 'Otevřít', url: 'https://example.org' }] } } };
  addTrigger(db, { type: 'dm_keyword', name: 'mc', keywords: ['ebook'], dm_template: tpl });
  await flows.onEvent(dmEv('ebook'));
  await flows.onEvent(postbackEv('t1:email'));
  assert.equal(sent.length, 2);
  assert.ok(db.prepare('SELECT pending_step FROM conversations').get().pending_step);
  await flows.onEvent(dmEv('pepa@seznam.cz'));
  assert.equal(db.prepare('SELECT email FROM contacts').get().email, 'pepa@seznam.cz');
  assert.equal(sent.length, 4); // poděkování + krok link
  assert.equal(sent[3].body.message.attachment.payload.text, 'Tady je odkaz.');
  assert.equal(db.prepare('SELECT pending_step FROM conversations').get().pending_step, null);
  // varianta: uživatel e-mail nedá
  const { db: db2, sent: sent2, flows: flows2 } = setup();
  addTrigger(db2, { type: 'dm_keyword', name: 'mc', keywords: ['ebook'], dm_template: tpl });
  await flows2.onEvent(dmEv('ebook'));
  await flows2.onEvent(postbackEv('t1:email'));
  await flows2.onEvent(dmEv('nechci'));
  assert.equal(sent2.length, 3);
  assert.equal(sent2[2].body.message.attachment.payload.text, 'Tady je odkaz.');
});

test('public_reply_text jako JSON pole → náhodná varianta', async () => {
  const { sent, flows, db } = setup();
  addTrigger(db, { type: 'comment_keyword', name: 'mc', keywords: ['chci taky'],
    public_reply_text: JSON.stringify(['Posílám!', 'Kuk do DM']), dm_template: { text: 'x' } });
  await flows.onEvent(commentEv);
  assert.ok(['Posílám!', 'Kuk do DM'].includes(sent[0].body.message));
});

test('quick_replies dostanou payload s prefixem triggeru; text >640 se v šabloně ořízne', async () => {
  const { sent, flows, db } = setup();
  addTrigger(db, { type: 'dm_keyword', name: 'mc', keywords: ['hej'], dm_template: { text: 'A'.repeat(700),
    buttons: [{ type: 'web_url', title: 'W', url: 'https://example.org' }], quick_replies: [{ title: 'Q', payload: 'link' }] } });
  await flows.onEvent(dmEv('hej'));
  const msg = sent[0].body.message;
  assert.equal(msg.attachment.payload.text.length, 640);
  assert.deepEqual(msg.quick_replies, [{ content_type: 'text', title: 'Q', payload: 't1:link' }]);
});

test('trackované odkazy: web_url tlačítko vede přes /r/<token>, follow-up se po kliku přeskočí', async () => {
  const { db, sent, flows, links } = setup({ trackLinks: true });
  addTrigger(db, { type: 'comment_keyword', name: 'mc', keywords: ['chci taky'], dm_template: MC_TEMPLATE,
    followups: [{ delay_min: 30, text: 'Nezapomeň na odkaz!' }] });
  await flows.onEvent(commentEv);
  await flows.onEvent(postbackEv('t1:link'));
  const btn = sent[1].body.message.attachment.payload.buttons[0];
  assert.match(btn.url, /^https:\/\/x\.example\/ig-webhook\/r\/[A-Za-z0-9_-]+$/);
  const row = db.prepare('SELECT * FROM links').get();
  assert.equal(row.url, 'https://example.com/x');
  assert.equal(row.trigger_id, 1); assert.equal(row.conversation_id, 1); assert.equal(row.step_key, 'link');
  // klik → follow-up se neposílá
  links.hit(btn.url.split('/r/')[1]);
  const job = db.prepare(`SELECT payload FROM jobs WHERE type='followup'`).get();
  await flows.followupHandler(JSON.parse(job.payload));
  assert.equal(sent.length, 2);
  // bez kliku by se poslal
  const { db: db2, sent: sent2, flows: flows2 } = setup({ trackLinks: true });
  addTrigger(db2, { type: 'comment_keyword', name: 'mc', keywords: ['chci taky'], dm_template: MC_TEMPLATE,
    followups: [{ delay_min: 30, text: 'Nezapomeň na odkaz!' }] });
  await flows2.onEvent(commentEv);
  await flows2.onEvent(postbackEv('t1:link'));
  const job2 = db2.prepare(`SELECT payload FROM jobs WHERE type='followup'`).get();
  await flows2.followupHandler(JSON.parse(job2.payload));
  assert.equal(sent2.length, 3);
  assert.equal(sent2[2].body.message.text, 'Nezapomeň na odkaz!');
});


test('konverzace ukládá tlačítka odchozí zprávy (vč. tokenu trackovaného odkazu) a klik příchozího postbacku', async () => {
  const { db, flows } = setup({ trackLinks: true });
  addTrigger(db, { type: 'comment_keyword', name: 'x', keywords: ['chci taky'], dm_template: MC_TEMPLATE });
  await flows.onEvent(commentEv);
  const out1 = db.prepare(`SELECT payload FROM messages WHERE direction='out' ORDER BY id`).all();
  const m1 = JSON.parse(out1[0].payload);
  assert.equal(m1.template, 'button');
  assert.deepEqual(m1.buttons, [{ type: 'postback', title: 'Chci odkaz', payload: 't1:link' }]);
  await flows.onEvent({ ...postbackEv('t1:link'), title: 'Chci odkaz' });
  const inn = db.prepare(`SELECT payload FROM messages WHERE direction='in' ORDER BY id DESC LIMIT 1`).get();
  assert.deepEqual(JSON.parse(inn.payload), { kind: 'postback', click: 't1:link', title: 'Chci odkaz' });
  const out2 = db.prepare(`SELECT payload FROM messages WHERE direction='out' ORDER BY id DESC LIMIT 1`).get();
  const m2 = JSON.parse(out2.payload);
  assert.equal(m2.buttons[0].type, 'web_url');
  assert.equal(m2.buttons[0].title, 'Otevřít');
  assert.equal(m2.buttons[0].url, 'https://example.com/x', 'ukládá se cílová URL, ne redirect');
  const link = db.prepare('SELECT token FROM links').get();
  assert.equal(m2.buttons[0].token, link.token, 'token trackovaného odkazu u tlačítka → dohledání kliku');
});

test('quick reply klik se uloží jako payload příchozí zprávy', async () => {
  const { db, flows } = setup();
  addTrigger(db, { type: 'dm_keyword', name: 'q', keywords: ['start'], dm_template: { text: 'Vyber:', quick_replies: [{ title: 'A', payload: 'a' }], steps: { a: { text: 'Áčko' } } } });
  await flows.onEvent(dmEv('start'));
  await flows.onEvent(dmEv('A', { quickReplyPayload: 't1:a' }));
  const rows = db.prepare(`SELECT direction, text, payload FROM messages ORDER BY id`).all();
  const qr = rows.find(r => r.direction === 'in' && r.text === 'A');
  assert.deepEqual(JSON.parse(qr.payload), { kind: 'quick_reply', click: 't1:a', title: 'A' });
  const out0 = JSON.parse(rows.find(r => r.direction === 'out').payload);
  assert.deepEqual(out0.quick_replies, [{ title: 'A', payload: 't1:a' }]);
});

test('old comments do not trigger public or private replies', async () => {
  const {db,sent,flows}=setup();
  addTrigger(db,{type:'comment_keyword',name:'old',keywords:['chci'],dm_template:{text:'demo'}});
  await flows.onEvent({...commentEv,ts:Math.floor(Date.now()/1000)-8*86400});
  assert.equal(sent.length,0);
});

test('postback cannot invoke a trigger from another account', async () => {
  const {db,sent,flows}=setup();
  db.prepare("INSERT INTO accounts (ig_user_id) VALUES ('other')").run();
  addTrigger(db,{type:'comment_keyword',name:'foreign',keywords:['chci'],dm_template:{text:'demo',steps:{link:{text:'secret template'}}}});
  db.prepare('UPDATE triggers SET account_id=2').run();
  await flows.onEvent({...dmEv(''),kind:'postback',payload:'t1:link'});
  assert.equal(sent.length,0);
});
