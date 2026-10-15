# Fase 2 — Backend: disegno da approvare

> Stato: **approvato**, tutte le decisioni prese (vedi §11). Implementazione in `backend/`. Contratto di riferimento: `contracts/deployments/luksoTestnet.json`
> (`0x056a7e72…7892`, verificato). Vincoli: `CLAUDE.md`. Decisioni precedenti: `00-analisi.md` §9, `01-contratto.md`.

## 1. Componenti

```
browser (estensione UP)          app Android (fase 4)
        │ HTTPS                         │ HTTPS
        ▼                               ▼
  reverse proxy del server (TLS) ──► backend Express su 127.0.0.1:PORT (PM2)
                                        ├─ SQLite (better-sqlite3, WAL)
                                        ├─ RPC LUKSO dedicato ──► UpCieBadge (attest / invalidate, letture)
                                        └─ OCSP Ministero dell'Interno
  job (stesso processo o PM2 separato): indicizzatore eventi, ricontrollo revoca, backup
```

- Cartella `backend/`, Node 22, Express 5, ethers v6, `pkijs`/`asn1js` (dalla logica dello spike), `better-sqlite3`.
- Il browser **non** parla mai con l'RPC: tutte le letture on-chain passano dal backend.
- Amministrazione **solo da riga di comando sul server** (niente endpoint admin esposti).

## 2. Flusso di collegamento

1. **Enunciato.** `POST /api/statements {up, mode}` → il backend genera il testo (formato v1 dello spike: origine,
   chainId, contratto, UP, nonce 32 byte, emissione, scadenza, `Mode`). `mode` è `link` (prima UP o rinnovo),
   `migrate` (sposta la UP principale) o `additional` (UP in più, solo con eccezione approvata).
2. **Firma della UP.** `POST /api/statements/:id/up-signature {signature}`: firma EIP-191 del testo; il backend chiama
   `isValidSignature(hashMessage(testo), firma)` sulla UP (deve restituire `0x1626ba7e`; il controller deve avere il
   permesso SIGN). Va fatta entro **5 minuti** dall'emissione (regola anti-replay di `CLAUDE.md`). Prima controlla che
   l'indirizzo sia davvero una UP (LSP0).
3. **Firma della CIE**, due canali:
   - `POST /api/statements/:id/cie-cades`: upload del `.p7m` di CieSign (variante A1, per test e ripiego);
   - `POST /api/statements/:id/cie-raw {certificate, signature}`: firma PKCS#1 su SHA-256 del testo fatta dall'app
     Android via NFC (variante A2).
   Entro la scadenza dell'enunciato (proposta: **15 minuti**, per lasciare tempo alla firma con CieSign).
4. **Verifica CIE** (in memoria, nulla su disco):
   - contenuto firmato identico al testo emesso, nonce a uso singolo;
   - firma valida; certificato del titolare valido oggi, `keyUsage digitalSignature`, policy `1.3.76.47.4`;
   - catena: titolare → sub CA → **root "National root CA for the Italian Electronic Identity Card" con impronta
     SHA-256 fissata in configurazione** (la Trusted List AgID resta un controllo incrociato manuale);
   - **OCSP** con risposta firmata e stato GOOD; se l'OCSP non risponde → **rifiuto** (fail-closed, D5);
   - codice fiscale = primi 16 caratteri del `commonName`, controllati con il pattern.
5. **Unicità e decisione** (§4).
6. **Conio.** `attest(up, "CIE", notAfter del certificato, primary)` con la chiave dell'attestatore; si attende la
   conferma e si registra la transazione. Poi si scartano CF, nome e certificato: restano solo HMAC del CF e
   riferimento cifrato del certificato (seriale + emittente) per il ricontrollo della revoca (D5.2).
7. **Esito.** `GET /api/statements/:id` → `pending_up` → `pending_cie` → `verifying` → `minting` → `done`
   (con tx hash) oppure `failed` (con codice d'errore generico, mai dati personali).

## 3. Altri endpoint

| Metodo | Path | Scopo |
|---|---|---|
| GET | `/api/health` | stato del servizio, RPC raggiungibile, ultimo blocco indicizzato |
| GET | `/api/config` | chainId, indirizzo contratto, versione enunciato (per frontend e app) |
| GET | `/api/badge/:up` | `isVerified`, `isVerifiedPrimary`, `getAttestation` letti on-chain |

Protezioni: limiti di frequenza per IP (in memoria, IP non salvati), body max 64 KB, CORS limitato all'origine del
frontend, header di sicurezza, nessun dettaglio d'errore interno nelle risposte.

## 4. Regole di unicità (D3)

`person_key = HMAC-SHA256(UNIQ_PEPPER, CF)`.

| Situazione | `mode` | Esito |
|---|---|---|
| Persona nuova | `link` | conio, `primary = true` |
| Stessa persona, stessa UP (es. carta rinnovata) | `link` | rinnovo in place (stesso token) |
| Persona con UP principale attiva su un'altra UP | `link` | rifiuto `MIGRATION_OR_EXCEPTION_REQUIRED` |
| come sopra | `migrate` | `invalidate(vecchia, "MIGRATED")` + `attest(nuova, primary = true)` |
| come sopra | `additional` | se c'è un'eccezione approvata on-chain con capienza → `attest(nuova, primary = false)`; altrimenti il backend crea una **richiesta d'eccezione** con ticket casuale e la mostra all'utente |
| UP già collegata a un'**altra** persona | qualsiasi | rifiuto `UP_LINKED_TO_ANOTHER_PERSON` (la UP deve prima fare `renounce`) |
| UP con bollino `Revoked` | qualsiasi | rifiuto (deve decidere l'owner) |

**Eccezioni:** il ticket (32 byte casuali) lega la richiesta alla persona **solo nel nostro DB**. L'owner approva da
UP ChainIntegrate con `approveException(ticket, maxUps)`: on-chain resta il ticket, senza dati personali. Il backend
legge `exceptionOf(ticket)` prima di coniare.

## 5. Dati (SQLite)

```sql
statements(id TEXT PK, up TEXT, mode TEXT, nonce TEXT UNIQUE, text_sha256 TEXT,
           issued_at INT, expires_at INT, up_signed_at INT, status TEXT, error_code TEXT, tx_hash TEXT)
persons(person_key BLOB PK, created_at INT)                       -- HMAC del CF, nient'altro
links(up TEXT PK, person_key BLOB, is_primary INT, status TEXT, verified_at INT, expires_at INT,
      cert_ref_enc BLOB, last_ocsp_at INT, last_ocsp_status TEXT, tx_hash TEXT, updated_at INT)
exception_requests(ticket TEXT PK, person_key BLOB, status TEXT, created_at INT)
chain_cursor(name TEXT PK, last_block INT)                         -- parte da DEPLOY_BLOCK
audit(id INT PK, ts INT, event TEXT, up TEXT, tx_hash TEXT, detail TEXT)   -- mai dati personali
```

- `cert_ref_enc` = AES-256-GCM(seriale + emittente del certificato) con `CERT_REF_KEY`.
- Gli enunciati scaduti vengono cancellati dopo 7 giorni.
- Lo stato on-chain è la fonte di verità: l'indicizzatore aggiorna `links` dagli eventi (`Attested`, `Invalidated`,
  `Revoked`, `Reinstated`), così anche un `renounce` fatto direttamente dalla UP si riflette nel DB.

## 6. Job periodici

| Job | Frequenza | Cosa fa |
|---|---|---|
| Indicizzatore | ogni 1 min | `eth_getLogs` dal blocco salvato (all'inizio `DEPLOY_BLOCK`) a blocchi limitati; aggiorna `links` |
| Ricontrollo revoca (D5.2) | ogni 24 h | per ogni link valido: OCSP con seriale + emittente decifrati; se REVOKED → `invalidate(up, "CERT_REVOKED")` |
| Pulizia | ogni 24 h | cancella enunciati scaduti e richieste d'eccezione abbandonate |
| Backup | ogni 24 h | §7 |

Se l'OCSP non risponde durante il **ricontrollo** (diverso dalla verifica iniziale): nessuna invalidazione, nuovo
tentativo il giorno dopo, avviso nei log dopo 3 giorni consecutivi (decisione B2).

## 7. Backup con script

**Cosa:** solo il database SQLite. I segreti (`.env`) **non** finiscono nel backup automatico.

**Script** `backend/scripts/backup.js` (lanciato dal timer systemd `deploy/systemd/up-cie-link-backup.*`):
1. copia consistente del DB mentre il servizio gira, con l'API di backup di SQLite
   (`better-sqlite3` `db.backup()`), su file temporaneo;
2. controllo d'integrità della copia (`PRAGMA integrity_check`);
3. compressione e **cifratura** con `age` verso una **chiave pubblica**: il server può creare i backup ma non
   leggerli; la chiave privata sta offline, da te;
4. nome con data e hash SHA-256, permessi `600`;
5. rotazione: 14 giornalieri + 8 settimanali;
6. copia **fuori dal server** (destinazione da decidere: B5);
7. esito nei log; uscita con errore se un passo fallisce (PM2/cron lo segnalano).

**Script** `backend/scripts/restore.js`: decifra con la chiave privata, verifica l'hash e l'integrità, ripristina su
un file nuovo (mai sopra il DB attivo senza conferma esplicita).

**Prova di ripristino** documentata, da fare una volta al mese.

**Chiavi da custodire a parte** (password manager / cassaforte), perché senza di esse il backup è inutile:
- `UNIQ_PEPPER`: senza, gli HMAC esistenti non si ricalcolano più e l'unicità si perde;
- `CERT_REF_KEY`: senza, il ricontrollo della revoca non è più possibile;
- `ATTESTER_PRIVATE_KEY`: sostituibile (l'owner può cambiare attestatore), ma va protetta;
- chiave privata `age` dei backup.

**GDPR:** i backup contengono dati pseudonimizzati, quindi cifrati e con conservazione limitata. Una cancellazione su
richiesta resta nei backup fino alla loro rotazione (max ~8 settimane): da scrivere nell'informativa.

## 8. Configurazione (`backend/.env`, con `.env.example` nel repo)

`PORT`, `PUBLIC_ORIGIN` (frontend), `NETWORK` (`luksoTestnet`/`luksoMainnet`, da cui si leggono indirizzo e
`DEPLOY_BLOCK` in `contracts/deployments/`), `RPC_URL`, `ATTESTER_PRIVATE_KEY`, `UNIQ_PEPPER`, `CERT_REF_KEY`,
`CIE_ROOT_SHA256` (impronte delle root ammesse), `DB_PATH`, `BACKUP_DIR`, `BACKUP_AGE_RECIPIENT`.

## 9. Test

- Verifica CIE: PKI finta generata nei test (come lo `selftest` dello spike), OCSP locale, casi positivi e negativi.
- ERC-1271 e conio: contratto e UP di test su rete Hardhat in-process.
- Regole di unicità: tutti i casi della tabella §4.
- Privacy: test che falliscono se CF o nome finti compaiono in log, risposte o DB.
- Backup/restore: ciclo completo su un DB di prova.

## 10. Decisioni che servono da te

- **B1** Finestre temporali: firma UP entro 5 min dall'emissione, firma CIE entro 15 min. Ok?
- **B2** OCSP irraggiungibile nel ricontrollo periodico: nessuna invalidazione, avviso dopo 3 giorni. Ok?
- **B3** Flusso delle eccezioni con ticket come in §4. Ok?
- **B4** UP già collegata a un'altra persona: rifiuto finché la UP non fa `renounce`. Ok?
- **B5** Backup: `age` per la cifratura va bene? **Dove** copiarli fuori dal server (altro server via rsync/SSH,
  storage S3-compatibile, Google Drive, altro)? Retention 14 + 8 ok?
- **B6** Server: sottodominio, reverse proxy già in uso (nginx? Caddy?), porta interna libera.
- **B7** Upload `.p7m` (CieSign) anche in produzione, o solo per i test finché non c'è l'app Android?

## 11. Decisioni prese (2026-10-14)

- **B1–B4:** confermate esplicitamente come proposte in §10.

- **B5 Backup:** per ora **sullo stesso server** (script, cifratura e rotazione come in §7). La copia fuori dalla
  macchina diventa obbligatoria prima dell'uso "sul serio" (mainnet con utenti reali): lo script ha già il passo
  opzionale, da attivare quando ci sarà la destinazione.
- **B6 Server:** dietro **nginx** sulla VPS esistente. Sottodominio **confermato: `up-cie-link.chainintegrate.it`**
  (DNS già configurato verso la VPS)
  (stesso schema di `crosschain-lukso.chainintegrate.it`, stesso nome del repo e del token). Porta interna da scegliere
  dopo aver controllato quelle libere (`ss -ltnp`); il backend la legge da `PORT` e rifiuta di partire se è occupata.
- **B7 Canali CIE:** test e demo iniziale **senza app**, con upload del `.p7m` di CieSign; in definitiva **app
  Android**. L'upload resta dietro un'opzione di configurazione (`ALLOW_CADES_UPLOAD`), da spegnere quando l'app è
  pronta.

## 12. RPC (informazioni ricavate da `traceability-registry`, 2026-10-14)

- **Testnet:** RPC pubblico `https://rpc.testnet.lukso.network`.
- **Mainnet:** nodo self-hosted ChainIntegrate `https://rpc.chainintegrate.it/rpc/<api-key>`, con la chiave **nel
  percorso dell'URL** e la regola "una chiave dedicata per servizio": serve solo per il **backend** di up-cie-link.
  Il dominio non è pubblico: l'RPC si usa solo lato server.
- **Deploy dei contratti:** RPC pubblici (testnet e mainnet), decisione del 2026-10-14: per poche transazioni di
  deploy non serve il nodo.
- Conseguenza: `RPC_URL` non va **mai** scritto nei log (il backend non lo stampa, gli errori riportano solo codici).
- La porta 3014 è già usata da `traceability-registry`.

## 13. Decisioni del 2026-10-14 (pezzo 3 e monitoraggio)

Confermate:
- UP aggiuntiva senza una principale: rifiuto `NO_PRIMARY_LINK`.
- Eccezioni: al primo tentativo l'utente riceve un ticket opaco (64 caratteri esadecimali) da inviare a ChainIntegrate;
  dopo `approveException(ticket, n)` dalla UP owner rifà il collegamento.
- Il limite `n` conta tutte le UP della persona, principale compresa.
- Al riavvio gli enunciati a metà diventano `failed / INTERRUPTED`.
- Monitoraggio con mail sullo schema del relayer di Cross_Chain (monitor separato ogni ora, sola lettura, mail solo
  quando cambia qualcosa, promemoria ogni 24 h), con:
  - **A, problemi (mail immediata):** backend giù, RPC irraggiungibile o catena sbagliata, OCSP irraggiungibile nel
    ricontrollo per 3 giorni, conio fallito, saldo attestatore basso, attestatore on-chain diverso o azzerato, backup
    fallito o vecchio, CA della CIE in scadenza entro 60 giorni;
  - **B, eventi (mail immediata):** richiesta di eccezione (con il comando per approvarla), certificato revocato con
    bollino invalidato, revoca/ripristino dell'owner, rinuncia di un titolare;
  - **C, riepilogo giornaliero:** solo numeri e indirizzi UP, mai dati personali.
- SMTP: lo stesso account `no-reply@chainintegrate.it` del relayer; destinatario lo stesso del relayer, scritto solo
  nella configurazione sul server.

Decise il 2026-10-14 (risposte alle domande a scelta):
- mail per ogni collegamento riuscito: **accesa durante i test e la demo** (`NOTIFY_EACH_LINK=true`), poi spenta; a
  regime i collegamenti compaiono solo nel riepilogo giornaliero, mentre problemi ed eventi degni di nota arrivano
  sempre subito;
- **backend con PM2** (`deploy/ecosystem.config.cjs`, una sola istanza per via della coda seriale);
  **monitor con timer systemd** (`deploy/systemd/`), indipendente da PM2, così segnala anche un PM2 fermo.

- **backup giornaliero con timer systemd** (`deploy/systemd/up-cie-link-backup.*`, alle 03:15 ora del server).
