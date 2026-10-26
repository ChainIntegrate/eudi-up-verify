# UP CIE Link — operazioni sul server

Configurazione concordata il 2026-10-15. Questo file è il riferimento per installare, aggiornare e gestire il
servizio. I file in `deploy/` usano già questi valori.

## 1. Configurazione concordata

| Voce | Valore |
|---|---|
| Server | VPS di ChainIntegrate (indirizzo e accesso SSH nel gestore di password, non nel repository) |
| Dominio | `up-cie-link.chainintegrate.it` (DNS già sul server) |
| Porta interna del backend | **3015** (solo 127.0.0.1; 3014 è di traceability-registry) |
| Codice | **`/var/www/up-cie-link`** (come gli altri progetti web) |
| Utente di sistema | **`up-cie-link`** (dedicato, senza login; home `/home/up-cie-link`) |
| Database | `/var/lib/up-cie-link/up-cie-link.db` (cartella 700) |
| Backup | `/var/backups/up-cie-link` (cartella 700), cifrati con age, timer alle 03:15 |
| Node / PM2 | `/usr/bin/node` (Node 22) e `/usr/bin/pm2` di sistema; versioni esatte nel gestore di password |
| Processo backend | PM2 dell'utente `up-cie-link` (`pm2-up-cie-link.service`), app `up-cie-link` |
| Monitor | timer systemd `up-cie-link-monitor.timer` (ogni ora), configurazione `backend/monitor.env` |
| nginx | `/etc/nginx/sites-available/up-cie-link`, log `/var/log/nginx/up-cie-link.*.log` |
| HTTP/2 | **non attivato** (decisione del 2026-10-15): con la versione di nginx del server l'opzione `http2` su `listen 443` vale per tutti i siti; si rivaluta con nginx ≥ 1.25.1 (`http2 on;` per singolo sito) |
| Rotazione log nginx | giornaliera, 14 file (`/etc/logrotate.d/nginx`, verificato il 2026-10-15) — coerente con l'informativa |
| Rete | LUKSO testnet (4201), RPC pubblico `https://rpc.testnet.lukso.network` |
| Contratto | `0x6A525B5662EF905f3DD90F7139DC3a702b1371BA`, blocco 8745039 (`contracts/deployments/luksoTestnet.json`) |
| Owner | UP testnet `0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C` |
| Attestatore | `0x8F42E3A2a23DE54a8DFa94502f344Cb81062723a` (chiave privata solo in `backend/.env`) |
| Root CIE fissata (`CIE_ROOT_SHA256`) | `40f425927e8a1e6a297a15c2a9d79e2221bf4fe25b2f21e3bfad53a1ba58b0d7` — "National root CA for the Italian Electronic Identity Card" (Ministero dell'Interno), valida fino al 2044-05-16; presente nella Trusted List AgID (controllo del 2026-10-15) |
| Sub CA | SUBCA003, SHA-256 `8f3cce1555f96594d294f00fec381fda9d8bac7271fcbdc8bb8f7766b0e27eee`, valida fino al 2039-05-13 (`backend/trust/` sul server) |
| Installazione | 2026-10-15: backend online (PM2 `pm2-up-cie-link.service` abilitato), timer attivi, primo backup ok, mail ok (`smtps.aruba.it`), HTTPS con certbot (scadenza 2027-01-13, rinnovo automatico) |
| Primo collegamento reale | 2026-10-15: riuscito (UP + CIE reale via CieSign → bollino principale valido) |
| Metadati del bollino | serviti dal nostro dominio (`/metadata/badge.json`, `/metadata/badge-icon.png`), **niente IPFS** (decisione del 2026-10-15: un solo file, sempre uguale; integrità garantita dagli hash on-chain). Non modificarli senza "Aggiorna i metadati" dalla pagina admin; mantenere il dominio finché esistono bollini. Ultimo aggiornamento on-chain: 2026-10-15 (testo "No name, tax code or card data on-chain") |
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
ALLOW_RAW_CHANNEL=false
WALLETCONNECT_PROJECT_ID=<Project ID Reown, lo stesso di Cross_Chain: pubblico>
NOTIFY_EACH_LINK=true
CIE_ROOT_SHA256=<dal passo 2.4>
SMTP_HOST=… SMTP_PORT=… SMTP_SECURE=… SMTP_USER=… SMTP_PASS=… SMTP_FROM=… NOTIFICATION_EMAIL=…  (come il relayer)
BACKUP_DIR=/var/backups/up-cie-link
BACKUP_AGE_RECIPIENT=<chiave pubblica age1… generata sul PC con npm run backup:keygen -- <file>>
```

Il backend non parte se `.env` è leggibile da altri utenti, né se contiene `ATTESTER_PRIVATE_KEY`, `UNIQ_PEPPER` o
`CERT_REF_KEY`: quelli vanno solo nel firmatario (§2.3b).

### 2.3b Firmatario: segreti in un processo separato (audit UCL-08, decisioni S1-S3 del 2026-10-27)

Il backend non vede i tre segreti: li custodisce il **firmatario** (`signer/`), un processo con un suo utente
(`up-cie-link-signer`), **senza rete**, che risponde solo al backend su `/run/up-cie-link-signer/signer.sock`. Calcola
l'impronta del codice fiscale, cifra/decifra il riferimento al certificato e firma solo `attest()` / `invalidate()`
sul contratto indicato, con limiti di frequenza (20 conii l'ora, 100 al giorno; 100 invalidazioni l'ora; 30 impronte
al minuto; 2.000 decifrature al giorno). Oltre i limiti rifiuta: l'utente vede un messaggio chiaro, a te arriva una
mail di problema; se è traffico vero si alzano i limiti in `signer.env` (vedi `signer/signer.env.example`).

Il suo codice sta in `/opt/up-cie-link-signer`, di root e in sola lettura, installato **da un clone nuovo** (mai da
`/var/www/up-cie-link`, scrivibile dall'utente del backend):

```bash
sudo bash -c 'd=$(mktemp -d) && git clone --depth 1 https://github.com/ChainIntegrate/up-cie-link "$d" \
  && bash "$d/deploy/install-signer.sh" && rm -rf "$d"'
```

Lo script crea l'utente, installa il codice e l'unità systemd. Poi i segreti, in un file leggibile solo da root
(systemd lo legge e li passa al processo):

```bash
sudo install -m 600 -o root -g root /dev/null /etc/up-cie-link/signer.env
sudo nano /etc/up-cie-link/signer.env
```

```
ATTESTER_PRIVATE_KEY=<chiave privata di 0x8F42…723a>
UNIQ_PEPPER=<primo openssl rand>
CERT_REF_KEY=<secondo openssl rand>
SIGNER_CONTRACT=<indirizzo del contratto, come in contracts/deployments/<rete>.json>
SIGNER_CHAIN_ID=4201
```

```bash
sudo systemctl enable --now up-cie-link-signer
sudo journalctl -u up-cie-link-signer -n 5 --no-pager   # "[signer] attester 0x8F42…, contract …, socket …"
```

Controlli del backend all'avvio (e ogni minuto finché non passano): versione del protocollo, contratto e rete del
firmatario, chiave = attestatore del contratto, e il **valore di controllo di `UNIQ_PEPPER`**: salvato al primo avvio,
deve restare uguale per sempre. Un `UNIQ_PEPPER` copiato male romperebbe in silenzio "una persona, una UP principale":
il backend lo rifiuta (`PEPPER_MISMATCH`), manda una mail e non accetta file CIE. Il sito resta in linea in ogni caso
(verifica, admin); senza firmatario i file CIE ricevono `SERVICE_UNAVAILABLE` e il monitor segnala `signer_not_ready`.
All'avvio il backend prova anche a decifrare un riferimento al certificato già salvato: se non ci riesce,
`CERT_REF_KEY` è sbagliata (`CERT_REF_KEY_MISMATCH`) e i file CIE vengono rifiutati.

**Passaggio di un'installazione esistente** (i segreti erano in `backend/.env`): il valore di controllo viene salvato
al primo avvio, quindi **prima** di togliere i segreti dal backend si verifica che il firmatario abbia lo stesso
`UNIQ_PEPPER`:

1. installare il firmatario e creare `signer.env` copiando i tre valori da `backend/.env` (passi sopra), avviarlo;
2. confrontare il valore di controllo nel log del firmatario (`pepper check …`) con quello calcolato dal `.env`
   attuale del backend; devono coincidere:

   ```bash
   sudo grep '^UNIQ_PEPPER=' /var/www/up-cie-link/backend/.env | cut -d= -f2- | node -e 'const c=require("crypto");let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(c.createHmac("sha256",Buffer.from(s.trim().replace(/^0x/,""),"hex")).update("up-cie-link:pepper-check:v1").digest("hex").slice(0,32)))'
   sudo journalctl -u up-cie-link-signer -n 5 --no-pager | grep 'pepper check'
   ```
3. solo se coincidono: `git pull`, togliere le tre righe da `backend/.env`, `pm2 reload`. Il backend controlla
   il resto (attestatore, `CERT_REF_KEY` su un riferimento salvato) e lo dice nel log (`signer ready`).

### 2.4 Certificati CIE e prova con l'OCSP reale (audit UCL-06)

Il `.p7m` firmato con CieSign contiene nome, codice fiscale e certificato: non deve mai stare in una cartella
leggibile da altri utenti del server, come `/tmp` (audit UCL-37), e si cancella subito dopo la prova.

Dal PC, in una cartella privata della propria home sul server:

```bash
ssh <utente>@<server> 'install -d -m 700 ~/p7m'
scp <file>.p7m <utente>@<server>:p7m/cie.p7m
```

Sul server, spostarlo nella home dell'utente del servizio (cartella `700`, file `600`):

```bash
sudo install -d -m 700 -o up-cie-link -g up-cie-link /home/up-cie-link/p7m
sudo install -m 600 -o up-cie-link -g up-cie-link ~/p7m/cie.p7m /home/up-cie-link/p7m/cie.p7m
shred -u ~/p7m/cie.p7m
cd /var/www/up-cie-link/backend
sudo -u up-cie-link -H node scripts/trust-extract.js /home/up-cie-link/p7m/cie.p7m trust
```

Lo script scrive in `trust/` solo i certificati delle CA (mai quello del titolare) e stampa le impronte SHA-256.
Confrontare l'impronta della root con quella verificata dallo spike sulla Trusted List AgID, poi scriverla in
`CIE_ROOT_SHA256` nel `.env`. Quindi:

```bash
sudo -u up-cie-link -H node scripts/check-p7m.js /home/up-cie-link/p7m/cie.p7m
sudo -u up-cie-link -H shred -u /home/up-cie-link/p7m/cie.p7m
```

In alternativa, `check-p7m.js` si può eseguire sul PC (con `trust/` e `CIE_ROOT_SHA256` in `backend/.env`): il
`.p7m` non passa dal server.

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

- Se cambia `signer/` o `deploy/systemd/up-cie-link-signer.service`: rieseguire l'installazione del firmatario
  **da un clone nuovo** (§2.3b), poi `sudo systemctl restart up-cie-link-signer`. Il commit installato è in
  `/opt/up-cie-link-signer/COMMIT`.
- Se cambiano gli altri file in `deploy/systemd/`: ricopiarli e `sudo systemctl daemon-reload`.
- Se cambia `deploy/nginx/up-cie-link.conf`: certbot ha modificato la copia in `/etc/nginx`, quindi **non
  sovrascriverla**: confrontare con `diff` e riportare a mano le differenze, poi `sudo nginx -t`.
- Il frontend è servito direttamente dalla cartella del repository: il `git pull` lo aggiorna.

## 4. Operazioni ricorrenti

| Cosa | Comando |
|---|---|
| Log del backend | `sudo -u up-cie-link -H pm2 logs up-cie-link --lines 50 --nostream` |
| Log e stato del firmatario | `sudo journalctl -u up-cie-link-signer -n 50 --no-pager`; lo stato (pronto, limiti) è anche nella pagina admin |
| Limiti del firmatario raggiunti (mail) | se è traffico vero: alzarli in `/etc/up-cie-link/signer.env`, poi `sudo systemctl restart up-cie-link-signer`; se non lo è, **Ferma i conii** e controllare il server |
| Stato del monitor (senza mail) | `cd /var/www/up-cie-link/backend && sudo -u up-cie-link -H node src/monitor.js --dry-run` |
| Backup subito | `sudo systemctl start up-cie-link-backup.service` |
| Ripristino (sul PC o su un altro server) | `npm run restore -- --file <backup.db.gz.age> --identity <chiave age privata> --out restored.db` |
| Richiesta di accesso o cancellazione dei dati | la persona la fa da sola da "Il mio bollino", firmando con la UP (UCL-31). Se scrive per e-mail o Telegram, indicarle quella pagina: **mai** eseguire una richiesta senza una firma della UP |
| Accesso / cancellazione da riga di comando (solo dopo aver verificato la firma) | `sudo -u up-cie-link -H node scripts/data-subject.js export --up 0x…` (in `backend/`); `… erase --up 0x…`, poi lo stesso con `--yes` |
| `security.txt` (`frontend/.well-known/`) | rinnovare il campo `Expires` prima del 2027-10-19 |
| Eccezioni, revoche, metadati, emergenza | pagina `https://up-cie-link.chainintegrate.it/admin` con la UP owner |

Emergenza (chiave dell'attestatore o server compromessi):

1. pagina admin → **Ferma i conii** (attestatore a zero: nessun nuovo bollino, il monitor segnala `attester_zero`);
2. se il **server** era compromesso: reinstallarlo da zero (o su una macchina nuova) seguendo il §2, con segreti
   nuovi; non fidarsi di nulla di ciò che c'era;
3. nuova chiave dell'attestatore: `npm run new-key` in `contracts/` sul PC. **Annotare l'indirizzo fuori dal server**
   (gestore di password): è il riferimento per il passo 5. Chiave privata in `/etc/up-cie-link/signer.env`
   (`ATTESTER_PRIVATE_KEY`), poi `sudo systemctl restart up-cie-link-signer` e
   `sudo -u up-cie-link -H pm2 reload up-cie-link` (con l'attestatore a zero il backend accetta la nuova chiave e
   resta in modalità "conii fermati");
4. pagina admin → **Ripristina l'attestatore**;
5. **prima di firmare** (audit UCL-33): la pagina è servita dal server, quindi se il server fosse ancora compromesso
   potrebbe proporre un altro indirizzo. Confrontare con l'indirizzo annotato al passo 3 sia quello scritto nella
   pagina sia quello nei dati della transazione mostrati dall'estensione UP (`setAttester`: le ultime 40 cifre
   esadecimali dei dati). Firmare solo se coincidono;
6. aggiornare l'indirizzo dell'attestatore in questo file e in `backend/monitor.env`.

Dopo ogni nuovo deploy del contratto (audit UCL-38): il vecchio indirizzo va in `superseded` nel file della rete in
`contracts/deployments/`; la pagina admin lo mostra in "Contratti sostituiti" e con **Ferma i conii** gli mette
l'attestatore a zero.

## 5. Cosa custodire fuori dal server

- `UNIQ_PEPPER` e `CERT_REF_KEY` (senza di loro un backup non serve); sul server sono solo in
  `/etc/up-cie-link/signer.env`, che non entra nei backup;
- chiave privata dell'attestatore;
- chiave privata age dei backup (file generato con `npm run backup:keygen`, mai sul server);
- accesso alla UP owner (controller nell'estensione).

## 6. Passaggio a mainnet (da fare più avanti)

- deploy del contratto in mainnet (`CONFIRM_MAINNET=yes`), verifica, metadati dalla pagina admin; deploy normale,
  **senza** Nick factory (decisione A2 del 2026-10-27: il contratto vive solo su LUKSO);
- stessa chiave dell'attestatore `0x8F42…723a` (decisione A3), con LYX veri per il gas;
- firmatario: `SIGNER_CONTRACT` = nuovo indirizzo e `SIGNER_CHAIN_ID=42` in `/etc/up-cie-link/signer.env`, poi
  riavvio del firmatario e del backend;
- testnet abbandonato (decisione A1): attestatore a zero sul contratto testnet dalla pagina admin; database e backup
  del testnet cancellati quando il mainnet parte (o una copia tenuta fuori dal server, a scelta);
- nel sorgente del contratto il commento di `attest` dice ancora "mese dopo la scadenza": correggerlo prima del deploy
  (oggi la scadenza è il primo giorno del mese della scadenza, UCL-34);
- paternità on-chain: `LSP4Creators` sul contratto e `LSP12IssuedAssets` sulla UP owner (oggi Universal Everything
  mostra ChainIntegrate come creatore e "Asset Maintainer", probabilmente perché la UP è `owner`);
- `NETWORK=luksoMainnet`, `RPC_URL` con la chiave dedicata del nodo ChainIntegrate;
- copia dei backup fuori dal server (audit UCL-25) quando gli utenti saranno in numero discreto (confermato il
  2026-10-27); processo separato per HMAC e firma (UCL-08): fatto e installato sulla VPS il 2026-10-27 (§2.3b);
- informativa: completata il 2026-10-27 (UCL-14); da rileggere prima del mainnet (owner o legale);
- verificare se la policy dei certificati CIE (CP/CPS) consente a un privato di basarsi sul certificato (UCL-13);
- `ALLOW_RAW_CHANNEL=false` finché l'app Android non è pronta (UCL-40);
- `NOTIFY_EACH_LINK=false`.
