export async function subscribeContact({ apiKey, listId, email, username, fetchFn = fetch }) {
  const res = await fetchFn(`https://api2.ecomailapp.cz/lists/${listId}/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', key: apiKey },
    body: JSON.stringify({
      subscriber_data: { email, name: username || '' },
      update_existing: true,
      resubscribe: false,
      trigger_autoresponders: true,
    }),
  });
  if (!res.ok) throw new Error(`ecomail ${res.status}: ${await res.text()}`);
  return true;
}
