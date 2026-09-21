import { today } from './store.js';

export function inc(db, triggerId, metric, day = today()) {
  db.prepare(`INSERT INTO stats_daily (day, trigger_id, metric, value) VALUES (?,?,?,1)
    ON CONFLICT(day, trigger_id, metric) DO UPDATE SET value = value + 1`)
    .run(day, triggerId || 0, metric);
}

export function range(db, days = 30) {
  const rows = db.prepare(`SELECT day, trigger_id, metric, value FROM stats_daily
    WHERE day >= date('now', ?) ORDER BY day, trigger_id`).all(`-${days} days`);
  return rows.map(r => Object.assign({}, r));
}
