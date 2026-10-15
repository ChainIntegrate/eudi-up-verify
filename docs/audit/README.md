# Audit — tracciamento

Report: [`AUDIT-2026-10-14.md`](AUDIT-2026-10-14.md) (14-15 ottobre 2026, revisione `b5d4217`), conservato senza
modifiche. Qui lo stato di ogni punto. Stati: **aperto**, **risolto** (con commit e test), **parziale**,
**da fare dall'owner**, **accettato** (rischio accettato, con motivo), **rinviato** (con quando).

Decisioni dell'owner del 2026-10-15: Gruppo 1 tutto come proposto; UCL-03 scadenza al primo giorno del mese successivo
alla scadenza della carta; UCL-05/21 nuovo deploy; UCL-07, 08, 10, 11, 19 come proposto; UCL-25 al mainnet; UCL-27
"ChainIntegrate"; UCL-30 Telegram più e-mail; UCL-13 e UCL-14 vedi sotto.

Ogni correzione porta nel messaggio di commit l'ID del punto.

## Stato

| ID | Sev. | Titolo | Cosa è stato fatto | Commit | Stato |
|---|---|---|---|---|---|
| UCL-01 | High | Conii bloccati dopo una transazione fallita | Wallet senza NonceManager, nonce letto dal nodo senza cache, simulazione (`staticCall`) prima di ogni invio, attesa con timeout (`TX_TIMEOUT` con l'hash); allarmi del monitor su conii aperti e coda ferma; test di regressione A.1 e transazione non minata | `a5b79a5`, `3c57cf9` | risolto |
| UCL-02 | High | Conti alla rovescia vecchi interrompono la firma CIE | timer e polling si fermano quando il loro passo non è più in pagina; test con orologio finto (fallisce sul codice vecchio) | `817d369` | risolto |
| UCL-03 | Medium | `expiresAt` rivela il compleanno e collega le UP | scadenza on-chain = primo giorno del mese successivo alla scadenza della carta; motivo on-chain sempre `INVALIDATED`; informativa: migrazione collegabile, cosa dice il bollino | `bad21d1`, `8d59cab` | risolto (residuo sotto) |
| UCL-04 | Medium | Conio non registrato rompe l'unicità | tabella `mints` scritta prima dell'invio, hash salvato subito, `reconcileMints()` all'avvio e ogni minuto; un conio aperto blocca nuove richieste della stessa persona/UP | `bad21d1` | risolto |
| UCL-05 | Medium | Contratti "simil-UP", `renounce()` rientrante | contratto: `nonReentrant`, `Attested` prima del mint; backend: `owner()` deve essere un Key Manager LSP6 con `target()` = la UP; test con i contratti dell'audit | `cd36843`, deploy `6b0982a` | risolto (testnet `0x6A52…71BA`) |
| UCL-06 | Medium | Ricontrollo revoche silenzioso; OCSP reale non provato | errori in due giri consecutivi → problema; monitor: ricontrollo vecchio o con errori; conteggi nel riepilogo | `3c57cf9` | parziale: **manca la prova con un `.p7m` reale e l'OCSP reale** |
| UCL-07 | Medium | Firma CIE non legata alla sessione (phishing) | enunciato v2 con avviso che nomina sito e UP; massimo una migrazione ogni 30 giorni | `bad21d1` | risolto |
| UCL-08 | Medium | Segreti e dati sullo stesso host | umask 077, `.env` leggibile da altri → il backend non parte, DB a 600, utente dedicato (`deploy/README.md`), monitor senza chiave | `abca9c9`, `3c57cf9` | parziale: processo separato per HMAC/firma **rinviato al mainnet** |
| UCL-09 | Medium | Catena web3 1.x nelle dipendenze dei contratti | `overrides` npm con pacchetto vuoto: 13 pacchetti di produzione, `npm audit` 0, niente `git+ssh`; devcontainer con `--ignore-scripts` | `f5bb398` | risolto |
| UCL-10 | Medium | Conservazione e cancellazione | riferimento al certificato cancellato a invalidazione/scadenza; collegamenti 12 mesi dopo la fine; impronte e richieste orfane 12 mesi; audit 12 mesi; `npm run data:export` / `data:erase`; informativa aggiornata | `bad21d1`, `8d59cab` | risolto |
| UCL-11 | Medium | Nessun controllo d'età | solo maggiorenni, età dal codice fiscale in memoria, codice neutro `AGE_NOT_ELIGIBLE` | `8d59cab` | risolto |
| UCL-12 | Medium | `expired` durante verifica/coda/conio | scadenza solo per `pending_up` / `pending_cie` | `a5b79a5` | risolto |
| UCL-13 | Medium | Termini CieSign e policy dei certificati CIE | owner: i termini di CieSign li accetta ogni utente per conto suo | — | accettato (vedi nota) |
| UCL-14 | Low | Informativa incompleta | per ora resta parziale come quella di Cross_Chain; il titolare sarà "ChainIntegrate SRLS" o "ChainIntegrate, servizi di Simone Cavalletti" come sul sito | — | rinviato (prima del mainnet) |
| UCL-15 | Low | Rate limit | IPv6 per /64, mappa limitata, cache di 10 s di `/api/badge`, `limit_req` in nginx | `abca9c9`, `6cd0cd6` | risolto |
| UCL-16 | Low | nginx | header ripetuti in ogni location, HSTS, Permissions-Policy, `server_tokens off`, log senza query string, sorgenti SVG non serviti; provato con nginx reale | `abca9c9` | risolto (controllare logrotate sul server) |
| UCL-17 | Low | SMTP | `requireTLS` con `SMTP_SECURE=false` | `abca9c9` | risolto |
| UCL-18 | Low | PKI | niente SHA-1 in CMS e OCSP (`OCSP_ALLOW_SHA1` solo d'emergenza), nonce OCSP verificato (test di replay), freschezza 24 h, catena di al massimo due anelli | `abca9c9` | risolto (estensioni EKU e revoca della sub CA non controllate) |
| UCL-19 | Low | OCSP quotidiano informa il Ministero | dichiarato nell'informativa | `8d59cab` | risolto (CRL valutate più avanti) |
| UCL-20 | Low | Migrazione non atomica | prima `attest` della nuova UP, poi invalidazione della vecchia con nuovi tentativi | `bad21d1` | risolto |
| UCL-21 | Low | Eccezioni non revocabili | `approveException` accetta valori più bassi e 0 (ritirata); backend `EXCEPTION_WITHDRAWN` | `cd36843`, deploy `6b0982a` | risolto (testnet `0x6A52…71BA`) |
| UCL-22 | Low | Monitor | controlli su conii, coda, invalidazioni, conii falliti, ricontrollo revoche; `monitor.env` senza chiave privata | `3c57cf9` | risolto |
| UCL-23 | Low | `/api/health` pubblico | dettagli solo da 127.0.0.1; 404 da nginx | `abca9c9` | risolto |
| UCL-24 | Low | Fine riga CRLF | `.gitattributes` | `a5b79a5` | risolto |
| UCL-25 | Low | Backup sullo stesso server | — | — | rinviato al mainnet (con utenti reali) |
| UCL-26 | Info | Documenti non aggiornati | README, docs | `3b7045b` | risolto |
| UCL-27 | Info | Titolare del copyright | `NOTICE`: "Copyright 2026 ChainIntegrate" | `3b7045b` | risolto |
| UCL-28 | Info | Banner | senza "placeholder", filtro corretto | `3b7045b` | risolto |
| UCL-29 | Info | Codici fiscali di test plausibili | codici con carattere di controllo errato, con test | `8d59cab` | risolto |
| UCL-30 | Info | Telegram personale | owner: va bene Telegram, più l'e-mail; e-mail aggiunta nel piè di pagina | `8d59cab` | risolto |

## Note e rischi residui

- **UCL-03, residuo:** la carta scade il giorno del compleanno, quindi "primo giorno del mese successivo" rivela ancora
  il **mese** di nascita (non il giorno). Anche il tipo di validità della carta (3/5/10 anni) resta deducibile in parte.
  Scelta dell'owner; arrotondare a trimestre o a "verifica + 12 mesi" lo ridurrebbe.
- **UCL-05:** nuovo contratto in testnet il 2026-10-15: `0x6A525B5662EF905f3DD90F7139DC3a702b1371BA`, blocco
  8745039, dal commit `90ed066`, verificato su Blockscout, metadati LSP4 impostati dall'owner. La verifica "è una UP" accetta qualsiasi Key Manager che dichiari LSP6 e punti alla UP: un contratto costruito
  apposta può ancora farlo, ma il conio viene comunque simulato e il contratto non è più rientrabile.
- **UCL-06:** prima di aprire il servizio va eseguita una verifica completa con un `.p7m` reale di CieSign e l'OCSP
  reale del Ministero (algoritmo di firma della risposta, certificato del responder, nonce, freschezza).
- **UCL-13:** i termini di CieSign riguardano l'utente. Resta un punto distinto e non verificato: se la policy dei
  certificati CIE (CP/CPS) consente a un privato di basarsi sul certificato di autenticazione fuori da "Entra con CIE".
- **WalletConnect (futuro):** prima di includere il bundle, verificare la licenza (non open source) e aggiungere Reown
  all'informativa.
