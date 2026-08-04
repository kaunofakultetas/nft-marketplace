// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] MisbehavingNft — a collection that answers politely and then acts otherwise
//
//  MaliciousNft covers the collection that does NOTHING on transfer. This one covers the
//  collection that does the WRONG thing: it reverts halfway through, hands over a token
//  nobody bought, reports nobody as the owner, or advertises an approval its own transfer
//  then refuses to honour. Every mode answers the marketplace's view calls plausibly
//  enough to be listed — the misbehaviour surfaces only once the money has moved.
//
//    RevertOnTransfer      safeTransferFrom reverts; the purchase must unwind completely
//    TransferWrongToken    safeTransferFrom moves the decoy instead of the token sold
//    ZeroOwner             ownerOf names the zero address, so nobody can be the owner
//    LyingApproval         getApproved names the marketplace, the transfer then refuses
//    ReenterCancelForeign  safeTransferFrom reaches for ANOTHER collection's listing
//
//  Only the four functions the marketplace actually calls are implemented — ownerOf,
//  getApproved, isApprovedForAll and the 3-argument safeTransferFrom. realOwnerOf() is
//  the mock's own books, which the tests read to see what truly happened.
//
//  Used by:
//    - tests/HostileToken.t.sol
// ---------------------------------------------------------------------------------------

import {NftMarketplace} from "../../src/NftMarketplace.sol";

error MisbehavingNft__TransferRefused();
error MisbehavingNft__NotReallyApproved();

contract MisbehavingNft {

    enum Mode {
        RevertOnTransfer,
        TransferWrongToken,
        ZeroOwner,
        LyingApproval,
        ReenterCancelForeign
    }

    Mode private immutable i_mode;
    NftMarketplace private immutable i_marketplace;

    mapping(uint256 => address) private s_realOwner;

    uint256 private s_decoyTokenId;
    address private s_foreignNft;
    uint256 private s_foreignTokenId;
    bool private s_foreignCancelRefused;

    constructor(Mode mode, NftMarketplace marketplace) {
        i_mode = mode;
        i_marketplace = marketplace;
    }

    function mint(address to, uint256 tokenId) external {
        s_realOwner[tokenId] = to;
    }

    // Which token TransferWrongToken palms off on the buyer instead of the one sold
    function setDecoy(uint256 tokenId) external {
        s_decoyTokenId = tokenId;
    }

    // Which foreign listing ReenterCancelForeign reaches for while the sale is open
    function armForeignCancel(address nftAddress, uint256 tokenId) external {
        s_foreignNft = nftAddress;
        s_foreignTokenId = tokenId;
    }

    // True once the cross-collection attempt has been made AND refused
    function foreignCancelRefused() external view returns (bool) {
        return s_foreignCancelRefused;
    }

    // The mock's own books — what the tests read to see past whatever ownerOf claims
    function realOwnerOf(uint256 tokenId) external view returns (address) {
        return s_realOwner[tokenId];
    }


    // --- everything below is what the marketplace sees ---

    function ownerOf(uint256 tokenId) external view returns (address) {
        if (i_mode == Mode.ZeroOwner) {
            return address(0);
        }
        return s_realOwner[tokenId];
    }

    // Always "approved", so listItem never gets in the way of the real experiment.
    // LyingApproval is the mode where the transfer then holds the truth against it.
    function getApproved(uint256) external view returns (address) {
        return address(i_marketplace);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function safeTransferFrom(address, address to, uint256 tokenId) external {
        if (i_mode == Mode.RevertOnTransfer) {
            revert MisbehavingNft__TransferRefused();
        }

        if (i_mode == Mode.LyingApproval) {
            revert MisbehavingNft__NotReallyApproved();
        }

        if (i_mode == Mode.TransferWrongToken) {
            s_realOwner[s_decoyTokenId] = to;
            return;
        }

        if (i_mode == Mode.ReenterCancelForeign) {
            // cancelListing carries no reentrancy guard, so the call is allowed in —
            // only the ownership check on the FOREIGN collection can turn it away
            try i_marketplace.cancelListing(s_foreignNft, s_foreignTokenId) {
                s_foreignCancelRefused = false;
            } catch {
                s_foreignCancelRefused = true;
            }
        }

        s_realOwner[tokenId] = to;
    }
}
