// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Proceeds tests — the pull-payment ledger, for honest sellers
//
//  Sale money waits inside the marketplace until the seller pulls it, which is what
//  stops a seller whose wallet rejects ETH from blocking a sale. The balance is zeroed
//  before the transfer, so there is never anything left to claim twice.
//
//  Past that one payout this file asks the quieter questions. What must a withdrawal
//  NOT touch — other listings, the approvals behind them, the token that was sold,
//  anyone else's entry? What earns nothing at all, no matter how often it is done —
//  listing, repricing, cancelling, buying? Does one entry serve a seller across every
//  collection they trade in? And a payout is SILENT: withdrawProceeds emits no event,
//  so the indexer that rebuilds the marketplace from logs can never show a payout, and
//  the seller's balance card has to be read from the chain instead.
//
//  Hostile payees, return bombs, isolation between two sellers and plain-ETH refusal
//  live in tests/ProceedsSecurity.t.sol — nobody here is misbehaving.
// ---------------------------------------------------------------------------------------

import {Vm} from "forge-std/Vm.sol";

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {MockNft} from "./mocks/MockNft.sol";
import {NftMarketplace, NftMarketplace__NoProceeds} from "../src/NftMarketplace.sol";

contract ProceedsTest is MarketplaceTestBase {

    // Minted inside the tests that need them, kept clear of the fixture's 0 and 1
    uint256 private constant CONTRACT_SELLER_TOKEN = 70;
    uint256 private constant STRANGER_TOKEN = 71;
    uint256 private constant BUSY_MARKET_TOKEN = 72;
    uint256 private constant SEQUENCE_TOKEN_BASE = 80;

    // The books this contract keeps when it is paid — see receive() below
    uint256 private s_ethReceived;
    uint256 private s_paymentsReceived;


    // This test contract doubles as a seller that is a CONTRACT rather than a wallet.
    // The two stores are the point of it: 2300 gas — all a transfer() would forward —
    // cannot pay for them, and most real contract wallets do at least this much work on
    // being paid.
    receive() external payable {
        s_ethReceived += msg.value;
        s_paymentsReceived += 1;
    }


    // The seller ends up with the ETH and the contract with nothing
    function test_WithdrawProceeds_PaysTheSeller() public {
        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        uint256 balanceBefore = seller.balance;

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, balanceBefore + PRICE);
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0);
    }

    // Nothing earned, nothing to withdraw — and the refusal must leave the ledger and
    // both balances exactly as it found them rather than opening an empty account
    function test_WithdrawProceeds_RevertsWithNoProceeds() public {
        uint256 sellerBefore = seller.balance;

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(seller.balance, sellerBefore, "a failed claim moved money");
        assertEq(address(marketplace).balance, 0);
    }

    // The balance is zeroed before the transfer, so a second call finds nothing — the
    // same property that makes reentrancy here pointless. The wallet arithmetic either
    // side of the pair is what proves the price was paid out once and not twice.
    function test_WithdrawProceeds_CannotBeDrainedTwice() public {
        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        uint256 sellerBefore = seller.balance;

        vm.startPrank(seller);
        marketplace.withdrawProceeds();

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        marketplace.withdrawProceeds();
        vm.stopPrank();

        assertEq(seller.balance, sellerBefore + PRICE, "the price was paid out twice");
        assertEq(address(marketplace).balance, 0, "wei left stranded");
    }

    // A payout is INVISIBLE to the backend. The indexer rebuilds the whole marketplace
    // from four events and withdrawProceeds emits none of them, so no log anywhere says
    // a seller was paid
    function test_WithdrawProceeds_EmitsNothingAtAll() public {
        _list(TOKEN_ID, PRICE);

        // The sale is the last thing the indexer ever hears about this money, and it
        // hears it exactly once
        vm.recordLogs();
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);
        assertEq(_marketplaceLogCount(), 1, "a sale must announce itself exactly once");

        vm.recordLogs();
        vm.prank(seller);
        marketplace.withdrawProceeds();

        // Not one log from anybody: the ETH leaves on a bare call, which logs nothing
        assertEq(vm.getRecordedLogs().length, 0, "the payout was announced");
    }

    // One seller, two collections, ONE balance: the ledger is keyed by seller alone, so
    // a trader never has to withdraw once per collection. Both sales use the SAME
    // tokenId, which is where a ledger keyed by anything else would show itself.
    function test_Proceeds_FromTwoCollectionsLandInOneBalance() public {
        MockNft second = new MockNft();
        second.mint(seller, TOKEN_ID);

        _list(TOKEN_ID, PRICE);

        vm.startPrank(seller);
        second.approve(address(marketplace), TOKEN_ID);
        marketplace.listItem(address(second), TOKEN_ID, 2 ether);
        vm.stopPrank();

        vm.startPrank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);
        marketplace.buyListing{value: 2 ether}(address(second), TOKEN_ID);
        vm.stopPrank();

        assertEq(marketplace.getProceeds(seller), 3 ether, "the two sales did not merge");
        assertEq(address(marketplace).balance, 3 ether);

        // The fixture funds only the buyer, so the seller's closing wallet is the whole
        // proof on its own
        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, 3 ether, "one claim must settle both collections");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0, "wei left stranded");
        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(second.ownerOf(TOKEN_ID), buyer, "the wrong collection moved");
    }

    // A sale opens exactly one account. Nobody else earns anything from it — not the
    // payer, not the collection, not this contract itself: there is no fee anywhere in
    // the marketplace, and getProceeds answers zero for addresses it has never seen.
    function test_GetProceeds_IsZeroForEveryAddressThatNeverSold() public {
        assertEq(marketplace.getProceeds(seller), 0, "a fresh ledger owes nobody");
        assertEq(marketplace.getProceeds(stranger), 0);

        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(marketplace.getProceeds(seller), PRICE, "the seller lost a cut");
        assertEq(marketplace.getProceeds(buyer), 0, "the payer was credited");
        assertEq(marketplace.getProceeds(stranger), 0);
        assertEq(marketplace.getProceeds(address(0)), 0);
        assertEq(marketplace.getProceeds(address(nft)), 0, "the collection took a cut");
        assertEq(marketplace.getProceeds(address(this)), 0, "the deployer took a cut");
        assertEq(
            marketplace.getProceeds(address(marketplace)), 0, "the contract took a cut"
        );

        // Every wei in custody belongs to that one entry, which is the same statement
        // read from the other side
        assertEq(address(marketplace).balance, PRICE);
    }

    // Listing, repricing and cancelling are free and earn nothing: only a completed sale
    // moves money. A seller who changed their mind has no balance to pull, and the token
    // and its approval sit exactly where they did before the listing existed.
    function test_GetProceeds_StaysZeroWhenAListingIsCancelledInsteadOfSold() public {
        _list(TOKEN_ID, PRICE);
        assertEq(marketplace.getProceeds(seller), 0, "listing paid the seller");

        vm.startPrank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 2 ether);
        assertEq(marketplace.getProceeds(seller), 0, "repricing paid the seller");

        marketplace.cancelListing(address(nft), TOKEN_ID);
        assertEq(marketplace.getProceeds(seller), 0, "cancelling paid the seller");

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        marketplace.withdrawProceeds();
        vm.stopPrank();

        assertEq(address(marketplace).balance, 0, "money appeared without a sale");
        assertEq(nft.ownerOf(TOKEN_ID), seller);
        // OpenZeppelin clears an approval when the token MOVES, and nothing moved here,
        // so the seller can go straight back on the market without approving again
        assertEq(nft.getApproved(TOKEN_ID), address(marketplace));

        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, 3 ether);

        vm.prank(buyer);
        marketplace.buyListing{value: 3 ether}(address(nft), TOKEN_ID);

        // The one sale that happened, not a penny of the listings that came before it
        assertEq(marketplace.getProceeds(seller), 3 ether, "the ledger remembered more");
    }

    // A payout must be a payout and nothing else. The seller's OTHER listing, the token
    // behind it and the approval backing it are untouched by the withdrawal — and the
    // listing is still live enough to be bought straight afterwards.
    function test_WithdrawProceeds_LeavesOtherListingsAndApprovalsUntouched() public {
        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, 2 ether);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.prank(seller);
        marketplace.withdrawProceeds();

        NftMarketplace.Listing memory kept =
            marketplace.getListing(address(nft), OTHER_TOKEN_ID);
        assertEq(kept.price, 2 ether, "the payout disturbed another listing");
        assertEq(kept.seller, seller, "the payout rewrote a listing's seller");
        assertEq(nft.ownerOf(OTHER_TOKEN_ID), seller, "the payout moved a token");
        assertEq(
            nft.getApproved(OTHER_TOKEN_ID),
            address(marketplace),
            "the payout revoked an approval"
        );
        assertEq(nft.ownerOf(TOKEN_ID), buyer, "the sold token came back");

        // And the survivor still sells, crediting its own price and no more
        vm.prank(buyer);
        marketplace.buyListing{value: 2 ether}(address(nft), OTHER_TOKEN_ID);

        assertEq(marketplace.getProceeds(seller), 2 ether, "the second sale drifted");
        assertEq(address(marketplace).balance, 2 ether);
    }

    // The pull half of pull payments: a sale credits the ledger and pays NO wallet. The
    // seller's balance must not move until they ask for it — a marketplace that pushed
    // ETH at sale time would hand every seller the power to fail a purchase.
    function test_Proceeds_SaleCreditsTheLedgerAndPaysNoWallet() public {
        _list(TOKEN_ID, PRICE);

        uint256 buyerBefore = buyer.balance;
        assertEq(seller.balance, 0, "the fixture funds only the buyer");

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(seller.balance, 0, "the sale pushed ETH at the seller");
        assertEq(buyer.balance, buyerBefore - PRICE, "the buyer paid the wrong amount");
        assertEq(marketplace.getProceeds(seller), PRICE);
        assertEq(address(marketplace).balance, PRICE, "the money is held, not sent");

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, PRICE, "asking for it is what finally pays");
    }

    // The ordinary shape of a marketplace account: sell, pull the money out, spend it.
    // Buying credits the OTHER party and only them — the buyer's own entry, freshly
    // closed by the withdrawal, must stay at zero however much they spend.
    function test_Proceeds_SellerWithdrawsThenBuysWithTheSameEth() public {
        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.prank(seller);
        marketplace.withdrawProceeds();
        assertEq(seller.balance, PRICE, "the payout was not exact");

        // The stranger now offers something at exactly what the seller just took out
        nft.mint(stranger, STRANGER_TOKEN);
        vm.startPrank(stranger);
        nft.approve(address(marketplace), STRANGER_TOKEN);
        marketplace.listItem(address(nft), STRANGER_TOKEN, PRICE);
        vm.stopPrank();

        vm.prank(seller);
        marketplace.buyListing{value: PRICE}(address(nft), STRANGER_TOKEN);

        assertEq(nft.ownerOf(STRANGER_TOKEN), seller);
        assertEq(seller.balance, 0, "the purchase cost something other than the price");
        assertEq(marketplace.getProceeds(stranger), PRICE, "the new seller was not paid");
        assertEq(marketplace.getProceeds(seller), 0, "buying credited the buyer");
        assertEq(address(marketplace).balance, PRICE, "custody holds one sale only");
    }

    // A seller that is a contract rather than a wallet, and an honest one: its receive()
    // simply writes its own books. That bookkeeping is the assertion — the 2300 gas a
    // transfer() forwards could never pay for it.
    function test_Proceeds_ContractSellerWithAWorkingWalletIsPaidInFull() public {
        nft.mint(address(this), CONTRACT_SELLER_TOKEN);
        nft.approve(address(marketplace), CONTRACT_SELLER_TOKEN);
        marketplace.listItem(address(nft), CONTRACT_SELLER_TOKEN, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), CONTRACT_SELLER_TOKEN);

        assertEq(marketplace.getProceeds(address(this)), PRICE);
        assertEq(s_ethReceived, 0, "the sale paid the seller early");

        uint256 balanceBefore = address(this).balance;
        marketplace.withdrawProceeds();

        assertEq(address(this).balance, balanceBefore + PRICE, "the payout fell short");
        assertEq(s_ethReceived, PRICE, "the recipient's own books disagree");
        assertEq(s_paymentsReceived, 1, "the payout arrived in instalments");
        assertEq(marketplace.getProceeds(address(this)), 0);
        assertEq(address(marketplace).balance, 0, "wei left stranded");
    }

    // An earned balance is nobody else's business. A busy marketplace goes on all around
    // one seller — other people list, reprice, cancel and trade, here and in another
    // collection — and their entry must read exactly what it read before any of it.
    function test_Proceeds_SurviveEverybodyElsesActivityUntouched() public {
        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        // The stranger runs a listing through its whole life without ever selling it
        nft.mint(stranger, STRANGER_TOKEN);
        vm.startPrank(stranger);
        nft.approve(address(marketplace), STRANGER_TOKEN);
        marketplace.listItem(address(nft), STRANGER_TOKEN, 2 ether);
        marketplace.updateListing(address(nft), STRANGER_TOKEN, 3 ether);
        marketplace.cancelListing(address(nft), STRANGER_TOKEN);
        vm.stopPrank();

        // The buyer resells what they bought, to a third party
        vm.startPrank(buyer);
        nft.approve(address(marketplace), TOKEN_ID);
        marketplace.listItem(address(nft), TOKEN_ID, 4 ether);
        vm.stopPrank();

        vm.deal(stranger, 4 ether);
        vm.prank(stranger);
        marketplace.buyListing{value: 4 ether}(address(nft), TOKEN_ID);

        // And a wholly unrelated collection changes hands as well
        MockNft second = new MockNft();
        second.mint(stranger, BUSY_MARKET_TOKEN);
        vm.startPrank(stranger);
        second.approve(address(marketplace), BUSY_MARKET_TOKEN);
        marketplace.listItem(address(second), BUSY_MARKET_TOKEN, 5 ether);
        vm.stopPrank();

        vm.prank(buyer);
        marketplace.buyListing{value: 5 ether}(address(second), BUSY_MARKET_TOKEN);

        assertEq(marketplace.getProceeds(seller), PRICE, "another trade moved the entry");
        assertEq(seller.balance, 0, "the seller was paid without asking");

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, PRICE, "the payout was not the earned amount");
        assertEq(marketplace.getProceeds(buyer), 4 ether, "a bystander's entry moved");
        assertEq(marketplace.getProceeds(stranger), 5 ether);
        assertEq(address(marketplace).balance, 9 ether, "only the seller's money left");
    }

    // A blanket approval outlives what a single-token one does not: OpenZeppelin clears
    // getApproved when a token moves, but isApprovedForAll survives, so a seller who
    // granted the collection once sells twice, and both sales settle in one claim.
    function test_Proceeds_BlanketApprovalCarriesTwoSalesIntoOneBalance() public {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
        marketplace.listItem(address(nft), OTHER_TOKEN_ID, 2 ether);
        vm.stopPrank();

        vm.startPrank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);
        marketplace.buyListing{value: 2 ether}(address(nft), OTHER_TOKEN_ID);
        vm.stopPrank();

        assertEq(nft.getApproved(TOKEN_ID), address(0), "a sale left an approval behind");
        assertTrue(
            nft.isApprovedForAll(seller, address(marketplace)),
            "a sale revoked the collection-wide approval"
        );

        assertEq(marketplace.getProceeds(seller), 3 ether, "a sale went uncredited");

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, 3 ether, "the payout was not the sum of both sales");
        assertEq(address(marketplace).balance, 0, "wei left stranded");
    }

    // PROPERTY: pulling after every sale and pulling once at the end must leave the
    // seller with the same money. The first path zeroes and re-credits the entry over
    // and over, which is exactly where a figure surviving a payout would show up.
    function testFuzz_Proceeds_WithdrawingEachTimeMatchesOneFinalPayout(
        uint96 rawFirst,
        uint96 rawSecond,
        uint96 rawThird,
        bool withdrawAfterEachSale
    ) public {
        uint256[3] memory prices = [
            _bound(uint256(rawFirst), 1, 20 ether),
            _bound(uint256(rawSecond), 1, 20 ether),
            _bound(uint256(rawThird), 1, 20 ether)
        ];

        uint256 total;

        for (uint256 i = 0; i < prices.length; i++) {
            uint256 tokenId = SEQUENCE_TOKEN_BASE + i;
            nft.mint(seller, tokenId);
            _list(tokenId, prices[i]);

            vm.prank(buyer);
            marketplace.buyListing{value: prices[i]}(address(nft), tokenId);
            total += prices[i];

            if (withdrawAfterEachSale) {
                vm.prank(seller);
                marketplace.withdrawProceeds();
                assertEq(marketplace.getProceeds(seller), 0, "a payout left a remainder");
            } else {
                assertEq(marketplace.getProceeds(seller), total, "the run drifted");
            }
        }

        if (!withdrawAfterEachSale) {
            vm.prank(seller);
            marketplace.withdrawProceeds();
        }

        assertEq(seller.balance, total, "the two orders of events paid differently");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0, "wei left stranded");
    }


    // How many of the logs just recorded came from the MARKETPLACE — the collection
    // emits its own Approval and Transfer logs in the very same transactions
    function _marketplaceLogCount() private returns (uint256) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 count;

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(marketplace)) {
                count++;
            }
        }
        return count;
    }
}
