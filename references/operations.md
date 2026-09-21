# Provoz, záloha a řešení chyb

## Pravidla a AI

V panelu Triggery vyberte účet, typ, klíčové slovo a text. Ukázková `examples/trigger.json` je neaktivní a s fiktivní URL. Pro formulář vložte `text` do pole Text DM a zbytek šablony (`buttons`, `steps`) do JSON pole. `account_id` zjistíte v panelu; nepočítejte automaticky s 1. Klíčová slova se porovnávají jako části textu bez diakritiky a bez rozlišení velikosti; například „ano“ může odpovídat i části delšího slova. Pilotní pravidla proto volte jednoznačně.

Kroky s postback tlačítky používají `steps`; payload se automaticky označí ID triggeru. Follow-upy jsou JSON pole `[{"delay_min":60,"text":"..."}]`. Po kliku na trackovaný odkaz se follow-up přeskočí. Není to neomezená sekvence: stále platí DM okno. Předání člověku v inboxu automatiku dané konverzace pozastaví.

AI: nastavte klíč/model, doplňte znalosti a povolené odkazy. `ai_style` mění styl a jazyk. `ai_daily_limit` je počet odpovědí na jednu konverzaci a UTC den, nikoli globální finanční limit. Nejasný dotaz nebo selhání modelu vede na handoff. Ceny kontroluje prompt a základní filtr; ani s podklady nelze zaručit správné částky. Začněte bez AI a bez sběru e-mailu, pokud je nepotřebujete.

## Zálohování

DB obsahuje tajemství i osobní údaje. Zálohujte ji do neveřejného, ideálně šifrovaného úložiště; nikdy ji nepřikládejte k chybě do veřejného issue. Prostá kopie živého `.db` bez WAL nemusí být konzistentní. Dodaný skript používá SQLite `VACUUM INTO`:

```sh
node scripts/backup.mjs /soukroma/cesta/nova-zaloha.db
```

Cílový adresář musí existovat, cílový soubor naopak nesmí existovat. Nativně spouštějte pod účtem služby. Pro Docker můžete vytvořit zálohu uvnitř volume a pak ji zkopírovat ven:

```sh
docker compose --env-file .env -f deploy/compose.yaml exec -T app node scripts/backup.mjs /app/data/backup-new.db
docker compose --env-file .env -f deploy/compose.yaml cp app:/app/data/backup-new.db ./backup-new.db
chmod 600 backup-new.db
```

Zálohu poté přesuňte do vlastního neveřejného zálohovacího úložiště. Zálohujte i `.env` odděleně a soukromě. Obnovu nejprve vyzkoušejte v izolované instalaci s `dry_run=1` a odpojenými integracemi. Při obnově zastavte app, původní DB **včetně** `-wal` a `-shm` přesuňte do záložního adresáře a nahraďte konzistentní zálohou. Zachovejte vlastníka a práva. Nespouštějte dvě instance nad jednou DB.

## Aktualizace / rollback

Zaznamenejte commit/verzi, zazálohujte DB i `.env`, aktualizujte pouze kód. Před spuštěním spusťte testy. Docker znovu sestavte přes `up -d --build`; data zůstávají ve volume. Nikdy neprovádějte `down -v`, pokud nechcete ztratit volume.

Při problému vraťte `dry_run=1`, deaktivujte dotčené triggery nebo zastavte službu. Předem rozpracované síťové odeslání může ještě doběhnout. Pro návrat verze použijte předchozí kód; po nekompatibilní změně schématu i odpovídající zálohu. Nevracejte bez rozmyslu starou DB po ostrém provozu: návrat deduplikačních dat může vést k opakování odpovědi. Existující komerční automat během pilotu zachovejte, ale vypněte kolidující pravidla, aby neposílaly oba systémy současně.

## Diagnostika

| Příznak | Kontrola |
|---|---|
| Server nenastartuje | Node s node:sqlite, dlouhé ADMIN_PASSWORD, rozdílné porty, práva k DB, formát PUBLIC_BASE |
| Panel 401 | Uživatel/heslo z .env, restart po jejich změně; prohlížeč může držet staré Basic Auth |
| Veřejný panel 404 | Je správně; použijte SSH tunel na 8102 |
| Meta verification selže | DNS, HTTPS, cesta /ig-webhook, přesná shoda verify tokenu |
| Webhook POST 403 | Secret správné app/subscription a nezměněné raw tělo požadavku |
| Události vůbec nepřicházejí | App webhooks i subscribed_apps konkrétního účtu, role, oprávnění, povolení zpráv |
| Simulace funguje, DM nedorazí | dry_run, oprávnění/testovací role, 24h okno, nový testovací event; zkontrolujte příjemce |
| Komentář podruhé nic nespustí | Deduplikace platí i pro dry-run; použijte nový komentář |
| AI předává člověku | Model/klíč, chybějící znalosti, nepovolená URL, limit odpovědí |
| Token nefunguje | Expirace/odvolání oprávnění, obnovte nebo znovu připojte vlastní token |

Po pádu procesu nebo timeoutu nelze z HTTP odpovědi vždy poznat, zda Meta zprávu přijala. Nejprve ověřte inbox/příjemce, potom rozhodněte o opakování. Logy jsou soukromé: v simulaci obsahují obsah zpráv. Webhook raw data zůstávají 30 dnů, ostatní data do ručního odstranění.
