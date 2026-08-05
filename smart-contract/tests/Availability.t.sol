// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Availability tests — the attacks that take things away instead of stealing them
//
//  Nothing is drained in this file. The damage is that something becomes IMPOSSIBLE: a
//  listing nobody can cancel and nobody can buy, a payout that can never be made, an
//  order book somebody floods. For the person holding the stuck listing that is as real
//  as a theft, and on a contract with no admin key and no pause switch there is nobody to
//  appeal to afterwards.
//
//  The root cause behind most of it is that every listing path reads ownership LIVE from
//  the collection through the isOwner modifier — so a collection that stops answering
//  takes its listings hostage, including the seller's own way out.
//
//  Covers:
//    - a listing whose token was burned, so ownerOf reverts instead of naming an owner
//    - a collection whose ownerOf breaks, and one that reverts on every call
//    - a token id re-minted after a burn, to a stranger and back to the seller
//    - ETH forced in by selfdestruct, which no missing receive() can refuse
//    - fifty listings from one actor, and what they cost everybody else
//    - a failed purchase and an unpayable seller, neither of which may block anyone else
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {BurnableNft} from "./mocks/BurnableNft.sol";
import {EthForcer} from "./mocks/EthForcer.sol";
import {MaliciousSeller} from "./mocks/MaliciousSeller.sol";
import {RejectingBuyer} from "./mocks/RejectingBuyer.sol";
import {
    NftMarketplace__ListingStale,
    NftMarketplace__NoProceeds,
    NftMarketplace__NotOwner,
    NftMarketplace__TransferFailed
} from "../src/NftMarketplace.sol";

contract AvailabilityTest is MarketplaceTestBase {

    uint256 private constant DEAD_TOKEN = 500;
    uint256 private constant STUCK_SELLER_TOKEN = 99;
    uint256 private constant INNOCENT_TOKEN = 900;
    uint256 private constant SPAM_FIRST_TOKEN = 1000;
    uint256 private constant SPAM_COUNT = 50;

    uint256 private constant FORCED_ETH = 3 ether;

    // A listing costs the same however full the book is; this is the slack allowed for
    // measurement noise, and it is far below what even one loop over 50 listings costs
    uint256 private constant GAS_TOLERANCE = 5_000;


    // FIXED: the seller lists, then the token is burned, so ownerOf reverts. Every route
    // to the listing used to go through isOwner; the seller's cancel now asks the
    // collection nothing at all, which is the only way out of this one.
    function test_Dos_BurnedTokenLeavesTheListingStrandedForever() public {
        BurnableNft dead = _listedBurnableCollection();

        dead.burn(DEAD_TOKEN);
        assertEq(dead.rawOwnerOf(DEAD_TOKEN), address(0), "the token should be gone");
        assertEq(
            marketplace.getListing(address(dead), DEAD_TOKEN).price,
            PRICE,
            "the listing should still be on the books at this point"
        );

        vm.prank(seller);
        try marketplace.cancelListing(address(dead), DEAD_TOKEN) {
            assertEq(
                marketplace.getListing(address(dead), DEAD_TOKEN).price,
                0,
                "cancel succeeded but the listing survived"
            );
        } catch {
            assertTrue(
                false,
                "the recorded seller cannot withdraw their own burned listing"
            );
        }
    }

    // FIXED: the same trap without a burn. A collection whose ownerOf reverts for any
    // reason at all — a bad upgrade, a frozen accessor — used to freeze every listing it
    // ever had, because no route skipped the question. The seller's cancel now does.
    function test_Dos_CollectionWithABrokenOwnerOfStrandsTheListing() public {
        BurnableNft broken = _listedBurnableCollection();

        broken.breakOwnerOf();

        vm.prank(seller);
        try marketplace.cancelListing(address(broken), DEAD_TOKEN) {
            assertEq(
                marketplace.getListing(address(broken), DEAD_TOKEN).price,
                0,
                "cancel succeeded but the listing survived"
            );
        } catch {
            assertTrue(
                false,
                "a broken ownerOf locks the seller out of their own listing"
            );
        }
    }

    // FIXED: the community half of the burned-token escape. The seller's route above is
    // useless when the seller is gone — and ownerOf reverting used to take the stranger
    // route down with it, because the staleness check needed an ANSWER to compare
    // against. A collection that cannot even answer has proved the listing dead better
    // than any answer could, so anybody may retire it.
    function test_Dos_AnybodyCanRetireAListingWhoseTokenWasBurned() public {
        BurnableNft dead = _listedBurnableCollection();
        dead.burn(DEAD_TOKEN);

        vm.prank(stranger);
        marketplace.cancelListing(address(dead), DEAD_TOKEN);

        assertEq(
            marketplace.getListing(address(dead), DEAD_TOKEN).price,
            0,
            "the stranger's cancel should have cleared the burned listing"
        );
    }

    // FIXED: the same standing against a collection whose ownerOf is broken outright —
    // the listing is exactly as dead, and the proof is exactly the same revert.
    function test_Dos_AnybodyCanRetireAListingOnABrokenCollection() public {
        BurnableNft broken = _listedBurnableCollection();
        broken.breakOwnerOf();

        vm.prank(stranger);
        marketplace.cancelListing(address(broken), DEAD_TOKEN);

        assertEq(
            marketplace.getListing(address(broken), DEAD_TOKEN).price,
            0,
            "the stranger's cancel should have cleared the stranded listing"
        );
    }

    // FIXED: a collection that reverts on EVERY call used to make the listing immortal —
    // unbuyable, so pure noise on the storefront, and uncancellable, so it stayed there.
    // The buyer half is proved first because that half always behaved correctly.
    function test_Dos_BrickedCollectionMakesTheListingImmortal() public {
        BurnableNft bricked = _listedBurnableCollection();

        bricked.brick();

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        try marketplace.buyListing{value: PRICE}(address(bricked), DEAD_TOKEN) {
            assertTrue(false, "a collection that cannot transfer still sold a token");
        } catch {
            assertEq(buyer.balance, buyerBefore, "the failed purchase kept the ETH");
        }

        vm.prank(seller);
        try marketplace.cancelListing(address(bricked), DEAD_TOKEN) {
            assertEq(
                marketplace.getListing(address(bricked), DEAD_TOKEN).price,
                0,
                "cancel succeeded but the listing survived"
            );
        } catch {
            assertTrue(
                false,
                "the seller cannot walk away from a listing on a dead collection"
            );
        }
    }

    // PROPERTY: a listing whose token no longer exists must never take a buyer's money.
    // Refusing the sale is the only acceptable answer, and it must leave the listing and
    // the buyer's balance exactly as they were.
    function test_Dos_BuyingABurnedTokenTakesNoMoney() public {
        BurnableNft dead = _listedBurnableCollection();
        dead.burn(DEAD_TOKEN);

        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        try marketplace.buyListing{value: PRICE}(address(dead), DEAD_TOKEN) {
            assertTrue(false, "a token that no longer exists was sold");
        } catch {
            assertEq(buyer.balance, buyerBefore, "the buyer paid for nothing");
            assertEq(
                marketplace.getListing(address(dead), DEAD_TOKEN).price,
                PRICE,
                "the refused purchase consumed the listing"
            );
        }
    }

    // PROPERTY: the strand must last only as long as the token is missing. Once the id
    // exists again, the escape hatch has to work — whoever holds the token can clear the
    // listing they inherited, and until they do nobody can buy it out from under them.
    function test_Dos_ReMintedTokenGivesTheNewOwnerAWayOut() public {
        BurnableNft coll = _listedBurnableCollection();

        coll.burn(DEAD_TOKEN);
        coll.mint(stranger, DEAD_TOKEN);

        // The old listing names the old seller, so it cannot sell somebody else's token
        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__ListingStale.selector, address(coll), DEAD_TOKEN
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(coll), DEAD_TOKEN);

        vm.prank(stranger);
        marketplace.cancelListing(address(coll), DEAD_TOKEN);

        assertEq(marketplace.getListing(address(coll), DEAD_TOKEN).price, 0);
    }

    // FINDING: a listing survives the destruction of its token, so a collection that
    // re-issues the id to the original seller brings the old price back to life with no
    // action from anybody. Whichever way the marketplace answers, the sale must be whole:
    // the buyer holds the token and the seller is credited, or nothing happened at all.
    function test_Dos_ReMintedTokenCanResurrectTheOldListing() public {
        BurnableNft coll = new BurnableNft();
        coll.mint(seller, DEAD_TOKEN);

        // A collection-wide approval is the common case, and it outlives the token
        vm.startPrank(seller);
        coll.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(coll), DEAD_TOKEN, PRICE);
        vm.stopPrank();

        coll.burn(DEAD_TOKEN);
        coll.mint(seller, DEAD_TOKEN);

        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        try marketplace.buyListing{value: PRICE}(address(coll), DEAD_TOKEN) {
            assertEq(coll.rawOwnerOf(DEAD_TOKEN), buyer, "the buyer paid for nothing");
            assertEq(marketplace.getProceeds(seller), PRICE, "the seller lost the money");
        } catch {
            assertEq(buyer.balance, buyerBefore, "refused, but the ETH is gone");
            assertEq(coll.rawOwnerOf(DEAD_TOKEN), seller, "refused, but the token moved");
        }
    }

    // PROPERTY: ETH pushed in by selfdestruct cannot be refused by any contract, so the
    // marketplace must simply carry on. A surplus balance must not disturb a sale, must
    // not leak into anybody's proceeds, and must not change what a payout hands over.
    function test_Dos_ForcedEthCannotStopTheMarketplaceWorking() public {
        _forceEthIntoMarketplace(FORCED_ETH);
        assertEq(address(marketplace).balance, FORCED_ETH, "the push did not land");

        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE, "forced ETH reached the books");

        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, sellerBefore + PRICE, "the payout was not the price");
        assertEq(address(marketplace).balance, FORCED_ETH, "the payout took surplus");
    }

    // FINDING: the forced ETH is stuck for good — withdrawProceeds pays from the books
    // and there is no sweep, so nobody, not even the sender, can ever take it out. The
    // practical lesson is about accounting: "balance EQUALS outstanding proceeds" is not
    // a property this contract can hold, because anyone can raise the balance for the
    // cost of the ETH they throw away. Only "balance is at least the proceeds owed" is
    // safe to assert on a live chain.
    function test_Dos_ForcedEthIsStuckAndBreaksExactBalanceAccounting() public {
        _forceEthIntoMarketplace(FORCED_ETH);

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        vm.prank(stranger);
        marketplace.withdrawProceeds();

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        vm.prank(seller);
        marketplace.withdrawProceeds();

        // Not even the address that pushed the ETH in can ask for it back
        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        marketplace.withdrawProceeds();

        assertEq(address(marketplace).balance, FORCED_ETH, "the surplus moved somewhere");
        assertGt(
            address(marketplace).balance,
            marketplace.getProceeds(seller) + marketplace.getProceeds(stranger),
            "an equality between balance and proceeds is not a safe invariant"
        );
    }

    // PROPERTY: the marketplace holds no list it ever walks, so one actor filling it with
    // listings must not make anybody else's transaction cost more. A single global loop
    // anywhere would show up here as a cost that grows with the size of the book.
    function test_Dos_ListingSpamDoesNotMakeListingCostGrow() public {
        // Warm the accounts up first, so the two measurements compare like with like
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.approve(address(marketplace), OTHER_TOKEN_ID);

        vm.prank(seller);
        uint256 gasBefore = gasleft();
        marketplace.listItem(address(nft), OTHER_TOKEN_ID, PRICE);
        uint256 smallBookCost = gasBefore - gasleft();

        _spamListings(SPAM_COUNT);

        nft.mint(buyer, INNOCENT_TOKEN);
        vm.prank(buyer);
        nft.approve(address(marketplace), INNOCENT_TOKEN);

        vm.prank(buyer);
        uint256 gasAfter = gasleft();
        marketplace.listItem(address(nft), INNOCENT_TOKEN, PRICE);
        uint256 bigBookCost = gasAfter - gasleft();

        assertLe(
            bigBookCost,
            smallBookCost + GAS_TOLERANCE,
            "listing got more expensive as the order book grew"
        );
        assertEq(marketplace.getListing(address(nft), INNOCENT_TOKEN).price, PRICE);
    }

    // PROPERTY: a flooded order book is a display problem, never a trading problem. With
    // fifty of one actor's listings in the way, an unrelated seller and buyer must still
    // complete the whole round trip: list, buy, get paid.
    function test_Dos_SpammedOrderBookStillLetsAnUnrelatedSaleThrough() public {
        _spamListings(SPAM_COUNT);

        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(seller.balance, sellerBefore + PRICE);
    }

    // PROPERTY: a purchase that blows up halfway must leave nothing behind — above all
    // not a reentrancy guard still marked as entered, which would wedge the whole
    // marketplace shut for everybody after one griefing transaction.
    function test_Dos_FailedPurchaseDoesNotLeaveTheMarketplaceLocked() public {
        _list(TOKEN_ID, PRICE);

        RejectingBuyer pickyBuyer = new RejectingBuyer(marketplace);
        vm.deal(address(pickyBuyer), 10 ether);

        vm.expectRevert();
        pickyBuyer.buy(address(nft), TOKEN_ID, PRICE);

        // The next buyer walks in and finds the listing exactly as it was
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // PROPERTY: proceeds are per seller, so a seller whose wallet cannot accept ETH must
    // strand only their own money. If one failing payout could hold up the queue, one
    // contract seller would be enough to freeze everybody's earnings.
    function test_Dos_SellerWhoCannotBePaidDoesNotBlockOtherPayouts() public {
        MaliciousSeller stuckSeller =
            new MaliciousSeller(MaliciousSeller.Mode.RejectEth, marketplace);

        nft.mint(address(stuckSeller), STUCK_SELLER_TOKEN);
        stuckSeller.listToken(nft, STUCK_SELLER_TOKEN, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), STUCK_SELLER_TOKEN);

        vm.expectRevert(NftMarketplace__TransferFailed.selector);
        stuckSeller.withdraw();

        // An unrelated seller sells and is paid while that money sits there unclaimable
        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, sellerBefore + PRICE, "a stuck payout blocked another");
        assertEq(
            address(marketplace).balance,
            PRICE,
            "only the unclaimable seller's money should be left"
        );
    }

    // PROPERTY: the whole class in one test. One hostile actor uses every lever they have
    // — forced ETH, fifty listings, a dead collection of their own, an attempt to squat
    // somebody else's slot — and an unrelated pair must still be able to do everything:
    // list, reprice, cancel, list again, buy and withdraw.
    function test_Dos_NoActorCanBreakAnUnrelatedUsersFullLifecycle() public {
        _forceEthIntoMarketplace(FORCED_ETH);
        _spamListings(SPAM_COUNT);

        BurnableNft dead = new BurnableNft();
        dead.mint(stranger, DEAD_TOKEN);
        vm.startPrank(stranger);
        dead.approve(address(marketplace), DEAD_TOKEN);
        marketplace.listItem(address(dead), DEAD_TOKEN, PRICE);
        vm.stopPrank();
        dead.brick();

        // Occupying the listing slot of a token they do not own would be the cheapest
        // denial of service of all, so it has to be refused
        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(stranger);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        _list(TOKEN_ID, PRICE);

        vm.startPrank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 2 ether);
        marketplace.cancelListing(address(nft), TOKEN_ID);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
        vm.stopPrank();

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(nft.ownerOf(TOKEN_ID), buyer, "an unrelated sale was blocked");
        assertEq(seller.balance, sellerBefore + PRICE, "an unrelated payout was blocked");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, FORCED_ETH, "the books drifted");
    }


    // A fresh collection holding one listed token of the seller's, ready to be broken in
    // whichever way the test that called this wants to break it
    function _listedBurnableCollection() private returns (BurnableNft coll) {
        coll = new BurnableNft();
        coll.mint(seller, DEAD_TOKEN);

        vm.startPrank(seller);
        coll.approve(address(marketplace), DEAD_TOKEN);
        marketplace.listItem(address(coll), DEAD_TOKEN, PRICE);
        vm.stopPrank();
    }

    // One actor floods the book with listings nobody asked for
    function _spamListings(uint256 count) private {
        for (uint256 i = 0; i < count; i++) {
            nft.mint(stranger, SPAM_FIRST_TOKEN + i);
        }

        vm.startPrank(stranger);
        nft.setApprovalForAll(address(marketplace), true);
        for (uint256 i = 0; i < count; i++) {
            marketplace.listItem(address(nft), SPAM_FIRST_TOKEN + i, PRICE);
        }
        vm.stopPrank();
    }

    // selfdestruct hands the balance over without the recipient running any code, so this
    // works on a contract that deliberately has no way to accept ETH
    function _forceEthIntoMarketplace(uint256 amount) private {
        vm.deal(address(this), amount);

        EthForcer forcer = new EthForcer{value: amount}();
        forcer.forceInto(payable(address(marketplace)));
    }
}
