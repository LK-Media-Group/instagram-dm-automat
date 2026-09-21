import { randomBytes } from 'node:crypto';
import { nowSec } from './store.js';

// Trackované odkazy: tlačítko web_url dostane místo cílové URL náš redirect
// `${publicBase}/r/<token>`; první průchod zapíše klik (kdo, který trigger/krok).
// Díky tomu umíme follow-up jen pro ty, kdo neklikli, a statistiku kliků.
export function createLinks({ db, publicBase }) {
  return {
    wrap(url, { convoId = null, triggerId = null, stepKey = null } = {}) {
      if (!url || !/^https?:\/\//i.test(url) || !publicBase) return url;
      const token = randomBytes(8).toString('base64url');
      db.prepare(`INSERT INTO links (token, conversation_id, trigger_id, step_key, url) VALUES (?,?,?,?,?)`)
        .run(token, convoId, triggerId, stepKey, url);
      return `${publicBase.replace(/\/$/, '')}/r/${token}`;
    },
    resolve(token) {
      return db.prepare('SELECT * FROM links WHERE token=?').get(String(token || '')) || null;
    },
    // Zaznamená klik a vrátí { url, first, trigger_id, conversation_id } nebo null.
    hit(token) {
      const row = this.resolve(token);
      if (!row) return null;
      const first = !row.clicked_at;
      db.prepare('UPDATE links SET clicks = clicks + 1, clicked_at = COALESCE(clicked_at, ?) WHERE id=?').run(nowSec(), row.id);
      return { url: row.url, first, trigger_id: row.trigger_id, conversation_id: row.conversation_id, step_key: row.step_key };
    },
    clicked(convoId, triggerId = null) {
      const row = triggerId == null
        ? db.prepare('SELECT 1 FROM links WHERE conversation_id=? AND clicked_at IS NOT NULL LIMIT 1').get(convoId)
        : db.prepare('SELECT 1 FROM links WHERE conversation_id=? AND trigger_id=? AND clicked_at IS NOT NULL LIMIT 1').get(convoId, triggerId);
      return !!row;
    },
  };
}
