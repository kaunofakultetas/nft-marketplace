// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Access-control tests — who may do what to whose listing
//
//  The marketplace never takes custody, so every authorisation decision is a question it
//  asks the token contract at the moment of the call: who owns this right now, and who
//  offered it for sale. This file walks the whole matrix of people who are NOT that
//  person and demands that each of them is refused.
//
//  The one to keep in mind is the ERC-721 OPERATOR. setApprovalForAll lets an address
//  move a token, and it is tempting to read that as permission to sell it. It is not:
//  permission to transfer is not permission to set a price and pocket the proceeds.
//
//  Covers:
//    - a stranger listing, cancelling or repricing somebody else's token
//    - an operator and a single-token approvee attempting the same
//    - a seller who no longer holds the token, and the new owner who does
//    - proceeds: only the address that earned them can pull them
//    - the absence of any privileged role, the deployer's included
//    - buying, which needs no approval from the buyer at all
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {
    NftMarketplace,
    NftMarketplace__NotOwner,
    NftMarketplace__NotSeller,
    NftMarketplace__NotListed,
    NftMarketplace__NotApprovedForMarketplace,
    NftMarketplace__NoProceeds
} from "../src/NftMarketplace.sol";

contract AccessControlTest is MarketplaceTestBase {

    // Somebody the seller trusted with setApprovalForAll — a delegate, a game, a bot
    address private operator = makeAddr("operator");
    // Somebody holding the single-token approve() for the same token
    address private approvee = makeAddr("approvee");
    // Deploys its own marketplace, to prove deploying buys no authority
    address private deployer = makeAddr("deployer");

    uint256 private constant SECOND_SELLER_TOKEN = 9;
    uint256 private constant NEW_PRICE = 2 ether;
    uint256 private constant SECOND_PRICE = 3 ether;


    // Lists as the seller through a COLLECTION-wide approval, so the tests below can hand
    // the single-token approve() to a third party without silently making the listing
    // stale — the marketplace keeps its power through setApprovalForAll
    function _listWithCollectionApproval(uint256 tokenId, uint256 price) private {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(nft), tokenId, price);
        vm.stopPrank();
    }


    // -----------------------------------------------------------------------------------
    // A stranger — no ownership, no approval, no claim of any kind
    // -----------------------------------------------------------------------------------

    // Selling other people's property is the whole attack in one line: the listing must
    // not even be recorded, because the GUI would offer it and the buyer would pay
    function test_Stranger_CannotListATokenTheyDoNotOwn() public {
        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(stranger);
        marketplace.listItem(address(nft), OTHER_TOKEN_ID, PRICE);

        assertEq(marketplace.getListing(address(nft), OTHER_TOKEN_ID).price, 0);
        assertEq(nft.ownerOf(OTHER_TOKEN_ID), seller);
    }

    // Cancelling somebody else's listing is a denial of service: the seller's item
    // disappears from the market and they have to pay gas to put it back
    function test_Stranger_CannotCancelSomeoneElsesListing() public {
        _list(TOKEN_ID, PRICE);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(stranger);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, seller);
    }

    // Repricing somebody else's listing is theft with extra steps: drop the price to one
    // wei, buy it, and the seller's token is gone for nothing
    function test_Stranger_CannotRepriceSomeoneElsesListing() public {
        _list(TOKEN_ID, PRICE);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(stranger);
        marketplace.updateListing(address(nft), TOKEN_ID, 1 wei);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
    }


    // -----------------------------------------------------------------------------------
    // An ERC-721 operator — setApprovalForAll over the whole collection
    // -----------------------------------------------------------------------------------

    // An operator can MOVE the token, which is exactly why it must not be able to SELL
    // it: the proceeds of a listing go to whoever created it
    function test_Operator_CannotListTheOwnersToken() public {
        vm.prank(seller);
        nft.setApprovalForAll(operator, true);
        // The approval is real — this test is not passing because nothing was granted
        assertTrue(nft.isApprovedForAll(seller, operator));

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(operator);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
    }

    // Transfer rights say nothing about the owner's INTENT to sell, so an operator must
    // not be able to pull a live listing off the market either
    function test_Operator_CannotCancelTheOwnersListing() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.setApprovalForAll(operator, true);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(operator);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, seller);
    }

    // The dangerous half of the operator question: repricing to a token the operator can
    // then buy cheaply would turn a delegation into a self-service discount
    function test_Operator_CannotRepriceTheOwnersListing() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.setApprovalForAll(operator, true);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(operator);
        marketplace.updateListing(address(nft), TOKEN_ID, 1 wei);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
    }

    // An operator CAN revoke the marketplace's per-token approval on the owner's behalf —
    // ERC-721 allows that and no marketplace can prevent it. The property that must hold
    // is that the griefing stays a griefing: a named refusal, and nobody's money moves.
    function test_Operator_CanFreezeAListingButNeverProfitFromIt() public {
        _list(TOKEN_ID, PRICE);
        uint256 buyerBefore = buyer.balance;

        vm.prank(seller);
        nft.setApprovalForAll(operator, true);

        vm.prank(operator);
        nft.approve(address(0), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), seller, "the operator took the token");
        assertEq(buyer.balance, buyerBefore, "the buyer paid for a frozen listing");
        assertEq(marketplace.getProceeds(operator), 0, "the operator was credited");
        assertEq(marketplace.getProceeds(seller), 0);
    }


    // -----------------------------------------------------------------------------------
    // A single-token approvee — approve(bob, tokenId)
    // -----------------------------------------------------------------------------------

    // The narrower approval is no different in kind from setApprovalForAll: it authorises
    // one transfer, not a sale on the owner's behalf
    function test_ApprovedAddress_CannotListTheOwnersToken() public {
        vm.prank(seller);
        nft.approve(approvee, OTHER_TOKEN_ID);
        assertEq(nft.getApproved(OTHER_TOKEN_ID), approvee);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(approvee);
        marketplace.listItem(address(nft), OTHER_TOKEN_ID, PRICE);

        assertEq(marketplace.getListing(address(nft), OTHER_TOKEN_ID).price, 0);
    }

    // Holding the token's approval must not let anyone withdraw the owner's offer
    function test_ApprovedAddress_CannotCancelTheOwnersListing() public {
        _listWithCollectionApproval(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.approve(approvee, TOKEN_ID);
        assertEq(nft.getApproved(TOKEN_ID), approvee);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(approvee);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
    }

    // Nor set the price the owner will be paid
    function test_ApprovedAddress_CannotRepriceTheOwnersListing() public {
        _listWithCollectionApproval(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.approve(approvee, TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(approvee);
        marketplace.updateListing(address(nft), TOKEN_ID, 1 wei);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, seller);
    }


    // -----------------------------------------------------------------------------------
    // The token changed hands while listed — old owner, new owner
    // -----------------------------------------------------------------------------------

    // Once the token is gone the old seller cannot deliver, so they must not be able to
    // keep advertising it at a price of their choosing
    function test_FormerOwner_CannotRepriceTheListingTheyLeftBehind() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, NEW_PRICE);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
    }

    // FIXED: cancelling used to be guarded by CURRENT ownership alone, so whoever MADE
    // the offer could not retract it once the token moved — and behind a collection-wide
    // approval the abandoned listing came back to life at the old price the moment the
    // token returned. The recorded seller may now always cancel.
    function test_FormerSeller_MustBeAbleToRetractTheirOwnOffer() public {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
        nft.transferFrom(seller, stranger, TOKEN_ID);
        vm.stopPrank();

        // The seller tries to take back the offer they themselves made
        vm.prank(seller);
        try marketplace.cancelListing(address(nft), TOKEN_ID) {
            // Accepted — the offer is gone, which is the behaviour being asked for
        } catch {
            // Refused — the offer outlives the person who made it
        }

        vm.prank(stranger);
        nft.transferFrom(stranger, seller, TOKEN_ID);

        assertEq(
            marketplace.getListing(address(nft), TOKEN_ID).price,
            0,
            "a retracted offer went live again when the token came back"
        );
    }

    // The new owner inherits a listing that would pay the PREVIOUS owner, so repricing it
    // must be refused; cancelling it is their escape hatch, and that must still work
    function test_NewOwner_MayCancelTheInheritedListingButNotRepriceIt() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotSeller.selector);
        vm.prank(stranger);
        marketplace.updateListing(address(nft), TOKEN_ID, NEW_PRICE);

        // The payout address is still the original seller — no reprice, no redirection
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, seller);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);

        vm.prank(stranger);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
    }


    // -----------------------------------------------------------------------------------
    // Proceeds — the pull-payment ledger is per address and nothing else
    // -----------------------------------------------------------------------------------

    // withdrawProceeds takes no argument on purpose: there is no address to point at
    // somebody else's earnings. Neither a stranger nor the buyer who paid may claim them.
    function test_Proceeds_OnlyTheAddressThatEarnedThemCanPullThem() public {
        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        vm.prank(stranger);
        marketplace.withdrawProceeds();

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        vm.prank(buyer);
        marketplace.withdrawProceeds();

        assertEq(stranger.balance, 0, "a stranger was paid");
        assertEq(marketplace.getProceeds(seller), PRICE, "the seller's credit moved");
        assertEq(address(marketplace).balance, PRICE);
    }

    // The ledger must be isolated per seller: one payout may not touch another seller's
    // credit, nor the ETH backing it, or the first withdrawal of the day drains everyone
    function test_Proceeds_OneWithdrawalLeavesAnotherSellerUntouched() public {
        _list(TOKEN_ID, PRICE);

        nft.mint(stranger, SECOND_SELLER_TOKEN);
        vm.startPrank(stranger);
        nft.approve(address(marketplace), SECOND_SELLER_TOKEN);
        marketplace.listItem(address(nft), SECOND_SELLER_TOKEN, SECOND_PRICE);
        vm.stopPrank();

        vm.startPrank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);
        marketplace.buyListing{value: SECOND_PRICE}(address(nft), SECOND_SELLER_TOKEN);
        vm.stopPrank();

        uint256 otherBalanceBefore = stranger.balance;

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(marketplace.getProceeds(stranger), SECOND_PRICE, "credit was raided");
        assertEq(stranger.balance, otherBalanceBefore, "the payout went to two people");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, SECOND_PRICE, "the backing ETH is gone");
    }


    // -----------------------------------------------------------------------------------
    // No privileged role — nobody is an admin here, the deployer included
    // -----------------------------------------------------------------------------------

    // Deploying a marketplace grants no standing over what people trade on it: the
    // deployer is refused exactly like the stranger above, and earns nothing from a sale
    function test_NoAdmin_TheDeployerIsJustAnotherAddress() public {
        vm.prank(deployer);
        NftMarketplace fresh = new NftMarketplace();

        vm.startPrank(seller);
        nft.approve(address(fresh), TOKEN_ID);
        fresh.listItem(address(nft), TOKEN_ID, PRICE);
        vm.stopPrank();

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(deployer);
        fresh.cancelListing(address(nft), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(deployer);
        fresh.updateListing(address(nft), TOKEN_ID, 1 wei);

        vm.prank(buyer);
        fresh.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        vm.prank(deployer);
        fresh.withdrawProceeds();

        assertEq(fresh.getProceeds(seller), PRICE, "the deployer took a cut");
        assertEq(deployer.balance, 0);
        assertEq(nft.ownerOf(TOKEN_ID), buyer);
    }

    // There is no back door to call in the first place. This test contract DEPLOYED the
    // fixture's marketplace, and even it finds no owner, pause, fee or force-cancel entry
    // point: with no fallback function every one of those calls simply misses.
    function test_NoAdmin_NoAdministrativeEntryPointExists() public {
        _list(TOKEN_ID, PRICE);

        string[] memory adminish = new string[](12);
        adminish[0] = "owner()";
        adminish[1] = "renounceOwnership()";
        adminish[2] = "transferOwnership(address)";
        adminish[3] = "pause()";
        adminish[4] = "unpause()";
        adminish[5] = "withdraw()";
        adminish[6] = "emergencyWithdraw()";
        adminish[7] = "sweep(address)";
        adminish[8] = "setFee(uint256)";
        adminish[9] = "setFeeRecipient(address)";
        adminish[10] = "forceCancel(address,uint256)";
        adminish[11] = "upgradeTo(address)";

        for (uint256 i = 0; i < adminish.length; i++) {
            (bool answered, ) =
                address(marketplace).call(abi.encodeWithSignature(adminish[i]));
            assertFalse(answered, "the marketplace answered an administrative call");
        }

        // A function that DOES exist must answer, otherwise the probe above proves
        // nothing and the test would pass on any address at all
        (bool known, ) = address(marketplace).call(
            abi.encodeWithSignature("getProceeds(address)", seller)
        );
        assertTrue(known, "the probe misses even real functions");

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, seller);
    }

    // A collection-wide approval hands the marketplace power over EVERY token the seller
    // holds, so the only thing that may unlock it is a listing the owner made themselves:
    // an unlisted sibling token must be unreachable to everybody
    function test_NoAdmin_ABlanketApprovalIsUsableOnlyThroughTheOwnersListing() public {
        _listWithCollectionApproval(TOKEN_ID, PRICE);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), OTHER_TOKEN_ID
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), OTHER_TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(stranger);
        marketplace.listItem(address(nft), OTHER_TOKEN_ID, PRICE);

        assertEq(nft.ownerOf(OTHER_TOKEN_ID), seller, "an unlisted token was sold");
        assertEq(marketplace.getListing(address(nft), OTHER_TOKEN_ID).price, 0);
    }


    // -----------------------------------------------------------------------------------
    // The buyer's side — paying requires no authority over anything
    // -----------------------------------------------------------------------------------

    // Only the SELLER approves anything here. A buyer who has granted nothing to anybody
    // must still be able to pay and receive, or the GUI would demand a pointless approval
    function test_Buy_NeedsNoApprovalFromTheBuyer() public {
        _list(TOKEN_ID, PRICE);

        assertFalse(nft.isApprovedForAll(buyer, address(marketplace)));

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // And the purchase must not quietly leave the marketplace holding authority over the
    // token it just delivered — a sale is a delivery, not an enrolment
    function test_Buy_LeavesTheMarketplaceNoAuthorityOverTheBoughtToken() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.getApproved(TOKEN_ID), address(0), "approval survived the sale");
        assertFalse(nft.isApprovedForAll(buyer, address(marketplace)));

        // The previous seller has no way back to it either
        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
    }


    // -----------------------------------------------------------------------------------
    // The same questions asked of every address the fuzzer can think of
    // -----------------------------------------------------------------------------------

    // The named cases above cover the people we thought of; this covers the rest of the
    // address space, since an authorisation hole usually hides in the case nobody named
    function testFuzz_NoAddressButTheOwnerCanCancelOrReprice(address caller) public {
        vm.assume(caller != seller);
        vm.assume(caller != address(0) && caller != address(vm));

        _list(TOKEN_ID, PRICE);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(caller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(caller);
        marketplace.updateListing(address(nft), TOKEN_ID, 1 wei);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, seller);
    }

    // The money side of the same sweep: an address that earned nothing is refused, and
    // the seller's credit and the ETH backing it survive every attempt
    function testFuzz_NoAddressCanWithdrawProceedsItDidNotEarn(address caller) public {
        vm.assume(caller != seller);
        vm.assume(caller != address(0) && caller != address(vm));

        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        vm.prank(caller);
        marketplace.withdrawProceeds();

        assertEq(marketplace.getProceeds(seller), PRICE);
        assertEq(address(marketplace).balance, PRICE);
    }
}
