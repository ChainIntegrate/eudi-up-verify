# Fase 0 (v2) — Collegare una Universal Profile a una CIE

> Stato: **approvata** (decisioni D1-D10 confermate il 2026-10-14). Lo schema dati e il flusso qui sotto sono quelli
> iniziali: lo stato attuale è in `docs/02-backend.md`, `docs/03-frontend.md` e, per le modifiche dopo l'audit,
> `docs/audit/README.md`.
> Data: 2026-10-14. Sostituisce la v1 (archiviata in `docs/archivio/00-analisi-v1-eudi.md`), che partiva dall'assunto
> "usiamo l'EUDI Wallet" e per questo non confrontava le alternative.
> Legenda: **[V]** verificato (sorgente letto o comando eseguito) · **[D]** dedotto dai sorgenti, non provato end-to-end ·
> **[I]** incerto o non verificabile da questo ambiente.

## 1. Il problema, riformulato

Obiettivo: poter affermare, in modo verificabile da terzi e senza dati personali on-chain, che

> **"Chi controlla la UP `0x…` ha dimostrato, in un momento preciso, di possedere una CIE valida e di conoscerne il PIN."**

Requisiti derivati:
1. **Prova di controllo della UP**: firma ERC-1271 della UP.
2. **Prova di titolarità della CIE**: un'operazione crittografica che solo il chip della carta può fare e che, idealmente,
   richiede il PIN (possesso + conoscenza).
3. **Legame tra le due prove**: entrambe devono riferirsi allo **stesso enunciato**, che contiene UP, nonce del server e
   scadenza. Così nessuna delle due prove si può riusare per un'altra UP.
4. **Unicità**: una persona, una UP (o una politica esplicita per i casi diversi).
5. **Privacy**: nessun dato personale on-chain; off-chain solo uno pseudonimo con segreto lato server.
6. **Fattibilità** entro l'hackathon di inizio 2027, senza dipendere da accreditamenti lunghi.

Limite comune a tutte le strade: si dimostra che la stessa sessione ha visto entrambe le prove. Se il titolare della CIE
collabora con chi controlla la UP (per esempio gli presta carta e PIN), nessun protocollo lo impedisce. Va dichiarato.

## 2. Limiti di questa ricognizione

La rete di questo ambiente blocca i siti istituzionali (`cartaidentita.interno.gov.it`, `agid.gov.it`, `docs.italia.it`,
`federazione.servizicie.interno.gov.it`, `*.eudiw.dev`) e l'RPC LUKSO: il proxy risponde 403. Ho lavorato su:
- repo GitHub ufficiali (clonati): `italia/cie-middleware-linux` (`a05337f`, 2025-06-19),
  `italia/cieid-android-sdk` (`884e8cb`, 2023-05-12), `italia/eid-wallet-it-docs` (`c87e656`, 2026-09-29, v1.4.7),
  `italia/spid-cie-oidc-django` (`e83e039`), più i repo EUDI della v1;
- il manuale ufficiale del middleware CIE incluso nel repo (`DOC/CIE 3.0 - Manuale d'uso del middleware Linux.pdf`);
- pacchetti npm (versioni e licenze);
- ricerca web, per orientarsi soltanto (fonti elencate in fondo).

## 3. Cosa c'è dentro una CIE 3.0 (rilevante per noi)

Dal codice del middleware ufficiale (`cie-pkcs11/CSP/AbilitaCIE.cpp`, `IAS.cpp`) e dall'SDK Android (`nfc/Ias.kt`) **[V]**:

| Elemento | Accesso | Note |
|---|---|---|
| Applet **ICAO 9303** (DG1 MRZ, DG2 foto, SOD) | con **CAN** o MRZ stampati sulla carta | standard passaporto elettronico; BAC/PACE, Chip Authentication (EAC) secondo l'indice delle specifiche AgID |
| Applet **IAS**: `IdServizi` / **NIS** (12 cifre) | **senza PIN** | identificativo della carta, non della persona |
| Chiavi pubbliche di *internal authenticate* (`IntAuth`, `IntAuthServizi`) | senza PIN | il chip risponde a una sfida, dimostrando che la carta è autentica |
| **SOD dell'applet IAS** | senza PIN | firmato dall'emittente; copre con hash NIS, chiavi pubbliche, numero di serie, certificato (`hashSet[0xa1…0xa5, 0x1b]` in `AbilitaCIE.cpp`) |
| **Certificato di autenticazione del titolare** (`readCertCie`, file `0x1003`) | dopo PIN, in canale sicuro | il manuale ufficiale: *"certificato di autenticazione dell'utente, riconoscibile dal codice fiscale"* |
| **Chiave privata del titolare** (`CIE_KEY_Sign_ID = 0x81`) | **dopo PIN** (8 cifre) | usata per l'autenticazione TLS di "Entra con CIE" e per la **Firma Elettronica Avanzata** (CieSign / Software CIE) |

Il pezzo decisivo **[V]**: in `cieid-android-sdk` (licenza **BSD-3-Clause**, © IPZS) la funzione `firma()` fa
`startSecureChannel(pin)`, poi `sign( DigestInfo(SHA-256) || SHA-256(challenge) )`, cioè una **firma RSA PKCS#1 v1.5 su
SHA-256 di dati arbitrari con la chiave del titolare**. Lo stesso SDK legge il certificato (`readCertCie`). Quindi
**un'app può far firmare alla CIE, via NFC e con PIN, un enunciato scelto da noi**.

## 4. Le strade possibili

| # | Strada | Cosa dimostra | Accreditamento | Dati reali | Fattibile per l'hackathon |
|---|---|---|---|---|---|
| **A** | **Firma CIE dell'enunciato** (chiave del titolare + PIN) | possesso della carta **e** PIN; certificato del Ministero | **nessuno** | sì (CIE vere) | **sì** |
| B | Lettura ICAO via NFC (CAN) + passive/chip authentication | dati autentici e chip genuino; **nessun PIN** | nessuno | sì, molti (foto, MRZ) | sì, ma prova più debole e più invasiva |
| C | NIS + internal authenticate (pinless) | possesso di una carta autentica; **nessun PIN**, nessuna identità | nessuno | minimi | sì, ma non lega la persona |
| D | "Entra con CIE" (OpenID Connect, federazione CIE) | autenticazione completa gestita dal Ministero, attributi firmati (CF, nome…) | **adesione come SP** alla federazione CIE | sì | **[I]**: dipende dai tempi di adesione; esiste un ambiente di preproduzione |
| E | IT-Wallet (PID italiano via OpenID4VP) | PID rilasciato dopo identificazione con CIE | **onboarding RP** nella federazione IT-Wallet (registrazione amministrativa + tecnica) | sì | **[I]**: improbabile entro inizio 2027 per un privato |
| F | EUDI Wallet di riferimento (v1) | PID di test con dati inventati | nessuno (verifier ospitato) | no | sì, ma **non c'entra con la CIE** |

### A — Firma CIE di un enunciato congiunto (raccomandata)

**Come:**
1. Il backend genera l'enunciato (testo deterministico, UTF-8):
   ```
   ChainIntegrate — collegamento Universal Profile / CIE
   Origine: https://<dominio>
   Rete: LUKSO testnet (chainId 4201)
   Contratto: 0x<attestatore>
   Universal Profile: 0x<UP>
   Nonce: <base64url 32 byte>
   Emesso: <ISO-8601 UTC>   Scade: <+10 min>
   Dichiaro di controllare questo Universal Profile e di essere titolare della CIE con cui firmo.
   ```
2. La **UP firma** l'enunciato (EIP-191 → `isValidSignature` ERC-1271, verificato dal backend via RPC).
3. La **CIE firma lo stesso enunciato**, in uno di due modi:
   - **A1 – CieSign / Software CIE (app ufficiali, zero sviluppo mobile):** l'utente scarica `enunciato.txt`, lo firma
     in **CAdES** con l'app CieSign (smartphone NFC) o con il Software CIE (PC + lettore), e carica il `.p7m`. CieSign è
     gratuita e firma file di qualsiasi tipo (CAdES) o PDF (PAdES): fonti web del Ministero e manuale del middleware **[V]**.
   - **A2 – App ChainIntegrate con NFC:** l'app (es. `up-wallet-android`) inquadra un QR della pagina web, chiede il PIN,
     usa il codice NFC dell'SDK IPZS (BSD-3) per firmare `SHA-256(enunciato)` e leggere il certificato, e invia al backend
     `{certificato, firma}`. UX molto migliore; serve sviluppo Android.
4. Il backend verifica:
   - firma CIE (A1: CMS/CAdES con `pkijs`; A2: `crypto.verify('sha256', enunciato, cert, firma)`);
   - **catena del certificato verso le CA del Ministero dell'Interno** (certificati da pinnare) **[I]**: nome esatto e
     certificati della CA da scaricare dal sito istituzionale;
   - validità temporale e **stato di revoca** (OCSP/CRL indicati nel certificato) **[I]**;
   - che l'enunciato firmato sia **byte per byte** quello emesso, non scaduto, con nonce a uso singolo;
   - che la stessa UP abbia firmato lo stesso enunciato.
5. Unicità: `HMAC-SHA256(UNIQ_PEPPER, codice_fiscale)`. Il codice fiscale è nel certificato **[V]** (campo esatto **[I]**,
   probabilmente `serialNumber` o CN). Il codice fiscale è stabile nel tempo e tra rinnovi della carta, quindi è un ottimo
   identificatore per l'unicità, molto meglio del composito nome+data della v1.
6. Mint del bollino (contratto §6) con `source = "CIE"`, scadenza = `min(notAfter del certificato, durata scelta)`.

**Perché è la strada migliore per noi:**
- È **l'unica che usa la CIE vera senza accreditamenti**.
- Prova **possesso + PIN**: il livello più alto ottenibile senza federazione.
- Il **legame con la UP è crittografico**: la CIE firma un testo che contiene l'indirizzo della UP. Non è solo "stessa
  sessione" lato server: la prova si può riverificare da sola, se conservata (vedi D9).
- Codice di riferimento ufficiale e open source (IPZS, BSD-3) per la variante A2.

**Punti aperti [I]:**
- Certificati delle CA del Ministero, struttura del certificato del titolare, OCSP/CRL: da verificare su una CIE reale.
- Formato esatto del CAdES prodotto da CieSign (contenuto incapsulato o detached, attributi firmati): da provare con una firma vera.
- Termini d'uso di CieSign e del Software CIE per un uso come questo (firmare un enunciato verso un privato): da leggere.
- Implicazione legale: la firma è una **FEA**, non una firma qualificata. A noi serve come prova crittografica, non come
  sottoscrizione di un contratto; va spiegato bene all'utente cosa sta firmando.

### B — Lettura ICAO (passaporto elettronico)
Con il CAN si leggono DG1/DG2 e il SOD; la passive authentication verso la CSCA italiana dimostra che i dati sono
autentici, la chip authentication che il chip non è un clone. **Ma**: niente PIN (basta avere in mano la carta, che ha il
CAN stampato sopra), nessuna firma su un nostro enunciato (il legame con la UP resta solo lato server) e dati molto
invasivi (foto). Utile come complemento, non come base.

### C — NIS pinless
Il NIS identifica la **carta**, non la persona, e cambia al rinnovo. L'internal authenticate dimostra solo che la carta è
autentica. Pensato per controlli accessi fisici. Insufficiente da solo.

### D — "Entra con CIE" (OIDC)
La strada "istituzionale": il Ministero autentica l'utente e restituisce un `id_token` firmato con attributi (CF, nome…).
Il nostro nonce OIDC conterrebbe il legame con la UP. Fatti: l'adesione come fornitore di servizi (anche privato) passa dal
portale di federazione e dal manuale operativo **[I, fonti web]**; esiste un ambiente di **preproduzione** e un'app CieID
di collaudo (`it.ipzs.cieid.coll`) **[V, README cieid-android-sdk]**. Tempi e requisiti per un privato non verificati.
→ **Strada naturale per una versione di produzione**, da avviare in parallelo se interessa.

### E — IT-Wallet
Le specifiche (`eid-wallet-it-docs` v1.4.7) richiedono che ogni Relying Party completi una **registrazione amministrativa**
e una **registrazione tecnica in federazione** **[V]**. Il PID italiano ha `personal_administrative_number` **opzionale**
e regole di identity matching (CF se presente, altrimenti nome+cognome+data+luogo di nascita) **[V]**. Strada di medio
periodo, non per l'hackathon.

### F — EUDI Wallet di riferimento
Analizzata nella v1: funziona solo con PID di test dai dati inventati e **non coinvolge la CIE**. Utile al massimo come
demo "europea" alternativa; la scarto come strada principale.

## 5. Architettura proposta (strada A)

```
Browser + estensione UP ──► Frontend ──► Backend Express (127.0.0.1, PM2) ──► RPC LUKSO (chiave dedicata) ──► Attestatore LSP8
                                │              ▲   ▲
                     A1: upload .p7m           │   └── A2: app Android (NFC CIE) invia {cert, firma}
                                               └── SQLite (better-sqlite3)
```

**Flusso:**
1. `POST /api/statements {up}` → il backend crea l'enunciato (nonce, scadenza 10 min) e lo restituisce.
2. La UP firma l'enunciato: `POST /api/statements/:id/up-signature` → verifica ERC-1271 (permesso SIGN sul controller,
   finestra 5 min, uso singolo).
3. La CIE firma:
   - A1: `GET /api/statements/:id/file` (download `enunciato.txt`) → firma con CieSign → `POST /api/statements/:id/cie-cades`
     (upload `.p7m`);
   - A2: la pagina mostra un QR `{statementId, url}` → l'app scarica l'enunciato, lo fa firmare alla CIE →
     `POST /api/statements/:id/cie-raw {certDer, signature}`.
4. Verifica (§4-A punto 4) → HMAC del codice fiscale → controllo unicità → `attest()` on-chain → risposta con tx hash.
5. `GET /api/badge/:up` → letture on-chain tramite il backend (`eth_getLogs` da `DEPLOY_BLOCK`).

**Dati (SQLite):**
```sql
statements(id PK, up, nonce, text_sha256, issued_at, expires_at, up_sig_ok INT, status, error_code, tx_hash)
persons(uniq_hmac BLOB PK, up TEXT UNIQUE, source TEXT, verified_at INT, expires_at INT, status TEXT, tx_hash TEXT)
chain_cursor(name PK, last_block INT)
```
Il `.p7m`, il certificato, nome, cognome e CF **non vengono salvati né loggati**: si verificano in memoria e si scartano.
Si salva solo `uniq_hmac`.

## 6. Contratto LUKSO (invariato nella sostanza rispetto alla v1)

Fatti verificati sui pacchetti npm **[V]**: `@lukso/lsp8-contracts@0.18.1` (pragma `^0.8.27`), `@lukso/lsp4-contracts@0.17.3`
(`_LSP4_TOKEN_TYPE_NFT = 1` esiste), `@lukso/lsp0-contracts@0.16.3` installabili. **Non** installabili:
`@lukso/lsp-smart-contracts@0.17.4` e `@lukso/lsp6-contracts@0.16.3` (dipendono da `@lukso/lsp25-contracts@~0.16.0`, che
su npm non esiste: `ETARGET`). Le estensioni ufficiali `LSP8NonTransferable` (sbloccabile dall'owner) e `LSP8Revokable`
(revoca = trasferimento all'owner) non fanno al caso nostro. ERC-1271 sulla UP passa dal KeyManager e richiede il permesso
**SIGN** sul controller (`LSP6KeyManagerCore.isValidSignature`).

Bozza (dettagli nella v1, §B.1): LSP8 soulbound con `_beforeTokenTransfer` che rifiuta tutto tranne il mint;
`tokenId = bytes32(uint256(uint160(up)))` (formato ADDRESS); `owner` = UP ChainIntegrate; `attester` = chiave operativa;
`attest(up, source, expiresAt)`, `invalidate(up, reason)` senza burn; `isVerified(address)`; LSP4TokenType = 1; metadati
EN poi IT; icona ≤ 800 px. `source` diventa `bytes32("CIE")` (o `"CIE_FEA"`), così resta estendibile ad altre fonti
(`"CIE_OIDC"`, `"IT_WALLET"`, `"EUDI_PID"`).

## 7. Privacy e GDPR (cambia rispetto alla v1: ora i dati sono **reali**)

- Trattiamo dati personali reali (nome, cognome, CF nel certificato), anche se solo in memoria: serve **informativa**,
  **consenso esplicito**, titolare del trattamento (ChainIntegrate), periodo di conservazione, procedura di cancellazione.
- Conserviamo solo `HMAC(UNIQ_PEPPER, CF)` + UP: **dato pseudonimizzato, quindi ancora dato personale**. `UNIQ_PEPPER` va
  tenuto fuori dal DB e dai backup del DB. Il CF ha uno spazio di valori ristretto: se il pepper trapela, l'HMAC si inverte
  per forza bruta.
- On-chain: nessun dato personale; il bollino rivela solo che quella UP "ha una CIE verificata", per scelta dell'utente.
- L'enunciato firmato dalla CIE **è** una prova che lega identità e UP. Conservarlo (cifrato) serve per contestazioni;
  non conservarlo minimizza il rischio. Decisione D9.
- Log: solo id, codici di stato, tx hash. Mai certificati, CF, firme.
- Per la demo: usare la **propria** CIE del team, con consenso scritto.

## 8. Rischi e piani B

| Rischio | Piano B |
|---|---|
| CA del Ministero / formato certificato diversi dal previsto | Test su CIE reale come primo passo della Fase 1 (spike); A2 legge il certificato direttamente dal chip |
| CAdES di CieSign non verificabile come previsto (detached, encoding testo) | A2, oppure PAdES (PDF) con `pkijs` |
| Termini d'uso CieSign incompatibili | A2 (firma tramite la nostra app con codice IPZS BSD-3) |
| OCSP/CRL non raggiungibili | Accettare senza controllo di revoca solo in demo, dichiarandolo; scadenza breve del bollino |
| Telefono senza NFC / NFC problematico | Software CIE da PC con lettore USB (A1) |
| PIN CIE bloccato dopo 3 errori | Avviso chiaro in UI; serve il PUK |
| UX A1 macchinosa (scarica, firma, ricarica) | A2 come obiettivo; A1 come ripiego sempre disponibile |
| Dipendenze npm LUKSO | Pacchetti singoli pinnati + lockfile |
| PM2 è AGPL-3.0 | Solo runtime, non distribuito: nessun impatto sulla licenza Apache-2.0 |
| Uso del codice SDK IPZS | BSD-3: mantenere copyright e nota in `THIRD_PARTY_NOTICES`; niente loghi CIE/CieID |

## 9. Decisioni

### Prese (2026-10-14)
| # | Decisione |
|---|---|
| D1 | **Strada A: firma CIE** dell'enunciato congiunto. |
| D2 | **Variante A2** (app Android con NFC); probabile integrazione in **UP-Wallet**, da decidere più avanti. A1 (CieSign + upload) resta come ripiego per i test. |
| D6 | Rinominare il repo (il nome lo sceglie il titolare: lo strumento GitHub di questa sessione non permette di rinominare). |
| D7 | Dicitura da definire in corso d'opera (restano fermi i divieti: niente "ufficiale", niente loghi istituzionali). |
| D8 | **Hardhat 3** (attuale: 3.19.0; la 2.x è ferma alla 2.29.1). Ha `hardhat-toolbox-mocha-ethers` (ethers v6) e la verifica su Blockscout integrata in `@nomicfoundation/hardhat-verify` 3.x. Config in TypeScript/ESM. |
| D10 | Owner = UP ChainIntegrate; rete **LUKSO testnet**; hosting sul server già in uso (Node/Express su 127.0.0.1 + PM2). |
| D3 | **Una sola UP attiva per persona.** Uscite di sicurezza: *migrazione* con nuova firma CIE (vecchio bollino invalidato con motivo `MIGRATED`); *eccezione* con limite per persona (default 1) alzabile solo dall'owner, con evento on-chain. |
| D4 | `expiresAt` = **scadenza del certificato CIE** (validità della carta). Nessuna durata arbitraria. Al rinnovo della carta si rifirma. |
| D5 | Revoca, tutte e tre: (1) alla verifica si rifiutano i certificati revocati; se il servizio di revoca non risponde **si rifiuta** (fail-closed, interpretazione del "sì": da confermare); (2) controllo periodico dopo il conio, quindi si conservano **numero di serie ed emittente del certificato, cifrati**; (3) invalidazione su richiesta dell'utente e dell'owner per abuso. |
| D9 | **Non** si conserva l'enunciato firmato. Restano solo `SHA-256(enunciato)`, l'HMAC del CF e (per D5.2) serial+emittente cifrati. |

### Indirizzi owner (UP ChainIntegrate)
| Rete | UP |
|---|---|
| LUKSO mainnet | `0x4a2605796e0d91A9667d6E30365aEEC384C48c27` |
| LUKSO testnet (4201) | `0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C` |

Le UP hanno i loro controller, ma per ora non servono: il contratto riceve la UP come `owner` già nel costruttore (deploy
da una chiave di deploy separata). Le operazioni dell'owner (es. `setAttester`) si fanno più avanti dalla UP.
**[I]** Da verificare via RPC, al momento del deploy, che entrambi gli indirizzi siano UP (LSP0) sulla rete giusta.

## 10. Primo passo proposto dopo l'approvazione

**Spike di verifica su CIE reale** (prima di contratto e backend): con una CIE del team, firmare un `enunciato.txt` con
CieSign e verificare in locale, con uno script Node, firma, catena, revoca e campo del CF. È il fatto che regge tutto il
progetto e oggi è **[I]**. Se fallisce, si ripiega su A2 o D prima di aver scritto altro codice.

## 11. Risultati dello spike su CIE reale (2026-10-14)

Firma fatta con **CieSign** (smartphone) su un enunciato generato da `spike/make-statement.mjs`, verificata su Windows
con `spike/verify-cie.mjs --tsl https://eidas.agid.gov.it/TL/TSL-IT.xml --online`. Esito: **tutti i controlli superati**.
L'output non contiene dati personali; i valori sotto sono quelli stampati dallo script. **[V]**

| Aspetto | Risultato |
|---|---|
| File prodotto da CieSign | `signed_<n>_enunciato.txt.p7m`: CMS SignedData, **contenuto incapsulato** (attached), un firmatario, 3 certificati inclusi (titolare, sub CA, root) |
| Contenuto firmato | **identico byte per byte** all'enunciato (517 byte): CieSign non altera il file |
| Firma | SHA-256 + RSA PKCS#1 v1.5 (`1.2.840.113549.1.1.11`), CAdES-BES (`signingCertificateV2`), attributo `signingTime` presente |
| Certificato titolare | RSA 2048; `keyUsage = digitalSignature`; `extKeyUsage = clientAuth`; policy `1.3.76.47.4`; validità residua ~7,3 anni (è la validità della carta: base per D4) |
| Emittente | `CN=Issuing sub CA for the Italian Electronic Identity Card - SUBCA003, OU=Direz. Centr. per i Servizi Demografici - CNSD, O=Ministero dell'Interno, C=IT` |
| Radice | `CN=National root CA for the Italian Electronic Identity Card` (stessa OU/O), autofirmata, inclusa nel CMS |
| Trusted List AgID | 562 servizi, 176 di tipo IdV; la **SUBCA003 è presente** tra i servizi IdV → catena valida |
| Codice fiscale | nel **`commonName`**: lunghezza 29, CF all'inizio + 13 caratteri dopo (forma probabile `CF/<12 cifre>`, da confermare). `serialNumber` (15, misto) **non** contiene il CF |
| Revoca – OCSP | `https://ocsp.cie.interno.gov.it/` risponde; risposta **firmata e valida**, stato **GOOD** |
| Revoca – CRL | `http://ldap.cie.interno.gov.it/ciesubca003.crl`: il contenuto scaricato **non è una CRL DER/PEM** (causa da capire); non bloccante perché l'OCSP funziona |

**Conseguenze per il progetto:**
- **Strada A confermata**: la firma CIE di un enunciato scelto da noi si verifica in modo completo con librerie standard
  (`pkijs`), senza accreditamenti.
- **Unicità (D3)**: chiave = `HMAC(UNIQ_PEPPER, primi 16 caratteri del commonName)`, dopo aver verificato il pattern del CF.
  Non usare `serialNumber` né la parte dopo il CF: probabilmente identificano la carta e cambiano al rinnovo **[I]**.
- **Revoca (D5)**: OCSP disponibile, quindi la politica fail-closed è praticabile. Per il ricontrollo dopo il conio (D5.2)
  bastano numero di serie ed emittente del certificato, da conservare cifrati.
- **Scadenza (D4)**: `expiresAt` = `notAfter` del certificato del titolare.
- **Trust anchor in produzione**: lo spike non verifica la firma XML della Trusted List. Proposta: **pinnare la "National
  root CA for the Italian Electronic Identity Card"** (impronta SHA-256 in configurazione) e accettare le sub CA che ne
  discendono; la Trusted List resta un controllo incrociato.
- La variante A2 (app Android con NFC) usa **la stessa chiave e lo stesso certificato**: questi risultati valgono anche
  per lei. Cambia solo il formato: firma PKCS#1 "nuda" invece di CMS.

**Nota (scoperta scrivendo il backend):** lo spike valida catena e risposta OCSP con i componenti di pkijs, che in test
hanno accettato un certificato non firmato dalla CA a cui era collegato (abbinamento solo per nome). Il risultato sulla
CIE reale resta valido (certificati autentici), ma la logica dello spike non va riusata: il backend valida ogni anello
in modo esplicito con OpenSSL (`backend/src/cie/chain.js`), con test di regressione dedicati.

**Ancora da verificare [I]:** la CRL (formato reale del file scaricato); la forma esatta del `commonName` (cosa sono i 13
caratteri dopo il CF); il comportamento con una CIE revocata (difficile da provare, si affida al test con PKI finta).

## Fonti web consultate (orientative, non verificate a fondo)

- [Ministero dell'Interno – CieSign](https://www.cartaidentita.interno.gov.it/en/public-and-business-administration/electronic-signature-with-cie-ciesign/)
- [Ministero dell'Interno – Electronic verification with CIE](https://www.cartaidentita.interno.gov.it/en/public-and-business-administration/electronic-verification-with-cie/)
- [Ministero dell'Interno – CIE features](https://www.cartaidentita.interno.gov.it/en/cie/cie-features/)
- [Ministero dell'Interno – Operating manual "Entra con CIE"](https://www.cartaidentita.interno.gov.it/en/public-and-business-administration/operating-manual-entra-con-cie/)
- [Federazione CIE – Manuale operativo](https://federazione.servizicie.interno.gov.it/docs/cie-manuale-operativo-docs)
- [AgID – CIE 3.0 Specifiche chip (PDF)](https://www.agid.gov.it/sites/default/files/repository_files/documentazione/cie_3.0_-_specifiche_chip.pdf)
- [Manuale accessi pinless (NIS)](https://docs.italia.it/projects/cie-accessi-pinless-manuale-docs/downloads/pdf/stabile)
- [Developers Italia – CIE](https://developers.italia.it/en/cie)
- [Agenda Digitale – CIE 3.0 usi digitali](https://www.agendadigitale.eu/cittadinanza-digitale/cie-3-0-tutti-gli-usi-digitali-della-nuova-carta-didentita/)
- [Provincia di Modena – CIE 3.0 Manuale accesso ai servizi (PDF)](https://www.provincia.modena.it/wp-content/uploads/2020/02/CIE3.0-Manuale-Accesso-ai-Servizi.pdf)
