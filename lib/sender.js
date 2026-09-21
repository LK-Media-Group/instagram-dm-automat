import { getSetting } from './db.js';
import { windowOpen } from './store.js';


export class WindowClosedError extends Error {}
export class DuplicatePrivateReplyError extends Error {}

export function createSender({ db, fetchFn = fetch, now = () => Math.floor(Date.now() / 1000), paceMs = 1000, graphVersion = 'v23.0', log = console.error }) {
  const API = `https://graph.instagram.com/${graphVersion}`;
  let queue = Promise.resolve();
  let lastSend = 0;

  function paced(fn) {
    const p = queue.then(async () => {
      const wait = Math.max(0, paceMs - (Date.now() - lastSend));
      if (wait) await new Promise(r => setTimeout(r, wait));
      lastSend = Date.now();
      return fn();
    });
    queue = p.catch(() => {});
    return p;
  }

  async function call(path, body, token) {
    if (getSetting(db, 'dry_run', '1') !== '0') {
      log(`[dry-run] POST ${path} ${JSON.stringify(body)}`);
      return { dryRun: true };
    }
    const res = await fetchFn(`${API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`graph ${path} -> ${res.status}: ${JSON.stringify(data)}`);
    return data;
  }

  return {
    async sendDM(account, convo, message, source) {
      if (!windowOpen(convo, now())) throw new WindowClosedError(`24h okno zavřené (convo igsid=${convo.igsid}, source=${source})`);
      return paced(() => {
        if (!windowOpen(convo, now())) throw new WindowClosedError("24h window closed while queued");
        return call(`/${account.ig_user_id}/messages`, { recipient: { id: convo.igsid }, message }, account.access_token);
      });
    },
    async sendPrivateReply(account, commentId, message) {
      if (db.prepare('SELECT 1 FROM private_replies WHERE comment_id=?').get(commentId))
        throw new DuplicatePrivateReplyError(commentId);
      return paced(async () => {
      if (db.prepare('SELECT 1 FROM private_replies WHERE comment_id=?').get(commentId))
        throw new DuplicatePrivateReplyError(commentId);
      const result = await call(`/${account.ig_user_id}/messages`,
        { recipient: { comment_id: commentId }, message }, account.access_token);
      db.prepare('INSERT OR IGNORE INTO private_replies (comment_id, sent_at) VALUES (?,?)').run(commentId, now());
      return result;
      });
    },
    replyComment(account, commentId, text) {
      return paced(() => call(`/${commentId}/replies`, { message: text }, account.access_token));
    },
  };
}
