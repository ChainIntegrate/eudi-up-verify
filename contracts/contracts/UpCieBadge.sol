// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {LSP8IdentifiableDigitalAsset} from "@lukso/lsp8-contracts/contracts/LSP8IdentifiableDigitalAsset.sol";

/// @title UP CIE Link badge
/// @notice Soulbound LSP8 badge stating that a Universal Profile was linked to a valid Italian CIE
/// (signature of a joint statement by both the UP and the CIE, verified off-chain by the attester).
/// @dev No personal data is stored: only source, verification time, expiry and status per UP.
/// One token per UP, tokenId = the UP address left-padded to 32 bytes (LSP8 tokenId format ADDRESS).
/// "One person, one UP" is enforced off-chain by the attester backend; the owner can approve
/// exceptions, recorded on-chain with an opaque ticket. Each badge says whether it is the person's
/// primary UP or an additional one (exception), without linking UPs to each other: contracts that need
/// strict "one person, one vote" use {isVerifiedPrimary}.
contract UpCieBadge is LSP8IdentifiableDigitalAsset {
    enum Status {
        None,
        Valid,
        Invalidated,
        Revoked
    }

    struct Attestation {
        bytes32 source;
        uint64 verifiedAt;
        uint64 expiresAt;
        Status status;
        bool primary;
    }

    // LSP4TokenType: 1 = NFT, so wallets list the badge among collectibles.
    uint256 private constant _TOKEN_TYPE_NFT = 1;
    // LSP8TokenIdFormat: 2 = ADDRESS.
    uint256 private constant _TOKEN_ID_FORMAT_ADDRESS = 2;
    bytes32 private constant _REASON_SELF = "SELF";

    address public attester;
    mapping(bytes32 tokenId => Attestation) private _attestations;
    /// @notice Exceptions to "one person, one UP" approved by the owner: ticket => max number of UPs.
    mapping(bytes32 ticket => uint8 maxUps) public exceptionOf;

    event Attested(
        address indexed up,
        bytes32 indexed tokenId,
        bytes32 source,
        uint64 verifiedAt,
        uint64 expiresAt,
        bool primary
    );
    event Invalidated(address indexed up, bytes32 indexed tokenId, bytes32 reason, address indexed by);
    event Revoked(address indexed up, bytes32 indexed tokenId, bytes32 reason);
    event Reinstated(address indexed up, bytes32 indexed tokenId);
    event AttesterChanged(address indexed previousAttester, address indexed newAttester);
    event ExceptionApproved(bytes32 indexed ticket, uint8 maxUps);

    error NotAttester(address caller);
    error InvalidUniversalProfile();
    error ExpiryNotInFuture(uint64 expiresAt);
    error BadgeRevoked(address up);
    error BadgeNotValid(address up);
    error BadgeNotRevoked(address up);
    error BadgeNotFound(address up);
    error InvalidException();
    error TransferNotAllowed();
    error Reentrancy();
    error OperatorsNotAllowed();

    // UCL-05: state-changing functions cannot be re-entered (e.g. renounce() from the UP's universalReceiver
    // while its badge is being minted, which would emit Invalidated before Attested).
    bool private _locked;

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    modifier onlyAttester() {
        if (msg.sender != attester || attester == address(0)) revert NotAttester(msg.sender);
        _;
    }

    constructor(
        address owner_,
        address attester_
    ) LSP8IdentifiableDigitalAsset("UP CIE Link", "UPCIE", owner_, _TOKEN_TYPE_NFT, _TOKEN_ID_FORMAT_ADDRESS) {
        attester = attester_;
        emit AttesterChanged(address(0), attester_);
    }

    // ---------------------------------------------------------------- attester

    /// @notice Mints the badge to `up`, or renews it in place if it already exists.
    /// @param expiresAt Badge expiry (unix seconds): the first day of the month after the card expiry (UCL-03).
    /// @param primary True for the person's primary UP, false for an additional UP allowed by an exception.
    function attest(address up, bytes32 source, uint64 expiresAt, bool primary) external onlyAttester nonReentrant {
        if (up == address(0)) revert InvalidUniversalProfile();
        if (expiresAt <= block.timestamp) revert ExpiryNotInFuture(expiresAt);

        bytes32 tokenId = tokenIdOf(up);
        Attestation storage a = _attestations[tokenId];
        if (a.status == Status.Revoked) revert BadgeRevoked(up);

        uint64 verifiedAt = uint64(block.timestamp);
        a.source = source;
        a.verifiedAt = verifiedAt;
        a.expiresAt = expiresAt;
        a.status = Status.Valid;
        a.primary = primary;

        // Event first, then the mint (which calls the recipient's universalReceiver): logs stay in logical order.
        emit Attested(up, tokenId, source, verifiedAt, expiresAt, primary);

        // force = false: the recipient must support LSP1 (a Universal Profile), never an EOA.
        if (!_exists(tokenId)) _mint(up, tokenId, false, "");
    }

    /// @notice Invalidates a valid badge (e.g. certificate revoked, migration). It can be attested again.
    function invalidate(address up, bytes32 reason) external onlyAttester nonReentrant {
        _invalidate(up, reason);
    }

    // ---------------------------------------------------------------- holder

    /// @notice The holder withdraws its own badge, without going through the attester.
    function renounce() external nonReentrant {
        _invalidate(msg.sender, _REASON_SELF);
    }

    // ---------------------------------------------------------------- owner

    /// @notice Blocks a badge for abuse: the attester cannot renew it until the owner reinstates it.
    function revoke(address up, bytes32 reason) external onlyOwner nonReentrant {
        bytes32 tokenId = tokenIdOf(up);
        Attestation storage a = _attestations[tokenId];
        if (a.status == Status.None) revert BadgeNotFound(up);
        if (a.status == Status.Revoked) revert BadgeRevoked(up);
        a.status = Status.Revoked;
        emit Revoked(up, tokenId, reason);
    }

    /// @notice Lifts a revocation: the badge becomes Invalidated and can be attested again.
    function reinstate(address up) external onlyOwner nonReentrant {
        bytes32 tokenId = tokenIdOf(up);
        Attestation storage a = _attestations[tokenId];
        if (a.status != Status.Revoked) revert BadgeNotRevoked(up);
        a.status = Status.Invalidated;
        emit Reinstated(up, tokenId);
    }

    /// @notice Public record of an exception to "one person, one UP". `ticket` is an opaque random id
    /// generated by the attester backend: it carries no personal data. `maxUps` counts all the person's UPs
    /// (primary included); it can be lowered later, and 0 withdraws the exception (UCL-21).
    function approveException(bytes32 ticket, uint8 maxUps) external onlyOwner {
        if (ticket == bytes32(0)) revert InvalidException();
        exceptionOf[ticket] = maxUps;
        emit ExceptionApproved(ticket, maxUps);
    }

    /// @notice Sets the attester. `address(0)` stops all new attestations (emergency stop).
    function setAttester(address newAttester) external onlyOwner {
        emit AttesterChanged(attester, newAttester);
        attester = newAttester;
    }

    // ---------------------------------------------------------------- views

    /// @notice True if `up` holds a valid, unexpired badge.
    function isVerified(address up) external view returns (bool) {
        Attestation storage a = _attestations[tokenIdOf(up)];
        return a.status == Status.Valid && block.timestamp < a.expiresAt;
    }

    /// @notice True if `up` holds a valid, unexpired badge AND it is the person's primary UP.
    /// Use this for strict "one person, one UP" (e.g. voting, airdrops).
    function isVerifiedPrimary(address up) external view returns (bool) {
        Attestation storage a = _attestations[tokenIdOf(up)];
        return a.status == Status.Valid && block.timestamp < a.expiresAt && a.primary;
    }

    function getAttestation(address up) external view returns (Attestation memory) {
        return _attestations[tokenIdOf(up)];
    }

    function tokenIdOf(address up) public pure returns (bytes32) {
        return bytes32(uint256(uint160(up)));
    }

    // ---------------------------------------------------------------- soulbound

    /// @dev Only minting is allowed: no transfer, no burn.
    function _beforeTokenTransfer(
        address from,
        address to,
        bytes32 tokenId,
        bool force,
        bytes memory data
    ) internal virtual override {
        if (from != address(0)) revert TransferNotAllowed();
        super._beforeTokenTransfer(from, to, tokenId, force, data);
    }

    function authorizeOperator(address, bytes32, bytes memory) public pure override {
        revert OperatorsNotAllowed();
    }

    // ---------------------------------------------------------------- internal

    function _invalidate(address up, bytes32 reason) private {
        bytes32 tokenId = tokenIdOf(up);
        Attestation storage a = _attestations[tokenId];
        if (a.status != Status.Valid) revert BadgeNotValid(up);
        a.status = Status.Invalidated;
        emit Invalidated(up, tokenId, reason, msg.sender);
    }
}
