# Audit — tracciamento

Report: [`AUDIT-2026-10-14.md`](AUDIT-2026-10-14.md) (14-15 ottobre 2026, revisione `b5d4217`), conservato senza
modifiche. Qui lo stato di ogni punto. Stati: **aperto**, **decisione** (serve una scelta dell'owner), **in corso**,
**risolto** (con commit e test), **accettato** (rischio accettato, con motivo), **fuori codice** (legale/operativo).

Ogni correzione porta nel messaggio di commit l'ID del punto (es. `UCL-01`).

## Gruppo 1 — correzioni senza decisioni (proposte per prime)

| ID | Sev. | Titolo | Proposta | Stato |
|---|---|---|---|---|
| UCL-01 | High | Conii bloccati dopo una transazione fallita | Wallet senza NonceManager; simulazione (`staticCall`) prima di inviare; `wait` con timeout; allarme coda ferma; test di regressione A.1 | aperto |
| UCL-02 | High | Conti alla rovescia vecchi interrompono la firma CIE | timer legati al passo visibile; test con orologio finto (A.3) | aperto |
| UCL-12 | Medium | `expired` mentre è in verifica/coda/conio | scadenza solo per `pending_up` / `pending_cie` | aperto |
| UCL-04 | Medium | Conio non registrato rompe l'unicità | riga "in conio" scritta prima di inviare, hash salvato subito, riconciliazione all'avvio | aperto |
| UCL-06 | Medium | Ricontrollo revoche che fallisce in silenzio | allarme su errori ripetuti e su job vecchio; conteggi nel riepilogo; prova con il `.p7m` reale e l'OCSP reale (serve il tuo file) | aperto |
| UCL-09 | Medium | Catena web3 1.x nelle dipendenze dei contratti | `overrides` npm che elimina `@truffle/hdwallet-provider`; `npm ci --ignore-scripts` nel devcontainer | aperto |
| UCL-15 | Low | Rate limit | IPv6 per /64, mappa limitata, cache breve per `/api/badge`, `limit_req` in nginx | aperto |
| UCL-16 | Low | nginx | HSTS, header ripetuti nelle `location`, `server_tokens off`, `Permissions-Policy`, commento sui log corretto | aperto |
| UCL-17 | Low | SMTP | `requireTLS` quando non è TLS diretto | aperto |
| UCL-18 | Low | PKI | solo SHA-256 o superiori; finestra OCSP più stretta; `pathLen` | aperto |
| UCL-20 | Low | Migrazione non atomica | prima `attest` della nuova UP, poi `invalidate` della vecchia | aperto |
| UCL-22 | Low | Monitor | controlli su coda, conii falliti, job revoche; niente chiave privata nel monitor | aperto |
| UCL-23 | Low | `/api/health` pubblico | pubblico solo `ok`; dettagli solo da 127.0.0.1 | aperto |
| UCL-24 | Low | Fine riga CRLF su Windows | `.gitattributes` | aperto |
| UCL-26 | Info | Documenti non aggiornati | README e docs | aperto |
| UCL-28 | Info | Banner: "placeholder" e spunta tagliata | correggere filtro SVG e testo | aperto |
| UCL-29 | Info | Codici fiscali di test plausibili | codici con carattere di controllo errato | aperto |

## Gruppo 2 — servono decisioni

| ID | Sev. | Titolo | Domanda | Stato |
|---|---|---|---|---|
| UCL-03 | Medium | `expiresAt` rivela il compleanno e collega le UP | scadenza on-chain arrotondata (es. min(scadenza carta, verifica + 12 mesi) al primo del mese)? motivo generico on-chain? migrazione ritardata o dichiarata? | decisione |
| UCL-05 + UCL-21 | Medium/Low | Contratti "simil-UP" e `renounce()` rientrante; eccezioni non revocabili | nuovo deploy del contratto (testnet) con correzioni; verifica più stretta della UP nel backend | decisione |
| UCL-07 | Medium | Firma CIE non legata alla sessione (phishing) | avviso esplicito nel testo dell'enunciato (versione v2); limite di migrazioni per periodo | decisione |
| UCL-08 | Medium | Segreti e dati sullo stesso host | processo separato per HMAC e firma con utente dedicato, oppure solo hardening (utente dedicato, permessi, systemd) per ora | decisione |
| UCL-10 | Medium | Conservazione e cancellazione | periodi per tabella; script `erase`/`export`; cosa fare dell'unicità dopo una cancellazione | decisione |
| UCL-11 | Medium | Nessun controllo d'età | soglia 18 anni (o 14) ricavata dal codice fiscale | decisione |
| UCL-19 | Low | OCSP quotidiano informa il Ministero | dichiararlo nell'informativa, o CRL al posto dell'OCSP periodico | decisione |
| UCL-25 | Low | Backup sullo stesso server, rotazione chiavi | dove fare la copia esterna; procedura di rotazione | decisione |
| UCL-27 | Info | Nessun titolare del copyright | file `NOTICE`: con quale nome (ChainIntegrate / persona / società)? | decisione |
| UCL-30 | Info | Telegram personale come assistenza | canale aziendale? | decisione |

## Gruppo 3 — fuori dal codice (legale / operativo)

| ID | Sev. | Titolo | Cosa serve | Stato |
|---|---|---|---|---|
| UCL-13 | Medium | Termini CieSign e policy dei certificati CIE | leggere termini d'uso CieSign e CP/CPS CIE (o chiedere a Ministero/IPZS) | fuori codice |
| UCL-14 | Low | Informativa incompleta | dati legali del titolare, responsabili (VPS, SMTP), DPIA e registro dei trattamenti | fuori codice |
| Licenze | — | WalletConnect (futuro), marchio "CIE" | verifica licenza prima di includere il bundle; verifica del nome | fuori codice |
