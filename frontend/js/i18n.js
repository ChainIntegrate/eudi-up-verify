// Static texts, Italian and English. Every string is written here; none comes from outside.
// Strings used with { html } may contain markup and must stay static.
import { storage } from "./dom.js";

const PRIVACY_DATE_IT = "28 ottobre 2026";
const PRIVACY_DATE_EN = "28 October 2026";
const CONTACTS_IT = `e-mail <a href="mailto:info@chainintegrate.it">info@chainintegrate.it</a>, <a href="https://t.me/Simone_1977_2" target="_blank" rel="noopener">Telegram</a> oppure una segnalazione su <a href="https://github.com/ChainIntegrate/up-cie-link/issues" target="_blank" rel="noopener">GitHub</a>`;
const CONTACTS_EN = `e-mail <a href="mailto:info@chainintegrate.it">info@chainintegrate.it</a>, <a href="https://t.me/Simone_1977_2" target="_blank" rel="noopener">Telegram</a> or an issue on <a href="https://github.com/ChainIntegrate/up-cie-link/issues" target="_blank" rel="noopener">GitHub</a>`;

const T = {
  it: {
    title: "UP CIE Link — ChainIntegrate",
    langButton: "English",
    themeToLight: "Tema chiaro",
    themeToDark: "Tema scuro",
    navHome: "Home",
    navLink: "Collega",
    navVerify: "Verifica",
    navMine: "Il mio bollino",
    footer: `Servizio sperimentale di <a href="https://www.linkedin.com/company/chainintegrate" target="_blank" rel="noopener">ChainIntegrate</a> · <a href="/privacy" data-link>Privacy</a> · <a href="/note-legali" data-link>Note legali</a> · <a href="https://github.com/ChainIntegrate/up-cie-link" target="_blank" rel="noopener">Codice sorgente</a> · Assistenza: <a href="https://t.me/Simone_1977_2" target="_blank" rel="noopener">Telegram</a>, <a href="mailto:info@chainintegrate.it">info@chainintegrate.it</a>`,
    footerNote: "Non è un servizio pubblico e non è collegato al Ministero dell'Interno.",
    testnetBanner: "Rete di prova (LUKSO testnet): i bollini emessi qui servono solo per i test.",
    loading: "Caricamento…",
    configError: "Il servizio non risponde. Riprova tra qualche minuto.",

    // home
    homeTitle: "Collega la tua Universal Profile alla tua CIE",
    homeLead: "Firmi un enunciato con la Universal Profile e con la Carta d'Identità Elettronica. Se le firme sono valide, la tua UP riceve un bollino non trasferibile: sulla blockchain non vanno nome, codice fiscale o dati della carta.",
    homeStart: "Collega la UP",
    homeVerify: "Verifica una UP",
    howTitle: "Come funziona",
    how: `<ol>
      <li>Colleghi la Universal Profile con l'estensione UP Browser e la UP firma un enunciato che contiene il suo indirizzo.</li>
      <li>Firmi lo stesso enunciato con la CIE (CieSign, lettore e PIN); poi carichi qui il file firmato.</li>
      <li>Il servizio controlla firma, certificato e revoca della carta; se tutto è valido conia il bollino sulla tua UP.</li>
    </ol>`,
    chainTitle: "Cosa resta sulla blockchain",
    chain: `<ul>
      <li>Che quella UP ha un bollino "CIE verificata", con data di verifica e scadenza (il primo giorno del mese in cui scade la carta: non la data esatta).</li>
      <li>Se è la UP principale della persona.</li>
      <li><strong>Nessun</strong> nome, codice fiscale o dato della carta.</li>
    </ul>`,
    needTitle: "Cosa ti serve",
    need: `<ul>
      <li>La CIE con il PIN e un lettore (NFC o USB) con <strong>CieSign</strong>.</li>
      <li>L'estensione <strong>UP Browser</strong> con la tua Universal Profile; il controller deve avere il permesso di firma (SIGN).</li>
      <li>Circa 10 minuti: l'enunciato vale 15 minuti.</li>
    </ul>`,
    rulesTitle: "Una persona, una UP principale",
    rules: `<p>Ogni CIE può collegare <strong>una sola UP principale</strong>. Puoi spostarla su una nuova UP (migrazione: la vecchia viene invalidata). UP aggiuntive solo con un'eccezione approvata da ChainIntegrate.</p>
      <p>Il bollino scade all'inizio del mese in cui scade la carta e si invalida se il certificato della carta viene revocato. Puoi rinunciarvi quando vuoi.</p>`,

    // link flow
    linkTitle: "Collega la UP alla CIE",
    stepConnect: "UP",
    stepMode: "Modalità",
    stepConsent: "Consenso",
    stepUpSign: "Firma UP",
    stepCie: "Firma CIE",
    stepResult: "Esito",
    connectTitle: "1 · Collega la Universal Profile",
    connectText: "Scegli il wallet con cui collegare la tua Universal Profile.",
    connectExtension: "Estensione UP Browser",
    connectAndroid: "UP Wallet per Android",
    androidSoon: "La connessione con UP Wallet per Android (WalletConnect) non è attiva su questo server.",
    upWalletHint: "UP Wallet per Android: inquadri un QR con l'app (oppure, sul telefono, apri l'app con un tocco) e confermi lì ogni firma.",
    adminDesktopOnly: "La pagina admin si usa solo dal computer, con l'estensione UP Browser.",
    viaUpWallet: "con UP Wallet",
    disconnect: "Disconnetti",
    cancel: "Annulla",
    wcTitle: "Collega UP Wallet",
    wcIntro: "Apri UP Wallet sul telefono, scegli la rete LUKSO di questo servizio e la tua UP, poi inquadra il QR con \"Scan QR\". Se sei già sul telefono, tocca \"Apri UP Wallet\".",
    wcQrAlt: "QR per collegare UP Wallet",
    wcIntroPhone: "Tocca \"Apri UP Wallet\": l'app si apre con la richiesta di collegamento. Nell'app scegli la rete LUKSO di questo servizio e la tua UP, poi approva e torna qui.",
    wcQrOther: "Oppure inquadra questo QR con UP Wallet su un altro telefono.",
    wcOpenApp: "Apri UP Wallet",
    wcCopy: "Copia link",
    wcCopied: "Link copiato: incollalo in UP Wallet con \"Paste\".",
    wcPreparing: "Preparo il collegamento…",
    wcWaiting: "In attesa di UP Wallet…",
    wcPending: "Conferma la richiesta nell'app UP Wallet sul telefono.",
    wcPrivacy: "Il collegamento passa dai server di WalletConnect (Reown), che vedono i dati della sessione ma non il contenuto delle richieste, cifrate. Portions © 2025 Reown, Inc. All Rights Reserved.",
    next: "Avanti",
    back: "Indietro",
    connected: "UP collegata:",
    noExtension: `Estensione UP Browser non trovata. Installala dal <a href="https://chromewebstore.google.com/detail/universal-profiles/abpickdkkbnbcoepogfhkhennhfhehfn" target="_blank" rel="noopener">Chrome Web Store</a> e ricarica la pagina.`,
    modeTitle: "2 · Cosa vuoi fare",
    modeLink: "Primo collegamento",
    modeLinkText: "La CIE non è ancora collegata ad alcuna UP: questa diventa la tua UP principale. Vale anche per rinnovare il bollino della stessa UP.",
    modeMigrate: "Sposta la UP principale",
    modeMigrateText: "La CIE è già collegata a un'altra UP: questa diventa la principale e la vecchia viene invalidata.",
    modeAdditional: "UP aggiuntiva",
    modeAdditionalText: "Collega questa UP in più rispetto alla principale. Serve un'eccezione: al primo tentativo ricevi un codice da inviare a ChainIntegrate.",
    consentTitle: "3 · Informativa e consenso",
    consentText: `Durante la verifica il servizio legge il certificato della tua CIE (nome, cognome, codice fiscale) solo in memoria. Conserva soltanto un'impronta del codice fiscale, calcolata con una chiave segreta, per garantire una sola UP principale per persona. Dettagli nell'<a href="/privacy" data-link>informativa sulla privacy</a>.`,
    consentRead: "Ho letto l'informativa sulla privacy.",
    consentAgree: "Acconsento al trattamento dei dati della mia CIE per questa verifica e alla pubblicazione del bollino sulla blockchain, che è pubblica e permanente.",
    createButton: "Prepara l'enunciato",
    upSignTitle: "4 · Firma con la Universal Profile",
    upSignText: "Qui sotto c'è l'enunciato che firmeranno la UP e la CIE. Controlla che l'indirizzo sia quello della tua UP, poi firma.",
    upSignDeadline: "Tempo per la firma della UP:",
    upSignButton: "Firma con la UP",
    cieTitle: "5 · Firma con la CIE",
    cieSteps: `<ol>
      <li>Scarica il file dell'enunciato (non modificarlo e non aprirlo con un editor che lo salvi).</li>
      <li>Apri <strong>CieSign</strong>, scegli <em>Firma</em>, seleziona il file e il formato <strong>CAdES (.p7m)</strong>; appoggia la CIE e inserisci il PIN.</li>
      <li>Carica qui il file <strong>.p7m</strong> creato da CieSign.</li>
    </ol>`,
    cieDeadline: "Tempo rimasto:",
    downloadButton: "Scarica l'enunciato",
    chooseFile: "File firmato (.p7m)",
    uploadButton: "Invia il file firmato",
    fileTooBig: "Il file è troppo grande: deve essere il .p7m dell'enunciato (pochi kB).",
    cadesDisabled: "La firma con CieSign non è attiva su questo servizio: servirà l'app Android (in arrivo).",
    waitTitle: "Verifica in corso",
    waitVerifying: "Controllo della firma e del certificato…",
    waitQueued: "In coda…",
    waitMinting: "Conio del bollino sulla blockchain…",
    doneTitle: "Fatto: la UP ha il bollino",
    doneText: "La transazione è registrata sulla blockchain.",
    viewTx: "Vedi la transazione",
    viewBadge: "Vedi il bollino",
    failTitle: "Collegamento non riuscito",
    expiredTitle: "Enunciato scaduto",
    expiredText: "Il tempo è finito. Ricomincia: serve un nuovo enunciato.",
    restart: "Ricomincia",
    ticketTitle: "Codice della richiesta di eccezione",
    ticketText: `Invia questo codice a ChainIntegrate (<a href="mailto:info@chainintegrate.it">info@chainintegrate.it</a>). Quando l'eccezione è approvata, rifai il collegamento con la modalità "UP aggiuntiva".`,
    copy: "Copia",
    copied: "Copiato",

    // verify
    verifyTitle: "Verifica il bollino di una UP",
    verifyLead: "Chiunque può controllare lo stato del bollino di una Universal Profile. I dati sono letti dalla blockchain.",
    verifyPlaceholder: "Indirizzo della UP (0x…)",
    verifyButton: "Verifica",
    invalidAddress: "Indirizzo non valido.",
    stateValid: "Bollino valido",
    stateExpired: "Bollino scaduto",
    stateNone: "Nessun bollino",
    stateInvalidated: "Bollino invalidato",
    stateRevoked: "Bollino revocato",
    stateNoneText: "Questa UP non ha mai ricevuto il bollino.",
    stateInvalidatedText: "Il bollino non è più valido (rinuncia del titolare, migrazione o certificato della carta revocato).",
    stateRevokedText: "Il bollino è stato revocato da ChainIntegrate.",
    factUp: "Universal Profile",
    factPrimary: "UP principale",
    factVerifiedAt: "Verificata il",
    factExpiresAt: "Scade il",
    yes: "sì",
    no: "no",
    shareLink: "Link da condividere:",

    // mine
    mineTitle: "Il mio bollino",
    mineLead: "Collega la tua UP per vedere il bollino, rinnovarlo o rinunciarvi, e per scaricare o cancellare i tuoi dati.",
    renewButton: "Rinnova",
    linkButton: "Collega questa UP",
    renounceTitle: "Rinuncia al bollino",
    renounceText: "La UP invia una transazione che invalida il suo bollino. Non si annulla: per riaverlo dovrai rifare il collegamento con la CIE.",
    renounceButton: "Rinuncia",
    renounceConfirm: "Confermi la rinuncia? Firmerai la transazione con la UP.",
    renounceSent: "Transazione inviata. Lo stato si aggiorna appena la transazione è confermata.",
    dataTitle: "I tuoi dati",
    dataText: "Puoi scaricare una copia dei dati che conserviamo su di te, oppure cancellarli. In entrambi i casi firmi la richiesta con la UP: solo chi la controlla può farlo. Se questa UP ha un bollino valido, la richiesta riguarda tutte le UP collegate alla tua CIE; se il suo bollino non è più valido (rinuncia, migrazione, scadenza), riguarda solo questa UP. Se non hai più nessuna UP con un bollino valido e vuoi i dati di tutte, scrivici: ti chiederemo di firmare la richiesta con la CIE.",
    dataExportButton: "Scarica i miei dati",
    dataEraseButton: "Cancella i miei dati",
    dataEraseConfirm: "Confermi la cancellazione? Se questa UP ha un bollino valido, tutti i bollini collegati alla tua CIE verranno invalidati e i dati cancellati; altrimenti si cancellano solo i dati di questa UP. Non si annulla. Firmerai la richiesta con la UP.",
    dataDownload: "Scarica il file",
    dataExportReady: "Ecco i tuoi dati.",
    dataExportOne: "Ecco i dati di questa UP. Il suo bollino non è più valido, quindi il file non contiene le altre UP collegate alla tua CIE.",
    dataErasedOne: "Dati di questa UP cancellati. Il suo bollino non era più valido, quindi le altre UP collegate alla tua CIE non sono state toccate.",
    dataErased: "Dati cancellati ({n} UP). I bollini ancora validi vengono invalidati sulla blockchain entro qualche minuto.",
    dataNone: "Non conserviamo dati collegati a questa UP.",


    // admin (owner only)
    adminTitle: "Amministrazione",
    adminMainnetBanner: "rete principale: le transazioni sono reali e pubbliche.",
    adminTestnetBanner: "rete di prova.",
    adminLogin: "Accedi come owner",
    adminLoginText: "Solo la UP proprietaria del contratto (ChainIntegrate) può accedere. Firmerai un messaggio di accesso, valido 5 minuti; la sessione dura 30 minuti.",
    adminLogout: "Esci",
    adminStatus: "Stato del servizio",
    adminRefresh: "Aggiorna",
    adminNetwork: "Rete",
    adminContract: "Contratto",
    adminOwner: "Owner",
    adminAttester: "Attestatore on-chain",
    adminSigner: "Firmatario (processo separato)",
    adminSignerOk: "pronto",
    adminBalance: "Saldo attestatore",
    adminActive: "Bollini attivi (principali / aggiuntivi)",
    adminQueue: "Coda · conii in corso · invalidazioni",
    adminIndexer: "Indicizzatore",
    adminRevocation: "Ricontrollo revoche (controllati / revocati / OCSP giù / errori)",
    adminBackup: "Ultimo backup",
    adminMetadata: "Metadati del bollino",
    adminMetadataOk: "aggiornati",
    adminMetadataOld: "da aggiornare",
    adminSetMetadata: "Aggiorna i metadati",
    adminEmergency: "Emergenza",
    adminStop: "Ferma i conii",
    adminStopText: "Imposta l'attestatore a zero: nessun nuovo bollino finché non lo ripristini. Usalo se la chiave dell'attestatore o il server sono compromessi.",
    adminRestore: "Ripristina l'attestatore",
    adminRestoreText: "Rimette come attestatore la chiave configurata sul server: {address}. Prima di firmare confronta questo indirizzo, e quello mostrato dall'estensione UP, con quello che hai annotato fuori dal server quando hai creato la chiave: se il server era compromesso, la pagina potrebbe proporre un indirizzo diverso.",
    adminSuperseded: "Contratti sostituiti",
    adminSupersededText: "Contratti precedenti di questa rete: l'attestatore va messo a zero, così nessuno può più coniarvi bollini.",
    adminSupersededStopped: "attestatore a zero",
    adminSupersededUnknown: "stato non leggibile",
    adminStopped: "Conii fermati: l'attestatore on-chain è zero.",
    adminExceptions: "Richieste di eccezione",
    adminNoExceptions: "Nessuna richiesta aperta.",
    adminTicket: "Ticket",
    adminRequested: "Richiesta il",
    adminOnChainLimit: "Limite on-chain",
    adminNotApproved: "non approvata",
    adminMaxUps: "UP in tutto",
    adminApprove: "Approva",
    adminChange: "Cambia limite",
    adminWithdraw: "Ritira",
    adminReject: "Rifiuta",
    adminRejectConfirm: "Rifiutare la richiesta? Per 30 giorni la persona non potrà chiederne un'altra.",
    adminBadge: "Bollino di una UP",
    adminSearch: "Cerca",
    adminOnChain: "Stato on-chain",
    adminLocal: "Stato nel backend",
    adminReason: "Motivo",
    adminRevoke: "Revoca",
    adminReinstate: "Ripristina",
    adminConfirm: "Confermi questa operazione? La firmerai con la UP owner.",
    adminTypeMainnet: "Rete principale: scrivi MAINNET per confermare.",
    adminTxSent: "Transazione inviata.",

    // errors
    errors: {
      NETWORK: "Connessione al servizio non riuscita. Controlla la rete e riprova.",
      RATE_LIMITED: "Troppe richieste. Aspetta un minuto e riprova.",
      INVALID_UP: "Indirizzo della UP non valido.",
      NOT_A_UNIVERSAL_PROFILE: "Questo indirizzo non è una Universal Profile su questa rete.",
      INVALID_UP_SIGNATURE: "La firma della UP non è valida. Il controller usato deve avere il permesso di firma (SIGN) sulla UP.",
      UP_SIGNATURE_WINDOW_EXPIRED: "Sono passati più di 5 minuti per la firma della UP. Ricomincia.",
      STATEMENT_EXPIRED: "L'enunciato è scaduto. Ricomincia.",
      ALREADY_SIGNED: "Questo enunciato è già stato firmato.",
      ALREADY_SUBMITTED: "Il file firmato è già stato inviato per questo enunciato.",
      UP_SIGNATURE_REQUIRED: "Prima serve la firma della UP.",
      CHANNEL_DISABLED: "La firma con CieSign non è attiva su questo servizio.",
      INVALID_P7M: "Il file è vuoto o non è un .p7m.",
      CMS_INVALID: "Il file non è un .p7m valido. Usa il file creato da CieSign in formato CAdES.",
      CONTENT_MISMATCH: "Il file firmato non contiene esattamente l'enunciato. Firma il file scaricato senza modificarlo.",
      SIGNATURE_INVALID: "La firma della CIE non è valida.",
      CERT_NOT_HOLDER: "Il certificato non è quello del titolare di una CIE.",
      CERT_POLICY: "Il certificato non è quello di una CIE.",
      CERT_KEY_USAGE: "Il certificato della carta non può essere usato per questa firma.",
      CERT_INVALID: "Il certificato della carta non è valido.",
      CERT_EXPIRED: "Il certificato della carta è scaduto o non ancora valido.",
      CHAIN_UNTRUSTED: "Il certificato non risulta emesso per la CIE.",
      ISSUER_NOT_IN_TRUST_STORE: "Il certificato non risulta emesso per la CIE.",
      TAX_CODE_NOT_FOUND: "Il certificato non ha il formato atteso di una CIE.",
      CERT_REVOKED: "Il certificato della carta risulta revocato.",
      CERT_STATUS_UNKNOWN: "Lo stato del certificato della carta è sconosciuto.",
      OCSP_UNAVAILABLE: "Il servizio che controlla la revoca delle carte non risponde. Riprova più tardi con un nuovo enunciato.",
      OCSP_INVALID: "La risposta sul controllo di revoca non è valida. Riprova più tardi.",
      UP_REVOKED: "Il bollino di questa UP è stato revocato da ChainIntegrate: non si può rinnovare.",
      UP_LINKED_TO_ANOTHER_PERSON: "Questa UP è già collegata a un'altra CIE.",
      MIGRATION_OR_EXCEPTION_REQUIRED: "La tua CIE è già collegata a un'altra UP. Scegli \"Sposta la UP principale\" oppure \"UP aggiuntiva\".",
      NO_PRIMARY_LINK: "Per una UP aggiuntiva serve prima una UP principale valida.",
      EXCEPTION_REQUIRED: "Per una UP aggiuntiva serve un'eccezione approvata da ChainIntegrate.",
      EXCEPTION_PENDING: "La richiesta di eccezione è in attesa di approvazione.",
      EXCEPTION_LIMIT_REACHED: "Hai raggiunto il numero di UP consentito dall'eccezione.",
      EXCEPTION_WITHDRAWN: "L'eccezione per le UP aggiuntive è stata ritirata da ChainIntegrate.",
      AGE_NOT_ELIGIBLE: "Il servizio è riservato ai maggiorenni.",
      CARD_EXPIRING: "La carta scade questo mese: il bollino scadrebbe subito. Usa la nuova carta quando l'avrai.",
      NOT_OWNER: "Questa UP non è l'owner del contratto: accesso negato.",
      ADMIN_LOGIN_REQUIRED: "Sessione scaduta: accedi di nuovo.",
      CHALLENGE_EXPIRED: "Il messaggio di accesso è scaduto o già usato: riprova.",
      BAD_ORIGIN: "Richiesta da un'origine non valida.",
      INVALID_ARGS: "Valori non validi.",
      METADATA_FILE_MISSING: "Il file dei metadati non è sul server.",
      EXCEPTION_REJECTED: "La richiesta di eccezione è stata respinta da ChainIntegrate. Potrai fare una nuova richiesta tra 30 giorni.",
      REQUEST_EXPIRED: "La richiesta è scaduta o è già stata usata. Riprova.",
      INVALID_REQUEST: "Richiesta non valida. Riprova.",
      MINT_IN_PROGRESS: "C'è già un bollino in corso di emissione per questa CIE o questa UP. Riprova tra qualche minuto.",
      MIGRATION_TOO_SOON: "Hai già spostato la UP principale negli ultimi 30 giorni. Riprova più avanti.",
      ALREADY_VERIFIED: "Questa UP ha già un bollino valido con questa carta: non serve rinnovarlo. Potrai rinnovarlo con la nuova carta, quando l'avrai.",
      MINT_FAILED: "Il conio del bollino non è riuscito. ChainIntegrate è stata avvisata: riprova più tardi.",
      MINT_RATE_LIMITED: "In questo momento il servizio ha raggiunto il numero massimo di bollini per ora (o per oggi). La tua CIE è stata verificata, ma il bollino non è stato emesso: riprova tra un'ora. ChainIntegrate è stata avvisata.",
      SERVICE_UNAVAILABLE: "Il servizio di verifica è temporaneamente non disponibile. Riprova tra qualche minuto.",
      SERVICE_BUSY: "In questo momento ci sono troppe verifiche in corso. Riprova tra un minuto con un nuovo enunciato.",
      INTERRUPTED: "Il servizio si è riavviato durante la verifica. Ricomincia.",
      CHAIN_READ_FAILED: "Lettura dalla blockchain non riuscita. Riprova.",
      NOT_FOUND: "Enunciato non trovato.",
      PAYLOAD_TOO_LARGE: "Il file è troppo grande.",
      WALLET_REJECTED: "Operazione annullata nel wallet.",
      WC_REJECTED: "Collegamento rifiutato in UP Wallet.",
      WC_FAILED: "Collegamento con UP Wallet non riuscito. Riprova.",
      WC_LOAD_FAILED: "Non riesco a caricare il codice di collegamento. Ricarica la pagina e riprova.",
      WC_WRONG_CHAIN: "UP Wallet è su un'altra rete: in UP Wallet scegli la rete LUKSO di questo servizio e riprova.",
      WALLET_ERROR: "L'estensione UP Browser ha restituito un errore.",
      NO_EXTENSION: "Estensione UP Browser non trovata.",
      NO_ACCOUNT: "Nessuna UP selezionata nell'estensione.",
      WRONG_CHAIN: "L'estensione è su un'altra rete: passa alla rete indicata in alto.",
      DEFAULT: "Errore imprevisto. Riprova; se continua, contatta ChainIntegrate.",
    },

    // privacy
    privacyTitle: "Informativa sulla privacy",
    privacySubtitle: `Ultimo aggiornamento: ${PRIVACY_DATE_IT}. Riguarda il servizio UP CIE Link (up-cie-link.chainintegrate.it), in prova.`,
    privacy: `
      <h2>1 · In breve</h2>
      <ul>
        <li>Il servizio legge il certificato della tua CIE solo per verificarlo, in memoria. Nome, cognome, codice fiscale e il file firmato <strong>non vengono salvati</strong>.</li>
        <li>Conserva un'impronta del codice fiscale (HMAC con una chiave segreta del server), per garantire una sola UP principale per persona. È un dato pseudonimizzato: per la legge resta un dato personale.</li>
        <li>Sulla blockchain va solo il bollino sulla tua UP, con date e stato: nessun nome, codice fiscale o dato della carta. Il bollino però è legato alla tua UP, quindi a chi sa che quella UP è tua dice che hai una CIE verificata. La scadenza del bollino è il primo giorno del mese in cui scade la carta: rivela quindi il mese di scadenza della carta, che per la CIE coincide con il mese di nascita del titolare (non il giorno né l'anno). La blockchain è pubblica e permanente.</li>
        <li>Nessuna pubblicità, nessun tracciamento, nessuna statistica d'uso, nessun cookie.</li>
      </ul>
      <h2>2 · Chi è il titolare</h2>
      <p>ChainIntegrate, servizi di Simone Cavalletti, che gestisce il servizio. Contatti, anche per tutte le richieste sui dati: ${CONTACTS_IT}.</p>
      <h2>3 · Perché e su quale base</h2>
      <p>Per collegare la tua Universal Profile alla tua CIE ed emettere il bollino, garantendo una sola UP principale per persona e invalidando il bollino se il certificato della carta viene revocato. Base giuridica: il tuo <strong>consenso</strong> (art. 6.1.a GDPR), che dai prima della firma e puoi revocare in ogni momento (punto 7).</p>
      <h2>4 · Cosa conserviamo</h2>
      <ul>
        <li><strong>Collegamento</strong>: indirizzo della UP, impronta del codice fiscale, UP principale sì/no, date di verifica e scadenza, stato, transazione. Fino a 12 mesi dopo la fine della validità del bollino (scadenza, rinuncia, invalidazione o revoca), poi si cancella; l'impronta del codice fiscale si cancella quando non resta alcun collegamento.</li>
        <li><strong>Riferimento al certificato</strong> (numero di serie e autorità emittente, cifrati): serve solo a ricontrollare ogni giorno se il certificato è stato revocato. Si cancella appena il bollino scade, viene invalidato o revocato, o vi rinunci.</li>
        <li><strong>Enunciati</strong>: indirizzo della UP, modalità, date, esito. Si cancellano 7 giorni dopo la scadenza.</li>
        <li><strong>Richieste di eccezione</strong>: codice, impronta del codice fiscale, stato. Quelle non approvate si chiudono dopo 30 giorni.</li>
        <li><strong>Registro delle operazioni</strong> (data, tipo di operazione, indirizzo della UP, transazione): 12 mesi.</li>
        <li><strong>Copie di sicurezza</strong> cifrate del database: fino a 14 giorni, più una a settimana per 8 settimane.</li>
        <li><strong>Registri del server web</strong>: indirizzo IP, data e pagina richiesta, per sicurezza; cancellati dopo 14 giorni. I limiti di richieste usano l'IP solo in memoria.</li>
      </ul>
      <h2>5 · Con chi parla il servizio, e cosa vede</h2>
      <ul>
        <li><strong>Servizio OCSP del Ministero dell'Interno</strong> (ocsp.cie.interno.gov.it): il nostro server chiede se il certificato della tua carta è revocato, alla verifica e poi ogni giorno. Riceve il numero di serie del certificato e l'IP del nostro server, non il tuo; poiché il Ministero sa a chi appartiene ogni certificato, può dedurre che la tua carta è collegata a questo servizio.</li>
        <li><strong>Nodo della blockchain LUKSO</strong> (sulla rete principale un nodo di ChainIntegrate; sulla rete di prova il nodo pubblico di LUKSO): il nostro server legge lo stato dei bollini e invia le transazioni. Vede gli indirizzi delle UP.</li>
        <li><strong>Estensione UP Browser</strong> (LUKSO): firma l'enunciato e la rinuncia con la tua UP, nel tuo browser.</li>
        <li><strong>Aruba S.p.A.</strong> (Italia), fornitore che tratta i dati per nostro conto: il server su cui gira il servizio (database, registri, copie di sicurezza cifrate) e l'invio delle e-mail di avviso a ChainIntegrate.</li>
        <li><strong>WalletConnect (Reown, Inc.)</strong>, solo se colleghi UP Wallet per Android: le richieste tra questa pagina e l'app passano dai suoi server (relay). Vede l'indirizzo della UP, la rete, l'IP e i dati tecnici della sessione; il contenuto delle richieste (testo da firmare, transazioni) è cifrato tra la pagina e l'app. Nessuna statistica d'uso viene inviata a Reown. Reown ha sede negli Stati Uniti: questi dati possono essere trattati fuori dall'Unione Europea. Secondo la sua <a href="https://reown.com/privacy-policy" target="_blank" rel="noopener">informativa</a>, i trasferimenti fuori dallo Spazio economico europeo avvengono con i meccanismi di trasferimento previsti dalla legge. Se non vuoi, usa l'estensione UP Browser.</li>
        <li><strong>Chiunque legga la blockchain</strong>: vede il bollino delle UP. Se sposti la UP principale (migrazione), le due operazioni avvengono a breve distanza e possono far capire che le due UP sono della stessa persona.</li>
        <li><strong>Avvisi a ChainIntegrate</strong>: per i problemi del servizio e gli eventi importanti (per esempio una richiesta di eccezione) riceviamo una e-mail con l'indirizzo della UP, mai dati della carta.</li>
      </ul>
      <h2>6 · Cosa resta nel tuo browser</h2>
      <p>La lingua e il tema scelti, il numero dell'enunciato in corso (solo per la sessione) e, se colleghi UP Wallet, i dati del collegamento WalletConnect, fino a quando premi "Disconnetti". Nient'altro.</p>
      <h2>7 · I tuoi diritti</h2>
      <p>Secondo il Regolamento UE 2016/679 (GDPR) puoi chiedere l'accesso ai dati che ti riguardano e riceverli in un formato leggibile da una macchina (portabilità), o la loro cancellazione, dalla pagina "Il mio bollino" ("Scarica i miei dati" dà un file JSON), firmando la richiesta con la UP: solo chi la controlla può farlo. Se la UP non ha più un bollino valido, la richiesta riguarda solo quella UP. Rettifica e limitazione del trattamento, e le richieste di chi non ha più una UP con un bollino valido, si fanno scrivendo ai contatti del punto 2: ti chiederemo una firma della UP o, per i dati di tutte le tue UP, una firma con la CIE, per essere certi che la richiesta venga da te. Puoi revocare il consenso in qualsiasi momento. La cancellazione invalida i bollini e cancella anche l'impronta del codice fiscale: dopo potresti collegare di nuovo la CIE come se fosse la prima volta. Puoi anche rinunciare al bollino da solo, dalla pagina "Il mio bollino". Puoi presentare reclamo al Garante per la protezione dei dati personali (<a href="https://www.garanteprivacy.it" target="_blank" rel="noopener">garanteprivacy.it</a>). Quello che sta sulla blockchain (il bollino e la sua storia) non può essere cancellato da nessuno.</p>
      <h2>8 · Minori e modifiche</h2>
      <p>Il servizio è riservato ai maggiorenni: l'età si ricava dal codice fiscale del certificato, solo durante la verifica. Se questa informativa cambia, cambia la data in alto; le versioni precedenti restano nella <a href="https://github.com/ChainIntegrate/up-cie-link/commits/main/frontend/js/i18n.js" target="_blank" rel="noopener">cronologia del repository</a>.</p>`,

    // legal
    legalTitle: "Note legali",
    legal: `
      <h2>Cosa attesta il bollino</h2>
      <p>Solo che, alla data indicata, chi controllava quella Universal Profile ha firmato lo stesso enunciato anche con una CIE il cui certificato era valido e non revocato. Il bollino non contiene e non rivela l'identità della persona.</p>
      <h2>Cosa non è</h2>
      <ul>
        <li>Non è un documento d'identità e non sostituisce l'identificazione prevista dalla legge.</li>
        <li>Non è un servizio pubblico: non è gestito, approvato né collegato al Ministero dell'Interno o all'Istituto Poligrafico e Zecca dello Stato.</li>
        <li>La firma usata è fatta con il certificato di autenticazione della carta: non è una firma digitale qualificata.</li>
      </ul>
      <h2>Servizio sperimentale</h2>
      <p>Il servizio è in prova e viene fornito così com'è, senza garanzie. ChainIntegrate può revocare un bollino in caso di abuso. Il codice è pubblico con licenza Apache-2.0.</p>
      <h2>Componenti di terzi</h2>
      <p>Solo per il collegamento con UP Wallet, la pagina carica due componenti di terzi, non modificati: il client WalletConnect di Reown, Inc., con la <a href="/vendor/WALLETCONNECT-LICENSE.md" target="_blank" rel="noopener">WalletConnect Community License</a> (Portions © 2025 Reown, Inc. All Rights Reserved), e qrcode-generator di Kazuhiko Arase (licenza MIT). Elenco completo dei pacchetti inclusi e delle loro licenze: <a href="https://github.com/ChainIntegrate/up-cie-link/tree/main/frontend/vendor" target="_blank" rel="noopener">frontend/vendor</a>.</p>`,
  },

  en: {
    title: "UP CIE Link — ChainIntegrate",
    langButton: "Italiano",
    themeToLight: "Light theme",
    themeToDark: "Dark theme",
    navHome: "Home",
    navLink: "Link",
    navVerify: "Verify",
    navMine: "My badge",
    footer: `Experimental service by <a href="https://www.linkedin.com/company/chainintegrate" target="_blank" rel="noopener">ChainIntegrate</a> · <a href="/privacy" data-link>Privacy</a> · <a href="/note-legali" data-link>Legal notes</a> · <a href="https://github.com/ChainIntegrate/up-cie-link" target="_blank" rel="noopener">Source code</a> · Support: <a href="https://t.me/Simone_1977_2" target="_blank" rel="noopener">Telegram</a>, <a href="mailto:info@chainintegrate.it">info@chainintegrate.it</a>`,
    footerNote: "Not a public service and not connected to the Italian Ministry of the Interior.",
    testnetBanner: "Test network (LUKSO testnet): badges issued here are for testing only.",
    loading: "Loading…",
    configError: "The service is not responding. Try again in a few minutes.",

    homeTitle: "Link your Universal Profile to your CIE",
    homeLead: "You sign a statement with your Universal Profile and with your Italian electronic identity card (CIE). If both signatures are valid, your UP receives a non-transferable badge: no name, tax code or card data goes on the blockchain.",
    homeStart: "Link your UP",
    homeVerify: "Verify a UP",
    howTitle: "How it works",
    how: `<ol>
      <li>You connect your Universal Profile with the UP Browser extension, and the UP signs a statement containing its address.</li>
      <li>You sign the same statement with your CIE (CieSign, card reader and PIN), then upload the signed file here.</li>
      <li>The service checks the signature, the certificate and its revocation; if everything is valid it mints the badge to your UP.</li>
    </ol>`,
    chainTitle: "What stays on the blockchain",
    chain: `<ul>
      <li>That this UP has a "CIE verified" badge, with verification date and expiry (the first day of the month in which the card expires: not the exact date).</li>
      <li>Whether it is the person's primary UP.</li>
      <li><strong>No</strong> name, tax code or card data.</li>
    </ul>`,
    needTitle: "What you need",
    need: `<ul>
      <li>Your CIE with its PIN and a reader (NFC or USB) with <strong>CieSign</strong>.</li>
      <li>The <strong>UP Browser</strong> extension with your Universal Profile; the controller needs the SIGN permission.</li>
      <li>About 10 minutes: the statement is valid for 15 minutes.</li>
    </ul>`,
    rulesTitle: "One person, one primary UP",
    rules: `<p>Each CIE can link <strong>one primary UP</strong>. You can move it to a new UP (migration: the old one is invalidated). Additional UPs only with an exception approved by ChainIntegrate.</p>
      <p>The badge expires at the start of the month in which the card expires and is invalidated if the card's certificate is revoked. You can renounce it at any time.</p>`,

    linkTitle: "Link your UP to your CIE",
    stepConnect: "UP",
    stepMode: "Mode",
    stepConsent: "Consent",
    stepUpSign: "UP signature",
    stepCie: "CIE signature",
    stepResult: "Result",
    connectTitle: "1 · Connect your Universal Profile",
    connectText: "Choose the wallet to connect your Universal Profile with.",
    connectExtension: "UP Browser extension",
    connectAndroid: "UP Wallet for Android",
    androidSoon: "Connecting with UP Wallet for Android (WalletConnect) is not active on this server.",
    upWalletHint: "UP Wallet for Android: scan a QR code with the app (or, on the phone, open the app with a tap) and confirm every signature there.",
    adminDesktopOnly: "The admin page is used only from a computer, with the UP Browser extension.",
    viaUpWallet: "with UP Wallet",
    disconnect: "Disconnect",
    cancel: "Cancel",
    wcTitle: "Connect UP Wallet",
    wcIntro: "Open UP Wallet on your phone, choose this service's LUKSO network and your UP, then scan the QR code with \"Scan QR\". If you are already on the phone, tap \"Open UP Wallet\".",
    wcQrAlt: "QR code to connect UP Wallet",
    wcIntroPhone: "Tap \"Open UP Wallet\": the app opens with the connection request. In the app choose this service's LUKSO network and your UP, then approve and come back here.",
    wcQrOther: "Or scan this QR code with UP Wallet on another phone.",
    wcOpenApp: "Open UP Wallet",
    wcCopy: "Copy link",
    wcCopied: "Link copied: paste it in UP Wallet with \"Paste\".",
    wcPreparing: "Preparing the connection…",
    wcWaiting: "Waiting for UP Wallet…",
    wcPending: "Confirm the request in the UP Wallet app on your phone.",
    wcPrivacy: "The connection goes through WalletConnect's (Reown) servers, which see the session data but not the content of the requests, which is encrypted. Portions © 2025 Reown, Inc. All Rights Reserved.",
    next: "Next",
    back: "Back",
    connected: "Connected UP:",
    noExtension: `UP Browser extension not found. Install it from the <a href="https://chromewebstore.google.com/detail/universal-profiles/abpickdkkbnbcoepogfhkhennhfhehfn" target="_blank" rel="noopener">Chrome Web Store</a> and reload the page.`,
    modeTitle: "2 · What do you want to do",
    modeLink: "First link",
    modeLinkText: "Your CIE is not linked to any UP yet: this one becomes your primary UP. Also used to renew the badge of the same UP.",
    modeMigrate: "Move the primary UP",
    modeMigrateText: "Your CIE is already linked to another UP: this one becomes the primary and the old one is invalidated.",
    modeAdditional: "Additional UP",
    modeAdditionalText: "Link this UP in addition to the primary one. It needs an exception: on the first attempt you get a code to send to ChainIntegrate.",
    consentTitle: "3 · Privacy notice and consent",
    consentText: `During the check the service reads your CIE certificate (name, surname, tax code) in memory only. It keeps only a fingerprint of the tax code, computed with a secret key, to allow a single primary UP per person. Details in the <a href="/privacy" data-link>privacy notice</a>.`,
    consentRead: "I have read the privacy notice.",
    consentAgree: "I consent to the processing of my CIE data for this check and to the publication of the badge on the blockchain, which is public and permanent.",
    createButton: "Prepare the statement",
    upSignTitle: "4 · Sign with your Universal Profile",
    upSignText: "Below is the statement that your UP and your CIE will sign. Check that the address is your UP's, then sign.",
    upSignDeadline: "Time left for the UP signature:",
    upSignButton: "Sign with the UP",
    cieTitle: "5 · Sign with your CIE",
    cieSteps: `<ol>
      <li>Download the statement file (do not edit it, and do not open it with an editor that saves it).</li>
      <li>Open <strong>CieSign</strong>, choose <em>Sign</em>, select the file and the <strong>CAdES (.p7m)</strong> format; place the CIE on the reader and enter the PIN.</li>
      <li>Upload here the <strong>.p7m</strong> file created by CieSign.</li>
    </ol>`,
    cieDeadline: "Time left:",
    downloadButton: "Download the statement",
    chooseFile: "Signed file (.p7m)",
    uploadButton: "Send the signed file",
    fileTooBig: "The file is too large: it must be the statement's .p7m (a few kB).",
    cadesDisabled: "Signing with CieSign is not enabled on this service: the Android app (coming) will be needed.",
    waitTitle: "Checking",
    waitVerifying: "Checking the signature and the certificate…",
    waitQueued: "Queued…",
    waitMinting: "Minting the badge on the blockchain…",
    doneTitle: "Done: your UP has the badge",
    doneText: "The transaction is recorded on the blockchain.",
    viewTx: "View the transaction",
    viewBadge: "View the badge",
    failTitle: "Linking failed",
    expiredTitle: "Statement expired",
    expiredText: "Time is up. Start again: a new statement is needed.",
    restart: "Start again",
    ticketTitle: "Exception request code",
    ticketText: `Send this code to ChainIntegrate (<a href="mailto:info@chainintegrate.it">info@chainintegrate.it</a>). Once the exception is approved, link again with the "Additional UP" mode.`,
    copy: "Copy",
    copied: "Copied",

    verifyTitle: "Verify the badge of a UP",
    verifyLead: "Anyone can check the badge status of a Universal Profile. The data is read from the blockchain.",
    verifyPlaceholder: "UP address (0x…)",
    verifyButton: "Verify",
    invalidAddress: "Invalid address.",
    stateValid: "Valid badge",
    stateExpired: "Expired badge",
    stateNone: "No badge",
    stateInvalidated: "Invalidated badge",
    stateRevoked: "Revoked badge",
    stateNoneText: "This UP has never received the badge.",
    stateInvalidatedText: "The badge is no longer valid (renounced by the holder, migration, or the card's certificate was revoked).",
    stateRevokedText: "The badge was revoked by ChainIntegrate.",
    factUp: "Universal Profile",
    factPrimary: "Primary UP",
    factVerifiedAt: "Verified on",
    factExpiresAt: "Expires on",
    yes: "yes",
    no: "no",
    shareLink: "Link to share:",

    mineTitle: "My badge",
    mineLead: "Connect your UP to see your badge, renew it or renounce it, and to download or erase your data.",
    renewButton: "Renew",
    linkButton: "Link this UP",
    renounceTitle: "Renounce the badge",
    renounceText: "Your UP sends a transaction that invalidates its badge. It cannot be undone: to get it back you will have to link your CIE again.",
    renounceButton: "Renounce",
    renounceConfirm: "Do you confirm? You will sign the transaction with your UP.",
    renounceSent: "Transaction sent. The status updates as soon as it is confirmed.",
    dataTitle: "Your data",
    dataText: "You can download a copy of the data we keep about you, or erase it. Either way you sign the request with your UP: only whoever controls it can do so. If this UP has a valid badge, the request covers every UP linked to your CIE; if its badge is no longer valid (renounced, migrated, expired), it covers this UP only. If you have no UP with a valid badge left and want the data of all of them, write to us: we will ask you to sign the request with your CIE.",
    dataExportButton: "Download my data",
    dataEraseButton: "Erase my data",
    dataEraseConfirm: "Do you confirm the erasure? If this UP has a valid badge, every badge linked to your CIE will be invalidated and the data deleted; otherwise only this UP's data is erased. It cannot be undone. You will sign the request with your UP.",
    dataDownload: "Download the file",
    dataExportReady: "Here is your data.",
    dataExportOne: "Here is the data of this UP. Its badge is no longer valid, so the file does not include the other UPs linked to your CIE.",
    dataErasedOne: "The data of this UP has been erased. Its badge was no longer valid, so the other UPs linked to your CIE were not touched.",
    dataErased: "Data erased ({n} UP). The badges still valid are invalidated on the blockchain within a few minutes.",
    dataNone: "We keep no data linked to this UP.",

    adminTitle: "Administration",
    adminMainnetBanner: "main network: transactions are real and public.",
    adminTestnetBanner: "test network.",
    adminLogin: "Log in as owner",
    adminLoginText: "Only the UP that owns the contract (ChainIntegrate) can log in. You will sign a login message, valid for 5 minutes; the session lasts 30 minutes.",
    adminLogout: "Log out",
    adminStatus: "Service status",
    adminRefresh: "Refresh",
    adminNetwork: "Network",
    adminContract: "Contract",
    adminOwner: "Owner",
    adminAttester: "On-chain attester",
    adminSigner: "Signer (separate process)",
    adminSignerOk: "ready",
    adminBalance: "Attester balance",
    adminActive: "Active badges (primary / additional)",
    adminQueue: "Queue · mints in progress · invalidations",
    adminIndexer: "Indexer",
    adminRevocation: "Revocation recheck (checked / revoked / OCSP down / errors)",
    adminBackup: "Last backup",
    adminMetadata: "Badge metadata",
    adminMetadataOk: "up to date",
    adminMetadataOld: "to update",
    adminSetMetadata: "Update metadata",
    adminEmergency: "Emergency",
    adminStop: "Stop minting",
    adminStopText: "Sets the attester to zero: no new badges until you restore it. Use it if the attester key or the server are compromised.",
    adminRestore: "Restore the attester",
    adminRestoreText: "Sets the key configured on the server as attester again: {address}. Before signing, compare this address, and the one shown by the UP extension, with the one you wrote down outside the server when you created the key: if the server was compromised, the page could propose a different address.",
    adminSuperseded: "Superseded contracts",
    adminSupersededText: "Earlier contracts of this network: their attester must be set to zero, so nobody can mint badges there any more.",
    adminSupersededStopped: "attester at zero",
    adminSupersededUnknown: "state not readable",
    adminStopped: "Minting stopped: the on-chain attester is zero.",
    adminExceptions: "Exception requests",
    adminNoExceptions: "No open requests.",
    adminTicket: "Ticket",
    adminRequested: "Requested on",
    adminOnChainLimit: "On-chain limit",
    adminNotApproved: "not approved",
    adminMaxUps: "UPs in total",
    adminApprove: "Approve",
    adminChange: "Change limit",
    adminWithdraw: "Withdraw",
    adminReject: "Reject",
    adminRejectConfirm: "Reject the request? The person cannot ask again for 30 days.",
    adminBadge: "Badge of a UP",
    adminSearch: "Search",
    adminOnChain: "On-chain status",
    adminLocal: "Backend status",
    adminReason: "Reason",
    adminRevoke: "Revoke",
    adminReinstate: "Reinstate",
    adminConfirm: "Do you confirm this operation? You will sign it with the owner UP.",
    adminTypeMainnet: "Main network: type MAINNET to confirm.",
    adminTxSent: "Transaction sent.",

    errors: {
      NETWORK: "Could not reach the service. Check your connection and try again.",
      RATE_LIMITED: "Too many requests. Wait a minute and try again.",
      INVALID_UP: "Invalid UP address.",
      NOT_A_UNIVERSAL_PROFILE: "This address is not a Universal Profile on this network.",
      INVALID_UP_SIGNATURE: "The UP signature is not valid. The controller used needs the SIGN permission on the UP.",
      UP_SIGNATURE_WINDOW_EXPIRED: "More than 5 minutes passed before the UP signature. Start again.",
      STATEMENT_EXPIRED: "The statement has expired. Start again.",
      ALREADY_SIGNED: "This statement has already been signed.",
      ALREADY_SUBMITTED: "The signed file has already been sent for this statement.",
      UP_SIGNATURE_REQUIRED: "The UP signature is needed first.",
      CHANNEL_DISABLED: "Signing with CieSign is not enabled on this service.",
      INVALID_P7M: "The file is empty or not a .p7m.",
      CMS_INVALID: "The file is not a valid .p7m. Use the CAdES file created by CieSign.",
      CONTENT_MISMATCH: "The signed file does not contain exactly the statement. Sign the downloaded file without changing it.",
      SIGNATURE_INVALID: "The CIE signature is not valid.",
      CERT_NOT_HOLDER: "The certificate is not a CIE holder's certificate.",
      CERT_POLICY: "The certificate is not a CIE certificate.",
      CERT_KEY_USAGE: "The card's certificate cannot be used for this signature.",
      CERT_INVALID: "The card's certificate is not valid.",
      CERT_EXPIRED: "The card's certificate has expired or is not yet valid.",
      CHAIN_UNTRUSTED: "The certificate was not issued for the CIE.",
      ISSUER_NOT_IN_TRUST_STORE: "The certificate was not issued for the CIE.",
      TAX_CODE_NOT_FOUND: "The certificate does not have the expected CIE format.",
      CERT_REVOKED: "The card's certificate is revoked.",
      CERT_STATUS_UNKNOWN: "The status of the card's certificate is unknown.",
      OCSP_UNAVAILABLE: "The card revocation service is not responding. Try again later with a new statement.",
      OCSP_INVALID: "The revocation check answer is not valid. Try again later.",
      UP_REVOKED: "This UP's badge was revoked by ChainIntegrate: it cannot be renewed.",
      UP_LINKED_TO_ANOTHER_PERSON: "This UP is already linked to another CIE.",
      MIGRATION_OR_EXCEPTION_REQUIRED: "Your CIE is already linked to another UP. Choose \"Move the primary UP\" or \"Additional UP\".",
      NO_PRIMARY_LINK: "An additional UP needs a valid primary UP first.",
      EXCEPTION_REQUIRED: "An additional UP needs an exception approved by ChainIntegrate.",
      EXCEPTION_PENDING: "The exception request is waiting for approval.",
      EXCEPTION_LIMIT_REACHED: "You have reached the number of UPs allowed by the exception.",
      EXCEPTION_WITHDRAWN: "The exception for additional UPs was withdrawn by ChainIntegrate.",
      AGE_NOT_ELIGIBLE: "The service is for adults only.",
      CARD_EXPIRING: "The card expires this month: the badge would expire at once. Use the new card when you have it.",
      NOT_OWNER: "This UP is not the owner of the contract: access denied.",
      ADMIN_LOGIN_REQUIRED: "Session expired: log in again.",
      CHALLENGE_EXPIRED: "The login message expired or was already used: try again.",
      BAD_ORIGIN: "Request from an invalid origin.",
      INVALID_ARGS: "Invalid values.",
      METADATA_FILE_MISSING: "The metadata file is not on the server.",
      EXCEPTION_REJECTED: "The exception request was rejected by ChainIntegrate. You can ask again in 30 days.",
      REQUEST_EXPIRED: "The request has expired or was already used. Try again.",
      INVALID_REQUEST: "Invalid request. Try again.",
      MINT_IN_PROGRESS: "A badge is already being issued for this CIE or this UP. Try again in a few minutes.",
      MIGRATION_TOO_SOON: "You already moved your primary UP in the last 30 days. Try again later.",
      ALREADY_VERIFIED: "This UP already has a valid badge with this card: there is no need to renew it. You can renew it with your new card, when you have it.",
      MINT_FAILED: "Minting the badge failed. ChainIntegrate has been notified: try again later.",
      MINT_RATE_LIMITED: "The service has reached its maximum number of badges for this hour (or today). Your CIE was verified, but the badge was not issued: try again in an hour. ChainIntegrate has been notified.",
      SERVICE_UNAVAILABLE: "The verification service is temporarily unavailable. Try again in a few minutes.",
      SERVICE_BUSY: "Too many verifications are running right now. Try again in a minute with a new statement.",
      INTERRUPTED: "The service restarted during the check. Start again.",
      CHAIN_READ_FAILED: "Reading from the blockchain failed. Try again.",
      NOT_FOUND: "Statement not found.",
      PAYLOAD_TOO_LARGE: "The file is too large.",
      WALLET_REJECTED: "Cancelled in the wallet.",
      WC_REJECTED: "Connection refused in UP Wallet.",
      WC_FAILED: "Connecting UP Wallet failed. Try again.",
      WC_LOAD_FAILED: "The connection code cannot be loaded. Reload the page and try again.",
      WC_WRONG_CHAIN: "UP Wallet is on another network: choose this service's LUKSO network in UP Wallet and try again.",
      WALLET_ERROR: "The UP Browser extension returned an error.",
      NO_EXTENSION: "UP Browser extension not found.",
      NO_ACCOUNT: "No UP selected in the extension.",
      WRONG_CHAIN: "The extension is on another network: switch to the network shown at the top.",
      DEFAULT: "Unexpected error. Try again; if it persists, contact ChainIntegrate.",
    },

    privacyTitle: "Privacy notice",
    privacySubtitle: `Last updated: ${PRIVACY_DATE_EN}. Covers the UP CIE Link service (up-cie-link.chainintegrate.it), in testing.`,
    privacy: `
      <h2>1 · In short</h2>
      <ul>
        <li>The service reads your CIE certificate only to check it, in memory. Name, surname, tax code and the signed file are <strong>not stored</strong>.</li>
        <li>It keeps a fingerprint of the tax code (HMAC with a secret server key), to allow a single primary UP per person. It is pseudonymised data: legally it is still personal data.</li>
        <li>Only the badge on your UP, with dates and status, goes on the blockchain: no name, tax code or card data. The badge is tied to your UP, though: anyone who knows the UP is yours learns that you have a verified CIE. The badge expires on the first day of the month in which the card expires: it therefore reveals the card's expiry month, which for the CIE is the holder's month of birth (not the day or the year). The blockchain is public and permanent.</li>
        <li>No ads, no tracking, no usage statistics, no cookies.</li>
      </ul>
      <h2>2 · Who is responsible</h2>
      <p>ChainIntegrate, services of Simone Cavalletti, which runs the service. Contact, also for every request about your data: ${CONTACTS_EN}.</p>
      <h2>3 · Why, and on what basis</h2>
      <p>To link your Universal Profile to your CIE and issue the badge, allowing a single primary UP per person and invalidating the badge if the card's certificate is revoked. Legal basis: your <strong>consent</strong> (Art. 6(1)(a) GDPR), given before signing and revocable at any time (section 7).</p>
      <h2>4 · What we keep</h2>
      <ul>
        <li><strong>Link</strong>: UP address, tax code fingerprint, primary yes/no, verification and expiry dates, status, transaction. Until 12 months after the badge stops being valid (expiry, renunciation, invalidation or revocation), then deleted; the tax code fingerprint is deleted when no link is left.</li>
        <li><strong>Certificate reference</strong> (serial number and issuing authority, encrypted): used only for the daily check of the certificate's revocation. Deleted as soon as the badge expires, is invalidated or revoked, or you renounce it.</li>
        <li><strong>Statements</strong>: UP address, mode, dates, outcome. Deleted 7 days after they expire.</li>
        <li><strong>Exception requests</strong>: code, tax code fingerprint, status. Unapproved ones are closed after 30 days.</li>
        <li><strong>Operations log</strong> (date, type of operation, UP address, transaction): 12 months.</li>
        <li><strong>Encrypted backups</strong> of the database: up to 14 days, plus one per week for 8 weeks.</li>
        <li><strong>Web server logs</strong>: IP address, date and page requested, for security; deleted after 14 days. Rate limits use the IP in memory only.</li>
      </ul>
      <h2>5 · Who the service talks to, and what they see</h2>
      <ul>
        <li><strong>OCSP service of the Italian Ministry of the Interior</strong> (ocsp.cie.interno.gov.it): our server asks whether your card's certificate is revoked, at the check and then daily. It receives the certificate's serial number and our server's IP, not yours; since the Ministry knows whom each certificate belongs to, it can infer that your card is linked to this service.</li>
        <li><strong>LUKSO blockchain node</strong> (on mainnet a ChainIntegrate node; on the test network LUKSO's public node): our server reads the badges and sends the transactions. It sees the UP addresses.</li>
        <li><strong>UP Browser extension</strong> (LUKSO): signs the statement and the renunciation with your UP, in your browser.</li>
        <li><strong>Aruba S.p.A.</strong> (Italy), a provider processing data on our behalf: the server the service runs on (database, logs, encrypted backups) and the alert e-mails sent to ChainIntegrate.</li>
        <li><strong>WalletConnect (Reown, Inc.)</strong>, only if you connect UP Wallet for Android: requests between this page and the app go through its servers (relay). It sees the UP address, the network, the IP and the session's technical data; the content of the requests (text to sign, transactions) is encrypted between the page and the app. No usage statistics are sent to Reown. Reown is based in the United States: this data may be processed outside the European Union. According to its <a href="https://reown.com/privacy-policy" target="_blank" rel="noopener">privacy policy</a>, transfers outside the European Economic Area use the lawful transfer mechanisms provided by law. If you do not want that, use the UP Browser extension.</li>
        <li><strong>Anyone reading the blockchain</strong>: sees the badges of the UPs. If you move your primary UP (migration), the two operations happen close together and may reveal that both UPs belong to the same person.</li>
        <li><strong>Alerts to ChainIntegrate</strong>: for service problems and notable events (for example an exception request) we receive an e-mail with the UP address, never card data.</li>
      </ul>
      <h2>6 · What stays in your browser</h2>
      <p>The language and theme you chose, the number of the statement in progress (for the session only) and, if you connect UP Wallet, the WalletConnect connection data, until you press "Disconnect". Nothing else.</p>
      <h2>7 · Your rights</h2>
      <p>Under Regulation (EU) 2016/679 (GDPR) you can ask for access to your data and receive it in a machine-readable format (portability), or for its erasure, from the "My badge" page ("Download my data" gives a JSON file), signing the request with your UP: only whoever controls it can do so. If the UP no longer has a valid badge, the request covers that UP only. Rectification and restriction of processing, and requests from people who no longer have a UP with a valid badge, are made by writing to the contacts in section 2: we will ask for a signature of the UP or, for the data of all your UPs, a signature with your CIE, to be sure the request comes from you. You can withdraw your consent at any time. Erasure invalidates the badges and also deletes the tax code fingerprint: afterwards you could link the CIE again as if for the first time. You can also renounce the badge yourself from the "My badge" page. You can lodge a complaint with the Italian data protection authority (<a href="https://www.garanteprivacy.it" target="_blank" rel="noopener">garanteprivacy.it</a>). What is on the blockchain (the badge and its history) cannot be deleted by anyone.</p>
      <h2>8 · Minors and changes</h2>
      <p>The service is for adults only: the age is read from the certificate's tax code, during the check only. If this notice changes, the date at the top changes; previous versions stay in the <a href="https://github.com/ChainIntegrate/up-cie-link/commits/main/frontend/js/i18n.js" target="_blank" rel="noopener">repository history</a>.</p>`,

    legalTitle: "Legal notes",
    legal: `
      <h2>What the badge states</h2>
      <p>Only that, on the date shown, whoever controlled that Universal Profile also signed the same statement with a CIE whose certificate was valid and not revoked. The badge neither contains nor reveals the person's identity.</p>
      <h2>What it is not</h2>
      <ul>
        <li>It is not an identity document and does not replace any identification required by law.</li>
        <li>It is not a public service: it is not run, approved by or connected to the Italian Ministry of the Interior or the State Printing Office (IPZS).</li>
        <li>The signature uses the card's authentication certificate: it is not a qualified digital signature.</li>
      </ul>
      <h2>Experimental service</h2>
      <p>The service is in testing and provided as is, without warranties. ChainIntegrate may revoke a badge in case of abuse. The code is public under the Apache-2.0 licence.</p>
      <h2>Third-party components</h2>
      <p>Only for the UP Wallet connection, the page loads two unmodified third-party components: the WalletConnect client of Reown, Inc., under the <a href="/vendor/WALLETCONNECT-LICENSE.md" target="_blank" rel="noopener">WalletConnect Community License</a> (Portions © 2025 Reown, Inc. All Rights Reserved), and qrcode-generator by Kazuhiko Arase (MIT licence). Full list of the bundled packages and their licences: <a href="https://github.com/ChainIntegrate/up-cie-link/tree/main/frontend/vendor" target="_blank" rel="noopener">frontend/vendor</a>.</p>`,
  },
};

const prefs = storage("local");
const fromUrl = new URLSearchParams(location.search).get("lang");
let lang = fromUrl === "en" || fromUrl === "it" ? fromUrl : prefs.get("ucl-lang") === "en" ? "en" : "it";

export const getLang = () => lang;
export function setLang(l) {
  lang = l === "en" ? "en" : "it";
  prefs.set("ucl-lang", lang);
  document.documentElement.lang = lang;
}
export const t = (key) => T[lang][key] ?? T.it[key] ?? key;
// Unknown codes show the generic message followed by the technical code, so a screenshot is enough to diagnose.
export const errorText = (code) => T[lang].errors[code] ?? `${T[lang].errors.DEFAULT} (${code ?? "?"})`;
export const hasErrorText = (code) => code in T.it.errors;
export const allKeys = () => ({ it: T.it, en: T.en });
export const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "it-IT", { day: "numeric", month: "long", year: "numeric" }) : "—";
