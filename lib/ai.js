import { getSetting } from './db.js';

export function createAi({ db, config, fetchFn = fetch, knowledge = '', spendFn = async () => {} }) {
  async function reply(convo, contact, history) {
    if (!history.length) return { handoff: 'prázdná historie' };
    try {
      const allowedLinks = JSON.parse(getSetting(db, 'ai_allowed_links', '[]'));
      const priceInfo = getSetting(db, 'ai_price_info', '');
      const system = [
        'Jsi přátelský asistent českého Instagram účtu. Odpovídáš na DM sledujících.',
        getSetting(db, 'ai_style', 'Piš česky, vykej, stručně — max 3 věty.'),
        'PRAVIDLA (porušení = selhání):',
        '- NIKDY neuváděj ceny, slevy ani odkazy, které nejsou níže v POVOLENÝCH ÚDAJÍCH.',
        '- Nikdy nic neslibuj (vratky, výsledky, termíny, individuální výjimky).',
        '- Když si nejsi jistý, dotaz se týká platby/reklamace, nebo chce uživatel člověka, odpověz přesně jedním slovem: HANDOFF',
        `POVOLENÉ ÚDAJE:\n${priceInfo || '(žádné ceny nejsou k dispozici — o cenách nemluv)'}`,
        `Povolené odkazy: ${allowedLinks.join(' ') || '(žádné)'}`,
        knowledge ? `ZNALOSTI O PROJEKTU:\n${knowledge}` : '',
      ].filter(Boolean).join('\n\n');
      let res;
      try {
        res = await fetchFn(`${config.aiBaseUrl}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': config.aiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: config.aiModel, max_tokens: 300, system, messages: history }),
        });
      } catch (e) { return { handoff: `AI nedostupná: ${e}` }; }
      if (!res.ok) return { handoff: `AI chyba ${res.status}` };
      const data = await res.json();
      try { await spendFn({ model: config.aiModel, usage: data.usage }); }
      catch (e) { console.error(`ig-automat spendlog selhal (ignoruji): ${e}`); }
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (!text || text.includes('HANDOFF')) return { handoff: 'AI si neví rady' };
      for (const url of text.match(/https?:\/\/[^\s)]+/g) || [])
        if (!allowedLinks.some(a => { try { const u = new URL(url); const v = new URL(a); return u.origin === v.origin && (u.pathname === v.pathname || u.pathname.startsWith(v.pathname.endsWith('/') ? v.pathname : v.pathname + '/')); } catch { return false; } })) return { handoff: `nepovolený odkaz: ${url}` };
      if (/\d[\d\s.]*\s*(kč|czk|eur|€|usd|\$)/i.test(text) && !priceInfo)
        return { handoff: 'AI zmínila cenu bez podkladu' };
      return { text };
    } catch (e) { return { handoff: `AI výjimka: ${e}` }; }
  }
  return { reply };
}
