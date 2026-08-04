// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] ReturnBombSeller — a payee that answers its payout with megabytes of returndata
//
//  withdrawProceeds pays with a low-level call, and a low-level call lets the RECIPIENT
//  decide how much data comes back. This one hands back a megabyte of it. That is free
//  for a caller which ignores the returndata — Solidity emits no returndatacopy when the
//  result is written as (bool sent, ) — and ruinous for one that copies it, because the
//  copy is paid for out of the gas the caller has left AFTER the payee is done.
//
//  Sizing: returning N bytes costs this contract the memory expansion for N bytes, and a
//  caller that copied them would pay that expansion again plus the copy itself. Running
//  the withdrawal under a budget between the two is what tells the versions apart.
//
//  Only what a seller needs is implemented: list a token it owns, then ask for its money.
//
//  Used by:
//    - tests/ProceedsSecurity.t.sol
// ---------------------------------------------------------------------------------------

import {NftMarketplace} from "../../src/NftMarketplace.sol";
import {MockNft} from "./MockNft.sol";

contract ReturnBombSeller {

    NftMarketplace private immutable i_marketplace;
    uint256 private immutable i_returnBytes;

    constructor(NftMarketplace marketplace, uint256 returnBytes) {
        i_marketplace = marketplace;
        i_returnBytes = returnBytes;
    }

    function listToken(MockNft nft, uint256 tokenId, uint256 price) external {
        nft.approve(address(i_marketplace), tokenId);
        i_marketplace.listItem(address(nft), tokenId, price);
    }

    function withdraw() external {
        i_marketplace.withdrawProceeds();
    }

    // The ETH is still accepted: RETURN ends this frame SUCCESSFULLY and only then hands
    // back i_returnBytes bytes of (zeroed) memory. Immutables cannot be read from inline
    // assembly, so the size is copied onto the stack first.
    receive() external payable {
        uint256 size = i_returnBytes;
        assembly {
            return(0, size)
        }
    }
}
