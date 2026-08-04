// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Update tests — a reprice changes the price and nothing else
//
//  updateListing is the only function that edits a live listing in place, and it writes a
//  single field of it. Everything around that field — who gets paid, who owns the token,
//  what the marketplace is allowed to move, every other listing and every proceeds
//  balance — must come out of the call exactly as it went in, and the new number must be
//  the only one that can buy the token afterwards.
//
//  The event matters as much as the state: a reprice announces ItemUpdated, never
//  ItemListed, and announces it exactly once. The backend indexer counts on that
//  distinction, and the 2024 contract did not provide it.
//
//  Covers:
//    - the reprice changes the price and leaves owner, approval and seller untouched
//    - exactly one log, carrying the right indexed seller / collection / tokenId
//    - the new price binds, the old one is refused quoting the new number, and the sale
//      that follows is booked and announced at it
//    - chains of reprices, up and back down, and a reprice to the price already in force
//    - one wei and 2^256-1 reached through the update path
//    - collection-wide approvals, and the approval an honest transfer quietly cleared
//    - other tokens, other collections, other sellers and their proceeds
//    - the new owner of a resold token repricing it, and a contract seller doing the same
// ---------------------------------------------------------------------------------------

import {Vm} from "forge-std/Vm.sol";

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {MockNft} from "./mocks/MockNft.sol";
import {
    NftMarketplace,
    NftMarketplace__PriceMustBeAboveZero,
    NftMarketplace__NotSeller,
    NftMarketplace__NotApprovedForMarketplace,
    NftMarketplace__PriceNotMet
} from "../src/NftMarketplace.sol";

contract UpdatingTest is MarketplaceTestBase {

    uint256 private constant NEW_PRICE = 2 ether;
    uint256 private constant NEIGHBOUR_PRICE = 4 ether;
    uint256 private constant MAX_PRICE = type(uint256).max;

    // Never minted and never listed: every view of it must stay empty throughout
    uint256 private constant UNTOUCHED_TOKEN_ID = 7;
    uint256 private constant SECOND_SELLER_TOKEN = 42;
    uint256 private constant CONTRACT_SELLER_TOKEN = 77;


    // The fixture's _list always speaks for the shared seller; the independence tests
    // need a second seller listing a token of their own
    function _listAs(address holder, uint256 tokenId, uint256 price) private {
        vm.startPrank(holder);
        nft.approve(address(marketplace), tokenId);
        marketplace.listItem(address(nft), tokenId, price);
        vm.stopPrank();
    }

    // The exact PriceNotMet payload, so a test can demand the refusal quote the price
    // that is really in force rather than accept any revert at all
    function _priceNotMet(uint256 tokenId, uint256 price)
        private
        view
        returns (bytes memory)
    {
        return abi.encodeWithSelector(
            NftMarketplace__PriceNotMet.selector, address(nft), tokenId, price
        );
    }

    // Reads the WHOLE log output of the recorded action. expectEmit would happily accept
    // a second, unannounced event alongside the expected one, and the indexer replays
    // every log it sees — so the count is as much a part of the contract as the values
    function _assertOnlyItemUpdated(
        address expectedSeller,
        uint256 tokenId,
        uint256 expectedPrice
    ) private {
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(logs.length, 1, "a reprice emitted something other than one log");
        assertEq(logs[0].emitter, address(marketplace), "the emitter is not ours");
        assertEq(logs[0].topics.length, 4, "the indexed parameters changed");
        // ItemListed has the same shape, so only the topic tells the two apart
        assertEq(logs[0].topics[0], ItemUpdated.selector, "this is not an ItemUpdated");
        assertEq(
            logs[0].topics[1],
            bytes32(uint256(uint160(expectedSeller))),
            "the logged seller is wrong"
        );
        assertEq(
            logs[0].topics[2],
            bytes32(uint256(uint160(address(nft)))),
            "the logged collection is wrong"
        );
        assertEq(logs[0].topics[3], bytes32(tokenId), "the logged tokenId is wrong");
        assertEq(
            abi.decode(logs[0].data, (uint256)),
            expectedPrice,
            "the logged price is wrong"
        );
    }


    // REGRESSION: the 2024 contract re-emitted ItemListed, leaving the indexer unable to
    // tell a reprice from a new listing (30 real listings looked like 40)
    function test_UpdateListing_EmitsItemUpdatedNotItemListed() public {
        _list(TOKEN_ID, PRICE);

        vm.expectEmit(true, true, true, true);
        emit ItemUpdated(seller, address(nft), TOKEN_ID, 2 ether);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 2 ether);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 2 ether);
    }

    // A new owner inheriting a listing must not be able to reprice it: the proceeds would
    // still be routed to the previous owner
    function test_UpdateListing_RevertsForOwnerWhoIsNotTheSeller() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotSeller.selector);
        vm.prank(stranger);
        marketplace.updateListing(address(nft), TOKEN_ID, 2 ether);

        // The refused call must leave the offer exactly as the seller made it
        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, PRICE, "a refused reprice moved the price");
        assertEq(listing.seller, seller, "a refused reprice moved the payout address");
    }

    // Zero is the not-listed sentinel here too
    function test_UpdateListing_RevertsOnZeroPrice() public {
        _list(TOKEN_ID, PRICE);

        vm.expectRevert(NftMarketplace__PriceMustBeAboveZero.selector);
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 0);

        // A zero that got through would delete the listing rather than reprice it, so the
        // refusal has to leave both fields standing
        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, PRICE, "the listing was zeroed by the refusal");
        assertEq(listing.seller, seller);
    }

    // updateListing re-checks the approval on every call: a seller who revoked it must
    // not be able to keep advertising a price the marketplace could never honour
    function test_UpdateListing_RevertsWhenApprovalWasRevoked() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.approve(address(0), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 2 ether);

        // ...and the old price survives the refusal untouched
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
    }


    // A reprice writes one field. Everything the call READ on the way — the owner, the
    // approval it checked, the seller it compared against — and everything it never
    // mentioned at all must be identical afterwards, or the reprice is quietly doing more
    function test_UpdateListing_ChangesThePriceAndNothingElse() public {
        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, NEIGHBOUR_PRICE);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, NEW_PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, NEW_PRICE, "the new price was not stored");
        assertEq(listing.seller, seller, "the reprice moved the payout address");

        // The token never moves for a reprice, and the marketplace's power over it is
        // still exactly the one the seller granted before listing
        assertEq(nft.ownerOf(TOKEN_ID), seller, "the token moved");
        assertEq(
            nft.getApproved(TOKEN_ID),
            address(marketplace),
            "the approval the reprice checked was consumed"
        );
        assertFalse(nft.isApprovedForAll(seller, address(marketplace)));

        // The seller's other token is a different row of the same mapping
        NftMarketplace.Listing memory neighbour =
            marketplace.getListing(address(nft), OTHER_TOKEN_ID);
        assertEq(neighbour.price, NEIGHBOUR_PRICE, "a reprice reached another token");
        assertEq(neighbour.seller, seller);

        // No money is involved in a reprice, and a token nobody listed still has no row
        assertEq(marketplace.getProceeds(seller), 0, "a reprice paid somebody");
        assertEq(marketplace.getProceeds(buyer), 0);
        assertEq(marketplace.getProceeds(stranger), 0);
        assertEq(address(marketplace).balance, 0, "the marketplace took ETH");
        assertEq(marketplace.getListing(address(nft), UNTOUCHED_TOKEN_ID).price, 0);
        assertEq(
            marketplace.getListing(address(nft), UNTOUCHED_TOKEN_ID).seller, address(0)
        );
    }

    // The indexer rebuilds the order book from logs alone, so a reprice must leave it
    // exactly one to read — a stray second event would be replayed as a second action —
    // and the three indexed fields are the only way it knows which listing moved
    function test_UpdateListing_EmitsExactlyOneLogWithTheRightIndexedFields() public {
        _list(TOKEN_ID, PRICE);

        vm.recordLogs();

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, NEW_PRICE);

        _assertOnlyItemUpdated(seller, TOKEN_ID, NEW_PRICE);
    }

    // Repricing to the number already in force is an ordinary, honest call — a GUI that
    // re-submits an unchanged form makes it every day. It must be accepted and announced
    // like any other, or the public record skips an action the seller really took
    function test_UpdateListing_ToTheSamePriceStillEmitsAndChangesNothing() public {
        _list(TOKEN_ID, PRICE);

        vm.recordLogs();

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, PRICE);

        _assertOnlyItemUpdated(seller, TOKEN_ID, PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, PRICE, "a no-op reprice changed the price");
        assertEq(listing.seller, seller);

        // And the offer is still live at that very price
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // The whole point of a reprice: the new number is the one the marketplace enforces,
    // the one it quotes when refusing, and the one it books. A sale announced at the
    // price the listing was CREATED with would pay one amount and log another
    function test_UpdateListing_TheSaleAfterwardsUsesTheNewPriceThroughout() public {
        _list(TOKEN_ID, PRICE);
        uint256 raised = 2.5 ether;

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, raised);

        vm.expectRevert(_priceNotMet(TOKEN_ID, raised));
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        uint256 buyerBefore = buyer.balance;

        vm.expectEmit(true, true, true, true);
        emit ItemBought(buyer, address(nft), TOKEN_ID, seller, raised);

        vm.prank(buyer);
        marketplace.buyListing{value: raised}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(buyer.balance, buyerBefore - raised, "the buyer paid the wrong price");
        assertEq(marketplace.getProceeds(seller), raised, "the seller was booked wrong");
        assertEq(address(marketplace).balance, raised);
    }

    // A seller who edits the price four times in a row must end up with the fourth number
    // and nothing else: every intermediate one dies the moment the next lands, and a
    // buyer holding any of them is refused with the price that is really in force
    function test_UpdateListing_OnlyTheLastOfSeveralRepricesBinds() public {
        _list(TOKEN_ID, PRICE);

        uint256[4] memory chain = [uint256(2 ether), 0.3 ether, 7 ether, 1];

        for (uint256 i = 0; i < chain.length; i++) {
            vm.expectEmit(true, true, true, true);
            emit ItemUpdated(seller, address(nft), TOKEN_ID, chain[i]);

            vm.prank(seller);
            marketplace.updateListing(address(nft), TOKEN_ID, chain[i]);

            NftMarketplace.Listing memory step =
                marketplace.getListing(address(nft), TOKEN_ID);
            assertEq(step.price, chain[i], "an intermediate reprice was not stored");
            assertEq(step.seller, seller, "an intermediate reprice moved the seller");
        }

        uint256 binding = chain[3];
        uint256[4] memory dead = [PRICE, chain[0], chain[1], chain[2]];

        for (uint256 i = 0; i < dead.length; i++) {
            vm.expectRevert(_priceNotMet(TOKEN_ID, binding));
            vm.prank(buyer);
            marketplace.buyListing{value: dead[i]}(address(nft), TOKEN_ID);
        }

        vm.prank(buyer);
        marketplace.buyListing{value: binding}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), binding, "the wrong price was booked");
        assertEq(address(marketplace).balance, binding);
    }

    // Repricing is an assignment, not an adjustment: raising and then lowering back must
    // land exactly on the original number and still sell for it. A price that
    // accumulated, or that remembered its high-water mark, shows up only on a round trip
    function test_UpdateListing_UpThenBackDownRestoresTheOriginalOffer() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 10 ether);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 10 ether);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, PRICE, "the round trip did not land on the old price");
        assertEq(listing.seller, seller);

        // The raised price is gone from the enforcement, not merely from the view
        vm.expectRevert(_priceNotMet(TOKEN_ID, PRICE));
        vm.prank(buyer);
        marketplace.buyListing{value: 10 ether}(address(nft), TOKEN_ID);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // The update path stores a price of its own, so it must accept the whole legal range:
    // from the smallest value above the not-listed sentinel to the largest word the EVM
    // has. A narrower accumulator anywhere along it would truncate in silence
    function test_UpdateListing_AcceptsOneWeiAndTheLargestPossiblePrice() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 1 wei);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 1 wei);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, MAX_PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, MAX_PRICE, "the extreme price did not survive storage");
        assertEq(listing.seller, seller);

        // Unpayable, and refused quoting the real number rather than a truncated one
        vm.expectRevert(_priceNotMet(TOKEN_ID, MAX_PRICE));
        vm.prank(buyer);
        marketplace.buyListing{value: 1 ether}(address(nft), TOKEN_ID);

        // ...and the seller can walk it straight back down to something sellable
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 1 wei);

        vm.prank(buyer);
        marketplace.buyListing{value: 1 wei}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), 1 wei, "a dust sale booked wrong");
    }

    // A seller who granted the collection-wide approval never granted a per-token one, so
    // the reprice can only pass through the isApprovedForAll branch — the branch the 2024
    // contract did not have. Revoking it must stop further repricing on the spot
    function test_UpdateListing_WorksThroughACollectionWideApproval() public {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
        vm.stopPrank();

        // Nothing per-token was ever granted, so the other branch cannot be what passes
        assertEq(nft.getApproved(TOKEN_ID), address(0));

        vm.recordLogs();

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, NEW_PRICE);

        _assertOnlyItemUpdated(seller, TOKEN_ID, NEW_PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, NEW_PRICE);

        vm.prank(seller);
        nft.setApprovalForAll(address(marketplace), false);

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 3 ether);

        assertEq(
            marketplace.getListing(address(nft), TOKEN_ID).price,
            NEW_PRICE,
            "a refused reprice changed the price anyway"
        );
    }

    // ERC-721 clears the single-token approval on EVERY transfer, so a token that leaves
    // its owner's wallet and comes back is unrepriceable although the listing, the seller
    // and the owner all look unchanged. Re-approving is the whole fix, and must suffice
    function test_UpdateListing_NeedsAFreshApprovalAfterATransferRoundTrip() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);
        vm.prank(stranger);
        nft.transferFrom(stranger, seller, TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), seller);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, seller);
        assertEq(nft.getApproved(TOKEN_ID), address(0), "the transfer kept an approval");

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, NEW_PRICE);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);

        vm.prank(seller);
        nft.approve(address(marketplace), TOKEN_ID);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, NEW_PRICE);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, NEW_PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: NEW_PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), NEW_PRICE);
        assertEq(marketplace.getProceeds(stranger), 0, "the middleman was paid");
    }

    // Almost every collection numbers its tokens from zero, so the same id in two of them
    // is the ordinary case rather than an exotic one. A listing keyed by tokenId alone
    // would let one collection's reprice rewrite the other collection's asking price
    function test_UpdateListing_DoesNotReachTheSameIdInAnotherCollection() public {
        MockNft second = new MockNft();
        second.mint(stranger, TOKEN_ID);

        _list(TOKEN_ID, PRICE);

        vm.startPrank(stranger);
        second.approve(address(marketplace), TOKEN_ID);
        marketplace.listItem(address(second), TOKEN_ID, NEIGHBOUR_PRICE);
        vm.stopPrank();

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, NEW_PRICE);

        NftMarketplace.Listing memory twin =
            marketplace.getListing(address(second), TOKEN_ID);
        assertEq(twin.price, NEIGHBOUR_PRICE, "a reprice crossed collections");
        assertEq(twin.seller, stranger, "a reprice moved the other collection's seller");

        // ...and the same holds in the other direction
        vm.prank(stranger);
        marketplace.updateListing(address(second), TOKEN_ID, 6 ether);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, NEW_PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, seller);

        // Each sale then pays its own seller its own price
        vm.startPrank(buyer);
        marketplace.buyListing{value: NEW_PRICE}(address(nft), TOKEN_ID);
        marketplace.buyListing{value: 6 ether}(address(second), TOKEN_ID);
        vm.stopPrank();

        assertEq(marketplace.getProceeds(seller), NEW_PRICE);
        assertEq(marketplace.getProceeds(stranger), 6 ether);
    }

    // The order book holds every seller's listings in one mapping. One seller repricing
    // must not disturb another's row, another's approval, or who a later sale pays
    function test_UpdateListing_LeavesAnotherSellersListingAlone() public {
        nft.mint(stranger, SECOND_SELLER_TOKEN);

        _list(TOKEN_ID, PRICE);
        _listAs(stranger, SECOND_SELLER_TOKEN, PRICE);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, NEW_PRICE);

        NftMarketplace.Listing memory theirs =
            marketplace.getListing(address(nft), SECOND_SELLER_TOKEN);
        assertEq(theirs.price, PRICE, "one seller's reprice moved another's price");
        assertEq(theirs.seller, stranger);
        assertEq(
            nft.getApproved(SECOND_SELLER_TOKEN),
            address(marketplace),
            "another seller's approval was disturbed"
        );

        vm.prank(stranger);
        marketplace.updateListing(address(nft), SECOND_SELLER_TOKEN, 5 ether);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, NEW_PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: 5 ether}(address(nft), SECOND_SELLER_TOKEN);

        assertEq(marketplace.getProceeds(stranger), 5 ether);
        assertEq(marketplace.getProceeds(seller), 0, "the wrong seller was paid");
        assertEq(
            marketplace.getListing(address(nft), TOKEN_ID).price,
            NEW_PRICE,
            "the sale cleared the wrong row"
        );
    }

    // Whoever owns a token is an ordinary seller, so the buyer of one sale must be able
    // to list and reprice in their own name — and their reprice must reach neither the
    // credit the previous seller is still owed nor the payout address of the new listing
    function test_UpdateListing_ByTheNewOwnerAfterAResale() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, NEW_PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: NEW_PRICE}(address(nft), TOKEN_ID);

        vm.startPrank(buyer);
        nft.approve(address(marketplace), TOKEN_ID);
        marketplace.listItem(address(nft), TOKEN_ID, 3 ether);
        vm.stopPrank();

        vm.expectEmit(true, true, true, true);
        emit ItemUpdated(buyer, address(nft), TOKEN_ID, 0.5 ether);

        vm.prank(buyer);
        marketplace.updateListing(address(nft), TOKEN_ID, 0.5 ether);

        assertEq(
            marketplace.getListing(address(nft), TOKEN_ID).seller,
            buyer,
            "the reprice handed the listing back to the previous seller"
        );

        vm.deal(seller, 1 ether);
        vm.prank(seller);
        marketplace.buyListing{value: 0.5 ether}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), seller);
        assertEq(marketplace.getProceeds(buyer), 0.5 ether);
        assertEq(
            marketplace.getProceeds(seller),
            NEW_PRICE,
            "the first sale's credit changed"
        );
        assertEq(address(marketplace).balance, NEW_PRICE + 0.5 ether);
    }

    // A seller can be a contract — a vault, a treasury, a game. It calls in its own name,
    // so a check written against tx.origin instead of msg.sender would refuse it here
    // while passing every test whose seller is a wallet
    function test_UpdateListing_AcceptsAContractSellerActingForItself() public {
        nft.mint(address(this), CONTRACT_SELLER_TOKEN);
        nft.approve(address(marketplace), CONTRACT_SELLER_TOKEN);
        marketplace.listItem(address(nft), CONTRACT_SELLER_TOKEN, PRICE);

        vm.expectEmit(true, true, true, true);
        emit ItemUpdated(address(this), address(nft), CONTRACT_SELLER_TOKEN, NEW_PRICE);

        marketplace.updateListing(address(nft), CONTRACT_SELLER_TOKEN, NEW_PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), CONTRACT_SELLER_TOKEN);
        assertEq(listing.price, NEW_PRICE);
        assertEq(listing.seller, address(this), "the contract seller was not recorded");

        vm.prank(buyer);
        marketplace.buyListing{value: NEW_PRICE}(address(nft), CONTRACT_SELLER_TOKEN);

        assertEq(nft.ownerOf(CONTRACT_SELLER_TOKEN), buyer);
        assertEq(marketplace.getProceeds(address(this)), NEW_PRICE);
        assertEq(marketplace.getProceeds(seller), 0, "the wrong seller was credited");
    }

    // The named chains above use prices we chose; this asks the same of any three. Only
    // the last number may ever move the token, and it must move it for exactly itself
    function testFuzz_UpdateListing_OnlyTheLastPriceOfAChainBinds(
        uint96 rawListed,
        uint96 rawMiddle,
        uint96 rawFinal
    ) public {
        uint256 listed = _bound(uint256(rawListed), 1, 30 ether);
        uint256 middle = _bound(uint256(rawMiddle), 1, 30 ether);
        uint256 asked = _bound(uint256(rawFinal), 1, 30 ether);
        vm.assume(listed != asked && middle != asked);

        _list(TOKEN_ID, listed);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, middle);
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, asked);

        vm.expectRevert(_priceNotMet(TOKEN_ID, asked));
        vm.prank(buyer);
        marketplace.buyListing{value: listed}(address(nft), TOKEN_ID);

        vm.expectRevert(_priceNotMet(TOKEN_ID, asked));
        vm.prank(buyer);
        marketplace.buyListing{value: middle}(address(nft), TOKEN_ID);

        vm.prank(buyer);
        marketplace.buyListing{value: asked}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), asked, "the wrong price was booked");
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
    }
}
