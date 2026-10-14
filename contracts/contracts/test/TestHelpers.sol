// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

// Test-only helpers: a real Universal Profile (LSP0) and a contract without LSP1.
import {LSP0ERC725Account} from "@lukso/lsp0-contracts/contracts/LSP0ERC725Account.sol";

contract TestUniversalProfile is LSP0ERC725Account {
    constructor(address initialOwner) LSP0ERC725Account(initialOwner) {}
}

contract NoLSP1Receiver {}
