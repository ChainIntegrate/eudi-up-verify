# UP CIE Link — operazioni sul server

Configurazione concordata il 2026-10-15. Questo file è il riferimento per installare, aggiornare e gestire il
servizio. I file in `deploy/` usano già questi valori.

## 1. Configurazione concordata

| Voce | Valore |
|---|---|
| Server | VPS `Simone1`, IP 31.14.140.170 (nginx davanti a tutti i progetti) |
| Dominio | `up-cie-link.chainintegrate.it` (DNS già sul server) |
| Porta interna del backend | **3015** (solo 127.0.0.1; 3014 è di traceability-registry) |
| Codice | **`/var/www/up-cie-link`** (come gli altri progetti web) |
| Utente di sistema | **`up-cie-link`** (dedicato, senza login; home `/home/up-cie-link`) |
| Database | `/var/lib/up-cie-link/up-cie-link.db` (cartella 700) |
| Backup | `/var/backups/up-cie-link` (cartella 700), cifrati con age, timer alle 03:15 |
| Node / PM2 | `/usr/bin/node` v22.23.2, `/usr/bin/pm2` 6.0.14 (verificati il 2026-10-15) |
| Processo backend | PM2 dell'utente `up-cie-link` (`pm2-up-cie-link.service`), app `up-cie-link` |
| Monitor | timer systemd `up-cie-link-monitor.timer` (ogni ora), configurazione `backend/monitor.env` |
| nginx | `/etc/nginx/sites-available/up-cie-link`, log `/var/log/nginx/up-cie-link.*.log` |
| Rotazione log nginx | giornaliera, 14 file (`/etc/logrotate.d/nginx`, verificato il 2026-10-15) — coerente con l'informativa |
| Rete | LUKSO testnet (4201), RPC pubblico `https://rpc.testnet.lukso.network` |
| Contratto | `0x6A525B5662EF905f3DD90F7139DC3a702b1371BA`, blocco 8745039 (`contracts/deployments/luksoTestnet.json`) |
| Owner | UP testnet `0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C` |
| Attestatore | `0x8F42E3A2a23DE54a8DFa94502f344Cb81062723a` (chiave privata solo in `backend/.env`) |
| Root CIE fissata (`CIE_ROOT_SHA256`) | `40f425927e8a1e6a297a15c2a9d79e2221bf4fe25b2f21e3bfad53a1ba58b0d7` — "National root CA for the Italian Electronic Identity Card" (Ministero dell'Interno), valida fino al 2044-05-16; presente nella Trusted List AgID (controllo del 2026-10-15) |
| Sub CA | SUBCA003, SHA-256 `8f3cce1555f96594d294f00fec381fda9d8bac7271fcbdc8bb8f7766b0e27eee`, valida fino al 2039-05-13 (`backend/trust/` sul server) |
| Installazione | 2026-10-15: backend online (PM2 `pm2-up-cie-link.service` abilitato), timer attivi, primo backup ok, mail ok (`smtps.aruba.it`), HTTPS con certbot (scadenza 2027-01-13, rinnovo automatico) |
| Primo collegamento reale | 2026-10-15: UP `0xC014c2cAd97F3D5d5fdBD6E09DA1e856E0659927` + CIE reale via CieSign → bollino principale valido, scadenza 2034-03-01 (primo giorno del mese dopo la scadenza della carta) |
| Prova OCSP reale | `check-p7m` con una CIE reale: **CHECK OK** il 2026-10-15 (audit UCL-06) |

Comandi come utente del servizio: `sudo -u up-cie-link -H <comando>`.

## 2. Installazione (una volta)

### 2.1 Utente e cartelle

```bash
sudo useradd --system --create-home --home-dir /home/up-cie-link --shell /usr/sbin/nologin up-cie-link
sudo install -d -m 755 -o up-cie-link -g up-cie-link /var/www/up-cie-link
sudo install -d -m 700 -o up-cie-link -g up-cie-link /var/lib/up-cie-link /var/backups/up-cie-link
```

### 2.2 Codice e dipendenze

```bash
sudo -u up-cie-link -H git clone https://github.com/ChainIntegrate/up-cie-link.git /var/www/up-cie-link
cd /var/www/up-cie-link/backend
sudo -u up-cie-link -H npm ci --omit=dev
```

(Se il repository è privato, il clone chiede le credenziali GitHub: usare un token in sola lettura.)

### 2.3 Segreti e configurazione del backend

Sul PC (una volta), nella cartella `backend` del repository, la coppia di chiavi age per i backup:

```bash
npm ci --ignore-scripts
npm run backup:keygen -- up-cie-link-backup-key.txt
```

Il file contiene la chiave **privata**: resta sul PC (e in una copia sicura), mai sul server. Il comando stampa la
chiave **pubblica** `age1…` da mettere in `BACKUP_AGE_RECIPIENT`.

Generare i due segreti e **copiarli subito nel gestore di password** (senza di loro i backup sono inutili):

```bash
openssl rand -hex 32   # UNIQ_PEPPER
openssl rand -hex 32   # CERT_REF_KEY
```

```bash
cd /var/www/up-cie-link/backend
sudo -u up-cie-link cp .env.example .env
sudo chmod 600 .env
sudo -u up-cie-link -H nano .env
```

Valori da impostare in `backend/.env`:

```
NETWORK=luksoTestnet
RPC_URL=https://rpc.testnet.lukso.network
PORT=3015
PUBLIC_ORIGIN=https://up-cie-link.chainintegrate.it
DB_PATH=/var/lib/up-cie-link/up-cie-link.db
ALLOW_CADES_UPLOAD=true
NOTIFY_EACH_LINK=true
ATTESTER_PRIVATE_KEY=<chiave privata di 0x8F42…723a>
UNIQ_PEPPER=<primo openssl rand>
CERT_REF_KEY=<secondo openssl rand>
CIE_ROOT_SHA256=<dal passo 2.4>
SMTP_HOST=… SMTP_PORT=… SMTP_SECURE=… SMTP_USER=… SMTP_PASS=… SMTP_FROM=… NOTIFICATION_EMAIL=…  (come il relayer)
BACKUP_DIR=/var/backups/up-cie-link
BACKUP_AGE_RECIPIENT=<chiave pubblica age1… generata sul PC con npm run backup:keygen -- <file>>
```

Il backend non parte se `.env` è leggibile da altri utenti.

### 2.4 Certificati CIE e prova con l'OCSP reale (audit UCL-06)

Dal PC, copiare il `.p7m` firmato con CieSign (contiene dati personali: si cancella subito dopo):

```bash
scp <file>.p7m ubuntu@31.14.140.170:/tmp/cie.p7m
```

Sul server:

```bash
cd /var/www/up-cie-link/backend
sudo -u up-cie-link -H node scripts/trust-extract.js /tmp/cie.p7m trust
```

Lo script scrive in `trust/` solo i certificati delle CA (mai quello del titolare) e stampa le impronte SHA-256.
Confrontare l'impronta della root con quella verificata dallo spike sulla Trusted List AgID, poi scriverla in
`CIE_ROOT_SHA256` nel `.env`. Quindi:

```bash
sudo -u up-cie-link -H node scripts/check-p7m.js /tmp/cie.p7m
shred -u /tmp/cie.p7m
```

`CHECK OK` = firma, certificato, catena e risposta OCSP reale del Ministero accettate dal backend. Se esce
`CHECK FAILED`, mandare il codice (non contiene dati personali) prima di andare avanti.

### 2.5 Configurazione del monitor (senza chiavi private)

```bash
cd /var/www/up-cie-link/backend
sudo -u up-cie-link cp monitor.env.example monitor.env
sudo chmod 600 monitor.env
sudo -u up-cie-link -H nano monitor.env
```

Valori: `PORT=3015`, `DB_PATH=/var/lib/up-cie-link/up-cie-link.db`, `BACKUP_DIR=/var/backups/up-cie-link`,
`ATTESTER_ADDRESS=0x8F42E3A2a23DE54a8DFa94502f344Cb81062723a`, SMTP come sopra.

### 2.6 Avvio del backend con PM2

L'attestatore deve avere qualche LYXt (faucet testnet) per pagare il gas dei conii.

```bash
cd /var/www/up-cie-link
sudo -u up-cie-link -H pm2 start deploy/ecosystem.config.cjs
sudo -u up-cie-link -H pm2 logs up-cie-link --lines 20 --nostream
sudo -u up-cie-link -H pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u up-cie-link --hp /home/up-cie-link
curl -s http://127.0.0.1:3015/api/health
```

Nei log deve comparire `up-cie-link backend on 127.0.0.1:3015 (luksoTestnet, contract 0x6A52…)`.

### 2.7 Timer di monitor e backup

```bash
cd /var/www/up-cie-link
sudo cp deploy/systemd/up-cie-link-monitor.* deploy/systemd/up-cie-link-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now up-cie-link-monitor.timer up-cie-link-backup.timer
sudo -u up-cie-link -H node backend/src/monitor.js --test-email
sudo systemctl start up-cie-link-backup.service && journalctl -u up-cie-link-backup -n 5 --no-pager
sudo systemctl start up-cie-link-monitor.service && journalctl -u up-cie-link-monitor -n 20 --no-pager
systemctl list-timers 'up-cie-link-*'
```

### 2.8 Sito (nginx + TLS)

```bash
cd /var/www/up-cie-link
sudo cp deploy/nginx/up-cie-link.conf /etc/nginx/sites-available/up-cie-link
sudo ln -s /etc/nginx/sites-available/up-cie-link /etc/nginx/sites-enabled/up-cie-link
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d up-cie-link.chainintegrate.it
```

### 2.9 Controlli finali

```bash
curl -sI https://up-cie-link.chainintegrate.it/ | grep -i "strict-transport\|content-security"
curl -s https://up-cie-link.chainintegrate.it/api/config
curl -s -o /dev/null -w '%{http_code}\n' https://up-cie-link.chainintegrate.it/api/health   # 404 da fuori
curl -s https://up-cie-link.chainintegrate.it/metadata/badge.json | sha256sum                # = file nel repo
```

Poi, dal browser: pagina `/admin` con la UP owner (stato del servizio e metadati "aggiornati"), quindi un
collegamento completo con una UP reale e la CIE.

## 3. Aggiornamenti

```bash
cd /var/www/up-cie-link
sudo -u up-cie-link -H git pull --ff-only
(cd backend && sudo -u up-cie-link -H npm ci --omit=dev)   # solo se backend/package-lock.json è cambiato
sudo -u up-cie-link -H pm2 reload up-cie-link
```

- Se cambiano i file in `deploy/systemd/`: ricopiarli e `sudo systemctl daemon-reload`.
- Se cambia `deploy/nginx/up-cie-link.conf`: certbot ha modificato la copia in `/etc/nginx`, quindi **non
  sovrascriverla**: confrontare con `diff` e riportare a mano le differenze, poi `sudo nginx -t`.
- Il frontend è servito direttamente dalla cartella del repository: il `git pull` lo aggiorna.

## 4. Operazioni ricorrenti

| Cosa | Comando |
|---|---|
| Log del backend | `sudo -u up-cie-link -H pm2 logs up-cie-link --lines 50 --nostream` |
| Stato del monitor (senza mail) | `cd /var/www/up-cie-link/backend && sudo -u up-cie-link -H node src/monitor.js --dry-run` |
| Backup subito | `sudo systemctl start up-cie-link-backup.service` |
| Ripristino (sul PC o su un altro server) | `npm run restore -- --file <backup.db.gz.age> --identity <chiave age privata> --out restored.db` |
| Richiesta di accesso ai dati | `sudo -u up-cie-link -H node scripts/data-subject.js export --up 0x…` (in `backend/`) |
| Richiesta di cancellazione | `… data-subject.js erase --up 0x…`, poi lo stesso con `--yes` |
| Eccezioni, revoche, metadati, emergenza | pagina `https://up-cie-link.chainintegrate.it/admin` con la UP owner |

Emergenza (chiave dell'attestatore o server compromessi):

1. pagina admin → **Ferma i conii** (attestatore a zero: nessun nuovo bollino, il monitor segnala `attester_zero`);
2. se serve una chiave nuova: `npm run new-key` in `contracts/` sul PC, nuova chiave privata in `backend/.env`,
   `sudo -u up-cie-link -H pm2 reload up-cie-link` (con l'attestatore a zero il backend parte comunque, in modalità
   "conii fermati");
3. pagina admin → **Ripristina l'attestatore**: imposta come attestatore la chiave ora configurata sul server;
4. aggiornare l'indirizzo dell'attestatore in questo file e in `backend/monitor.env`.

## 5. Cosa custodire fuori dal server

- `UNIQ_PEPPER` e `CERT_REF_KEY` (senza di loro un backup non serve);
- chiave privata dell'attestatore;
- chiave privata age dei backup (file generato con `npm run backup:keygen`, mai sul server);
- accesso alla UP owner (controller nell'estensione).

## 6. Passaggio a mainnet (da fare più avanti)

- deploy del contratto in mainnet (`CONFIRM_MAINNET=yes`), verifica, metadati dalla pagina admin;
- `NETWORK=luksoMainnet`, `RPC_URL` con la chiave dedicata del nodo ChainIntegrate;
- WalletConnect per UP Wallet Android (docs/03-frontend.md §5);
- copia dei backup fuori dal server (audit UCL-25), processo separato per HMAC e firma (UCL-08);
- informativa con il titolare ("ChainIntegrate SRLS" o "ChainIntegrate, servizi di Simone Cavalletti", UCL-14);
- `NOTIFY_EACH_LINK=false`.
