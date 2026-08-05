// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Economics tests — the games people play when nothing is technically broken
//
//  Every transaction in this file is valid. No guard fails, no ETH is stolen and no
//  invariant breaks — and yet somebody profits or the public record lies. The whole
//  history of this marketplace is four events, so an indexer that trusts them reports
//  whatever the traders make them say. And a price is only true until the seller moves
//  it, which the buyer finds out one block too late.
//
//  Covers:
//    - wash trading, by the seller directly and through a second wallet they control
//    - front-running a purchase: the seller cancels, reprices upward, reprices downward
//    - two buyers racing for the same listing
//    - griefing the order book with a dust price, an absurd price, unfillable bait
//    - being paid twice for one token, and the listing that never expires
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {
    NftMarketplace__NotApprovedForMarketplace,
    NftMarketplace__NotListed,
    NftMarketplace__NotOwner,
    NftMarketplace__PriceNotMet
} from "../src/NftMarketplace.sol";

contract EconomicsTest is MarketplaceTestBase {

    // PROPERTY: a seller must not be able to buy their own listing — it moves nothing,
    // costs only gas, and inflates the marketplace's sales and volume statistics.
    // FIXED: buyListing compares the two and reverts with SellerCannotBuy.
    function test_Attack_SellerBuysTheirOwnListingToFakeVolume() public {
        _list(TOKEN_ID, PRICE);
        vm.deal(seller, 10 ether);

        vm.prank(seller);
        try marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID) {
            assertTrue(false, "the seller was able to buy their own listing");
        } catch {
            // refused, as it should be
        }
    }

    // The reason the test above is only half a defence: with a second wallet the same
    // person controls, buyer and seller are different addresses and every check passes.
    // Documented, not demanded — no on-chain rule can tell these two apart.
    function test_Attack_WashTradeThroughASecondWalletIsIndistinguishable() public {
        address washer = makeAddr("the seller's other wallet");
        vm.deal(washer, 10 ether);

        uint256 pairBefore = seller.balance + washer.balance;

        // Round one is an ordinary sale, right down to the event the indexer stores
        _list(TOKEN_ID, PRICE);

        vm.expectEmit(true, true, true, true);
        emit ItemBought(washer, address(nft), TOKEN_ID, seller, PRICE);

        vm.prank(washer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        // Round two: the token goes home and is sold again at the very same price
        vm.prank(washer);
        nft.transferFrom(washer, seller, TOKEN_ID);
        _list(TOKEN_ID, PRICE);

        vm.prank(washer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        // Two full-price sales are on the public record...
        assertEq(marketplace.getProceeds(seller), 2 * PRICE);

        vm.prank(seller);
        marketplace.withdrawProceeds();

        // ...while the pair is exactly as rich as it started: the volume was manufactured
        assertEq(
            seller.balance + washer.balance,
            pairBefore,
            "a wash trade should move no value between the two wallets"
        );
        assertEq(nft.ownerOf(TOKEN_ID), washer);
    }

    // PROPERTY: a buyer who loses the race to the seller's cancel must fail cleanly —
    // no token, no charge, nothing booked to anybody. Losing costs gas and only gas.
    function test_FrontRun_SellerCancelsWhileTheBuyIsInFlight() public {
        _list(TOKEN_ID, PRICE);
        uint256 buyerBefore = buyer.balance;

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(buyer.balance, buyerBefore, "the buyer paid for a cancelled listing");
        assertEq(nft.ownerOf(TOKEN_ID), seller);
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0);
    }

    // PROPERTY: a buyer must never silently pay more than the price they signed for. The
    // exact-payment rule is what makes a front-run reprice visible instead of expensive —
    // the raised price can only be paid by a buyer who deliberately signs for it.
    function test_FrontRun_SellerRepricesUpwardBeforeTheBuyLands() public {
        _list(TOKEN_ID, PRICE);
        uint256 raised = PRICE * 2;
        uint256 buyerBefore = buyer.balance;

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, raised);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector, address(nft), TOKEN_ID, raised
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(buyer.balance, buyerBefore, "the buyer was charged the raised price");
        assertEq(nft.ownerOf(TOKEN_ID), seller);

        // The only way past a reprice is a fresh, informed decision by the buyer
        vm.prank(buyer);
        marketplace.buyListing{value: raised}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(buyer.balance, buyerBefore - raised);
    }

    // The honest cost of the exact-payment rule: even a price CUT invalidates a purchase
    // already in flight, because the payment no longer matches. The alternative — accept
    // anything at or above the price and refund the difference — would trade this away.
    function test_FrontRun_SellerRepricesDownwardAndTheInFlightBuyStillFails() public {
        _list(TOKEN_ID, PRICE);
        uint256 cut = PRICE / 2;
        uint256 buyerBefore = buyer.balance;

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, cut);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector, address(nft), TOKEN_ID, cut
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        // Failing is a usability cost, never a financial one — the money never left
        assertEq(buyer.balance, buyerBefore, "the buyer lost ETH on a rejected buy");
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, cut);

        // Resending at the new, lower price is all it takes
        vm.prank(buyer);
        marketplace.buyListing{value: cut}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(buyer.balance, buyerBefore - cut);
    }

    // PROPERTY: a listing fills exactly once. The buyer who loses the race must keep
    // every wei, and the seller must not be paid twice for one token.
    function test_Ordering_TwoBuyersRaceAndOnlyOneCanWin() public {
        _list(TOKEN_ID, PRICE);
        vm.deal(stranger, 10 ether);
        uint256 loserBefore = stranger.balance;

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(stranger);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer, "the wrong buyer got the token");
        assertEq(stranger.balance, loserBefore, "the losing buyer was charged");
        assertEq(marketplace.getProceeds(seller), PRICE, "the seller was paid twice");
        assertEq(address(marketplace).balance, PRICE);
    }

    // PROPERTY: a sale is final the moment it lands. A seller who tried to cancel and
    // lost the race must not be able to take the token back or keep it and the money.
    function test_Ordering_SellerCannotUndoASaleThatAlreadyLanded() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // PROPERTY: a seller who dumps their OWN token at dust moves only their own price.
    // Every other listing keeps its asking price and still has to be paid in full.
    function test_Grief_ListingAtOneWeiHarmsNobodyElse() public {
        _list(TOKEN_ID, 1);
        _list(OTHER_TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: 1}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), 1, "a dust sale paid more than dust");

        // The neighbouring listing is untouched by its neighbour's fire sale
        assertEq(marketplace.getListing(address(nft), OTHER_TOKEN_ID).price, PRICE);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector, address(nft), OTHER_TOKEN_ID, PRICE
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: 1}(address(nft), OTHER_TOKEN_ID);
    }

    // PROPERTY: an unpayable asking price is merely unpayable. It must not overflow the
    // proceeds books, block the rest of the market, or lock the token it names.
    function test_Grief_AbsurdPriceIsUnbuyableAndBlocksNothing() public {
        uint256 absurd = type(uint256).max;

        _list(TOKEN_ID, absurd);
        _list(OTHER_TOKEN_ID, PRICE);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector, address(nft), TOKEN_ID, absurd
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(marketplace.getProceeds(seller), 0, "an unbuyable listing paid out");

        // The rest of the book trades exactly as before
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), OTHER_TOKEN_ID);
        assertEq(nft.ownerOf(OTHER_TOKEN_ID), buyer);

        // And the token is not stuck: its owner can take it off the market
        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
    }

    // PROPERTY: bait that can never be filled must cost the buyers who bite nothing but
    // gas. What it does cost is the ORDER BOOK — a reverted buy cannot prune anything,
    // so only the griefer themselves can ever clear the listing the indexer advertises.
    function test_Grief_UnfillableBaitListingTakesNobodysMoney() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.approve(address(0), TOKEN_ID);

        uint256 buyerBefore = buyer.balance;

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(buyer.balance, buyerBefore, "a failed buy still took the money");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
    }

    // PROPERTY: one token, one payment. Once sold, the seller can neither re-list what
    // they no longer own nor revive the consumed listing by repricing it.
    function test_Attack_SellerCannotBePaidTwiceForOneToken() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, PRICE);

        assertEq(marketplace.getProceeds(seller), PRICE, "the seller was paid twice");
        assertEq(address(marketplace).balance, PRICE);
        assertEq(nft.ownerOf(TOKEN_ID), buyer);
    }

    // A listing has no deadline, so a price signed long ago still binds: a forgotten
    // listing is free money for the first passer-by once the floor moves above it. The
    // seller's only defence is remembering to cancel — documented, not demanded.
    function test_Ordering_ListingsNeverExpireSoAnOldPriceStaysBinding() public {
        _list(TOKEN_ID, PRICE);

        vm.warp(block.timestamp + 365 days);
        vm.roll(block.number + 2_600_000);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // PROPERTY: the house takes no cut and leaves no dust. Whatever buyers pay is
    // exactly what the seller can withdraw, at any prices, across several sales.
    function testFuzz_Economics_BuyersPayExactlyWhatTheSellerReceives(
        uint96 rawFirst,
        uint96 rawSecond
    ) public {
        uint256 firstPrice = _bound(uint256(rawFirst), 1, 40 ether);
        uint256 secondPrice = _bound(uint256(rawSecond), 1, 40 ether);

        uint256 sellerBefore = seller.balance;
        vm.deal(buyer, firstPrice + secondPrice);

        _list(TOKEN_ID, firstPrice);
        vm.prank(buyer);
        marketplace.buyListing{value: firstPrice}(address(nft), TOKEN_ID);

        _list(OTHER_TOKEN_ID, secondPrice);
        vm.prank(buyer);
        marketplace.buyListing{value: secondPrice}(address(nft), OTHER_TOKEN_ID);

        assertEq(buyer.balance, 0, "the buyer was charged more than the two prices");
        assertEq(marketplace.getProceeds(seller), firstPrice + secondPrice);
        assertEq(address(marketplace).balance, firstPrice + secondPrice);

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(
            seller.balance,
            sellerBefore + firstPrice + secondPrice,
            "a cut went missing between the buyer and the seller"
        );
        assertEq(address(marketplace).balance, 0, "ETH was left behind");
    }
}
