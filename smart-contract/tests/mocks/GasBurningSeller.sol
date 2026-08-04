// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] GasBurningSeller — a payee that eats every unit of gas the payout forwards
//
//  The payout call carries no gas stipend of its own: EIP-150 hands the recipient 63/64
//  of whatever the caller still has. A recipient can simply never give it back. What
//  must NOT follow is any harm to a third party — the failed call has to roll the payout
//  back so the ledger keeps its figure, and the 1/64 the rule holds back has to be
//  enough for the marketplace to notice the failure and revert.
//
//  Tests calling this must cap the gas of the whole withdrawal (foo{gas: n}()), otherwise
//  the spin below runs through Foundry's entire per-test gas limit before it gives up.
//
//  Only what a seller needs is implemented: list a token it owns, then ask for its money.
//
//  Used by:
//    - tests/ProceedsSecurity.t.sol
// ---------------------------------------------------------------------------------------

import {NftMarketplace} from "../../src/NftMarketplace.sol";
import {MockNft} from "./MockNft.sol";

contract GasBurningSeller {

    NftMarketplace private immutable i_marketplace;

    uint256 private s_burned;

    constructor(NftMarketplace marketplace) {
        i_marketplace = marketplace;
    }

    function listToken(MockNft nft, uint256 tokenId, uint256 price) external {
        nft.approve(address(i_marketplace), tokenId);
        i_marketplace.listItem(address(nft), tokenId, price);
    }

    function withdraw() external {
        i_marketplace.withdrawProceeds();
    }

    // Spins until the EVM cuts this frame off. The storage write is what makes the loop
    // impossible to optimise away and what finally throws: an SSTORE with 2300 gas or
    // less left is refused outright, so the frame ends out of gas with nothing returned.
    receive() external payable {
        while (true) {
            unchecked {
                s_burned += 1;
            }
        }
    }
}
