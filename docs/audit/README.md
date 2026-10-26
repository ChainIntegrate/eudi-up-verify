# Audit — tracciamento

Report: [`AUDIT-2026-10-14.md`](AUDIT-2026-10-14.md) (14-15 ottobre 2026, revisione `b5d4217`), conservato senza
modifiche. Qui lo stato di ogni punto. Stati: **aperto**, **risolto** (con commit e test), **parziale**,
**da fare dall'owner**, **accettato** (rischio accettato, con motivo), **rinviato** (con quando).

Decisioni dell'owner del 2026-10-15: Gruppo 1 tutto come proposto; UCL-03 scadenza al primo giorno del mese successivo
alla scadenza della carta; UCL-05/21 nuovo deploy; UCL-07, 08, 10, 11, 19 come proposto; UCL-25 rinviato (copia esterna quando gli utenti saranno in numero discreto); UCL-27
"ChainIntegrate"; UCL-30 Telegram più e-mail; UCL-13 e UCL-14 vedi sotto.

Ogni correzione porta nel messaggio di commit l'ID del punto.

## Stato

| ID | Sev. | Titolo | Cosa è stato fatto | Commit | Stato |
|---|---|---|---|---|---|
| UCL-01 | High | Conii bloccati dopo una transazione fallita | Wallet senza NonceManager, nonce letto dal nodo senza cache, simulazione (`staticCall`) prima di ogni invio, attesa con timeout (`TX_TIMEOUT` con l'hash); allarmi del monitor su conii aperti e coda ferma; test di regressione A.1 e transazione non minata | `a5b79a5`, `3c57cf9` | risolto |
| UCL-02 | High | Conti alla rovescia vecchi interrompono la firma CIE | timer e polling si fermano quando il loro passo non è più in pagina; test con orologio finto (fallisce sul codice vecchio) | `817d369` | risolto |
| UCL-03 | Medium | `expiresAt` rivela il compleanno e collega le UP | scadenza on-chain = primo giorno del mese successivo alla scadenza della carta (poi, con UCL-34, primo giorno del mese della scadenza); motivo on-chain sempre `INVALIDATED`; informativa: migrazione collegabile, cosa dice il bollino | `bad21d1`, `8d59cab` | risolto (residuo sotto) |
| UCL-04 | Medium | Conio non registrato rompe l'unicità | tabella `mints` scritta prima dell'invio, hash salvato subito, `reconcileMints()` all'avvio e ogni minuto; un conio aperto blocca nuove richieste della stessa persona/UP | `bad21d1` | risolto |
| UCL-05 | Medium | Contratti "simil-UP", `renounce()` rientrante | contratto: `nonReentrant`, `Attested` prima del mint; backend: `owner()` deve essere un Key Manager LSP6 con `target()` = la UP; test con i contratti dell'audit | `cd36843`, deploy `6b0982a` | risolto (testnet `0x6A52…71BA`) |
| UCL-06 | Medium | Ricontrollo revoche silenzioso; OCSP reale non provato | errori in due giri consecutivi → problema; monitor: ricontrollo vecchio o con errori; conteggi nel riepilogo; `scripts/check-p7m.js`: il 2026-10-15 sul server un `.p7m` reale di CieSign è passato (firma, catena alla root fissata, OCSP reale `ocsp.cie.interno.gov.it`, senza SHA-1) | `3c57cf9`, `87c1092` | risolto |
| UCL-07 | Medium | Firma CIE non legata alla sessione (phishing) | enunciato v2 con avviso che nomina sito e UP; massimo una migrazione ogni 30 giorni | `bad21d1` | risolto |
| UCL-08 | Medium | Segreti e dati sullo stesso host | umask 077, `.env` leggibile da altri → il backend non parte, DB a 600, utente dedicato (`deploy/README.md`), monitor senza chiave; **firmatario** in un processo separato (utente proprio, senza rete, codice di root in `/opt`, segreti in `/etc/up-cie-link/signer.env`): firma solo `attest`/`invalidate` sul contratto, limiti di frequenza, valore di controllo di `UNIQ_PEPPER`; il backend rifiuta di partire con i segreti nel suo `.env` (decisioni S1-S3 del 2026-10-27) | `abca9c9`, `3c57cf9`, `20abac2`, `18f188b` | risolto; installato sulla VPS il 2026-10-27 (valore di controllo del pepper confrontato, segreti tolti dal backend, `signer ready`, monitor senza problemi). Resta fuori: un attaccante root sulla VPS (condivisa con altri progetti) |
| UCL-09 | Medium | Catena web3 1.x nelle dipendenze dei contratti | `overrides` npm con pacchetto vuoto: 13 pacchetti di produzione, `npm audit` 0, niente `git+ssh`; devcontainer con `--ignore-scripts` | `f5bb398` | risolto |
| UCL-10 | Medium | Conservazione e cancellazione | riferimento al certificato cancellato a invalidazione/scadenza; collegamenti 12 mesi dopo la fine; impronte e richieste orfane 12 mesi; audit 12 mesi; `npm run data:export` / `data:erase`; informativa aggiornata | `bad21d1`, `8d59cab` | risolto |
| UCL-11 | Medium | Nessun controllo d'età | solo maggiorenni, età dal codice fiscale in memoria, codice neutro `AGE_NOT_ELIGIBLE` | `8d59cab` | risolto |
| UCL-12 | Medium | `expired` durante verifica/coda/conio | scadenza solo per `pending_up` / `pending_cie` | `a5b79a5` | risolto |
| UCL-13 | Medium | Termini CieSign e policy dei certificati CIE | owner: i termini di CieSign li accetta ogni utente per conto suo | — | accettato (vedi nota) |
| UCL-14 | Low | Informativa incompleta | titolare indicato come "ChainIntegrate, servizi di Simone Cavalletti" (decisione del 2026-10-15); il resto dell'informativa resta parziale come quella di Cross_Chain | — | parziale (completare prima del mainnet) |
| UCL-15 | Low | Rate limit | IPv6 per /64, mappa limitata, cache di 10 s di `/api/badge`, `limit_req` in nginx | `abca9c9`, `6cd0cd6` | risolto |
| UCL-16 | Low | nginx | header ripetuti in ogni location, HSTS, Permissions-Policy, `server_tokens off`, log senza query string, sorgenti SVG non serviti; provato con nginx reale | `abca9c9` | risolto (logrotate verificato sul server: giornaliero, 14 file) |
| UCL-17 | Low | SMTP | `requireTLS` con `SMTP_SECURE=false` | `abca9c9` | risolto |
| UCL-18 | Low | PKI | niente SHA-1 in CMS e OCSP (`OCSP_ALLOW_SHA1` solo d'emergenza), nonce OCSP verificato (test di replay), freschezza 24 h, catena di al massimo due anelli | `abca9c9` | risolto (estensioni EKU e revoca della sub CA non controllate) |
| UCL-19 | Low | OCSP quotidiano informa il Ministero | dichiarato nell'informativa | `8d59cab` | risolto (CRL valutate più avanti) |
| UCL-20 | Low | Migrazione non atomica | prima `attest` della nuova UP, poi invalidazione della vecchia con nuovi tentativi | `bad21d1` | risolto |
| UCL-21 | Low | Eccezioni non revocabili | `approveException` accetta valori più bassi e 0 (ritirata); backend `EXCEPTION_WITHDRAWN` | `cd36843`, deploy `6b0982a` | risolto (testnet `0x6A52…71BA`) |
| UCL-22 | Low | Monitor | controlli su conii, coda, invalidazioni, conii falliti, ricontrollo revoche; `monitor.env` senza chiave privata | `3c57cf9` | risolto |
| UCL-23 | Low | `/api/health` pubblico | dettagli solo da 127.0.0.1; 404 da nginx | `abca9c9` | risolto |
| UCL-24 | Low | Fine riga CRLF | `.gitattributes` | `a5b79a5` | risolto |
| UCL-25 | Low | Backup sullo stesso server | copia esterna quando gli utenti saranno in numero discreto, non per i primi test (decisione del 2026-10-15) | — | rinviato |
| UCL-26 | Info | Documenti non aggiornati | README, docs | `3b7045b` | risolto |
| UCL-27 | Info | Titolare del copyright | `NOTICE`: "Copyright 2026 ChainIntegrate" | `3b7045b` | risolto |
| UCL-28 | Info | Banner | senza "placeholder", filtro corretto | `3b7045b` | risolto |
| UCL-29 | Info | Codici fiscali di test plausibili | codici con carattere di controllo errato, con test | `8d59cab` | risolto |
| UCL-30 | Info | Telegram personale | owner: va bene Telegram, più l'e-mail; e-mail aggiunta nel piè di pagina | `8d59cab` | risolto |

## Note e rischi residui

- **UCL-03, residuo accettato:** la carta scade il giorno del compleanno, quindi il primo giorno del mese (oggi quello
  della scadenza, UCL-34) rivela ancora il **mese** di nascita (non il giorno). L'owner lo ritiene accettabile (2026-10-15): non si arrotonda
  al trimestre.
- **UCL-05:** nuovo contratto in testnet il 2026-10-15: `0x6A525B5662EF905f3DD90F7139DC3a702b1371BA`, blocco
  8745039, dal commit `90ed066`, verificato su Blockscout, metadati LSP4 impostati dall'owner. La verifica "è una UP" accetta qualsiasi Key Manager che dichiari LSP6 e punti alla UP: un contratto costruito
  apposta può ancora farlo, ma il conio viene comunque simulato e il contratto non è più rientrabile.
- **UCL-06:** verifica completa con un `.p7m` reale e l'OCSP reale eseguita il 2026-10-15 sul server: `CHECK OK`.
- **UCL-13:** i termini di CieSign riguardano l'utente. Resta un punto distinto e non verificato: se la policy dei
  certificati CIE (CP/CPS) consente a un privato di basarsi sul certificato di autenticazione fuori da "Entra con CIE".
- **WalletConnect (futuro):** prima di includere il bundle, verificare la licenza (non open source) e aggiungere Reown
  all'informativa.

## Seconda revisione (2026-10-15, revisione `64ec68d`)

Report: [`AUDIT-2026-10-15.md`](AUDIT-2026-10-15.md), conservato senza modifiche. Conferma le correzioni della prima
revisione. Nuovi punti, tutti **aperti** salvo dove indicato:

| ID | Sev. | Titolo | Stato |
|---|---|---|---|
| UCL-31 | Medium | Richieste di export/cancellazione dei dati non autenticate | risolto: export e cancellazione da "Il mio bollino" con una firma della UP (sfida senza stato, HMAC, 5 minuti, monouso; `/api/subject/*`); informativa e procedura aggiornate; test API ed end-to-end |
| UCL-32 | Low | Login admin bloccabile riempiendo la cache delle sfide | risolto: sfida senza stato (testo + HMAC con chiave di processo), memorizzate solo le sfide usate per un login riuscito; `owner()` in cache per un minuto alla richiesta della sfida, letto sempre al login; test |
| UCL-33 | Low | Ripristino dell'attestatore in emergenza passa dal server compromesso | risolto: procedura (`docs/operations.md` §4) con reinstallazione pulita, indirizzo annotato fuori dal server e confronto con pagina e dati della transazione prima di firmare; la pagina admin lo ricorda e mostra l'indirizzo |
| UCL-34 | Low | Scadenza arrotondata per eccesso: il bollino supera la carta fino a un mese | risolto: scadenza = primo giorno del mese in cui scade la carta; carta che scade nel mese corrente rifiutata (`CARD_EXPIRING`); testi aggiornati. I bollini già emessi mantengono la vecchia scadenza |
| UCL-35 | Low | Riferimento al certificato conservato dopo rinuncia o revoca | risolto: cancellato dall'indicizzatore su `Invalidated`/`Revoked` e dalla pulizia per ogni collegamento non più valido; test; informativa precisata |
| UCL-36 | Low | Dettagli operativi e dati dell'operatore nel repository pubblico | risolto (decisione del 2026-10-19): tolti IP, utente SSH, versioni esatte e il collegamento reale dell'operatore; lasciati il fornitore della posta (va nell'informativa, UCL-14) e l'indirizzo dell'attestatore (pubblico on-chain). I testi vecchi restano nella cronologia git, che non si riscrive |
| UCL-37 | Low | `.p7m` reale copiato in `/tmp` leggibile da tutti | risolto: `docs/operations.md` §2.4 usa cartelle private (`700`/`600`) e `shred`; in alternativa la prova si fa sul PC |
| UCL-38 | Low | Contratti testnet sostituiti con l'attestatore ancora attivo | risolto: la pagina admin elenca i contratti in `superseded` con il loro attestatore e li ferma (`setAttester(0)`), test end-to-end; i due contratti di testnet fermati dall'owner il 2026-10-19 |
| UCL-39 | Info | Avviso spurio "conio non registrato" dell'indicizzatore | risolto: nessun avviso se per quella UP c'è un conio aperto (lo chiude `reconcileMints()`); test |
| UCL-40 | Info | Rinforzi minori del sito | risolto: canale raw (app Android) dietro `ALLOW_RAW_CHANNEL`, spento; `/.well-known/security.txt` (scade il 2027-10-19: rinnovarlo); header API non più doppi (`proxy_hide_header`); `/README.md` non servito. Provato con nginx reale. Le pagine sconosciute restano 200 (applicazione a pagina singola) |
| UCL-41 | Info | Cooldown del rifiuto eccezione contato dalla richiesta | risolto: colonna `rejected_at`, il periodo di 30 giorni parte dal rifiuto; test |
| UCL-42 | Info | Copia di lavoro Windows con CRLF | **da fare dall'owner**: nella cartella locale `git rm --cached -r .` poi `git reset --hard` (o un clone nuovo) |
| UCL-43 | Info | Versione di nginx e supporto del sistema operativo | verificato il 2026-10-19: Ubuntu 22.04.5 LTS, supporto standard fino ad aprile 2027. Pianificare il passaggio a 24.04 prima di allora (porterebbe anche HTTP/2 per singolo sito) |
