# UP CIE Link — Fase 3: frontend (proposta, da confermare)

Stato: **proposta del 2026-10-14**, niente è implementato. Ogni punto va confermato esplicitamente.

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

## 3. Proposte da confermare

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
