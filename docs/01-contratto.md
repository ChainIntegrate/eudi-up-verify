# Fase 1 — Contratto attestatore: interfaccia da approvare

> Stato: **proposta**, nessun codice. Riferimenti: decisioni D3, D4, D5 in `00-analisi.md` §9; vincoli in `CLAUDE.md`.

## Principio guida

Il contratto sa solo **quale UP** è verificata, **da quale fonte**, **quando**, **fino a quando** e **in che stato**.
Non sa **chi** è la persona. Per questo l'unicità "una persona = una UP" (D3) si applica **nel backend**, che conosce
l'HMAC del codice fiscale. Metterla on-chain richiederebbe un identificativo della persona sulla blockchain, anche solo
pseudonimo: sarebbe immutabile e incompatibile con il diritto alla cancellazione. On-chain resta solo una **traccia
pubblica** delle eccezioni approvate dall'owner, senza dati personali.

## Interfaccia

```solidity
// UpCieBadge is LSP8IdentifiableDigitalAsset   (Solidity 0.8.28, @lukso/lsp8-contracts 0.18.1)
// name "UP CIE Link", symbol "UPCIE" (provvisori, D7)
// LSP4TokenType = 1 (NFT), LSP8TokenIdFormat = 2 (ADDRESS)
// tokenId(up) = bytes32(uint256(uint160(up)))  -> un token per UP, deterministico

enum Status { None, Valid, Invalidated, Revoked }
//  Valid       -> isVerified() true finché non scade
//  Invalidated -> dall'attester o dal titolare stesso; la UP può essere riattestata con una nuova firma CIE
//  Revoked     -> dall'owner (abuso); solo l'owner può revocare il blocco

struct Attestation {
    bytes32 source;      // es. "CIE" (estendibile: "CIE_OIDC", "IT_WALLET", ...)
    uint64  verifiedAt;  // momento della verifica
    uint64  expiresAt;   // = scadenza del certificato CIE (D4)
    Status  status;
}

// --- ruoli ---
// owner()   = UP ChainIntegrate (testnet 0x83cB...472C), passata nel costruttore
// attester  = chiave operativa del backend, impostata dall'owner
function setAttester(address newAttester) external onlyOwner;

// --- scrittura: backend ---
function attest(address up, bytes32 source, uint64 expiresAt) external onlyAttester;
//  - token inesistente: _mint(up, tokenId, force=false) -> la UP deve supportare LSP1 (niente EOA);
//    la UP lo registra tra i suoi asset (LSP5) e il bollino compare tra i collezionabili
//  - token esistente con stato Invalidated, oppure Valid ma scaduto o da aggiornare: aggiorna i dati in place (rinnovo)
//  - stato Revoked: revert
//  - expiresAt deve essere nel futuro
function invalidate(address up, bytes32 reason) external onlyAttester;   // -> Invalidated
//  reason: codici brevi, es. "CERT_REVOKED", "CERT_EXPIRED", "USER_REQUEST", "MIGRATED"

// --- scrittura: titolare ---
function renounce() external;   // msg.sender = UP titolare -> Invalidated, reason "SELF"
//  il titolare può sempre ritirare il proprio bollino senza passare dal backend

// --- scrittura: owner ---
function revoke(address up, bytes32 reason) external onlyOwner;    // -> Revoked (abuso)
function reinstate(address up) external onlyOwner;                 // Revoked -> Invalidated (riattestabile)
function approveException(bytes32 ticket, uint8 maxUps) external onlyOwner;
//  traccia pubblica di un'eccezione a D3: ticket = id casuale generato dal backend (nessun dato personale);
//  il backend conia la UP "in più" solo se trova on-chain l'evento con quel ticket

// --- lettura ---
function isVerified(address up) external view returns (bool);  // status == Valid && block.timestamp < expiresAt
function getAttestation(address up) external view returns (Attestation memory);
function tokenIdOf(address up) external pure returns (bytes32);

// --- eventi ---
event Attested(address indexed up, bytes32 indexed tokenId, bytes32 source, uint64 verifiedAt, uint64 expiresAt);
event Invalidated(address indexed up, bytes32 indexed tokenId, bytes32 reason, address indexed by);
event Revoked(address indexed up, bytes32 indexed tokenId, bytes32 reason);
event Reinstated(address indexed up, bytes32 indexed tokenId);
event AttesterChanged(address indexed previousAttester, address indexed newAttester);
event ExceptionApproved(bytes32 indexed ticket, uint8 maxUps);

// --- soulbound ---
// _beforeTokenTransfer: revert se from != address(0)  -> niente trasferimenti né burn; solo mint
// authorizeOperator: revert (un operatore non avrebbe nulla da fare)
```

## Come si applicano le decisioni

| Decisione | Dove |
|---|---|
| D3 una UP per persona | backend (HMAC del CF); eccezioni con `approveException` dell'owner |
| D3 migrazione | backend: verifica la nuova firma CIE, `invalidate(vecchia, "MIGRATED")` + `attest(nuova)` |
| D4 scadenza = carta | `expiresAt` = `notAfter` del certificato; `isVerified` lo controlla |
| D5.1 revoca alla verifica | backend (OCSP, fail-closed) prima di `attest` |
| D5.2 revoca dopo il conio | backend: ricontrollo OCSP periodico → `invalidate(up, "CERT_REVOKED")` |
| D5.3 su richiesta | titolare: `renounce()`; owner: `revoke()` |

## Test previsti (Hardhat 3, ethers v6)

- Deploy con owner = UP (LSP0 di test) e verifica di `LSP4TokenType = 1` e del formato tokenId.
- `attest` crea il token sulla UP; revert verso EOA o contratti senza LSP1; revert se non attester o se `expiresAt` è passato.
- `isVerified` true/false: valido, scaduto (time travel), invalidato, revocato.
- Rinnovo in place dopo `invalidate`; revert dopo `revoke`; `reinstate` poi `attest` di nuovo.
- `renounce` dal titolare; revert da altri indirizzi.
- Trasferimento, `transfer` forzato, `authorizeOperator`: tutti in revert.
- Ruoli: `setAttester` solo owner; il vecchio attester perde i permessi.
- Eventi emessi con i parametri attesi.

## Domande aperte

1. **Migrazione:** un evento che collega vecchia e nuova UP (`Migrated(old, new)`) sarebbe comodo, ma renderebbe pubblico
   che le due UP appartengono alla stessa persona. Proposta: **nessun collegamento on-chain**, solo `Invalidated` con
   motivo `MIGRATED` sulla vecchia. Ok?
2. **Stato `Revoked` separato da `Invalidated`:** serve a impedire che il backend riattesti una UP bloccata per abuso
   finché l'owner non decide. Ok tenerlo, o basta un solo stato "non valido"?
3. **Nome e simbolo** del token: provvisori "UP CIE Link" / "UPCIE", da decidere con la dicitura (D7).
4. **Pausa d'emergenza** (owner sospende tutti gli `attest`): non prevista; basta cambiare o azzerare l'attester con
   `setAttester(address(0))`. Ok?
