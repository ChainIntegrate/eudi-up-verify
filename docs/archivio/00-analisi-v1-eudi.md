# eudi-up-verify — Fase 0: analisi e ricognizione

> **Archiviato.** Prima versione della Fase 0, centrata sul solo EUDI Wallet. Sostituita da `docs/00-analisi.md`. I fatti verificati restano validi per la strada EUDI.

> Stato: **bozza da approvare**. Nessun codice applicativo scritto.
> Data ricognizione: 2026-10-14.
> Legenda evidenze: **[V]** verificato (comando eseguito o sorgente letto), **[D]** dedotto da sorgente ma non provato end-to-end, **[I]** incerto / non verificabile da questo ambiente.

## 0. Limiti dell'ambiente di ricognizione (leggere prima)

La policy di rete del container usato per questa analisi **blocca** gli host `*.eudiw.dev`, `docs.eudi.dev`,
`rpc.testnet.lukso.network`, `explorer.execution.testnet.lukso.network` (il proxy risponde `403` alla `CONNECT`).
Anche lo strumento di fetch web esterno non risolve questi domini (`getaddrinfo ENOTFOUND`).
Funzionano invece: `git clone` da GitHub, `raw.githubusercontent.com`, il registry npm, la ricerca web.

Conseguenza: tutto ciò che riguarda **i servizi live** (verifier ospitato, issuer ospitato, trust list, RPC LUKSO)
è **[I]** e va ricontrollato da una macchina con rete libera. Tutto ciò che riguarda **il codice** è stato letto
direttamente dai sorgenti, a questi commit:

| Repo (github.com/eu-digital-identity-wallet) | Commit | Data |
|---|---|---|
| eudi-srv-verifier-endpoint | `df07af2` | 2026-10-08 |
| eudi-srv-web-issuing-eudiw-py | `4a92332` | 2026-10-07 |
| eudi-app-android-wallet-ui | `7f40440` | 2026-10-09 |
| eudi-lib-jvm-openid4vp-kt | `5b9631e` | 2026-10-06 |
| eudi-web-verifier | `99bb2fa` | 2026-09-28 |

Pacchetti npm LUKSO ispezionati: `@lukso/lsp8-contracts@0.18.1`, `@lukso/lsp4-contracts@0.17.3`,
`@lukso/lsp0-contracts@0.16.3`, `@lukso/lsp6-contracts@0.16.3`.

Comandi di riferimento usati:
```bash
git clone --depth 1 https://github.com/eu-digital-identity-wallet/<repo>.git
jq / python3 su src/main/resources/public/openapi.json
npm view <pkg> version ; npm pack <pkg>@<ver> && tar xzf ...
keytool -list -v -keystore <jks> -storepass keystore
openssl x509 -in <pem> -noout -subject -issuer -dates -fingerprint -sha256
```

---

## A. Ecosistema EUDI

### A.1 Contratto dell'API del verifier (`eudi-srv-verifier-endpoint`)

**Come:** lettura di `README.md`, `src/main/resources/public/openapi.json`, e dei sorgenti Kotlin
`port/input/InitTransaction.kt`, `GetWalletResponse.kt`, `PostWalletResponse.kt`, `adapter/out/presentation/*`. **[V]**

Il README dichiara: implementa **OpenID4VP 1.0** (final), è *"merely a development tool, rather a production
application"*, la Verifier API **non è protetta** (nessuna autenticazione) e il disclaimer raccomanda di non usarlo in produzione.

#### `POST /ui/presentations` (esiste anche `/ui/presentations/v2`, stesso payload, risposta con `authorization_request_uri`)

Schema `InitTransaction` (openapi). `required` dichiarati: `dcql_query`, `nonce` (più un `type` che **non esiste**
tra le proprietà: incoerenza dello spec, da ignorare ma da segnalare). **[V]**

| Campo | Tipo / valori | Note |
|---|---|---|
| `dcql_query` | oggetto DCQL (OpenID4VP 1.0 §6) | **obbligatorio** |
| `nonce` | string | **obbligatorio**; finisce firmato nella risposta (vedi A.4) |
| `response_mode` | `direct_post` \| `direct_post.jwt` | default da config (`VERIFIER_DEFAULTHTTPRESPONSEMODE`, default `DirectPostJwt`) |
| `jar_mode` | `by_value` \| `by_reference` | default `ByReference` |
| `request_uri_method` | `get` \| `post` \| `post_get` | solo con `by_reference` |
| `wallet_response_redirect_uri_template` | URI con `{RESPONSE_CODE}` | solo same-device |
| `transaction_data` | array | non ci serve |
| `issuer_chain` | string PEM (uno o più certificati) | se presente, il verifier usa **questi** come trust anchor per la transazione |
| `authorization_request_scheme` / `authorization_request_uri` | string | mutuamente esclusivi; default `haip-vp://` |
| `profile` | `openid4vp` \| `haip` | `haip` impone: `x509_hash`, `direct_post.jwt`, by_reference, ES256, niente self-signed |
| `intended_use_id` / `registration_certificate` | string | mutuamente esclusivi; includono una WRPRC (registration certificate) nella richiesta |

Risposta 200 (`Transaction` = `oneOf`):
- by_reference: `{ transaction_id, client_id, request_uri, request_uri_method }` (+ `authorization_request_uri` in v2)
- by_value: `{ transaction_id, client_id, request }`
- con header `Accept: image/png` restituisce direttamente il **PNG del QR**.

Errori 400 `InitTransactionError.error` ∈ `MissingPresentationQuery, MissingNonce, InvalidIssuerChain,
UnsupportedFormat, HaipNotSupported.*, …`

#### `GET /ui/presentations/{transactionId}[?response_code=…]`

- 200 → `WalletResponse` = `{ "vp_token": { "<credential_query_id>": [ "<presentazione>" , … ] } }`
  oppure `{ "error": "...", "error_description": "..." }` se il wallet ha rifiutato.
- 400 → `{ "error": "PresentationNotSubmitted" }` (transitorio: ripetere il polling) o `"InvalidResponseCode"` (terminale).
- 404 → transaction sconosciuta.

#### Altri endpoint utili
- `GET /ui/presentations/{id}/events`: log della transazione. L'evento `RequestObjectRetrieved` contiene il **JWT della
  richiesta** (`put("jwt", event.jwt)` in `GetPresentationEvents.kt`) → da lì si ricava la chiave effimera di cifratura
  (serve per ricostruire la SessionTranscript mdoc con `direct_post.jwt`). **[V]**
- `POST /utilities/validations/msoMdoc/deviceResponse`, `/utilities/validations/sdJwtVc`: validatori standalone.
- Wallet API: `GET|POST /wallet/request.jwt/{requestId}` (**consumabile una sola volta**: dopo il primo recupero la
  presentazione passa a `RequestObjectRetrieved` e una seconda richiesta va in `InvalidState`; quindi **noi non dobbiamo
  mai** scaricare il request object), `POST /wallet/direct_post/{requestId}`.

### A.2 Prova con curl sul verifier ospitato

**Richiesta preparata** (mso_mdoc, PID, `age_over_18`):
```bash
curl -sS -i -X POST -H 'Content-Type: application/json' \
  --data '{"dcql_query":{"credentials":[{"id":"pid","format":"mso_mdoc",
    "meta":{"doctype_value":"eu.europa.ec.eudi.pid.1"},
    "claims":[{"path":["eu.europa.ec.eudi.pid.1","age_over_18"]}]}]},
    "nonce":"phase0-probe-0001","jar_mode":"by_reference","request_uri_method":"post","profile":"openid4vp"}' \
  https://verifier-backend.eudiw.dev/ui/presentations
```
**Risposta grezza ottenuta (identica anche per `dev.verifier-backend.eudiw.dev`):**
```
curl: (56) CONNECT tunnel failed, response 403
HTTP/1.1 403 Forbidden
Content-Type: text/plain; charset=utf-8
```
È il **proxy di questo ambiente** che nega l'host, non il verifier. **[V]** che da qui non si raggiunge; **[I]** se il
verifier accetti la richiesta.

Ulteriore incertezza **[I]**: l'hostname citato nel brief, `verifier-backend.eudiw.dev`, **non compare** nei sorgenti
attuali. I repo citano `dev.verifier-backend.eudiw.dev` (backend), `verifier.eudiw.dev` / `dev.verifier.eudiw.dev` (UI).
Da verificare da rete libera quale sia l'hostname vivo.

**Nota importante:** anche se la rete funzionasse, la richiesta così com'è **non soddisferebbe il wallet** (vedi A.5:
`age_over_18` non è più un claim del PID di test). Il verifier probabilmente la accetta comunque (non valida i claim
contro il catalogo dell'issuer) **[D]**.

**Da fare su rete libera prima della Fase 2:** ripetere la richiesta (con il DCQL definitivo) e allegare qui la risposta grezza.

### A.3 La risposta contiene claim già verificati o un vp_token grezzo?

**Risposta: vp_token grezzo**, ma già validato dal verifier al momento della ricezione. **[V]**

- `GetWalletResponse.kt` restituisce `WalletResponseTO(vpToken = …)`: le stringhe così come le ha postate il wallet
  (SD-JWT VC compatto `…~…~kbjwt` oppure DeviceResponse mdoc base64url). Nessun claim decodificato.
- In `PostWalletResponse.kt` + `ValidateSdJwtVcOrMsoMdocVerifiablePresentation.kt` il verifier, alla ricezione, valida:
  firma dell'emittente, catena x5c verso i trust anchor, KB-JWT (nonce, audience, algoritmo) per SD-JWT,
  SessionTranscript/DeviceAuth per mdoc, `credential_sets` soddisfatti, stato (status list) se abilitato.
- **Ma la fiducia sugli emittenti di default è disattivata:** in `VerifierContext.kt`, se `VERIFIER_TRUSTVALIDATOR_SERVICEURL`
  non è configurato → `log.warn("Trusting all Attestation Issuers")` e `IsChainTrustedForContextF.Ignored`. Se invece la
  transazione porta `issuer_chain`, il verifier usa `IsChainTrustedForContextF.usingTrustAnchors(issuer_chain)`. **[V]**
- Non sappiamo come è configurato il verifier ospitato (trust validator sì/no) **[I]**.

**Decisione proposta: verifichiamo tutto noi, sempre**, trattando il verifier come semplice trasporto.
Inviamo comunque `issuer_chain` (difesa in profondità: il verifier rifiuta subito emittenti estranei), ma la
decisione di coniare dipende solo dalla nostra verifica:

1. Estrarre la catena x5c (SD-JWT: header `x5c` dell'issuer-signed JWT; mdoc: `issuerAuth` COSE header 33).
2. Validare la catena verso un **insieme pinnato** di CA PID di test (fingerprint SHA-256 in config, non scaricati a runtime):
   date, `basicConstraints`, `keyUsage`, firma, nessuna CA estranea.
3. Verificare la firma dell'emittente con la chiave del certificato foglia; verificare `vct`/`docType`; validità temporale.
4. (Opzionale) status list del credential.

CA di test trovate nel repo del wallet (`resources-logic/src/main/res/raw/pidissuerca02_*.pem`) **[V]**:

| File | Subject | Validità | SHA-256 |
|---|---|---|---|
| pidissuerca02_ut.pem | CN=PID Issuer CA - UT 02 | 2025-03-24 → 2034-06-20 | `F5:D8:B0:3D:…:5C:45:00` |
| pidissuerca02_eu.pem | CN=PID Issuer CA 02, C=EU | 2025-04-09 → 2034-07-06 | `3B:0A:22:3E:…:70:B2:97` |
| (+ CZ, EE, LU, NL, PT) | | | |

Il README del verifier usa invece come esempio `PID Issuer CA - UT 01` (2023 → 2032). **[I]** quale CA firmi oggi i PID
emessi da `issuer.eudiw.dev`: la fonte autorevole è la trust list LoTE `https://trustedlist.serviceproviders.eudiw.dev/LOTE/json/PIDProviders.jwt`
(usata dal wallet), da scaricare e confrontare da rete libera. Proposta: pinnare **UT 01 + UT 02 + EU 02** finché non verificato.

### A.4 Come il nonce finisce firmato e come legarlo alla UP

**SD-JWT VC** **[V]** (codice verifier + OpenID4VP 1.0): il wallet aggiunge un **KB-JWT** firmato con la chiave del
dispositivo (`cnf.jwk` nell'issuer-signed JWT) con claim `nonce` = nonce della richiesta, `aud` = `client_id` del verifier
(con prefisso, es. `x509_hash:…`), `iat`, `sd_hash` (hash dell'SD-JWT presentato). Il verifier passa
`presentation.nonce` e `audience = config.verifierId.clientId` al validatore.

**mso_mdoc** **[V]** (`DocumentValidator.kt`, `HandoverInfo.kt`): `DeviceAuth.deviceSignature` firma la
`SessionTranscript = [null, null, ["OpenID4VPHandover", SHA-256(CBOR([client_id, nonce, jwk_thumbprint|null, response_uri]))]]`.
- `client_id`: dalla risposta di init.
- `response_uri`: `<publicUrl>/wallet/direct_post/{requestId}`, dove `requestId` è l'ultimo segmento di `request_uri` **[D]**.
- `jwk_thumbprint`: thumbprint della chiave effimera di cifratura, presente solo con `direct_post.jwt`; ricavabile dal JWT
  nell'evento `RequestObjectRetrieved` **[D]**. Con `direct_post` vale `null`.

**Legame con la UP (proposta):**
```
r      = 32 byte casuali
exp    = now + 10 min
nonce  = base64url( HMAC-SHA256(NONCE_KEY, "eudi-up-verify:v1" || chainId || upAddress || r || exp) )
DB     : sessions(nonce → upAddress, r, exp, stato)
```
- Il nonce è **opaco**: il verifier ospitato (terza parte) non vede l'indirizzo UP → non può collegare identità e UP.
- La catena di prova è: firma ERC-1271 della UP (→ sessione) ⇒ nonce generato per quella sessione ⇒ nonce firmato dalla chiave
  del dispositivo che detiene il PID. Al ritorno ricalcoliamo l'HMAC, controlliamo `exp`, uso singolo, e che `nonce`
  (KB-JWT o SessionTranscript) coincida.
- Limite onesto: il legame è **"la stessa sessione"**, non "la stessa persona controlla la UP e il wallet". Chi ha la UP
  può far scansionare il QR a un'altra persona. Non è risolvibile con questo protocollo; va dichiarato.

### A.5 Attributi del PID di test e unicità

**Fonte:** `eudi-srv-web-issuing-eudiw-py/app/metadata_config/credentials_supported/pid_mdoc.json` e `pid_jwt_vc.json`. **[V]**

PID mso_mdoc (`eu.europa.ec.eudi.pid.1`), claim attuali:
`family_name*, given_name*, birth_date*, place_of_birth*, nationality*, issuance_date*, expiry_date*, issuing_authority*,
issuing_country*` (obbligatori) — `family_name_birth, given_name_birth, resident_* (address, country, state, city,
postal_code, street, house_number), personal_administrative_number, sex, email_address, mobile_phone_number,
document_number, trust_anchor, portrait, issuing_jurisdiction` (opzionali).

PID SD-JWT VC (`urn:eudi:pid:1`, formato `dc+sd-jwt`): stessi concetti, nomi diversi (`birthdate`, `nationalities`,
`address.*`, `date_of_issuance`, `date_of_expiry`, `picture`, `email`, `phone_number`, …).

**Scoperta critica: `age_over_18` NON è più nel PID di test.** È stato rimosso (insieme a `age_in_years`,
`age_birth_year`) nel commit `6be6ca7` del 2025-11-24 ("oid4VCI version 1"). **[V]** Oggi `age_over_18` esiste solo in
altri credential: Age Verification `eu.europa.ec.av.1`, mDL, Photo ID. Il DCQL "minimo con solo age_over_18 sul PID"
del brief **non è realizzabile** con l'issuer attuale.

Altri fatti rilevanti **[V]**:
- Il PID è emesso a **batch "once_only" (30 copie)**: ogni presentazione usa una copia diversa, con firma e chiave di
  dispositivo diverse. Quindi **nulla nel credential è un identificatore stabile** salvo i valori dei claim.
- L'issuer di test ha il paese "FC" (form): chiunque può ottenere un PID di test **con dati inventati, a volontà**.
  In ambiente di test l'unicità è quindi **solo dimostrativa**, non garantita.
- Il credential Age Verification (`eu.europa.ec.av.1`) è progettato per essere non collegabile: impossibile da usare per l'unicità.

**Candidati per l'unicità:**

| Opzione | Pro | Contro |
|---|---|---|
| `personal_administrative_number` | stabile, unico per Stato | **opzionale**: spesso assente nel PID di test; semantica nazionale; dato molto sensibile |
| `document_number` | — | opzionale, cambia a ogni rinnovo: non adatto |
| Composito `family_name + given_name + birth_date + place_of_birth + issuing_country` (normalizzati) | sempre presenti (obbligatori) | omonimie possibili (rare con luogo di nascita), cambi di nome rompono l'unicità |

**Proposta:** chiave di unicità = `HMAC-SHA256(UNIQ_PEPPER, canonical(issuing_country | family_name | given_name |
birth_date | place_of_birth))`, con normalizzazione Unicode NFKC + maiuscolo + spazi compressi. Si memorizza **solo l'HMAC**.
Dallo stesso set si ricava l'età da `birth_date` (≥18) e i valori in chiaro vengono scartati in memoria subito dopo.

**Implicazioni GDPR** (non è parere legale):
- L'HMAC con segreto server è un **dato pseudonimizzato** (art. 4(5)), quindi **resta dato personale**: serve base giuridica
  (consenso esplicito, art. 6(1)(a)), informativa, periodo di conservazione, diritto alla cancellazione (cancellando la riga
  si perde l'unicità di quella persona, accettabile).
- Minimizzazione: chiediamo 5 attributi identificativi invece di uno. È giustificabile solo perché l'unicità è un requisito
  dichiarato; altrimenti basterebbe `birth_date` o, idealmente, un attestato di età.
- Il segreto `UNIQ_PEPPER` va custodito fuori dal DB; se trapela, con un dizionario di nomi/date la pseudonimizzazione cade.
- Con il verifier ospitato, **una terza parte (infrastruttura di test della Commissione) riceve i claim in chiaro** e li
  conserva fino alla pulizia (`VERIFIER_PRESENTATIONS_CLEANUP_MAXAGE`, default 10 giorni); la sua Verifier API non è
  autenticata (chi conosce il `transaction_id` legge la risposta). Accettabile solo con **PID di test e dati fittizi**.
- On-chain: nessun dato personale, ma il bollino rende la UP "persona verificata": è una scelta dell'utente, da spiegare.

**Conclusione:** nessun attributo è "adatto" in senso pieno. Il composito è il meno peggio e funziona per la demo;
l'unicità reale richiederebbe un identificatore pseudonimo per-RP rilasciato dal wallet (previsto dall'ARF ma non
disponibile nel PID di test attuale) **[I]**.

### A.6 SD-JWT VC vs mso_mdoc

| Criterio | SD-JWT VC (`urn:eudi:pid:1`) | mso_mdoc (`eu.europa.ec.eudi.pid.1`) |
|---|---|---|
| Supporto wallet di riferimento | sì (`Format.SdJwtVc.ES256`) **[V]** | sì (`Format.MsoMdoc.ES256`) **[V]** |
| Supporto verifier | sì **[V]** | sì **[V]** |
| Verifica in Node | JSON/JWS: `jose`, `@sd-jwt/*` (Apache-2.0) | CBOR/COSE: `@animo-id/mdoc` o `@auth0/mdl` (Apache-2.0), ma nessuno dei due ha il prefisso `OpenID4VPHandover` di OpenID4VP 1.0: SessionTranscript da costruire a mano **[V]** |
| Controllo nonce | diretto: `kb_jwt.nonce`, `aud` | indiretto: ricostruire SessionTranscript, servono `response_uri` e (con `.jwt`) thumbprint della chiave effimera |
| Debug e audit | leggibile | binario |

**Raccomandazione: SD-JWT VC come formato primario**, mso_mdoc come piano B (vedi C). Motivo: verifica indipendente
più semplice e meno fragile, e meno dipendenze dallo stato interno del verifier.

### A.7 Verifier ospitato o nostro in Docker

Fatti **[V]**:
- Il wallet di riferimento accetta solo i prefissi `client_id` **`x509_san_dns`** e **`x509_hash`** (`WalletCoreConfigImpl.kt`,
  build `dev` e `demo`), entrambi con richiesta firmata (JAR) da un **access certificate**.
- Il wallet carica le trust list LoTE da `trustedlist.serviceproviders.eudiw.dev` tra cui **`WRPACProviders.jwt`** (CA degli
  access certificate) e ha `configureReaderAuthentication { enforceIfPresent() }`.
- Il keystore incluso nel repo del verifier (`keystore.jks`) ha una catena giocattolo `CN=root → CN=intermediate → CN=verifier`
  (SAN `localhost`, `verifier`): **non** è in nessuna trust list. Il README: "The Access Certificate cannot be self-signed".
- Il verifier richiede HTTPS pubblico (il wallet deve raggiungere `request_uri` e `direct_post`).

| | Ospitato (EC) | Nostro in Docker |
|---|---|---|
| Access certificate accettato dal wallet | quasi certamente sì **[I]** | serve un WRPAC da una CA presente in `WRPACProviders`; procedura di emissione per terzi **non trovata** in documentazione ufficiale **[I]** (una fonte non ufficiale cita un registro `registry.serviceproviders.eudiw.dev/wrp`) |
| Lavoro | nullo | dominio + TLS + reverse proxy + JVM (~1 GB RAM) + keystore + config trust validator |
| Privacy | terza parte vede i claim, API senza auth | dati restano da noi |
| Stabilità per una demo di inizio 2027 | fuori dal nostro controllo, ridistribuito spesso da `main` | versione pinnata (immagine `ghcr.io/…:<tag>`) |
| Allineamento versioni wallet ↔ verifier | garantito dagli sviluppatori EC | a nostro carico |

**Raccomandazione:** demo sul **verifier ospitato** + verifica indipendente nostra (A.3). Preparare Docker come piano B
solo se otteniamo un WRPAC di test. Il nostro backend parla col verifier tramite un adattatore (`VERIFIER_BASE_URL`),
così il passaggio costa una riga di configurazione.

---

## B. LUKSO

### B.1 Contratto attestatore

**Verifiche sul sorgente** **[V]**:
- `@lukso/lsp8-contracts@0.18.1`: `pragma ^0.8.27` (compatibile con 0.8.28); costruttore
  `LSP8IdentifiableDigitalAsset(name_, symbol_, newOwner_, lsp4TokenType_, lsp8TokenIdFormat_)`; hook
  `_beforeTokenTransfer(from, to, tokenId, force, data)`; formati tokenId, tra cui `_LSP8_TOKENID_FORMAT_ADDRESS = 2`.
- Esistono estensioni ufficiali **`LSP8NonTransferable`** e **`LSP8Revokable`**, ma **non** fanno al caso nostro:
  - NonTransferable: blocco a finestra temporale, l'owner può chiamare `makeTransferable()`; consente il burn; bypass per un ruolo.
  - Revokable: "revoca" = **trasferimento forzato** del token all'owner/revoker: contrario al requisito "revoca senza burn, con stato".
  → Proposta: override minimo e immutabile di `_beforeTokenTransfer`.
- ERC-1271 sulla UP: `LSP0.isValidSignature` delega all'owner (KeyManager); `LSP6KeyManagerCore.isValidSignature` fa
  `ecrecover` e richiede che il firmatario abbia il permesso **`SIGN`** sulla UP. Una firma da un controller senza SIGN
  fallisce → messaggio d'errore chiaro nel frontend.

**Bozza di interfaccia (non codice definitivo):**
```solidity
// EudiVerifiedBadge is LSP8IdentifiableDigitalAsset
//   name "Verified via EUDI Wallet (ChainIntegrate)", symbol "EUDIV"
//   lsp4TokenType = 1, lsp8TokenIdFormat = 2 (ADDRESS)
enum Status { None, Valid, Invalidated }
struct Attestation { bytes32 source; uint64 verifiedAt; uint64 expiresAt; Status status; }

mapping(address => Attestation) attestationOf;     // chiave = UP
address public attester;                            // chiave operativa backend
// owner() = UP ChainIntegrate (branding, ERC725Y metadata, cambio attester)

function tokenIdOf(address up) pure returns (bytes32) // bytes32(uint256(uint160(up)))
function attest(address up, bytes32 source, uint64 expiresAt) onlyAttester
     // se non esiste: _mint(up, tokenId, force=false, "") -> LSP1 sulla UP -> compare tra i collezionabili
     // se esiste (scaduto o invalidato): rinnovo in place (decisione D7)
function invalidate(address up, bytes32 reason) onlyAttesterOrOwner   // status = Invalidated, niente burn
function setAttester(address) onlyOwner
function isVerified(address up) view returns (bool)  // status == Valid && block.timestamp < expiresAt
function getAttestation(address up) view returns (Attestation memory)

event Attested(address indexed up, bytes32 indexed tokenId, bytes32 source, uint64 verifiedAt, uint64 expiresAt);
event Invalidated(address indexed up, bytes32 indexed tokenId, bytes32 reason);
event AttesterChanged(address indexed previous, address indexed next);

_beforeTokenTransfer: revert se from != 0 (blocca trasferimenti e burn); consentito solo il mint.
authorizeOperator: revert (nessun senso per un soulbound).
```
- `source`: `bytes32("EUDI_PID")` (stringa leggibile su Blockscout).
- `reason`: codice corto, es. `bytes32("USER_REQUEST")`, `bytes32("ISSUER_REVOKED")`, `bytes32("DUPLICATE")`: niente testo libero (rischio PII).
- Nessun dato personale, nessun hash dei dati della persona on-chain. Il contratto conosce solo UP, fonte, date, stato.
- Solidity 0.8.28, viaIR, optimizer 200, `evmVersion: paris`. **[I]**: verificare con la versione di Hardhat scelta (D9).

### B.2 LSP4TokenType = 1

Concordo sul valore `1` (NFT). **Correzione al brief, con evidenza [V]:** la costante `_LSP4_TOKEN_TYPE_NFT = 1` **esiste** in
`@lukso/lsp4-contracts/contracts/LSP4Constants.sol` (presente almeno dalla 0.15.0 fino alla 0.17.3 attuale). Probabilmente
mancava in versioni più vecchie del pacchetto unico `@lukso/lsp-smart-contracts`. Userò comunque il letterale `1` con un
commento, come richiesto: non cambia nulla e non dipende dalla versione.

**Problema di dipendenze trovato [V]:** `npm i @lukso/lsp-smart-contracts@0.17.4` **fallisce** (`ETARGET`: richiede
`@lukso/lsp25-contracts@~0.16.0`, ma su npm l'ultima è `0.15.5`). Stesso problema per `@lukso/lsp6-contracts@0.16.3`.
`@lukso/lsp8-contracts@0.18.1` + `@lukso/lsp4-contracts@0.17.3` + `@lukso/lsp0-contracts@0.16.3` invece si installano.
→ Useremo i pacchetti singoli. Per testare ERC-1271 con un vero KeyManager servirebbe un `overrides` npm su lsp25, altrimenti
nei test si usa una UP (LSP0) posseduta da una EOA, che copre lo stesso ramo `isValidSignature` del contratto UP.

### B.3 Metadata LSP4

JSON LSP4Metadata (caricato su IPFS o URL, referenziato con `VerifiableURI`):
- `description`: blocco **EN** poi blocco **IT**, es.
  *"Verified via EUDI Wallet by ChainIntegrate. Demo on test infrastructure; not an official or government credential.
  — Verificato tramite EUDI Wallet da ChainIntegrate. Demo su infrastruttura di test; non è una credenziale ufficiale né statale."*
- `icon`: PNG ≤ 800×800 px (più varianti ≤ 800), nessuno stemma o logo istituzionale.
- `links`: repo, pagina privacy, pagina di verifica.
- `attributes`: `source`, `network` (solo attributi statici; lo stato dinamico si legge da `isVerified`).

---

## C. Rischi e piani B

| # | Rischio | Probabilità | Piano B |
|---|---|---|---|
| R1 | **`age_over_18` assente dal PID** (già successo, [V]) | certo | Chiedere `birth_date` e calcolare l'età lato server (D1). Alternativa: credential `eu.europa.ec.av.1`, ma senza unicità. |
| R2 | Versioni OpenID4VP: verifier e wallet seguono `main`, cambiano spesso (es. `/ui/presentations/v2`, WRPRC, CIR 2026/1731) | alta entro inizio 2027 | Pinnare: versione APK del wallet, tag immagine del verifier; test di contratto API in CI; ripetere la Fase 0 un mese prima dell'hackathon. |
| R3 | Il wallet impone WRPRC/registration certificate | media | Usare `intended_use_id` configurato sul verifier ospitato; con il nostro, serve WRPRC. |
| R4 | Access certificate (self-host) non ottenibile | alta | Restare sull'ospitato. |
| R5 | Verifier ospitato giù o hostname cambiato (già incerto, A.2) | media | Piano B Docker (se R4 risolto); video registrato della demo come ultima risorsa. |
| R6 | CA del PID di test ruotate (UT 01 → 02 …) | media | Set di CA pinnato e aggiornabile da config; script che confronta con la LoTE `PIDProviders.jwt`. |
| R7 | Libreria mdoc non allineata a OpenID4VP 1.0 | certo per mdoc | SD-JWT primario; per mdoc SessionTranscript costruita a mano con `cbor-x`. |
| R8 | RPC LUKSO testnet instabile / rate limit | media | Chiave dedicata + RPC secondario di fallback; retry con backoff; mint idempotente (tokenId deterministico). |
| R9 | Chiave attester compromessa | bassa | Chiave dedicata con solo LYX per il gas; `setAttester` dall'owner; `invalidate` dei mint sospetti. |
| R10 | Controller della UP senza permesso SIGN | media | Messaggio chiaro nel frontend con istruzioni. |
| R11 | Dipendenze npm LUKSO non installabili (già successo, B.2) | certo per il pacchetto unico | Pacchetti singoli pinnati + lockfile committato. |
| R12 | Unicità aggirabile in test (PID con dati inventati) | certo | Dichiararlo nel README e in demo. |
| R13 | PM2 è AGPL-3.0 | — | Solo strumento di runtime, non distribuito né incluso nel nostro codice: nessun impatto sulla licenza Apache-2.0. Da citare nel README. |

---

## D. Architettura proposta

### Componenti
```
[Browser + estensione UP]
      │ (1) connect, personal_sign del challenge
      ▼
[Frontend statico] ──HTTPS──► [reverse proxy TLS] ──► [Backend Express 127.0.0.1:PORT, PM2]
                                                        │  ├─ SQLite (better-sqlite3)
                                                        │  ├─ RPC LUKSO testnet (chiave dedicata) ──► EudiVerifiedBadge
                                                        │  └─ HTTP ──► Verifier EUDI (ospitato | Docker)
[Wallet EUDI Android] ◄──── QR / request_uri ─────────────────────────────┘
```
Il browser non fa mai RPC: legge e scrive solo tramite il backend.

### Flusso
1. `GET /api/challenge?up=0x…` → messaggio testuale: dominio, chainId 4201, UP, nonce casuale, `issuedAt`, scopo.
2. L'utente firma con la UP (EIP-191 `personal_sign`). `POST /api/sessions {up, message, signature}`:
   - controllo `issuedAt` entro 5 min (e non nel futuro oltre 30 s), challenge a uso singolo;
   - `UP.isValidSignature(hashMessage(message), signature) == 0x1626ba7e` via RPC dal backend.
3. Il backend genera il nonce (A.4) e chiama `POST {VERIFIER}/ui/presentations` con il DCQL (D1), `issuer_chain`,
   `jar_mode=by_reference`, `request_uri_method=post`, `response_mode` (D3). Salva `transaction_id`, `client_id`, `request_uri`.
4. Il frontend mostra il QR (PNG dal verifier o generato da `authorization_request_uri`) e interroga **il nostro**
   `GET /api/sessions/:id` (polling ogni 2 s, max 10 min).
5. Il backend fa polling su `GET {VERIFIER}/ui/presentations/{tid}`: `PresentationNotSubmitted` → riprova; `error` → fallita.
6. Verifica indipendente: catena x5c → CA pinnate, firma emittente, `vct`, validità, KB-JWT (firma con `cnf.jwk`,
   `nonce`, `aud == client_id`, `iat`, `sd_hash`), età ≥ 18, HMAC unicità.
7. Unicità: se l'HMAC esiste già con un'altra UP → rifiuto (o politica D6). Se è nuovo → `attest()` on-chain,
   attesa ricevuta, salvataggio.
8. Il frontend mostra il bollino (`GET /api/badge/:up`, letto via backend).

### Schema dati (SQLite)
```sql
challenges(id TEXT PK, up TEXT, nonce TEXT, issued_at INT, used_at INT)
sessions(id TEXT PK, up TEXT, nonce_r BLOB, nonce_exp INT, transaction_id TEXT, client_id TEXT,
         request_uri TEXT, status TEXT, error_code TEXT, tx_hash TEXT, created_at INT, updated_at INT)
persons(uniq_hmac BLOB PK, up TEXT UNIQUE, source TEXT, verified_at INT, expires_at INT,
        status TEXT, tx_hash TEXT)            -- unica tabella con dati pseudonimi
chain_cursor(name TEXT PK, last_block INT)    -- eth_getLogs a partire da DEPLOY_BLOCK
```
Nessun claim in chiaro, nessun vp_token salvato. Sessioni cancellate dopo N giorni (D8). Log con solo id e codici di stato.

### Endpoint backend
| Metodo | Path | Scopo |
|---|---|---|
| GET | `/api/challenge?up=` | challenge da firmare |
| POST | `/api/sessions` | verifica ERC-1271, init presentazione, restituisce id + QR |
| GET | `/api/sessions/:id` | stato: `pending` → `verifying` → `minting` → `done` / `failed` |
| GET | `/api/badge/:up` | `isVerified` + attestazione (lettura on-chain via backend) |
| POST | `/api/admin/invalidate` | solo da localhost/CLI: `invalidate(up, reason)` |
| GET | `/api/health` | stato del servizio |

Configurazione (`.env`, mai committato; `.env.example` sì): `RPC_URL`, `RPC_URL_FALLBACK`, `ATTESTER_PK`, `CONTRACT_ADDRESS`,
`DEPLOY_BLOCK`, `VERIFIER_BASE_URL`, `NONCE_KEY`, `UNIQ_PEPPER`, `PID_CA_FINGERPRINTS`, `PUBLIC_ORIGIN`.

---

## E. Decisioni che servono da te

1. **D1 – DCQL / attributi.** `age_over_18` non esiste più nel PID. Proposta: richiedere `family_name, given_name,
   birthdate, place_of_birth, issuing_country` (età + unicità) e scartare i valori dopo il calcolo. Alternative:
   (a) solo `birthdate`, senza unicità; (b) Age Verification `av.1`, senza unicità.
2. **D2 – Formato:** SD-JWT VC primario (raccomandato) o mso_mdoc?
3. **D3 – `response_mode`:** `direct_post.jwt` (cifrato, richiesto da HAIP) o `direct_post`? Con SD-JWT è indifferente
   per la nostra verifica; propongo `direct_post.jwt`.
4. **D4 – Verifier:** ospitato (raccomandato) + Docker come piano B? Chi prova a ottenere un WRPAC di test?
5. **D5 – Ruolo del wallet nella dicitura:** confermi "Verified via EUDI Wallet by ChainIntegrate / Verificato tramite EUDI
   Wallet da ChainIntegrate" e il disclaimer "demo su infrastruttura di test"?
6. **D6 – Politica di unicità:** se la stessa persona verifica una seconda UP: rifiutare, oppure invalidare la vecchia e
   coniare sulla nuova?
7. **D7 – Scadenza e rinnovo:** durata (es. 12 mesi o `min(12 mesi, scadenza PID)`)? Rinnovo in place dello stesso tokenId?
8. **D8 – Conservazione:** quanti giorni per le sessioni? Per `persons` fino a richiesta di cancellazione?
9. **D9 – Hardhat 2 o 3?** L'ultima versione su npm è `hardhat@3.19.0`; config e plugin cambiano molto rispetto alla 2.
10. **D10 – Dove vive il repo:** nuovo repo `ChainIntegrate/eudi-up-verify` (da creare tu o io?) o sottocartella di
    `Cross_Chain`? Questa bozza è ora in `Cross_Chain/eudi-up-verify/docs/`, **non committata**.
11. **D11 – Owner del contratto:** indirizzo della UP ChainIntegrate su testnet (ne esiste una o va creata?).
12. **D12 – Hosting:** dominio e macchina per backend e frontend (serve HTTPS pubblico solo se facciamo self-host del verifier).

**Promemoria:** prima del primo commit va aggiunto **LICENSE Apache-2.0** (compatibile con i componenti EUDI, anch'essi Apache-2.0).

## F. Da ricontrollare su rete libera (prima della Fase 2)

- [ ] Hostname vivo del verifier ospitato e risposta grezza all'init (A.2) con il DCQL definitivo.
- [ ] Claim effettivamente presenti in un PID emesso oggi da `issuer.eudiw.dev` (`/.well-known/openid-credential-issuer`).
- [ ] CA che firma i PID attuali: confronto con la LoTE `PIDProviders.jwt`.
- [ ] Il wallet Android (APK di rete) accetta le richieste del verifier ospitato senza WRPRC aggiuntiva.
- [ ] RPC `https://rpc.testnet.lukso.network` → `eth_chainId` = `0x1069` (4201) e API Blockscout per la verifica.
- [ ] docs.eudi.dev: non letta (bloccata); controllare se aggiunge vincoli rispetto ai README.
