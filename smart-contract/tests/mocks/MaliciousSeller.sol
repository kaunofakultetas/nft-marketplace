// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] MaliciousSeller — a seller that is a contract, not a wallet
//
//  withdrawProceeds hands control to whoever is being paid, which is the other end of
//  the reentrancy problem: the receiver runs code while the marketplace is mid-payout.
//  Two flavours:
//
//    ReenterWithdraw  its receive() calls withdrawProceeds again — the second claim must
//                     be refused, and the first must roll back rather than pay twice
//    RejectEth        its receive() reverts. The SALE still has to stand; only the
//                     payout fails, which is the entire point of pull payments.
//
//  Used by:
//    - tests/Availability.t.sol
//    - tests/ProceedsSecurity.t.sol
//    - tests/Reentrancy.t.sol
// ---------------------------------------------------------------------------------------

import {NftMarketplace} from "../../src/NftMarketplace.sol";
import {MockNft} from "./MockNft.sol";

contract MaliciousSeller {

    enum Mode {
        ReenterWithdraw,
        RejectEth
    }

    Mode private immutable i_mode;
    NftMarketplace private immutable i_marketplace;

    bool private s_reentered;

    constructor(Mode mode, NftMarketplace marketplace) {
        i_mode = mode;
        i_marketplace = marketplace;
    }

    function listToken(MockNft nft, uint256 tokenId, uint256 price) external {
        nft.approve(address(i_marketplace), tokenId);
        i_marketplace.listItem(address(nft), tokenId, price);
    }

    function withdraw() external {
        i_marketplace.withdrawProceeds();
    }

    receive() external payable {
        if (i_mode == Mode.RejectEth) {
            revert("this seller refuses ETH");
        }

        // Claim a second time while the first payout is still running
        if (!s_reentered) {
            s_reentered = true;
            i_marketplace.withdrawProceeds();
        }
    }
}
