// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Buy tests — the sale itself, from an honest buyer
//
//  The heart of the marketplace: one transaction moves a token one way and an exact price
//  the other, and it must leave every other listing, wallet, token and approval exactly
//  as it found them. Everything here is ordinary use by ordinary people — the attacks
//  live in Reentrancy.t.sol, HostileToken.t.sol, Economics.t.sol and Availability.t.sol.
//
//  Covers:
//    - the arithmetic of a sale, and the exact payment it insists on
//    - exactly one ItemBought, and exactly one token transfer, seller straight to buyer
//    - the single-token approval the marketplace held is cleared by that transfer, so the
//      new owner must grant their own before re-selling
//    - either approval style settles a sale, and either one may be revoked to stop it —
//      reversibly, since re-granting wakes the very same offer up
//    - listings, tokens and proceeds belonging to anybody else are left alone
//    - a contract buyer that acknowledges the token is treated exactly like a wallet
//    - the whole lifecycle from approval to payout, asserted at every step
//    - a refused purchase changes nothing at all, and the listing stays live
// ---------------------------------------------------------------------------------------

import {Vm} from "forge-std/Vm.sol";

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {MockNft} from "./mocks/MockNft.sol";
import {CrossFunctionAttacker} from "./mocks/CrossFunctionAttacker.sol";
import {
    NftMarketplace,
    NftMarketplace__NotApprovedForMarketplace,
    NftMarketplace__ListingStale,
    NftMarketplace__PriceNotMet
} from "../src/NftMarketplace.sol";

contract BuyingTest is MarketplaceTestBase {

    uint256 private constant SECOND_PRICE = 2 ether;
    uint256 private constant THIRD_PRICE = 3 ether;

    // Minted inside the tests that need a third token, so setUp stays as it is
    uint256 private constant SPARE_TOKEN_ID = 7;

    // Never minted and never listed: what an untouched mapping slot must keep reading as
    uint256 private constant NEVER_LISTED_TOKEN_ID = 424242;

    // The ERC-721 event the collection itself emits during a sale. Hashed here rather
    // than redeclared, so nothing in this file can drift away from the real signature.
    bytes32 private constant ERC721_TRANSFER_TOPIC =
        keccak256("Transfer(address,address,uint256)");


    // The fixture's _list grants a single-token approval; this is the same two steps with
    // the collection-wide one instead
    function _listWithBlanketApproval(uint256 tokenId, uint256 price) private {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(nft), tokenId, price);
        vm.stopPrank();
    }

    // _list always sells the fixture's collection as the fixture's seller; independence
    // tests need a second seller offering a second collection
    function _listAs(
        address holder,
        MockNft collection,
        uint256 tokenId,
        uint256 price
    ) private {
        vm.startPrank(holder);
        collection.approve(address(marketplace), tokenId);
        marketplace.listItem(address(collection), tokenId, price);
        vm.stopPrank();
    }

    // Both fields, always: a price of 0 with a seller left behind is still a half-listing
    function _assertNoListing(address collection, uint256 tokenId) private {
        NftMarketplace.Listing memory listing =
            marketplace.getListing(collection, tokenId);
        assertEq(listing.price, 0, "a price survived");
        assertEq(listing.seller, address(0), "a seller survived");
    }

    // An indexed address rides in a log topic as a left-padded 32-byte word
    function _topic(address account) private pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
    }


    // Token moves to the buyer, ETH is booked to the seller (not paid out yet), and the
    // event carries the seller the 2024 version omitted
    function test_BuyListing_TransfersTokenAndCreditsSeller() public {
        _list(TOKEN_ID, PRICE);

        vm.expectEmit(true, true, true, true);
        emit ItemBought(buyer, address(nft), TOKEN_ID, seller, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
        assertEq(address(marketplace).balance, PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
    }

    // Paying less was always refused, and the refusal must cost the buyer nothing and
    // leave the offer standing for the next attempt
    function test_BuyListing_RevertsOnUnderpayment() public {
        _list(TOKEN_ID, PRICE);

        uint256 buyerBefore = buyer.balance;

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector, address(nft), TOKEN_ID, PRICE
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE - 1}(address(nft), TOKEN_ID);

        assertEq(buyer.balance, buyerBefore, "the refused payment was kept");
        assertEq(address(marketplace).balance, 0, "the underpayment stayed behind");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(nft.ownerOf(TOKEN_ID), seller, "a refused sale moved the token");
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
    }

    // REGRESSION: the 2024 contract accepted an overpayment and credited the whole
    // msg.value to the seller while announcing the listing price
    function test_BuyListing_RevertsOnOverpayment() public {
        _list(TOKEN_ID, PRICE);

        uint256 buyerBefore = buyer.balance;

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector, address(nft), TOKEN_ID, PRICE
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE + 1}(address(nft), TOKEN_ID);

        // Not even the excess may be kept — the whole transaction has to unwind
        assertEq(buyer.balance, buyerBefore, "the refused payment was kept");
        assertEq(address(marketplace).balance, 0, "the overpayment stayed behind");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(nft.ownerOf(TOKEN_ID), seller, "a refused sale moved the token");
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
    }

    // REGRESSION: a listing whose seller moved the token used to fail with a bare
    // ERC-721 revert from inside the token contract
    function test_BuyListing_RevertsWhenSellerNoLongerOwnsTheToken() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);

        uint256 buyerBefore = buyer.balance;

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__ListingStale.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        // The new holder keeps the token, and the listing is refused rather than retired:
        // the buyer's money never moves in either direction
        assertEq(nft.ownerOf(TOKEN_ID), stranger, "a refused sale moved the token");
        assertEq(buyer.balance, buyerBefore, "the buyer paid for a stale listing");
        assertEq(marketplace.getProceeds(seller), 0, "a stale listing paid the seller");
        assertEq(address(marketplace).balance, 0);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
    }

    // Same for the other way a listing goes stale — and revoking is REVERSIBLE: the
    // listing is only asleep, so re-approving wakes the very same offer up again
    function test_BuyListing_RevertsWhenApprovalWasRevoked() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.approve(address(0), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        NftMarketplace.Listing memory asleep =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(asleep.price, PRICE, "the refusal retired the listing");
        assertEq(asleep.seller, seller);

        vm.prank(seller);
        nft.approve(address(marketplace), TOKEN_ID);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // Any payment that is not exactly the price is refused, whatever the numbers, and the
    // listing survives every refusal untouched
    function testFuzz_BuyListing_RequiresExactPayment(uint96 rawPrice, uint96 rawPayment)
        public
    {
        uint256 price = _bound(uint256(rawPrice), 1, 50 ether);
        uint256 payment = _bound(uint256(rawPayment), 0, 50 ether);
        vm.assume(payment != price);

        _list(TOKEN_ID, price);
        vm.deal(buyer, payment);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector, address(nft), TOKEN_ID, price
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: payment}(address(nft), TOKEN_ID);

        assertEq(buyer.balance, payment, "the refused payment was kept");
        assertEq(address(marketplace).balance, 0);
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, price);
    }


    // The ordinary lifecycle told as one story, asserted at every step: what each action
    // changes, and — more importantly — what it leaves exactly where it was
    function test_BuyListing_HappyPathFromApprovalToPayout() public {
        uint256 sellerStart = seller.balance;
        uint256 buyerStart = buyer.balance;

        _assertNoListing(address(nft), TOKEN_ID);
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0);

        // Approving is a promise made to the NFT contract alone: the marketplace has not
        // heard of the token yet
        vm.prank(seller);
        nft.approve(address(marketplace), TOKEN_ID);

        assertEq(nft.getApproved(TOKEN_ID), address(marketplace));
        _assertNoListing(address(nft), TOKEN_ID);

        // Listing records the offer and moves nothing at all
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, PRICE);
        assertEq(listing.seller, seller);
        assertEq(nft.ownerOf(TOKEN_ID), seller, "listing took custody of the token");
        assertEq(nft.balanceOf(seller), 2);
        assertEq(address(marketplace).balance, 0);

        // The sale: the token one way, the price into escrow
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(nft.balanceOf(seller), 1, "the seller kept a copy of the token");
        assertEq(nft.balanceOf(buyer), 1);
        _assertNoListing(address(nft), TOKEN_ID);
        assertEq(marketplace.getProceeds(seller), PRICE);
        assertEq(address(marketplace).balance, PRICE);
        assertEq(seller.balance, sellerStart, "the seller was paid before withdrawing");
        assertEq(buyer.balance, buyerStart - PRICE);

        // The payout, which is the only step that may move the seller's own wallet
        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, sellerStart + PRICE);
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0);
        assertEq(nft.ownerOf(TOKEN_ID), buyer, "the payout disturbed the token");
        _assertNoListing(address(nft), TOKEN_ID);
    }

    // The backend rebuilds the whole marketplace from logs, so a sale must announce
    // itself exactly once — and the token must move in ONE hop, seller straight to buyer:
    // a second Transfer would mean the marketplace took custody on the way
    function test_BuyListing_EmitsOneItemBoughtAndOneTokenTransfer() public {
        _list(TOKEN_ID, PRICE);

        vm.recordLogs();
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 marketplaceLogs;
        uint256 boughtLogs;
        uint256 transferLogs;

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(marketplace)) {
                marketplaceLogs++;

                if (logs[i].topics[0] == ItemBought.selector) {
                    boughtLogs++;
                    assertEq(logs[i].topics[1], _topic(buyer), "wrong buyer indexed");
                    assertEq(
                        logs[i].topics[2],
                        _topic(address(nft)),
                        "wrong collection indexed"
                    );
                    assertEq(logs[i].topics[3], bytes32(TOKEN_ID), "wrong id indexed");
                }
            } else if (
                logs[i].emitter == address(nft)
                    && logs[i].topics[0] == ERC721_TRANSFER_TOPIC
            ) {
                transferLogs++;
                assertEq(logs[i].topics[1], _topic(seller), "the token came from a hop");
                assertEq(logs[i].topics[2], _topic(buyer), "the token went elsewhere");
            }
        }

        assertEq(marketplaceLogs, 1, "a sale must emit exactly one marketplace event");
        assertEq(boughtLogs, 1, "the one marketplace event must be ItemBought");
        assertEq(transferLogs, 1, "the token must move in a single transfer");
    }

    // ERC-721 clears the single-token approval whenever a token moves, so the sale strips
    // the marketplace of all authority over what it just sold. The consequence the GUI
    // has to live with: a buyer wanting to re-sell must approve again first
    function test_BuyListing_ClearsTheApprovalSoTheBuyerMustGrantANewOne() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.getApproved(TOKEN_ID), address(0), "the sale left an approval");

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(buyer);
        marketplace.listItem(address(nft), TOKEN_ID, SECOND_PRICE);

        _assertNoListing(address(nft), TOKEN_ID);

        // With their own approval in place the new owner sells like anybody else
        vm.startPrank(buyer);
        nft.approve(address(marketplace), TOKEN_ID);
        marketplace.listItem(address(nft), TOKEN_ID, SECOND_PRICE);
        vm.stopPrank();

        NftMarketplace.Listing memory relisted =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(relisted.price, SECOND_PRICE);
        assertEq(relisted.seller, buyer, "the re-listing would pay the previous owner");
    }

    // The two ways of authorising the marketplace must produce the SAME sale, down to
    // every observable field. A second collection keeps the halves genuinely independent
    // instead of letting them share one listing slot
    function test_BuyListing_ApprovalStyleMakesNoDifferenceToTheSale() public {
        MockNft blanket = new MockNft();
        blanket.mint(seller, TOKEN_ID);

        _list(TOKEN_ID, PRICE);

        vm.startPrank(seller);
        blanket.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(blanket), TOKEN_ID, PRICE);
        vm.stopPrank();

        uint256 buyerBefore = buyer.balance;

        vm.startPrank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);
        marketplace.buyListing{value: PRICE}(address(blanket), TOKEN_ID);
        vm.stopPrank();

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(blanket.ownerOf(TOKEN_ID), buyer, "the blanket route sold differently");
        _assertNoListing(address(nft), TOKEN_ID);
        _assertNoListing(address(blanket), TOKEN_ID);

        // One seller, two collections, one ledger entry: the second sale adds to the
        // first rather than replacing it
        assertEq(marketplace.getProceeds(seller), 2 * PRICE);
        assertEq(address(marketplace).balance, 2 * PRICE);
        assertEq(buyer.balance, buyerBefore - 2 * PRICE);
    }

    // A sale touches one row of one collection. Everything else — the seller's other
    // listing and its approval, another seller's listing of the SAME id elsewhere, and
    // that seller's empty ledger — must be exactly as it was
    function test_BuyListing_LeavesOtherSellersListingsAndProceedsUntouched() public {
        address otherSeller = makeAddr("other seller");
        MockNft other = new MockNft();
        other.mint(otherSeller, TOKEN_ID);

        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, SECOND_PRICE);
        _listAs(otherSeller, other, TOKEN_ID, THIRD_PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        NftMarketplace.Listing memory kept =
            marketplace.getListing(address(nft), OTHER_TOKEN_ID);
        assertEq(kept.price, SECOND_PRICE, "the sale repriced a neighbour");
        assertEq(kept.seller, seller);
        assertEq(nft.ownerOf(OTHER_TOKEN_ID), seller, "a neighbouring token moved");
        assertEq(
            nft.getApproved(OTHER_TOKEN_ID),
            address(marketplace),
            "the sale disarmed the seller's other listing"
        );

        NftMarketplace.Listing memory foreign =
            marketplace.getListing(address(other), TOKEN_ID);
        assertEq(foreign.price, THIRD_PRICE, "the sale reached another collection");
        assertEq(foreign.seller, otherSeller);
        assertEq(other.ownerOf(TOKEN_ID), otherSeller);

        assertEq(marketplace.getProceeds(otherSeller), 0, "the wrong seller was paid");
        assertEq(marketplace.getProceeds(stranger), 0);
        assertEq(address(marketplace).balance, PRICE, "more than one price came in");
    }

    // Every view must still read empty for the parties and tokens the sale had nothing to
    // do with. address(0) most of all: a contract that deleted the listing before reading
    // its seller back would credit the zero address, and the money would be gone
    function test_BuyListing_UninvolvedListingsAndBalancesStillReadEmpty() public {
        MockNft untouched = new MockNft();
        untouched.mint(stranger, TOKEN_ID);

        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), NEVER_LISTED_TOKEN_ID);
        _assertNoListing(address(untouched), TOKEN_ID);

        assertEq(marketplace.getProceeds(address(0)), 0, "the price went to nobody");
        assertEq(marketplace.getProceeds(buyer), 0, "the buyer was credited a sale");
        assertEq(marketplace.getProceeds(stranger), 0);
        assertEq(marketplace.getProceeds(address(marketplace)), 0);
        assertEq(marketplace.getProceeds(address(nft)), 0);
    }

    // A buyer that is a contract is an ordinary buyer as long as it acknowledges the
    // token in onERC721Received. The mock is used UNARMED here — with no plan set, its
    // hook does nothing but accept, which is precisely an honest contract wallet
    function test_BuyListing_ContractBuyerThatAcceptsTheTokenIsJustABuyer() public {
        CrossFunctionAttacker wallet = new CrossFunctionAttacker(marketplace);
        vm.deal(address(wallet), PRICE);

        _list(TOKEN_ID, PRICE);

        wallet.buy(address(nft), TOKEN_ID, PRICE);

        assertEq(nft.ownerOf(TOKEN_ID), address(wallet));
        assertEq(address(wallet).balance, 0, "the contract paid the wrong amount");
        assertEq(marketplace.getProceeds(seller), PRICE);
        assertEq(address(marketplace).balance, PRICE);

        // And it may put the token straight back on the market like any other owner
        wallet.listToken(address(nft), TOKEN_ID, SECOND_PRICE);

        NftMarketplace.Listing memory relisted =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(relisted.price, SECOND_PRICE);
        assertEq(relisted.seller, address(wallet), "the contract was not the seller");
    }

    // Buying is permissionless: any funded address paying the exact price gets the token,
    // and the seller is credited the same amount whoever that address turns out to be
    function testFuzz_BuyListing_AnyFundedAddressCanBeTheBuyer(uint160 rawBuyer) public {
        // Kept above the precompiles and away from contracts and the cheatcode address:
        // those are the only addresses that do not behave like a wallet here
        uint256 bounded = _bound(uint256(rawBuyer), 0x10000, uint256(type(uint160).max));
        address anyBuyer = address(uint160(bounded));
        vm.assume(anyBuyer.code.length == 0);
        vm.assume(anyBuyer != address(vm));
        vm.assume(anyBuyer != seller);

        _list(TOKEN_ID, PRICE);
        vm.deal(anyBuyer, PRICE);

        vm.prank(anyBuyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), anyBuyer);
        assertEq(anyBuyer.balance, 0, "the buyer paid something other than the price");
        assertEq(marketplace.getProceeds(seller), PRICE, "the seller was not credited");
        assertEq(marketplace.getProceeds(anyBuyer), 0, "the buyer was credited a sale");
    }

    // A blanket approval is revoked with the same call that granted it, and that leaves
    // the listing standing but unsettleable — the asleep state a revoked single-token
    // approval produces, reached the other way round and woken the same way
    function test_BuyListing_RevertsWhenTheBlanketApprovalWasRevoked() public {
        _listWithBlanketApproval(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.setApprovalForAll(address(marketplace), false);

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        NftMarketplace.Listing memory refused =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(refused.price, PRICE, "the refusal deleted the listing");
        assertEq(refused.seller, seller, "the refusal forgot the seller");
        assertEq(nft.ownerOf(TOKEN_ID), seller, "the token moved anyway");

        vm.prank(seller);
        nft.setApprovalForAll(address(marketplace), true);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer, "the woken offer did not settle");
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // Both approval styles at once, then the per-token one dropped: the sale has to go
    // through on the blanket grant that is left. _isApprovedForMarketplace asks for
    // either, and this is the only arrangement in which an `and` there would show up
    function test_BuyListing_SettlesOnWhicheverApprovalIsLeft() public {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        nft.approve(address(marketplace), TOKEN_ID);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
        nft.approve(address(0), TOKEN_ID);
        vm.stopPrank();

        assertEq(nft.getApproved(TOKEN_ID), address(0), "the per-token grant survived");
        assertTrue(
            nft.isApprovedForAll(seller, address(marketplace)), "the blanket one went too"
        );

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer, "the surviving approval was not enough");
        assertEq(marketplace.getProceeds(seller), PRICE);
    }
}
