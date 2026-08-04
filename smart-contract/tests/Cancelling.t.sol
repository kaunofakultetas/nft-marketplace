// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Cancel tests — taking a listing back off the market
//
//  Cancelling is guarded by CURRENT ownership rather than by seller, on purpose: that is
//  what lets someone clean up a listing they inherited together with the token.
//
//  A cancel is the one action that neither gives nor takes anything: no token moves, no
//  ETH changes hands, no approval is granted or revoked. Almost everything that can go
//  wrong with it therefore goes wrong OUTSIDE the row being deleted — a neighbouring
//  listing emptied, an earlier sale's proceeds disturbed, an approval quietly revoked so
//  that the next listItem reverts. That is what most of this file watches for.
//
//  Covers:
//    - the row is emptied completely: price AND seller, read back through getListing
//    - the token never moves, and the ERC-721 approval survives, so a re-list needs none
//    - cancelling asks the collection nothing about approval, so a revoked one is no bar
//    - proceeds, the marketplace balance, other tokens and other sellers stay untouched
//    - exactly one ItemCanceled, naming the CANCELLER rather than the recorded seller
//    - list / cancel cycles, a cancel after a reprice, a contract seller, a returned NFT
// ---------------------------------------------------------------------------------------

import {Vm} from "forge-std/Vm.sol";

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {MockNft} from "./mocks/MockNft.sol";
import {NftMarketplace, NftMarketplace__PriceNotMet} from "../src/NftMarketplace.sol";

contract CancellingTest is MarketplaceTestBase {

    uint256 private constant HIGHER_PRICE = 2 ether;
    uint256 private constant THIRD_PRICE = 3 ether;
    uint256 private constant SECOND_SELLER_TOKEN = 7;
    uint256 private constant CONTRACT_TOKEN_ID = 8;
    uint256 private constant NEVER_LISTED_TOKEN = 42;
    uint256 private constant CANCEL_ROUNDS = 3;

    // topic[0] plus the three indexed parameters the backend reads
    uint256 private constant EXPECTED_TOPIC_COUNT = 4;

    bytes32 private constant TOPIC_ITEM_CANCELED =
        keccak256("ItemCanceled(address,address,uint256)");


    // The fixture's _list always speaks for the shared seller and the shared collection;
    // the independence tests need any owner to list on any collection
    function _listAs(
        MockNft collection,
        address holder,
        uint256 tokenId,
        uint256 price
    ) private {
        vm.startPrank(holder);
        collection.approve(address(marketplace), tokenId);
        marketplace.listItem(address(collection), tokenId, price);
        vm.stopPrank();
    }

    // "The listing is gone" means BOTH fields: a price of 0 alone would still leave
    // a payee behind in the slot for the next lifecycle to inherit
    function _assertNoListing(address collection, uint256 tokenId) private {
        NftMarketplace.Listing memory listing =
            marketplace.getListing(collection, tokenId);
        assertEq(listing.price, 0, "a price survived the cancel");
        assertEq(listing.seller, address(0), "a seller survived the cancel");
    }

    // A cancel moves no token and calls nothing that logs, so the whole transaction must
    // contain precisely one log — anything more means it did something on the side
    function _onlyRecordedLog() private returns (Vm.Log memory) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "the cancel emitted more than its own event");
        return logs[0];
    }

    // An indexed address arrives left-padded in its topic
    function _topicAddress(bytes32 topic) private pure returns (address) {
        return address(uint160(uint256(topic)));
    }


    // The listing is gone afterwards and the event names who removed it. Nothing else the
    // marketplace tracks may move: withdrawing an offer is not a trade
    function test_CancelListing_ClearsListingAndEmits() public {
        _list(TOKEN_ID, PRICE);

        vm.expectEmit(true, true, true, true);
        emit ItemCanceled(seller, address(nft), TOKEN_ID);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), TOKEN_ID);
        assertEq(nft.ownerOf(TOKEN_ID), seller, "the token moved on a cancel");
        assertEq(marketplace.getProceeds(seller), 0, "a cancel paid the seller");
        assertEq(address(marketplace).balance, 0);
    }

    // The deliberate escape hatch for stale listings. Clearing it must not hand the token
    // back to the wallet that listed it, nor pay anyone for the offer being withdrawn
    function test_CancelListing_NewOwnerCanClearInheritedListing() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);

        vm.prank(stranger);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), TOKEN_ID);
        assertEq(nft.ownerOf(TOKEN_ID), stranger, "the cancel undid the transfer");
        assertEq(marketplace.getProceeds(seller), 0, "the withdrawn offer paid out");
        assertEq(marketplace.getProceeds(stranger), 0);
    }

    // NON-OBVIOUS: a cancel writes to the marketplace's mapping and touches the token
    // contract not at all, so the approval granted before the first listing is still
    // there — one that helpfully revoked it would make this second listItem revert
    function test_CancelListing_LeavesTheApprovalIntactSoARelistNeedsNone() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        assertEq(
            nft.getApproved(TOKEN_ID),
            address(marketplace),
            "the cancel revoked the approval"
        );

        // No approve() in between: this listing has to be accepted on the old approval
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, HIGHER_PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, HIGHER_PRICE);
        assertEq(listing.seller, seller);

        // And it is a working listing rather than a stored row: the sale completes
        vm.prank(buyer);
        marketplace.buyListing{value: HIGHER_PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), HIGHER_PRICE);
    }

    // The mirror image: cancelling asks the collection only WHO OWNS the token, never
    // whether the marketplace may move it. A seller who revoked the approval is left
    // with an unbuyable listing, and an approval check here would strand it for good
    function test_CancelListing_WorksAfterTheApprovalWasRevoked() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.approve(address(0), TOKEN_ID);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), TOKEN_ID);
        assertEq(nft.getApproved(TOKEN_ID), address(0), "the cancel re-granted approval");
        assertEq(nft.ownerOf(TOKEN_ID), seller);
    }

    // A cancel may empty its own row and nothing else. Everything the marketplace
    // remembers about an earlier sale, about a neighbouring collection, and about a token
    // nobody ever listed has to read exactly the same before and after
    function test_CancelListing_TouchesNothingButItsOwnRow() public {
        // An earlier sale, so there is a ledger entry and a balance that could be damaged
        _list(OTHER_TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), OTHER_TOKEN_ID);

        // A neighbour: another seller, another collection, the same tokenId
        MockNft other = new MockNft();
        other.mint(stranger, TOKEN_ID);
        _listAs(other, stranger, TOKEN_ID, HIGHER_PRICE);

        _list(TOKEN_ID, THIRD_PRICE);

        uint256 buyerBefore = buyer.balance;
        uint256 marketplaceBefore = address(marketplace).balance;

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), TOKEN_ID);

        // The earlier sale is untouched, in both the ledger and the ETH backing it
        assertEq(marketplace.getProceeds(seller), PRICE, "the cancel moved the ledger");
        assertEq(
            address(marketplace).balance, marketplaceBefore, "ETH left on a cancel"
        );
        assertEq(buyer.balance, buyerBefore, "the cancel refunded a past buyer");
        assertEq(nft.ownerOf(OTHER_TOKEN_ID), buyer, "a sold token came back");
        assertEq(nft.ownerOf(TOKEN_ID), seller);

        // The neighbour listing is untouched, price and payee both
        NftMarketplace.Listing memory neighbour =
            marketplace.getListing(address(other), TOKEN_ID);
        assertEq(neighbour.price, HIGHER_PRICE, "the cancel reached another collection");
        assertEq(neighbour.seller, stranger);
        assertEq(
            marketplace.getProceeds(stranger), 0, "an uninvolved seller was credited"
        );

        // And a token that never touched the market still reads as absent
        _assertNoListing(address(nft), NEVER_LISTED_TOKEN);
    }

    // The indexer rebuilds the market from logs alone, so the shape of the ONE log a
    // cancel produces is load-bearing: a second event would retire a listing twice, and
    // seller and collection swapped in the topics would retire the wrong row entirely
    function test_CancelListing_EmitsExactlyOneEventWithTheRightValues() public {
        _list(TOKEN_ID, PRICE);

        vm.recordLogs();
        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        Vm.Log memory log = _onlyRecordedLog();
        assertEq(log.emitter, address(marketplace), "somebody else logged the cancel");
        assertEq(log.topics[0], TOPIC_ITEM_CANCELED, "a different event was emitted");
        assertEq(log.topics.length, EXPECTED_TOPIC_COUNT, "indexed params changed");
        assertEq(_topicAddress(log.topics[1]), seller, "topic 1 is not the canceller");
        assertEq(
            _topicAddress(log.topics[2]),
            address(nft),
            "topic 2 is not the collection"
        );
        assertEq(uint256(log.topics[3]), TOKEN_ID, "topic 3 is not the tokenId");
        assertEq(log.data.length, 0, "a cancel carries no data");
    }

    // A listing is made by one address and may be cancelled by another, so ItemCanceled
    // names the CANCELLER and not the seller the listing recorded. The indexer must
    // therefore retire the row by (collection, tokenId), never by topic 1
    function test_CancelListing_ByTheNewOwnerNamesTheCanceller() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);

        // The two parties really do differ here, which is what makes the topic meaningful
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, seller);

        vm.recordLogs();
        vm.prank(stranger);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        Vm.Log memory log = _onlyRecordedLog();
        assertEq(log.topics[0], TOPIC_ITEM_CANCELED);
        assertEq(
            _topicAddress(log.topics[1]),
            stranger,
            "the event named the recorded seller, not the canceller"
        );
        assertEq(uint256(log.topics[3]), TOKEN_ID);
    }

    // A reprice and a cancel write to the same row, so the cancel must erase whatever the
    // last reprice left there — a price no ItemListed ever announced. The listing that
    // follows may then carry the new price and only the new price
    function test_CancelListing_AfterARepriceLeavesNeitherPriceBehind() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, HIGHER_PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), TOKEN_ID);

        _list(TOKEN_ID, THIRD_PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, THIRD_PRICE, "a price from before the cancel came back");
        assertEq(listing.seller, seller);

        // The repriced value is as dead as the original one: it buys nothing
        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector,
                address(nft),
                TOKEN_ID,
                THIRD_PRICE
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: HIGHER_PRICE}(address(nft), TOKEN_ID);

        vm.prank(buyer);
        marketplace.buyListing{value: THIRD_PRICE}(address(nft), TOKEN_ID);

        assertEq(marketplace.getProceeds(seller), THIRD_PRICE, "a stale price was paid");
    }

    // Sellers change their mind repeatedly, and every cycle has to begin from the same
    // empty row. A cancel that left a fragment behind would surface as the wrong price or
    // the wrong payee only in the second or third round, long after the code was reviewed
    function test_CancelListing_RelistCycleRepeatsCleanly() public {
        for (uint256 round = 1; round <= CANCEL_ROUNDS; round++) {
            uint256 price = round * 1 ether;

            _list(TOKEN_ID, price);

            NftMarketplace.Listing memory listing =
                marketplace.getListing(address(nft), TOKEN_ID);
            assertEq(listing.price, price, "a cycle inherited an older price");
            assertEq(listing.seller, seller);

            vm.prank(seller);
            marketplace.cancelListing(address(nft), TOKEN_ID);

            _assertNoListing(address(nft), TOKEN_ID);
            assertEq(nft.ownerOf(TOKEN_ID), seller, "a cycle moved the token");
            assertEq(marketplace.getProceeds(seller), 0, "a cancel credited the seller");
            assertEq(address(marketplace).balance, 0, "a cancel took money in");
        }

        // The token is not worn out by the cycles: the next listing sells normally
        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // A seller need not be a wallet: a DAO treasury, a vault or a game contract holds
    // tokens too. This test contract is the seller here, and every step has to behave as
    // it does for an EOA — nothing in the path may assume a caller with no code
    function test_CancelListing_ByAContractSellerBehavesLikeAWallet() public {
        nft.mint(address(this), CONTRACT_TOKEN_ID);

        nft.approve(address(marketplace), CONTRACT_TOKEN_ID);
        marketplace.listItem(address(nft), CONTRACT_TOKEN_ID, PRICE);

        assertEq(
            marketplace.getListing(address(nft), CONTRACT_TOKEN_ID).seller,
            address(this),
            "a contract was not recorded as the seller"
        );

        marketplace.cancelListing(address(nft), CONTRACT_TOKEN_ID);

        _assertNoListing(address(nft), CONTRACT_TOKEN_ID);
        assertEq(nft.ownerOf(CONTRACT_TOKEN_ID), address(this));

        // The approval survives for a contract seller too, so it can re-list unaided
        marketplace.listItem(address(nft), CONTRACT_TOKEN_ID, HIGHER_PRICE);

        assertEq(
            marketplace.getListing(address(nft), CONTRACT_TOKEN_ID).price, HIGHER_PRICE
        );
    }

    // While the token was away its seller could not retract the offer — cancelling is
    // gated on current ownership. The moment it comes home that has to be possible again,
    // or the abandoned offer would go live at a price its maker had given up on
    function test_CancelListing_OfATokenThatCameBackToItsSeller() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);
        vm.prank(stranger);
        nft.transferFrom(stranger, seller, TOKEN_ID);

        assertEq(nft.getApproved(TOKEN_ID), address(0), "the transfer kept the approval");

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), TOKEN_ID);
        assertEq(nft.getApproved(TOKEN_ID), address(0), "the cancel granted an approval");
        assertEq(nft.ownerOf(TOKEN_ID), seller);

        // Back on the market only on purpose: a fresh approval and a fresh price
        _list(TOKEN_ID, HIGHER_PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, HIGHER_PRICE, "the retracted price came back");
        assertEq(listing.seller, seller);
    }

    // Cancelling is keyed by the token, never by the person: one seller taking an offer
    // back must leave another seller's offer in the same collection standing, and the
    // money from it must still reach the seller who made it
    function test_CancelListing_LeavesAnotherSellersListingAlone() public {
        _list(TOKEN_ID, PRICE);

        nft.mint(stranger, SECOND_SELLER_TOKEN);
        _listAs(nft, stranger, SECOND_SELLER_TOKEN, HIGHER_PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        NftMarketplace.Listing memory survivor =
            marketplace.getListing(address(nft), SECOND_SELLER_TOKEN);
        assertEq(survivor.price, HIGHER_PRICE, "another seller was delisted");
        assertEq(survivor.seller, stranger, "another seller's payee changed");

        vm.prank(buyer);
        marketplace.buyListing{value: HIGHER_PRICE}(address(nft), SECOND_SELLER_TOKEN);

        assertEq(nft.ownerOf(SECOND_SELLER_TOKEN), buyer);
        assertEq(marketplace.getProceeds(stranger), HIGHER_PRICE);
        assertEq(marketplace.getProceeds(seller), 0, "the canceller was paid");
        assertEq(nft.ownerOf(TOKEN_ID), seller, "the cancelled token moved anyway");
    }

    // Cancelling takes no money, so it must refuse any that arrives with it. ETH accepted
    // here would sit in the contract backing nobody's proceeds — the accounting hole
    // the pull-payment ledger exists to avoid — and the refusal has to be total
    function test_CancelListing_RefusesEthSentWithIt() public {
        _list(TOKEN_ID, PRICE);
        vm.deal(seller, 1 ether);

        vm.prank(seller);
        (bool accepted, ) = address(marketplace).call{value: 1 ether}(
            abi.encodeWithSignature(
                "cancelListing(address,uint256)", address(nft), TOKEN_ID
            )
        );

        assertFalse(accepted, "a cancel accepted ETH");
        assertEq(address(marketplace).balance, 0, "the ETH stayed in the marketplace");
        assertEq(seller.balance, 1 ether, "the sender's ETH did not come back");

        // Nothing happened at all: the listing is still on the market
        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, PRICE, "the refused call cancelled anyway");
        assertEq(listing.seller, seller);
    }

    // The tests above pick neighbouring ids by hand; a row keyed carelessly could still
    // collide elsewhere in the 256-bit id space. Cancelling one arbitrary token must
    // leave the other exactly as it was, and still able to sell
    function testFuzz_CancelListing_NeverReachesAnotherToken(
        uint256 rawTokenId,
        uint96 rawPrice
    ) public {
        uint256 otherId = _bound(rawTokenId, 2, type(uint256).max);
        uint256 otherPrice = _bound(uint256(rawPrice), 1, 50 ether);

        nft.mint(seller, otherId);

        _list(TOKEN_ID, PRICE);
        _list(otherId, otherPrice);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        NftMarketplace.Listing memory survivor =
            marketplace.getListing(address(nft), otherId);
        assertEq(survivor.price, otherPrice, "the wrong row was deleted");
        assertEq(survivor.seller, seller);
        _assertNoListing(address(nft), TOKEN_ID);

        vm.deal(buyer, otherPrice);
        vm.prank(buyer);
        marketplace.buyListing{value: otherPrice}(address(nft), otherId);

        assertEq(nft.ownerOf(otherId), buyer);
        assertEq(marketplace.getProceeds(seller), otherPrice);
        assertEq(nft.ownerOf(TOKEN_ID), seller, "the cancelled token was sold");
    }
}
