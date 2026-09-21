# Nasazení na vlastní server

## Předpoklady

Linux VPS s Docker Compose v2 **nebo** Node.js 24 a správcem služeb; trvalý lokální disk, DNS doména/subdoména, SSH přístup. Nastavte DNS A/AAAA na server (AAAA pouze při funkční IPv6). Pro Caddy musí být dostupné porty 80/443. Nesdílejte existující porty bez kontroly konfigurace.

Návod spouštějte z kořene balíčku. Nejdřív `npm test` a `npm run demo`. Pokud Node není na hostiteli, použijte oficiální Docker image:

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:24-bookworm-slim npm test
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:24-bookworm-slim npm run setup
```

Pokud máte Node, stačí `npm run setup`. Existující `.env` se nikdy nepřepisuje.

## Konfigurace

Upravte místní `.env` (chmod 600). `PUBLIC_DOMAIN` = skutečný hostname, `PUBLIC_BASE` = `https://váš-hostname/ig-webhook` bez koncového lomítka. Vložte Meta secret a verify token podle [meta-setup.md](meta-setup.md). `ADMIN_PASSWORD` a `WEBHOOK_VERIFY_TOKEN` generuje setup. Nastavení `META_APP_ID` je evidenční, token se připojuje CLI. Integrace bez klíčů zůstávají vypnuté.

`npm run check` kontroluje formát a chybějící pole; nedokazuje funkční DNS, Meta oprávnění ani doručení. V Docker variantě ho spusťte stejným jednorázovým `docker run` jako setup, jen s `npm run check`.

## Varianta A: Docker + HTTPS

```sh
docker compose --env-file .env -f deploy/compose.yaml up -d --build
docker compose --env-file .env -f deploy/compose.yaml ps
docker compose --env-file .env -f deploy/compose.yaml logs --tail=50 app caddy
```

Caddy automaticky zajistí certifikát. Aplikace i Caddy používají trvalé pojmenované volumes. Veřejně je routováno jen `/ig-webhook` a jeho podcesty. Panel je na **loopbacku hostitele** 8102; uvnitř kontejneru aplikace poslouchá na všech rozhraních, ale port 8101 není publikovaný hostiteli.

Na svém počítači otevřete tunel (nahraďte uživatele a server):

```sh
ssh -N -L 8102:127.0.0.1:8102 USER@SERVER
```

Pak otevřete `http://127.0.0.1:8102` a přihlaste se `admin` / heslem z `.env`. HTTP je zde pouze uvnitř lokálního SSH tunelu. Panel nevystavujte nešifrovaným veřejným HTTP.

Pokud už máte nginx/Caddy/Traefik, zachovejte jej. Spusťte pouze app a připojte jeho webhook do svého proxy; neroutujte veřejnou doménu na panel 8102. Konfiguraci původního proxy před změnou zálohujte. Pro hostitelský proxy přidejte app pouze loopback port `127.0.0.1:8101:8101`, nikoli `8101:8101`.

## Varianta B: nativní Node + systemd

1. Vytvořte systémový účet `ig-automat` bez přihlašování. Balíček uložte do `/opt/ig-automat` (z čistého ZIPu/repa, ne z provozní kopie).
2. Spusťte setup, upravte `.env`. Vlastníkem `.env` a adresáře `data/` musí být `ig-automat`; `.env` 600 a data 700. Aplikační kód může být root-owned/read-only. Ověřte skutečnou cestu `command -v node`; v `deploy/ig-automat.service` přizpůsobte `ExecStart`. Vyhněte se Node instalovanému pod domovem jiného uživatele.
3. Zkopírujte jednotku do `/etc/systemd/system/ig-automat.service`, spusťte `sudo systemctl daemon-reload` a `sudo systemctl enable --now ig-automat`.
4. Ověřte `systemctl status ig-automat` a `journalctl -u ig-automat -n 50`. Nativní konfigurace má oba listenery pouze na 127.0.0.1.
5. Ve vlastním HTTPS reverse proxy routujte pouze `/ig-webhook` a `/ig-webhook/*` na `127.0.0.1:8101`. Například hostitelský Caddy použije blok z `deploy/Caddyfile`, kde `{$PUBLIC_DOMAIN}` nahradíte svou doménou a `app:8101` hodnotou `127.0.0.1:8101`. Nenahrazujte celý existující Caddyfile, přidejte samostatný site blok.
6. Panel otevírejte přes výše uvedený SSH tunel.

Na jiných OS lze Node proces spustit pod odpovídajícím správcem služby; dodaná systemd jednotka je pouze pro Linux. Vždy zachovejte trvalou DB, jednu instanci, oddělení portů a HTTPS.

## Kontrola hranic

- Veřejné `https://váš-hostname/api/accounts` vrací 404.
- Panel bez přihlášení vrací 401, s přihlášením `/api/health` vrací `{"ok":true}`.
- Veřejný POST na `/ig-webhook` bez podpisu vrací 403.
- Webhook verification v Meta projde a platný test se objeví v inboxu.

Samotné „container healthy“ neověřuje Meta ani doručení. Před ostrým pilotem pokračujte [meta-setup.md](meta-setup.md).
