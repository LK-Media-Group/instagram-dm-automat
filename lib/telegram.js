export function createNotifier({ token, chatId, fetchFn = fetch, log = console.error }) {
  return async function notify(text) {
    if (!token || !chatId) return;
    try {
      const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res || !res.ok) log(`telegram notify: HTTP ${res?.status}`);
    } catch (e) { log(`telegram notify: ${e}`); }
  };
}
