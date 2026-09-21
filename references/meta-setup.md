# Meta / Instagram Login

Používejte profesionální účet (Business nebo Creator) a vlastní Meta aplikaci s produktem Instagram API **with Instagram Login**. Osobní consumer účet pro tuto integraci nestačí. Nezaměňujte tuto cestu s Facebook Login/Page tokeny.

Oficiální zdroje, které při instalaci zkontrolujte:

- [Meta: Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/)
- [Meta: Messaging API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/)
- [Meta: Private replies](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/private-replies/)
- [Oficiální Meta kolekce v Postmanu](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login)

Kolekce Meta potvrzuje profesionální účty a oprávnění `instagram_business_basic`, `instagram_business_manage_messages` a `instagram_business_manage_comments`. Aplikace nepublikuje média, takže `instagram_business_content_publish` nepotřebuje. Dostupnost oprávnění, režim aplikace a případný App Review/Advanced Access ověřte přímo v aktuálním dashboardu Meta; testovací role samy nezaručují provoz pro libovolné cizí účty.

## Postup

1. V Meta developers dashboardu vytvořte/otevřete svou aplikaci a nastavte Instagram Login. Přidejte svůj profesionální účet/testera a potvrďte pozvánku. Povolte přístup propojených nástrojů ke zprávám v nastavení Instagramu.
2. Zkopírujte secret příslušné aplikace do `.env`: `META_APP_SECRET`; pokud webhook subscription používá rodičovskou Meta aplikaci, doplňte také `META_PARENT_APP_SECRET`. Secret rodičovské aplikace a Instagram produktu nejsou vždy stejný. Nevypínejte ověřování podpisu kvůli chybě.
3. V aplikaci nastavte callback `https://váš-hostname/ig-webhook`, verify token z místní `.env` a odběr `messages`, `messaging_postbacks`, `comments`. Verify token je váš náhodný řetězec; není to přístupový token. Restartujte službu po změně `.env`.
4. Vygenerujte **dlouhodobý** Instagram User access token pro vlastní účet a požadovaná oprávnění. Krátkodobý token nejprve podle aktuální dokumentace vyměňte za dlouhodobý. Přihlašování a potřebná potvrzení proveďte jako vlastník účtu.
5. Importujte token do CLI přes stdin. Například v bash ho načtěte skrytě, mimo historii příkazů:

```bash
read -rs -p 'Instagram access token: ' IG_CONNECT_TOKEN
printf '\n'
printf '%s' "$IG_CONNECT_TOKEN" | node scripts/connect-account.mjs
unset IG_CONNECT_TOKEN
```

Pro Docker ve stejném postupu nahraďte druhý `printf ... | node ...` tímto:

```bash
printf '%s' "$IG_CONNECT_TOKEN" | docker compose --env-file .env -f deploy/compose.yaml exec -T app node scripts/connect-account.mjs
```

Při nativní instalaci spusťte CLI pod účtem služby v `/opt/ig-automat`, aby DB nezměnila vlastníka. Nevkládejte token do argumentu příkazu ani do Git repa. CLI prověří `/me`, přihlásí účet k webhookům a teprve po potvrzení uloží token. Volitelné `IG_TOKEN_EXPIRES_AT` je ověřený Unix čas expirace; bez něj se uloží 0 = neznámá expirace a server se pokusí token obnovit. Obnova může u čerstvého tokenu selhat; ověřte stav později v logu/panelu. Nepovažujte token za neomezený.

6. V panelu si ověřte účet, založte pilotní trigger se správným účtem a nejdřív ponechte `dry_run=1`. U komentáře omezte `media_scope` na testovací příspěvek. Z jiného testovacího IG účtu napište klíčové slovo. Sledujte inbox a log.
7. Pro skutečný pilot použijte novou zprávu/komentář a `dry_run=0`, až je ostré odesílání v rozsahu zadání. Ověřte přijetí přímo na Instagramu. Pak podle zadání vraťte simulaci, nebo ponechte domluvené pravidlo aktivní.

## Omezení zpráv

Kód drží běžné DM v 24hodinovém okně od příchozí interakce a nepoužívá HUMAN_AGENT k automatickému prodlužování. Private reply na komentář eviduje jednou; události starší než 7 dnů (pokud mají timestamp) zahodí. Konečná oprávnění a limity vynucuje Meta. Komentář sám neotevírá běžné DM okno; další kroky čekají na reakci uživatele. Automat nepodporuje obcházení těchto pravidel ani cold DM.
