// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

// Test-only helpers: a real Universal Profile (LSP0), a minimal Key Manager, a contract without LSP1, and the
// "UP-like" contracts of the 2026-10-14 audit (docs/audit).
import {LSP0ERC725Account} from "@lukso/lsp0-contracts/contracts/LSP0ERC725Account.sol";

contract TestUniversalProfile is LSP0ERC725Account {
    constructor(address initialOwner) LSP0ERC725Account(initialOwner) {}
}

contract NoLSP1Receiver {}

interface IBadgeRenounce {
    function renounce() external;
}

/// A minimal LSP6-like Key Manager: owner of a TestUniversalProfile, with one controller.
/// ERC-1271 checks the controller's ECDSA signature; execute() forwards calls to the UP.
contract TestKeyManager {
    address public target;
    address public immutable controller;

    constructor(address controller_) {
        controller = controller_;
    }

    function setTarget(address target_) external {
        require(target == address(0), "already set"); // test helper: set once, right after deployment
        target = target_;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x23f34c62; // ERC-165, LSP6
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        if (signature.length != 65) return 0xffffffff;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        return ecrecover(hash, v, r, s) == controller ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function execute(bytes calldata payload) external payable returns (bytes memory) {
        require(msg.sender == controller, "not the controller");
        (bool ok, bytes memory result) = target.call{value: msg.value}(payload);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return result;
    }
}

/// Audit PoC (UCL-05): claims LSP0 + LSP1, accepts any ERC-1271 signature and renounces its badge while it is
/// being minted.
contract TestReentrantFakeUP {
    address public badge;

    constructor(address badge_) {
        badge = badge_;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x24871b3d || id == 0x6bb56a14;
    }

    function isValidSignature(bytes32, bytes memory) external pure returns (bytes4) {
        return 0x1626ba7e;
    }

    function universalReceiver(bytes32, bytes calldata) external payable returns (bytes memory) {
        if (msg.sender == badge) IBadgeRenounce(badge).renounce();
        return "";
    }
}

/// Audit PoC (UCL-01/05): claims LSP0 and accepts any ERC-1271 signature, but has no LSP1 (attest() reverts).
contract TestFakeUPNoLsp1 {
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x24871b3d;
    }

    function isValidSignature(bytes32, bytes memory) external pure returns (bytes4) {
        return 0x1626ba7e;
    }
}
