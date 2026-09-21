// Offline demonstration, isolated SQLite memory DB; network calls are impossible here.
import assert from 'node:assert/strict';
import { openDb, setSetting } from '../lib/db.js';
import { createSender } from '../lib/sender.js';
import { createFlows } from '../lib/flows.js';
import { createJobs } from '../lib/jobs.js';
const db=openDb(':memory:');
setSetting(db,'dry_run','1');
db.prepare("INSERT INTO accounts (ig_user_id, username) VALUES ('demo-account','demo')").run();
db.prepare(`INSERT INTO triggers (account_id,type,name,keywords,dm_template) VALUES (1,'dm_keyword','PDF','["pruvodce"]',?)`)
  .run(JSON.stringify({text:'Tady je ukázkový průvodce: https://example.com/pruvodce'}));
const output=[];
const sender=createSender({db,paceMs:0,log:s=>output.push(s),fetchFn:async()=>{throw Error('Offline demo must not call network');}});
const flows=createFlows({db,sender,jobs:createJobs({db,handlers:{}}),ai:{reply:async()=>{throw Error('AI disabled');}},notifyTg:async()=>{},sse:{broadcast:()=>{}}});
const event={kind:'dm',accountIgId:'demo-account',igsid:'demo-reader',mid:'demo-message',text:'PRŮVODCE',ts:Math.floor(Date.now()/1000)};
await flows.onEvent(event);
await flows.onEvent(event);
assert.equal(output.length,1);
assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE direction='out'").get().n,1);
console.log('Fiktivní příchozí DM: PRŮVODCE');
console.log(output[0]);
console.log('OK: jedna simulovaná odpověď, opakovaný webhook bez druhé zprávy. Žádná síť ani trvalá data.');
db.close();
