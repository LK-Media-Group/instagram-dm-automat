# Instagram DM automat

Vlastní aplikace pro odpovědi na příchozí Instagram zprávy a vybrané komentáře, s webovým inboxem a instalačním skillem pro LLM asistenty. Pravidla fungují bez placeného modelu. AI odpovědi přes Anthropic Messages API lze zapnout samostatně.

## Použití s AI asistentem

V asistentovi s podporou skillů a přístupem k souborům/terminálu zadejte:

> Nainstalujte mi skill z tohoto GitHubu a ukažte mi, jak ho použít: https://github.com/LK-Media-Group/instagram-dm-automat

Nebo stáhněte ZIP, rozbalte jej a požádejte asistenta: „Přečtěte SKILL.md v tomto balíčku a podle něj mi zprovozněte Instagram DM automat.“ Při instalaci skillu zachovejte **celý adresář balíčku**, nejen SKILL.md; obsahuje i aplikaci. Podpora instalace se liší podle asistenta. Samotný obyčejný chat server nezřídí. Soukromé repo vyžaduje přístup; ZIP funguje bez přístupu ke GitHubu.

## Co obsahuje

- Pravidla pro klíčová slova v DM a komentářích, story replies a zmínky ve stories.
- Šablony odpovědí, tlačítka a kroky, trackované odkazy, follow-upy v otevřeném okně.
- Inbox s předáním konverzace člověku, více vlastních připojených účtů, základní statistiky.
- Volitelnou AI nad vlastními znalostmi, Telegram notifikace a synchronizaci e-mailu do Ecomailu.
- Offline demo, testy, Docker + Caddy a vzor služby systemd.

Jde o jednu instalaci pro jednoho správce, nikoli o SaaS s oddělenými zákaznickými přístupy. Šablony i rozhraní jsou česky; texty a jazyk AI lze přizpůsobit.

## Rychlé vyzkoušení bez klíčů

Použijte podporovaný Node.js s `node:sqlite` (minimum 22.13; pro nové nasazení Node 24 LTS). Aplikace nemá npm závislosti.

```sh
npm test
npm run demo
npm run setup
npm start
```

Po setupu je panel na `http://127.0.0.1:8102`. Prohlížeč se zeptá na uživatele `admin` a vygenerované `ADMIN_PASSWORD` z místní `.env`. Demo je pouze konzolové a používá paměťovou DB; panel bude zprvu prázdný. `npm start` bez nastavení Meta nic nepřipojí. Pro produkci upravte `.env` a spusťte `npm run check`.

## Nasazení

[Kompletní nasazení](references/deployment.md) → [Připojení Meta](references/meta-setup.md) → [Provoz a řešení chyb](references/operations.md).

Přenositelnost znamená server s dlouho běžícím Node procesem nebo Dockerem, trvalým diskem a veřejným HTTPS endpointem. Není nutný konkrétní cloud ani VPN produkt. Statický hosting, běžný PHP hosting bez Node a krátké serverless funkce pro tuto verzi nejsou vhodné.

## Co si nastavíte sami

Vlastní profesionální Instagram účet, Meta aplikaci a její oprávnění, doménu a server. Přístupový token vložíte do připojovacího CLI přes stdin. Žádné klíče, účty ani provozní databáze nejsou součástí distribuce. Výchozí API verze je `v23.0` převzatá z integrace; při nasazení ověřte její podporu a případně nastavte `GRAPH_API_VERSION`.

AI je vypnutá. Pokud ji chcete, doplňte vlastní `AI_API_KEY`, ověřte dostupnost `AI_MODEL`, vyplňte `prompts/knowledge.md` a nastavení v panelu. Podporován je formát Anthropic Messages, nikoli automaticky každé „OpenAI-compatible“ API. Vlastní server a volání modelu mají vlastní náklady.

## Hranice a data

`dry_run=1` simuluje Instagram odeslání, ale ukládá zprávy, statistiky a deduplikaci. Tyto záznamy nejsou potvrzením doručení. AI a další zapnuté integrace mohou i při dry-run volat síť. Offline demo žádnou síť nevolá.

DB obsahuje přístupové tokeny, zprávy, kontakty a kliky. Chraňte disk i zálohy. Raw webhooky se mažou po 30 dnech; historie zpráv a kontakty se automaticky nemažou. Retenci si nastavte podle svého provozu. Nastavení Ecomailu může spouštět jeho autorespondery: připojujte jej jen s odpovídajícím souhlasem kontaktů a zkontrolovaným seznamem. Telegram může přenášet obsah DM, AI jejich poslední historii.

Zpracování webhooků a fronta nejsou garancí přesně jednoho doručení při pádu procesu či nejistém výsledku síťového volání. Při takovém incidentu nejdřív zkontrolujte inbox. Aplikace není plnou náhradou všech funkcí komerčních automatizačních platforem a nemá trigger „nový sledující“.

## Licence

MIT, viz [LICENSE](LICENSE).
