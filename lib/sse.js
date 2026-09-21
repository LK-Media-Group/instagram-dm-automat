export function createSse() {
  const clients = new Set();
  return {
    handler(req, res) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    broadcast(type, data) {
      for (const res of clients) {
        try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
        catch { clients.delete(res); }
      }
    },
  };
}
