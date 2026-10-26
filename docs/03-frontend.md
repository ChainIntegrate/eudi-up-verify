# UP CIE Link — Fase 3: frontend

Stato (2026-10-19): **in funzione in testnet** su `up-cie-link.chainintegrate.it`. Decisioni F1-F8 (§4), pagina
admin A1-A5 (§6) confermate e implementate; primo collegamento reale (UP + CIE con CieSign) riuscito il 2026-10-15.
Dopo il secondo audit: in "Il mio bollino" export e cancellazione dei dati firmati dalla UP (UCL-31); nella pagina
admin i contratti sostituiti (UCL-38). Provati dall'owner: rinuncia, export, nuovo collegamento dopo la rinuncia, fermo dei contratti sostituiti.
La connessione con UP Wallet per Android (WalletConnect, §5) è rinviata al mainnet. I §1-3 sono la proposta
originale, conservata come storia delle decisioni.

Obiettivo: il frontend definitivo (o quasi) su `up-cie-link.chainintegrate.it`, con cui fare subito i test online
con UP e CIE reali via CieSign; l'app Android (Fase 4) si aggiungerà come secondo canale di firma CIE senza rifare le
pagine.

## 1. Vincoli già decisi

- Il browser non chiama mai un RPC: tutte le letture on-chain passano da `/api/badge/:up` e `/api/config`.
  Fa eccezione solo ciò che l'estensione UP fa per conto suo quando l'utente firma o invia una transazione.
- Niente "ufficiale", "riconosciuto dallo Stato", stemmi della CIE o loghi istituzionali.
- Niente dati personali nel frontend: il codice fiscale e il nome non vengono mai mostrati né salvati. Il `.p7m`
  passa dal browser al backend e basta.
- Privacy (analisi §7): servono informativa e consenso esplicito prima della firma con la CIE.

## 2. Pagine

1. **Home**: cosa fa il servizio, cosa resta on-chain (solo "questa UP ha una CIE verificata", con scadenza), cosa
   viene conservato (HMAC del codice fiscale), limiti (firma FEA, non qualificata), link a informativa e verifica.
2. **Collega** (procedura a passi):
   1. collega la UP con l'estensione UP Browser (`window.lukso`, in alternativa `window.ethereum`);
   2. scelta della modalità: primo collegamento, migrazione della UP principale, UP aggiuntiva (con eccezione);
   3. informativa e consenso (casella obbligatoria);
   4. firma dell'enunciato con la UP (`personal_sign` dall'estensione);
   5. firma con la CIE: scarica `enunciato.txt`, firmalo con CieSign, carica il `.p7m`; conto alla rovescia sulla
      scadenza dell'enunciato. Predisposto per il QR dell'app Android (Fase 4);
   6. attesa (verifica, coda, conio) con lo stato letto da `GET /api/statements/:id`;
   7. esito: bollino coniato con link alla transazione, oppure errore spiegato. Per l'eccezione: il ticket da
      inviare a ChainIntegrate, con il pulsante "copia".
3. **Verifica** (`/verify/<up>`, pubblica, senza estensione): stato del bollino di qualunque UP (valido, scaduto,
   invalidato, revocato, principale sì/no, date). È la pagina che si condivide.
4. **Il mio bollino** (con la UP collegata): stato, rinnovo (rifà la procedura), **rinuncia**. La rinuncia è una
   transazione `renounce()` inviata dalla UP tramite l'estensione: il backend la vede con l'indicizzatore.
5. **Informativa privacy** e **note legali**.

## 3. Proposte (confermate il 2026-10-14, vedi §4)

- **F1, tecnologia:** Vite + TypeScript + React, build statica servita da nginx sullo stesso dominio (nessun CORS
  in produzione). Dipendenze minime e fissate; ethers solo per gli indirizzi e la codifica di `renounce()`.
  Alternativa: TypeScript senza framework (meno dipendenze, più codice a mano).
- **F2, lingue:** italiano ed inglese con selettore, italiano predefinito.
- **F3, aspetto:** sobrio, colori e logo ChainIntegrate (se mi fornisci il logo), nessun richiamo grafico alla CIE.
- **F4, informativa privacy:** scrivo io una bozza (titolare ChainIntegrate, dati trattati, base giuridica
  consenso, conservazione, diritti, contatti). **Non è una consulenza legale**: va rivista da te o da un legale
  prima del mainnet. Mi servono i dati del titolare (ragione sociale, sede, contatto privacy).
- **F5, tempo per CieSign:** l'enunciato vale 15 minuti (B1). Propongo di lasciarlo così e di mostrare il conto
  alla rovescia; se nei test risulta stretto, si alza `STATEMENT_TTL_SEC` senza toccare il codice.
- **F6, metadati del bollino (LSP4):** nome, descrizione EN/IT e icona della collezione, così i wallet mostrano il
  bollino in modo leggibile. Si scrivono con `setData` dalla UP owner (script da Codespaces). Serve un'icona
  (≤ 800 px, nessun simbolo istituzionale): la fornisci tu o la preparo io semplice?
- **F7, percorso di rilascio:** prima tutto in **testnet** sul dominio definitivo, test con la tua UP e la tua CIE;
  poi deploy del contratto e passaggio a **mainnet** con la stessa build (cambia solo `NETWORK` / `RPC_URL`).
- **F8, endpoint di supporto:** nessuno nuovo per la procedura; aggiungo al backend solo il download
  `GET /api/statements/:id/file` (previsto nell'analisi §5, non ancora fatto), così il file da firmare ha sempre
  esattamente i byte attesi.

## 4. Decisioni prese (2026-10-14)

- **F1:** nessuna dipendenza da librerie online. Interpretazione applicata: HTML, CSS e JavaScript statici scritti
  da noi, **nessuna libreria di terzi e nessun passo di build**, nessun CDN né font esterni (come le pagine di
  Cross_Chain). Content-Security-Policy stretta in nginx: solo file del nostro dominio, niente codice inline.
- **F2:** italiano/inglese con pulsante, e pulsante tema chiaro/scuro (scuro predefinito, come Cross_Chain).
- **F3:** celeste e grigio. `img/logo.png` e `img/banner.png` sono **segnaposto** da sostituire (sorgenti SVG in
  `img/src/`).
- **F4:** dati del titolare presi da Cross_Chain (ChainIntegrate, info@chainintegrate.it, Telegram, GitHub).
  L'informativa è una bozza: **va rivista prima del mainnet**, non è una consulenza legale.
- **F5:** 15 minuti, con conto alla rovescia.
- **F6:** icona del bollino `metadata/badge-icon.png` (800×800, scudo con spunta, stile Cross_Chain, nessun simbolo
  istituzionale) e `metadata/badge.json` (LSP4Metadata, EN/IT), serviti dal nostro dominio. Lo script
  `contracts/scripts/lsp4-metadata.mjs` calcola il valore da scrivere (VerifiableURI); verificato su catena locale
  che la UP owner lo scrive con `execute()` e che un altro indirizzo viene respinto.
- **F7:** rilascio prima in testnet.
- **F8:** `GET /api/statements/:id/file` aggiunto.

Pagine: `/`, `/collega`, `/verifica/<up>`, `/il-mio-bollino`, `/privacy`, `/note-legali`.

Verificato: test end-to-end in Chromium (`backend/test/frontend.e2e.test.js`) con backend vero, catena locale, UP
LSP0 vera e un sostituto dell'estensione che firma con la chiave del controller: collegamento completo, download
del file con i byte esatti, verifica, rinuncia, errori; nessun errore nella pagina e CSP applicata. Template nginx
provato con nginx reale (pagine, header, CORS dei metadati, `X-Forwarded-For`, limite 128k).
Non verificato: l'estensione UP Browser reale, CieSign reale, i browser diversi da Chromium.

## 5. UP Wallet per Android (richiesta del 2026-10-14) — rinviata al mainnet

Decisione del 2026-10-14: per semplicità WalletConnect si aggiunge **al passaggio in mainnet**; in testnet solo
l'estensione UP Browser. Le domande W1-W4 qui sotto restano aperte fino ad allora.

La connessione deve funzionare con l'estensione UP Browser **e** con l'app UP Wallet per Android. L'app parla con le
dApp via **WalletConnect** (incolla il link `wc:` della dApp, come `up-wallet.html`), firma `personal_sign` con il
controller e invia transazioni dalla UP. Per farlo la pagina deve includere il lato "dApp" di WalletConnect:

- **W1, libreria:** `@walletconnect/sign-client` (Reown) impacchettato in **un file statico nel repository**
  (`frontend/vendor/`), costruito con esbuild come `vendor/walletkit` in Cross_Chain: nessun CDN, ma è codice di
  terzi e usa il relay di Reown (servizio online). Licenza: WalletConnect Community License (non open source),
  avviso nel piè di pagina, soglie d'uso oltre le quali serve una licenza commerciale. Alternativa: nessuna, l'app
  parla solo WalletConnect.
- **W2, Project ID Reown:** progetto nuovo per `up-cie-link.chainintegrate.it` (consigliato) oppure lo stesso di
  Cross_Chain con il dominio aggiunto agli "allowed domains".
- **W3, QR:** la pagina mostra il link `wc:` con il pulsante "copia" e un QR; per il QR un piccolo generatore
  (libreria MIT copiata in `vendor/` oppure scritto da noi).
- **W4, verifica sull'app:** serve che l'app supporti la rete LUKSO testnet (4201), `personal_sign` e
  `eth_sendTransaction` dalla UP. Non posso verificarlo da qui (il repository `up-wallet-android` non è in
  questa sessione).
- Informativa: va aggiunto Reown (vede indirizzo della UP, rete e IP durante la connessione).

## 6. Pagina admin (decisione del 2026-10-14; A1-A5 e pulsante di emergenza confermati il 2026-10-15)

Decisione: le operazioni dell'owner si fanno da una pagina admin che funziona **solo se la UP collegata è quella di
ChainIntegrate (owner del contratto) e ha firmato l'accesso**; predisposta per testnet e mainnet.

Proposta di dettaglio:
- **A1, accesso:** la pagina collega la UP; il backend controlla che sia l'`owner()` del contratto letto on-chain
  sulla rete configurata (attese: testnet `0x83cB…472C`, mainnet `0x4a26…8c27`). Poi la UP firma un messaggio di
  accesso (ERC-1271, nonce monouso, finestra 5 minuti); il backend rilascia una sessione di 30 minuti (cookie
  `HttpOnly`, `Secure`, `SameSite=Strict`, solo in memoria). Senza sessione le API admin rispondono 401 e la pagina
  non mostra nulla.
- **A2, contenuto:**
  - stato del servizio: rete, contratto, attestatore e saldo, indicizzatore, coda, conii in corso, ultimo backup,
    ricontrollo delle revoche;
  - richieste di eccezione (ticket, UP, data; nessun dato personale): "Approva per n UP" →
    `approveException(ticket, n)`, "Riduci / Ritira" (n più basso o 0), "Rifiuta" → chiusa nel backend (per 30 giorni
    la persona non può chiedere un nuovo ticket);
  - cerca una UP: `revoke(up, motivo)` / `reinstate(up)`;
  - metadati del bollino: confronto tra il valore on-chain e `metadata/badge.json`, "Aggiorna" → `setData`;
  - emergenza: "Ferma i conii" → `setAttester(0x0)`, e ripristino dell'attestatore.
- **A3, firme:** ogni transazione la firma la UP owner nell'estensione; il backend non ha mai chiavi dell'owner.
  In mainnet ogni transazione chiede una conferma in più (scrivere `MAINNET`).
- **A4, reti:** rete, owner atteso ed explorer letti dalla configurazione; banner con la rete ben visibile.
- **A5, traccia:** ogni azione admin va nel registro di audit (UP owner, azione, transazione) e manda una mail
  "event".

