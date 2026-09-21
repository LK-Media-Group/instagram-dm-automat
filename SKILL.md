---
name: instagram-dm-automat
description: Nasaďte, nakonfigurujte nebo ověřte vlastní automat pro Instagram DM z tohoto balíčku. Zahrnuje server, Meta webhook, pravidla odpovědí, inbox a volitelnou AI. Použijte pro zprovoznění této aplikace, nikoli pro hromadné nevyžádané zprávy.
---

# Instagram DM automat

Pracujte z kořene tohoto balíčku. Obsahuje skutečnou aplikaci, ne jen zadání k jejímu vytvoření. Zachovejte funkční existující instalaci; novou instalujte do samostatného adresáře a nové databáze.

1. Přečtěte [README.md](README.md). Zjistěte cílový server/OS, přístup, doménu a zda už běží automatizace na témže IG účtu. Zeptejte se pouze na chybějící údaje. Klíče požadujte vložit lokálně do `.env` či správce tajemství, nikoli do chatu nebo příkazového argumentu.
2. Spusťte `npm test` a `npm run demo` na podporovaném Node. Demo je offline, nepoužívá produkční DB ani účty. Nevydávejte ho za skutečné doručení na Instagram.
3. Podle [references/deployment.md](references/deployment.md) zvolte Docker Compose nebo nativní službu. Podporovaná infrastruktura vyžaduje dlouho běžící proces, trvalý disk a HTTPS webhook. Statický hosting a krátké serverless funkce nevyhovují. Neinstalujte další databázi; aplikace používá SQLite.
4. `npm run setup` vytvoří nová lokální tajemství, existující `.env` nepřepíše. Upravte konfiguraci pro cílový server. Veřejně zpřístupněte jen webhook a odkazy na portu 8101 přes HTTPS. Panel 8102 nechte za SSH tunelem/VPN; navíc vyžaduje Basic Auth. V Compose zachovejte vazbu panelu na 127.0.0.1 hostitele.
5. Připojení Meta proveďte podle [references/meta-setup.md](references/meta-setup.md). Zkontrolujte aktuální oficiální dokumentaci i oprávnění v účtu. Nezaměňujte Instagram Login a Facebook Login tokeny; nevymýšlejte zkratku přes cookies či heslo k IG. Tato distribuce má CLI import tokenu, nemá veřejné OAuth připojování účtů.
6. Nastavte jediný pilotní trigger, správné `account_id`, vlastní obsah a odkaz. Výchozí `dry_run=1`, `ai_enabled=0`. Ukázku najdete v [examples/trigger.json](examples/trigger.json); její účet, URL a aktivitu přizpůsobte. AI, Telegram a Ecomail jsou volitelné: nepřipojujte je, pokud je uživatel nechce. AI dostává historii zpráv; Telegram může dostat text DM; Ecomail adresu kontaktu.
7. Ověřte HTTPS handshake, odmítnutí neplatného podpisu, nepřístupnost `/api/accounts` z veřejného hostname a přihlášení do panelu. Zkontrolujte příchozí událost a simulovanou odpověď. Simulace zapisuje historii i deduplikaci; pro ostrý test použijte novou zprávu/komentář.
8. Pokud zadání již zahrnuje ostré spuštění a konkrétní testovací účet/obsah, proveďte domluvený pilot. Jinak nechte `dry_run=1` a vyžádejte si pouze chybějící rozsah ostrého odesílání. Pro pilot vypněte kolidující trigger v jiném automatu, přepněte `dry_run=0`, odešlete novou příchozí zprávu z testovacího účtu a potvrďte doručení na straně příjemce. Při chybě zastavte pilot; neopakujte slepě odeslání s nejasným výsledkem.
9. Předejte adresu panelu/tunel, název služby, umístění souborů, zálohování a rollback z [references/operations.md](references/operations.md). Rozlište lokální testy, nasazený server, připojení Meta a skutečné doručení. Report nesmí obsahovat tokeny, hesla ani texty soukromých DM.

## Důležité provozní hranice

- `dry_run` blokuje odesílání na Instagram, nikoli všechny síťové integrace. Pro offline demo používejte jen `npm run demo`.
- Spouštějte jednu instanci na jednu DB. Přepnutí konverzace na člověka zastaví bot odpovědi a follow-upy.
- Meta omezuje odpovědi a přístup k účtům; aplikace tato oprávnění neudělí. U komentářů není 24hodinové DM okno otevřené, dokud uživatel neinteraguje ve zprávách.
- Nejprve jednoduchá pravidla. AI smí využít vlastní schválené znalosti v `prompts/knowledge.md`, ale prompt není zárukou věcné správnosti. Nezapínejte AI bez kontroly obsahu a testů na vašich dotazech.
- Neexportujte `.env`, DB, logy, původní historii Gitu ani místní konverzace. Záloha DB obsahuje i tokeny.
