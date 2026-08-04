// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Proceeds security — the money the marketplace custodies between sale and payout
//
//  A sale does not pay the seller: it BOOKS the ETH inside this contract and waits for
//  withdrawProceeds. Between those two moments the marketplace holds other people's
//  money, and the payout itself hands control to whoever is being paid. That is where
//  this file attacks — hostile payees trying to break, starve or hijack a withdrawal,
//  and the arithmetic that decides who is owed what while several sellers share one
//  contract balance.
//
//  Covers:
//    - a payee whose receive() returns megabytes of data (the return bomb)
//    - a payee whose receive() burns every unit of gas the payout forwards
//    - a payee that refuses ETH outright — the sale it was paid for must still stand
//    - isolation: one seller's withdrawal never reaches another seller's money
//    - accumulation across several sales to several buyers, settled in one withdrawal
//    - custody: the marketplace holds ETH and never a token
//    - ETH arriving outside the books, by mistake or by force
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {GasBurningSeller} from "./mocks/GasBurningSeller.sol";
import {MaliciousSeller} from "./mocks/MaliciousSeller.sol";
import {ReturnBombSeller} from "./mocks/ReturnBombSeller.sol";
import {
    NftMarketplace__NoProceeds,
    NftMarketplace__TransferFailed
} from "../src/NftMarketplace.sol";

contract ProceedsSecurityTest is MarketplaceTestBase {

    uint256 private constant THIRD_TOKEN = 2;
    uint256 private constant PICKY_SELLER_TOKEN = 43;
    uint256 private constant BOMB_TOKEN = 44;
    uint256 private constant BURNER_TOKEN = 45;
    uint256 private constant SECOND_SELLER_TOKEN = 46;

    // One mebibyte of returndata: expanding memory that far costs the payee roughly 2.2M
    // gas, and a caller that copied it would have to pay about the same again
    uint256 private constant RETURN_BOMB_BYTES = 128 * 1024;

    // Enough for the whole withdrawal INCLUDING the payee building its buffer, but
    // chosen so the 1/64th the caller keeps back could never copy that buffer: if the
    // withdrawal survives on this budget, no copy happened
    uint256 private constant BOMB_GAS_BUDGET = 400_000;

    // Enough for the burner to spin through and still leave the marketplace its 1/64
    uint256 private constant BURN_GAS_BUDGET = 2_000_000;


    // PROPERTY: how much data a payee returns is the payee's business and must not decide
    // whether they get paid. withdrawProceeds writes the result as (bool sent, ), which
    // compiles WITHOUT a returndatacopy — the budget here is deliberately too small for a
    // second copy of the megabyte, so refactoring to (bool, bytes memory) turns this red.
    function test_Attack_ReturnBombPayeeCannotStarveTheWithdrawalOfGas() public {
        // Sizing matters: memory expansion is symmetric, so a buffer too big for the
        // caller to copy is also too big for the payee to build — an unbounded bomb just
        // makes the payee revert on itself, which proves nothing about the caller.
        ReturnBombSeller bomb = new ReturnBombSeller(marketplace, RETURN_BOMB_BYTES);

        nft.mint(address(bomb), BOMB_TOKEN);
        bomb.listToken(nft, BOMB_TOKEN, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), BOMB_TOKEN);

        bomb.withdraw{gas: BOMB_GAS_BUDGET}();

        assertEq(address(bomb).balance, PRICE, "the payout never reached the payee");
        assertEq(marketplace.getProceeds(address(bomb)), 0);
        assertEq(address(marketplace).balance, 0, "custody kept money it had paid out");
    }

    // PROPERTY: a payee that consumes everything forwarded to it can lock up only its OWN
    // money. The failed call must roll the payout back rather than zero the ledger, and
    // every other seller must still be able to walk away with theirs.
    function test_Attack_PayeeThatBurnsAllForwardedGasOnlyHarmsItself() public {
        GasBurningSeller burner = new GasBurningSeller(marketplace);

        nft.mint(address(burner), BURNER_TOKEN);
        burner.listToken(nft, BURNER_TOKEN, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), BURNER_TOKEN);

        // An honest seller is owed money out of the same contract balance
        _list(TOKEN_ID, PRICE);
        _buyFrom(buyer, TOKEN_ID, PRICE);
        uint256 sellerBefore = seller.balance;

        // The cap is what makes the burn finite; the marketplace still keeps the 1/64
        // EIP-150 holds back, which is what lets it report the failure properly
        vm.expectRevert(NftMarketplace__TransferFailed.selector);
        burner.withdraw{gas: BURN_GAS_BUDGET}();

        assertEq(marketplace.getProceeds(address(burner)), PRICE, "ledger was zeroed");
        assertEq(address(burner).balance, 0);

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, sellerBefore + PRICE, "an honest payout was blocked");
        assertEq(address(marketplace).balance, PRICE, "only the burner's money is stuck");
    }

    // PROPERTY: a seller who cannot receive ETH breaks only their OWN payout. The sale
    // itself already happened and must stand — this is what pull payments buy us.
    function test_Attack_SellerContractThatRefusesEthCannotUndoTheSale() public {
        MaliciousSeller pickySeller =
            new MaliciousSeller(MaliciousSeller.Mode.RejectEth, marketplace);

        nft.mint(address(pickySeller), PICKY_SELLER_TOKEN);
        pickySeller.listToken(nft, PICKY_SELLER_TOKEN, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), PICKY_SELLER_TOKEN);

        // The buyer got the token regardless of the seller's broken wallet
        assertEq(nft.ownerOf(PICKY_SELLER_TOKEN), buyer);

        vm.expectRevert(NftMarketplace__TransferFailed.selector);
        pickySeller.withdraw();

        // And the money is still theirs to claim once they can accept it
        assertEq(marketplace.getProceeds(address(pickySeller)), PRICE);
    }

    // PROPERTY: ETH cannot be stranded in the marketplace outside the proceeds books —
    // there is no receive() or fallback(), so a plain transfer is refused
    function test_Attack_PlainEthTransfersAreRefused() public {
        vm.deal(stranger, 5 ether);

        vm.prank(stranger);
        (bool accepted, ) = address(marketplace).call{value: 1 ether}("");

        assertFalse(accepted, "the marketplace accepted unaccounted ETH");
        assertEq(address(marketplace).balance, 0);
    }

    // Documentation rather than a demand: a selfdestructing contract can push ETH into
    // ANY address and no code can refuse it, so the balance is not something this
    // contract fully controls (vm.deal models exactly that). What MUST hold is that the
    // books never notice — a windfall belongs to nobody and stays where it lands.
    function test_Attack_ForceFedEthNeverBecomesWithdrawableProceeds() public {
        _list(TOKEN_ID, PRICE);
        _buyFrom(buyer, TOKEN_ID, PRICE);

        vm.deal(address(marketplace), address(marketplace).balance + 5 ether);

        assertEq(marketplace.getProceeds(seller), PRICE, "a gift inflated the ledger");
        assertEq(marketplace.getProceeds(stranger), 0);

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        vm.prank(stranger);
        marketplace.withdrawProceeds();

        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        marketplace.withdrawProceeds();

        // Exactly what was earned, never the windfall on top of it
        assertEq(seller.balance, sellerBefore + PRICE, "the seller was paid the gift");
        assertEq(address(marketplace).balance, 5 ether, "stranded, as it must be");
    }

    // PROPERTY: the LEDGER decides what a caller may take, never the contract balance.
    // Somebody who has sold nothing must be refused while there is plenty of money in
    // the contract — the classic "the balance is not yours" confusion.
    function test_Attack_SellerWithZeroProceedsCannotDrainAnothersMoney() public {
        _list(TOKEN_ID, PRICE);
        _buyFrom(buyer, TOKEN_ID, PRICE);

        uint256 custodyBefore = address(marketplace).balance;
        uint256 strangerBefore = stranger.balance;

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        vm.prank(stranger);
        marketplace.withdrawProceeds();

        // Having PAID into the contract is no better a claim than never touching it
        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        vm.prank(buyer);
        marketplace.withdrawProceeds();

        assertEq(address(marketplace).balance, custodyBefore, "custody was raided");
        assertEq(stranger.balance, strangerBefore);
        assertEq(marketplace.getProceeds(seller), PRICE, "the seller was short-changed");
    }

    // PROPERTY: proceeds are per-seller money, not a shared pot. One seller's withdrawal
    // must leave the other's ledger entry and wallet exactly as they were, and must not
    // cost them the ability to withdraw afterwards.
    function test_Proceeds_OneSellersWithdrawalNeverTouchesAnothers() public {
        address secondSeller = makeAddr("second seller");

        _list(TOKEN_ID, PRICE);
        _listFrom(secondSeller, SECOND_SELLER_TOKEN, 2 ether);

        _buyFrom(buyer, TOKEN_ID, PRICE);
        _buyFrom(buyer, SECOND_SELLER_TOKEN, 2 ether);

        uint256 secondBefore = secondSeller.balance;

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(marketplace.getProceeds(secondSeller), 2 ether, "ledger disturbed");
        assertEq(secondSeller.balance, secondBefore, "wallet disturbed");

        vm.prank(secondSeller);
        marketplace.withdrawProceeds();

        assertEq(secondSeller.balance, secondBefore + 2 ether, "paid the wrong amount");
        assertEq(address(marketplace).balance, 0, "wei left stranded");
    }

    // PROPERTY: a payout moves exactly what the ledger says and not one wei more. With a
    // second seller's money sitting in the same contract, an off-by-anything shows up
    // immediately as the wrong closing balance.
    function test_Proceeds_MarketplaceBalanceDropsByExactlyTheWithdrawnAmount() public {
        address secondSeller = makeAddr("second seller");

        _list(TOKEN_ID, PRICE);
        _listFrom(secondSeller, SECOND_SELLER_TOKEN, 3 ether);

        _buyFrom(buyer, TOKEN_ID, PRICE);
        _buyFrom(buyer, SECOND_SELLER_TOKEN, 3 ether);

        uint256 custodyBefore = address(marketplace).balance;
        uint256 owed = marketplace.getProceeds(seller);

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(address(marketplace).balance, custodyBefore - owed, "wrong amount left");
        assertEq(address(marketplace).balance, 3 ether, "somebody else's money moved");
    }

    // PROPERTY: every sale adds to the same running total, whoever paid it, and ONE
    // withdrawal settles the lot — a seller must never have to claim sale by sale.
    function test_Proceeds_AccumulateAcrossSalesAndPayOutInOneWithdrawal() public {
        uint256 firstPrice = 1 ether;
        uint256 secondPrice = 2.5 ether;
        uint256 thirdPrice = 0.25 ether;

        _list(TOKEN_ID, firstPrice);
        _list(OTHER_TOKEN_ID, secondPrice);
        _listFrom(seller, THIRD_TOKEN, thirdPrice);

        // Three different buyers, so nothing can accumulate per-buyer by accident
        _buyFrom(buyer, TOKEN_ID, firstPrice);
        _buyFrom(makeAddr("second buyer"), OTHER_TOKEN_ID, secondPrice);
        _buyFrom(makeAddr("third buyer"), THIRD_TOKEN, thirdPrice);

        uint256 total = firstPrice + secondPrice + thirdPrice;
        assertEq(marketplace.getProceeds(seller), total, "the sales did not add up");
        assertEq(address(marketplace).balance, total);

        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, sellerBefore + total, "one claim must settle them all");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0, "wei left stranded");
    }

    // PROPERTY: a withdrawal settles the account. The next sale must credit only itself —
    // a ledger that kept the old figure around would pay the same money out twice.
    function test_Proceeds_StartAgainFromZeroAfterAWithdrawal() public {
        _list(TOKEN_ID, PRICE);
        _buyFrom(buyer, TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.withdrawProceeds();
        assertEq(marketplace.getProceeds(seller), 0);

        _list(OTHER_TOKEN_ID, 2 ether);
        _buyFrom(buyer, OTHER_TOKEN_ID, 2 ether);

        assertEq(marketplace.getProceeds(seller), 2 ether, "an old balance came back");

        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, sellerBefore + 2 ether, "paid the wrong amount");
        assertEq(address(marketplace).balance, 0, "wei left stranded");
    }

    // PROPERTY: the ledger follows the CURRENT listing, not the collection's history. A
    // resale pays whoever listed it this time round, and leaves the previous seller's
    // unclaimed balance exactly where it was.
    function test_Proceeds_ResaleCreditsTheNewSellerNotTheOriginalOne() public {
        _list(TOKEN_ID, PRICE);
        _buyFrom(buyer, TOKEN_ID, PRICE);

        vm.startPrank(buyer);
        nft.approve(address(marketplace), TOKEN_ID);
        marketplace.listItem(address(nft), TOKEN_ID, 2 ether);
        vm.stopPrank();

        _buyFrom(stranger, TOKEN_ID, 2 ether);

        assertEq(marketplace.getProceeds(buyer), 2 ether, "the reseller was not paid");
        assertEq(
            marketplace.getProceeds(seller),
            PRICE,
            "the first seller was credited for somebody else's sale"
        );
        assertEq(address(marketplace).balance, PRICE + 2 ether);
    }

    // PROPERTY: this marketplace is self-custodial — it escrows ETH and NEVER a token. A
    // token that ended up owned by the marketplace would be stuck there for good: no
    // function in the contract can transfer one out again.
    function test_Proceeds_MarketplaceTakesCustodyOfEthOnlyNeverOfTokens() public {
        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, PRICE);

        assertEq(nft.balanceOf(address(marketplace)), 0, "listing moved a token");
        assertEq(nft.ownerOf(TOKEN_ID), seller, "the token left its owner's wallet");

        _buyFrom(buyer, TOKEN_ID, PRICE);

        assertEq(nft.balanceOf(address(marketplace)), 0, "the sale routed the token");
        assertEq(nft.ownerOf(TOKEN_ID), buyer, "the token did not reach the buyer");
        assertEq(address(marketplace).balance, PRICE, "ETH is the only thing custodied");

        vm.prank(seller);
        marketplace.cancelListing(address(nft), OTHER_TOKEN_ID);
        assertEq(nft.balanceOf(address(marketplace)), 0, "cancelling moved a token");

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(address(marketplace).balance, 0, "custody outlived the payout");
        assertEq(nft.balanceOf(address(marketplace)), 0);
    }

    // PROPERTY: isolation is not a property of the round numbers the tests above use. At
    // ANY two amounts each seller withdraws their own figure and the contract closes at
    // zero — a shared-pot bug would show as one of them taking a wei of the other's.
    function testFuzz_Proceeds_EachSellerWithdrawsOnlyTheirOwnShare(
        uint96 rawFirst,
        uint96 rawSecond
    ) public {
        uint256 firstPrice = _bound(uint256(rawFirst), 1, 40 ether);
        uint256 secondPrice = _bound(uint256(rawSecond), 1, 40 ether);

        address secondSeller = makeAddr("second seller");
        uint256 firstBefore = seller.balance;
        uint256 secondBefore = secondSeller.balance;

        _list(TOKEN_ID, firstPrice);
        _listFrom(secondSeller, SECOND_SELLER_TOKEN, secondPrice);

        _buyFrom(buyer, TOKEN_ID, firstPrice);
        _buyFrom(buyer, SECOND_SELLER_TOKEN, secondPrice);

        vm.prank(secondSeller);
        marketplace.withdrawProceeds();

        assertEq(secondSeller.balance, secondBefore + secondPrice, "wrong amount paid");
        assertEq(marketplace.getProceeds(seller), firstPrice, "the other seller's money");
        assertEq(address(marketplace).balance, firstPrice, "wrong amount left behind");

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, firstBefore + firstPrice, "wrong amount paid");
        assertEq(address(marketplace).balance, 0, "wei left stranded");
    }


    // Mint, approve and list one token as `owner`. The fixture's _list only ever acts as
    // `seller`, and half of this file needs a SECOND party owed money at the same time.
    function _listFrom(address owner, uint256 tokenId, uint256 price) private {
        nft.mint(owner, tokenId);

        vm.startPrank(owner);
        nft.approve(address(marketplace), tokenId);
        marketplace.listItem(address(nft), tokenId, price);
        vm.stopPrank();
    }

    // Buy as `who`, topping their wallet up first so that a test can never fail for the
    // uninteresting reason of a fresh address having no ETH
    function _buyFrom(address who, uint256 tokenId, uint256 price) private {
        vm.deal(who, who.balance + price);

        vm.prank(who);
        marketplace.buyListing{value: price}(address(nft), tokenId);
    }
}
