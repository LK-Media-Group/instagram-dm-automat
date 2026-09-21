export function createJobs({ db, handlers, log = console.error, now = () => Math.floor(Date.now() / 1000) }) {
  return {
    enqueue(type, dueAt, payload, uniqKey = null) {
      try {
        db.prepare('INSERT INTO jobs (type, due_at, payload, uniq_key) VALUES (?,?,?,?)')
          .run(type, dueAt, JSON.stringify(payload || {}), uniqKey);
        return true;
      } catch (e) {
        if (String(e).includes('UNIQUE')) return false;
        throw e;
      }
    },
    async tick() {
      const due = db.prepare(`SELECT * FROM jobs WHERE state='pending' AND due_at <= ? ORDER BY due_at LIMIT 20`).all(now());
      for (const job of due) {
        const handler = handlers[job.type];
        try {
          if (!handler) throw new Error(`neznámý typ jobu: ${job.type}`);
          await handler(JSON.parse(job.payload));
          db.prepare(`UPDATE jobs SET state='done' WHERE id=?`).run(job.id);
        } catch (e) {
          const attempts = job.attempts + 1;
          const failed = attempts >= 3;
          db.prepare('UPDATE jobs SET attempts=?, state=?, last_error=?, due_at=? WHERE id=?')
            .run(attempts, failed ? 'failed' : 'pending', String(e), now() + 300 * attempts, job.id);
          log(`job #${job.id} ${job.type} selhal (${attempts}×): ${e}`);
        }
      }
    },
  };
}
