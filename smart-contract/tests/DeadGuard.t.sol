// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Dead-guard tests — the bug that made the 2024 contract lie
//
//  REGRESSION, the whole file. The 2024 isListed modifier compared a uint256 against < 0
//  and therefore enforced NOTHING: every function it guarded happily ran on tokens that
//  had never been listed. The worst of them is updateListing, which could CREATE a
//  listing that had never been approved — the GUI then showed it as buyable, and buying
//  it failed deep inside the token contract.
//
//  A token nobody ever listed is the easy half. The half that bit in production is one
//  that WAS listed and is not any more: after a cancel the seller still holds it and the
//  ERC-721 approval is still standing, so the empty listing is the only thing left saying
//  the token is not for sale. This file therefore reads the guard in every state the
//  sentinel can be in, and reads it the way the GUI and the indexer meet it:
//
//    - the refusal is NftMarketplace__NotListed carrying the collection and tokenId that
//      were ASKED about — not a neighbour's, and not some downstream complaint about
//      price, ownership or approval that would only confuse whoever reads it
//    - a refused call writes no storage, moves no token, keeps no money, disturbs no
//      other listing and — the part the indexer depends on — emits no log at all
//    - price 0 IS "not listed", so getListing and the three guarded paths must agree with
//      each other in every state, through cancels, sales and re-listings
//
//  The refusals are called raw rather than through expectRevert: a raw call that
//  unexpectedly SUCCEEDS is caught by an assertFalse naming what got through, whereas
//  expectRevert would report only that a revert failed to arrive.
//
//  If any test in this file ever fails, that bug is back.
// ---------------------------------------------------------------------------------------

import {Vm} from "forge-std/Vm.sol";

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {MockNft} from "./mocks/MockNft.sol";
import {
    NftMarketplace,
    NftMarketplace__NotListed,
    NftMarketplace__PriceMustBeAboveZero
} from "../src/NftMarketplace.sol";

contract DeadGuardTest is MarketplaceTestBase {

    uint256 private constant HIGHER_PRICE = 3 ether;

    // Nothing ever mints this one: the fixture stops at OTHER_TOKEN_ID
    uint256 private constant UNMINTED_TOKEN_ID = 99;


    // buyListing, called without the safety net of expectRevert so that both halves of
    // the outcome — did it go through, and what exactly did it say — stay readable here.
    // The value rides with the call, so `caller` has to be able to afford it
    function _tryBuy(address caller, uint256 value, address collection, uint256 tokenId)
        private
        returns (bool ok, bytes memory data)
    {
        vm.prank(caller);
        (ok, data) = address(marketplace).call{value: value}(
            abi.encodeCall(NftMarketplace.buyListing, (collection, tokenId))
        );
    }

    // cancelListing, likewise
    function _tryCancel(address caller, address collection, uint256 tokenId)
        private
        returns (bool ok, bytes memory data)
    {
        vm.prank(caller);
        (ok, data) = address(marketplace).call(
            abi.encodeCall(NftMarketplace.cancelListing, (collection, tokenId))
        );
    }

    // updateListing, likewise
    function _tryUpdate(
        address caller,
        address collection,
        uint256 tokenId,
        uint256 newPrice
    ) private returns (bool ok, bytes memory data) {
        vm.prank(caller);
        (ok, data) = address(marketplace).call(
            abi.encodeCall(
                NftMarketplace.updateListing, (collection, tokenId, newPrice)
            )
        );
    }

    // A refusal is only the right refusal if it names the token that was asked about: a
    // bare selector match would pass just as happily while pointing the GUI elsewhere
    function _assertNotListed(bytes memory data, address collection, uint256 tokenId)
        private
    {
        assertEq(
            data,
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, collection, tokenId
            ),
            "not the guard's own error, or the wrong token named in it"
        );
    }

    // The three guarded paths, all asked about the same slot, all refused the same way
    function _assertAllThreeRefuse(
        address caller,
        uint256 value,
        address collection,
        uint256 tokenId
    ) private {
        (bool ok, bytes memory data) = _tryBuy(caller, value, collection, tokenId);
        assertFalse(ok, "a token that is not on the market was bought");
        _assertNotListed(data, collection, tokenId);

        (ok, data) = _tryCancel(caller, collection, tokenId);
        assertFalse(ok, "a token that is not on the market was cancelled");
        _assertNotListed(data, collection, tokenId);

        (ok, data) = _tryUpdate(caller, collection, tokenId, HIGHER_PRICE);
        assertFalse(ok, "a token that is not on the market was repriced");
        _assertNotListed(data, collection, tokenId);
    }

    // Reads which side of the sentinel a slot is on WITHOUT moving it: a reprice to zero
    // is refused by the guard when empty and by the zero-price rule when not, so neither
    // branch writes. `holder` must be both current owner and recorded seller
    function _guardIsOpen(address holder, address collection, uint256 tokenId)
        private
        returns (bool)
    {
        (bool ok, bytes memory data) = _tryUpdate(holder, collection, tokenId, 0);
        assertFalse(ok, "the zero-price probe must never succeed");

        if (bytes4(data) == NftMarketplace__NotListed.selector) {
            return false;
        }
        assertTrue(
            bytes4(data) == NftMarketplace__PriceMustBeAboveZero.selector,
            "the probe hit neither side of the sentinel"
        );
        return true;
    }

    // The indexer rebuilds the entire marketplace from logs emitted by THIS contract, so
    // the collection's own Approval and Transfer logs are none of this file's business
    function _assertNoMarketplaceLogs() private {
        Vm.Log[] memory logs = vm.getRecordedLogs();

        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(
                logs[i].emitter != address(marketplace),
                "a refused call announced itself to the indexer"
            );
        }
    }


    // Buying something nobody listed. The money must stay where it was: a marketplace
    // that accepted ETH for a listing that does not exist has no way to give it back
    function test_BuyListing_RevertsIfNotListed() public {
        uint256 buyerBefore = buyer.balance;

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(buyer.balance, buyerBefore, "the buyer paid for nothing at all");
        assertEq(address(marketplace).balance, 0);
        assertEq(nft.ownerOf(TOKEN_ID), seller);
    }

    // Cancelling something nobody listed (the 2024 contract emitted a real event for it)
    function test_CancelListing_RevertsIfNotListed() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, address(0));
    }

    // The dangerous one: repricing a token that was never listed used to CREATE a
    // listing, skipping the approval check that listItem enforces. The refusal is only
    // half the claim — the slot it was aimed at must still be empty afterwards
    function test_UpdateListing_RevertsIfNotListed() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, PRICE);

        NftMarketplace.Listing memory ghost =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(ghost.price, 0, "a reprice conjured a listing out of nothing");
        assertEq(ghost.seller, address(0), "a reprice conjured a seller out of nothing");
    }

    // The refusal must name the token that was ASKED about. A live listing for the
    // seller's other token stands right next to the empty slot, so a guard that answered
    // for the neighbour — or reached for it — is visible here and nowhere else
    function test_NeverListed_RefusalNamesTheTokenAskedAboutNotItsNeighbour() public {
        _list(OTHER_TOKEN_ID, PRICE);

        _assertAllThreeRefuse(buyer, PRICE, address(nft), TOKEN_ID);

        NftMarketplace.Listing memory neighbour =
            marketplace.getListing(address(nft), OTHER_TOKEN_ID);
        assertEq(neighbour.price, PRICE, "a refused call reached the live listing");
        assertEq(neighbour.seller, seller);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
        assertEq(nft.ownerOf(TOKEN_ID), seller);
        assertEq(nft.ownerOf(OTHER_TOKEN_ID), seller);
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0, "a refused call kept the money");

        // And the neighbour is still worth exactly what it always said
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), OTHER_TOKEN_ID);
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // Listings are keyed by collection AND tokenId, and every collection starts numbering
    // at zero. Listing token 0 of one must leave token 0 of the other as unlisted as it
    // was, and the refusal must name the collection that was asked about
    function test_NeverListed_ASecondCollectionKeepsItsOwnEmptySlot() public {
        MockNft other = new MockNft();
        other.mint(seller, TOKEN_ID);

        _list(TOKEN_ID, PRICE);

        _assertAllThreeRefuse(buyer, PRICE, address(other), TOKEN_ID);

        assertTrue(
            _guardIsOpen(seller, address(nft), TOKEN_ID),
            "the collection that was listed reads as absent"
        );
        assertFalse(
            _guardIsOpen(seller, address(other), TOKEN_ID),
            "one collection's listing opened another's slot"
        );
        assertEq(marketplace.getListing(address(other), TOKEN_ID).price, 0);
        assertEq(marketplace.getListing(address(other), TOKEN_ID).seller, address(0));
        assertEq(other.ownerOf(TOKEN_ID), seller);
    }

    // The backend rebuilds the marketplace from logs alone, so a refused call has to be
    // silent: the 2024 cancelListing announced ItemCanceled for tokens that had never
    // been listed, and the indexer dutifully retired listings that did not exist
    function test_NeverListed_RefusedCallsTellTheIndexerNothing() public {
        vm.recordLogs();

        _assertAllThreeRefuse(buyer, PRICE, address(nft), TOKEN_ID);

        _assertNoMarketplaceLogs();

        NftMarketplace.Listing memory slot =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(slot.price, 0);
        assertEq(slot.seller, address(0));
    }

    // THE 2024 BUG told through its consequence: a refused reprice must leave the slot as
    // free as it found it. The phantom listing the dead guard wrote then blocked the
    // owner's real listItem with AlreadyListed — the token became unsellable
    function test_NeverListed_RefusedRepriceLeavesTheSlotListableByItsOwner() public {
        (bool ok, bytes memory data) =
            _tryUpdate(seller, address(nft), TOKEN_ID, HIGHER_PRICE);
        assertFalse(ok, "a listing was conjured out of nothing");
        _assertNotListed(data, address(nft), TOKEN_ID);

        vm.prank(seller);
        nft.approve(address(marketplace), TOKEN_ID);

        // The honest route still works, and announces a NEW listing at the owner's price
        vm.expectEmit(true, true, true, true);
        emit ItemListed(seller, address(nft), TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, PRICE, "the phantom price outlived the refusal");
        assertEq(listing.seller, seller);
    }

    // A refusal must not be sticky. The token that could not be bought, cancelled or
    // repriced while it was off the market has to go through the whole ordinary
    // lifecycle the moment its owner lists it, down to the wei on both sides
    function test_NeverListed_RefusalIsNotStickyAndTheTokenStillSells() public {
        uint256 buyerStart = buyer.balance;

        _assertAllThreeRefuse(buyer, PRICE, address(nft), TOKEN_ID);
        assertEq(buyer.balance, buyerStart, "the refused buy kept the buyer's money");

        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(buyer.balance, buyerStart - PRICE);
        assertEq(seller.balance, PRICE, "the seller was paid something else");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0);
    }

    // A tokenId that was never minted has no owner to ask about, and the guard answers
    // before anybody asks: the caller gets this marketplace's named error instead of a
    // bare ERC-721 revert. Put isListed behind isOwner and this test is what notices
    function test_UnmintedTokenId_MeetsTheGuardBeforeTheCollectionIsAsked() public {
        // The collection itself cannot even answer who owns this id
        (bool minted, ) = address(nft).staticcall(
            abi.encodeCall(nft.ownerOf, (UNMINTED_TOKEN_ID))
        );
        assertFalse(minted, "the fixture was supposed to leave this id unminted");

        _assertAllThreeRefuse(buyer, PRICE, address(nft), UNMINTED_TOKEN_ID);

        assertEq(marketplace.getListing(address(nft), UNMINTED_TOKEN_ID).price, 0);
    }

    // A collection address typed wrong is an ordinary mistake, not an attack, and the
    // guard catches it first: an address with no code at all has an empty slot like
    // everything else, so the caller is told that rather than a raw call failure
    function test_MistypedCollectionAddress_MeetsTheGuardNotARawCallFailure() public {
        assertEq(stranger.code.length, 0, "the mistyped address must not be a contract");

        _assertAllThreeRefuse(buyer, PRICE, stranger, TOKEN_ID);
    }

    // The guard is the OUTERMOST check on all three paths, so "this is not for sale" is
    // what every caller hears. Each call below would also have failed a LATER check,
    // and must still be refused by the first one
    function test_Guard_AnswersBeforeThePriceAndOwnershipChecks() public {
        // A buy whose value could never have met the price either
        (bool ok, bytes memory data) = _tryBuy(buyer, 0.5 ether, address(nft), TOKEN_ID);
        assertFalse(ok, "an unlisted token was bought at an invented price");
        _assertNotListed(data, address(nft), TOKEN_ID);

        // A reprice to zero, which the zero-price rule would have refused on its own
        (ok, data) = _tryUpdate(seller, address(nft), TOKEN_ID, 0);
        assertFalse(ok, "an unlisted token was repriced to nothing");
        _assertNotListed(data, address(nft), TOKEN_ID);

        // And both owner-guarded paths asked by somebody who owns nothing here
        (ok, data) = _tryCancel(stranger, address(nft), TOKEN_ID);
        assertFalse(ok, "an unlisted token was cancelled by a passer-by");
        _assertNotListed(data, address(nft), TOKEN_ID);

        (ok, data) = _tryUpdate(stranger, address(nft), TOKEN_ID, PRICE);
        assertFalse(ok, "an unlisted token was repriced by a passer-by");
        _assertNotListed(data, address(nft), TOKEN_ID);
    }

    // The state the dead guard actually let through in the wild. After a cancel the
    // seller still owns the token and the approval is still standing, so the empty
    // listing is the only thing refusing a transfer — and it must refuse by name
    function test_AfterCancel_StillApprovedTokenIsNotTakenForNothing() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        assertEq(
            nft.getApproved(TOKEN_ID),
            address(marketplace),
            "the cancel was supposed to leave the token's approval alone"
        );

        uint256 buyerStart = buyer.balance;

        (bool ok, bytes memory data) = _tryBuy(buyer, 0, address(nft), TOKEN_ID);
        assertFalse(ok, "a cancelled listing was taken for nothing");
        _assertNotListed(data, address(nft), TOKEN_ID);

        (ok, data) = _tryCancel(seller, address(nft), TOKEN_ID);
        assertFalse(ok, "a cancelled listing was cancelled a second time");
        _assertNotListed(data, address(nft), TOKEN_ID);

        (ok, data) = _tryUpdate(seller, address(nft), TOKEN_ID, HIGHER_PRICE);
        assertFalse(ok, "a cancelled listing was repriced back onto the market");
        _assertNotListed(data, address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), seller, "the token left its owner's wallet");
        assertEq(buyer.balance, buyerStart);
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
    }

    // The other way a listing dies. Afterwards the single-token approval has been cleared
    // as an ERC-721 side effect, so a guard that let anything through would land on a
    // stale or approval complaint instead of the truthful one
    function test_AfterSale_RefusalsDoNotUnwindTheSaleOrItsNeighbour() public {
        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, HIGHER_PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.getApproved(TOKEN_ID), address(0), "the transfer kept an approval");

        _assertAllThreeRefuse(buyer, PRICE, address(nft), TOKEN_ID);
        _assertAllThreeRefuse(seller, 0, address(nft), TOKEN_ID);
        _assertAllThreeRefuse(stranger, 0, address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer, "the finished sale was undone");
        assertEq(marketplace.getProceeds(seller), PRICE, "the seller's money moved");
        assertEq(marketplace.getProceeds(buyer), 0);
        assertEq(marketplace.getProceeds(stranger), 0);
        assertEq(address(marketplace).balance, PRICE);

        NftMarketplace.Listing memory neighbour =
            marketplace.getListing(address(nft), OTHER_TOKEN_ID);
        assertEq(neighbour.price, HIGHER_PRICE, "a refused call reached the other token");
        assertEq(neighbour.seller, seller);
    }

    // Price 0 IS "not listed", so getListing and the guard are two views of one bit. This
    // walks one token through every state that bit can be in and demands the two views
    // agree at every step, or the storefront advertises what the contract refuses
    function test_Sentinel_GetListingAndTheGuardAgreeThroughAWholeLifecycle() public {
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
        assertFalse(
            _guardIsOpen(seller, address(nft), TOKEN_ID), "an empty slot was open"
        );
        _assertAllThreeRefuse(buyer, PRICE, address(nft), TOKEN_ID);

        // One wei is the smallest thing the sentinel has to tell apart from "absent"
        _list(TOKEN_ID, 1);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 1);
        assertTrue(
            _guardIsOpen(seller, address(nft), TOKEN_ID), "a price of 1 wei read as none"
        );

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
        assertFalse(
            _guardIsOpen(seller, address(nft), TOKEN_ID), "a cancelled slot stayed open"
        );
        _assertAllThreeRefuse(buyer, PRICE, address(nft), TOKEN_ID);

        _list(TOKEN_ID, PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
        assertTrue(
            _guardIsOpen(seller, address(nft), TOKEN_ID), "a re-listed slot stayed shut"
        );

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
        assertFalse(
            _guardIsOpen(buyer, address(nft), TOKEN_ID), "a sold slot stayed open"
        );
        _assertAllThreeRefuse(buyer, PRICE, address(nft), TOKEN_ID);
    }

    // Repetition: the sentinel has to be restored by EVERY cancel, not by most of them.
    // Three list/cancel cycles at prices three orders of magnitude apart — a delete that
    // left a residue would surface on the cycle after the one that caused it
    function test_Sentinel_ClosesAgainAfterEveryCancelInARepeatedCycle() public {
        uint256[3] memory prices = [uint256(1), PRICE, 1_000_000 ether];

        for (uint256 i = 0; i < prices.length; i++) {
            assertFalse(
                _guardIsOpen(seller, address(nft), TOKEN_ID),
                "the slot never closed after the previous cycle"
            );
            _assertAllThreeRefuse(buyer, PRICE, address(nft), TOKEN_ID);

            _list(TOKEN_ID, prices[i]);

            NftMarketplace.Listing memory listing =
                marketplace.getListing(address(nft), TOKEN_ID);
            assertEq(listing.price, prices[i], "the cycle listed the wrong price");
            assertEq(listing.seller, seller);
            assertTrue(
                _guardIsOpen(seller, address(nft), TOKEN_ID),
                "a fresh listing left the slot shut"
            );

            vm.prank(seller);
            marketplace.cancelListing(address(nft), TOKEN_ID);

            listing = marketplace.getListing(address(nft), TOKEN_ID);
            assertEq(listing.price, 0, "a price survived the cancel");
            assertEq(listing.seller, address(0), "a seller survived the cancel");
        }
    }

    // PROPERTY: with an empty order book NOTHING is listed — not the two tokens the
    // fixture minted, not any id of any collection anybody can name. A guard keyed on the
    // wrong thing would find a listing somewhere in this space
    function testFuzz_NothingIsListedUntilSomebodyListsIt(
        address collection,
        uint256 tokenId
    ) public {
        NftMarketplace.Listing memory slot =
            marketplace.getListing(collection, tokenId);
        assertEq(slot.price, 0);
        assertEq(slot.seller, address(0));

        _assertAllThreeRefuse(buyer, 0, collection, tokenId);
    }
}
