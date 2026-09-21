export function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const KIND_TO_TYPE = {
  comment: 'comment_keyword',
  dm: 'dm_keyword',
  story_reply: 'story_reply',
  story_mention: 'story_mention',
};

export function matchTrigger(db, accountId, event) {
  const type = KIND_TO_TYPE[event.kind];
  if (!type) return null;
  const rows = db.prepare(
    `SELECT * FROM triggers WHERE account_id=? AND type=? AND active=1 ORDER BY priority, id`
  ).all(accountId, type);
  const text = normalize(event.text);
  const scopeId = event.kind === 'comment' ? event.mediaId
    : event.kind === 'story_reply' ? event.storyId : null;
  for (const t of rows) {
    if (t.media_scope && t.media_scope !== scopeId) continue;
    const keywords = JSON.parse(t.keywords || '[]');
    if (keywords.length === 0) {
      if (type === 'story_mention' || type === 'story_reply') return t;
      continue;
    }
    if (keywords.some(k => text.includes(normalize(k)))) return t;
  }
  return null;
}
