export function parseEvents(payload) {
  const out = [];
  if (payload?.object !== 'instagram') return out;
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    const accountIgId = String(entry.id);
    for (const ch of Array.isArray(entry.changes) ? entry.changes : []) {
      if (ch.field === 'comments' && ch.value?.from) {
        out.push({ kind: 'comment', accountIgId, commentId: String(ch.value.id),
          mediaId: String(ch.value.media?.id || ''), text: ch.value.text || '',
          fromId: String(ch.value.from.id), fromUsername: ch.value.from.username || '',
          ts: entry.time || 0 });
      }
    }
    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const ts = m.timestamp > 1e12 ? Math.floor(m.timestamp / 1000) : (m.timestamp || 0);
      const igsid = String(m.sender?.id || '');
      if (m.message?.is_echo) { out.push({ kind: 'ignore', reason: 'echo' }); continue; }
      if (m.read || m.reaction) { out.push({ kind: 'ignore', reason: 'receipt' }); continue; }
      if (m.postback) {
        out.push({ kind: 'postback', accountIgId, igsid, mid: m.postback.mid || '',
          payload: m.postback.payload || '', title: m.postback.title || '', ts });
        continue;
      }
      if (!m.message) { out.push({ kind: 'ignore', reason: 'unknown' }); continue; }
      const msg = m.message;
      const mention = (msg.attachments || []).find(a => a.type === 'story_mention');
      if (mention) {
        out.push({ kind: 'story_mention', accountIgId, igsid, mid: msg.mid,
          url: mention.payload?.url || '', ts });
        continue;
      }
      if (msg.reply_to?.story) {
        out.push({ kind: 'story_reply', accountIgId, igsid, mid: msg.mid,
          text: msg.text || '', storyId: String(msg.reply_to.story.id || ''), ts });
        continue;
      }
      out.push({ kind: 'dm', accountIgId, igsid, mid: msg.mid, text: msg.text || '',
        quickReplyPayload: msg.quick_reply?.payload || null, ts });
    }
  }
  return out;
}
