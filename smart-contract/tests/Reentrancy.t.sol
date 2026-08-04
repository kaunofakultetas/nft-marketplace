// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Reentrancy tests — every direction control can be handed back mid-transaction
//
//  A purchase gives the outside world the floor twice: safeTransferFrom calls the buyer's
//  onERC721Received hook, and withdrawProceeds calls whoever is being paid. Both run
//  while the marketplace is mid-write, and both can call straight back in. Only
//  buyListing and withdrawProceeds carry nonReentrant — listItem, updateListing and
//  cancelListing are wide open, so the interesting attacks here are CROSS-function.
//
//  Covers:
//    - the buyer's receiver hook re-entering buyListing, same token and another one
//    - the hook re-listing the very token being delivered, which it already owns
//    - the hook cancelling or repricing listings — its own, and another user's
//    - the hook re-entering the payout it is separately owed
//    - the token contract itself re-entering the sale
//    - a seller contract re-entering the payout, or listing from inside it
//    - the marketplace still being usable after a re-entrant attempt was refused
// ---------------------------------------------------------------------------------------

import {Vm} from "forge-std/Vm.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {CrossFunctionAttacker} from "./mocks/CrossFunctionAttacker.sol";
import {MaliciousNft} from "./mocks/MaliciousNft.sol";
import {MaliciousSeller} from "./mocks/MaliciousSeller.sol";
import {ReentrantBuyer} from "./mocks/ReentrantBuyer.sol";
import {
    NftMarketplace,
    NftMarketplace__NotListed,
    NftMarketplace__NotOwner,
    NftMarketplace__TransferFailed
} from "../src/NftMarketplace.sol";

contract ReentrancyTest is MarketplaceTestBase {

    // Tokens 0 and 1 belong to the fixture's seller; everything the attacker owns is
    // minted here, so no test can be read as depending on another one's leftovers
    uint256 private constant ATTACKER_TOKEN = 5;
    uint256 private constant SECOND_ATTACKER_TOKEN = 6;
    uint256 private constant MALICIOUS_TOKEN = 7;
    uint256 private constant SECOND_MALICIOUS_TOKEN = 8;
    uint256 private constant EVIL_SELLER_TOKEN = 42;

    uint256 private constant RELIST_PRICE = 5 ether;
    uint256 private constant NEW_PRICE = 3 ether;


    // A funded attacker that can also act as an honest seller. The collection-wide
    // approval is granted up front because a token loses its single-token approval the
    // moment it moves — without it, nothing could be listed from inside a callback
    function _newAttacker() private returns (CrossFunctionAttacker attacker) {
        attacker = new CrossFunctionAttacker(marketplace);
        vm.deal(address(attacker), 10 ether);
        attacker.approveMarketplaceForAll(address(nft));
    }

    // The one number every reentrancy bug in this contract has to break: the marketplace
    // must hold exactly what its ledger owes — never less (somebody was paid twice) and
    // never more (somebody's money was booked to nobody)
    function _assertSolvent(address partyA, address partyB) private view {
        assertEq(
            address(marketplace).balance,
            marketplace.getProceeds(partyA) + marketplace.getProceeds(partyB),
            "marketplace balance no longer matches the proceeds ledger"
        );
    }


    // safeTransferFrom hands control to the buyer mid-sale; a contract buyer must not be
    // able to use that moment to buy a second token before the first sale finishes
    function test_Attack_BuyerHookReentersBuyListingForASecondToken() public {
        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, PRICE);

        ReentrantBuyer attacker = new ReentrantBuyer(marketplace);
        vm.deal(address(attacker), 10 ether);

        // The guard's refusal bubbles out through onERC721Received and takes the whole
        // purchase down with it
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        attacker.attack(address(nft), TOKEN_ID, PRICE, OTHER_TOKEN_ID, PRICE);

        // Nothing moved: both tokens are still the seller's
        assertEq(nft.ownerOf(TOKEN_ID), seller);
        assertEq(nft.ownerOf(OTHER_TOKEN_ID), seller);
    }

    // Re-entering the SAME listing never reaches the guard: the listing was deleted
    // before the transfer began, so isListed refuses first. Naming that error is what
    // proves the sale was already off the books rather than merely blocked.
    function test_Attack_BuyerHookReentersBuyListingForTheSameToken() public {
        _list(TOKEN_ID, PRICE);

        CrossFunctionAttacker attacker = _newAttacker();
        attacker.armHook(
            CrossFunctionAttacker.Action.BuyTarget, address(nft), TOKEN_ID, PRICE
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), TOKEN_ID
            )
        );
        attacker.buy(address(nft), TOKEN_ID, PRICE);

        assertEq(nft.ownerOf(TOKEN_ID), seller, "the token moved anyway");
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
        assertEq(marketplace.getProceeds(seller), 0);
    }

    // The hook runs AFTER ownership has moved, so the buyer already owns the token it is
    // being handed and unguarded listItem accepts it. The sale in flight must still
    // settle correctly, and the new listing be wholly the attacker's, not a mixture.
    function test_Attack_BuyerHookRelistsTheTokenBeingDelivered() public {
        _list(TOKEN_ID, PRICE);

        CrossFunctionAttacker attacker = _newAttacker();
        attacker.armHook(
            CrossFunctionAttacker.Action.ListTarget,
            address(nft),
            TOKEN_ID,
            RELIST_PRICE
        );

        attacker.buy(address(nft), TOKEN_ID, PRICE);

        assertEq(nft.ownerOf(TOKEN_ID), address(attacker), "the sale did not complete");
        assertEq(marketplace.getProceeds(seller), PRICE, "seller credited wrongly");
        assertEq(marketplace.getProceeds(address(attacker)), 0);
        _assertSolvent(seller, address(attacker));

        NftMarketplace.Listing memory relisted =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(relisted.seller, address(attacker), "re-listing kept the old seller");
        assertEq(relisted.price, RELIST_PRICE, "re-listing kept the old price");
    }

    // EXPECTED FAILURE: ItemBought is emitted AFTER safeTransferFrom, so a listing made
    // inside the buyer's hook is logged BEFORE the sale that enabled it. The indexer
    // deletes the active listing on ItemBought, so it drops a listing that really exists
    // on-chain. Emitting ItemBought with the other effects would restore the order.
    function test_Attack_RelistFromTheHookIsLoggedBeforeTheSaleThatCarriedIt() public {
        _list(TOKEN_ID, PRICE);

        CrossFunctionAttacker attacker = _newAttacker();
        attacker.armHook(
            CrossFunctionAttacker.Action.ListTarget,
            address(nft),
            TOKEN_ID,
            RELIST_PRICE
        );

        vm.recordLogs();
        attacker.buy(address(nft), TOKEN_ID, PRICE);

        uint256 listedAt = type(uint256).max;
        uint256 boughtAt = type(uint256).max;

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(marketplace)) {
                continue;
            }
            if (logs[i].topics[0] == ItemListed.selector) {
                listedAt = i;
            } else if (logs[i].topics[0] == ItemBought.selector) {
                boughtAt = i;
            }
        }

        assertTrue(listedAt != type(uint256).max, "the re-listing was not logged");
        assertTrue(boughtAt != type(uint256).max, "the sale was not logged");
        assertLt(boughtAt, listedAt, "the sale is logged after the listing it enabled");
    }

    // cancelListing carries no guard, so the hook really can reach it mid-sale. Doing so
    // to a listing the attacker owns is legitimate — what must not happen is the sale in
    // flight, another user's listing or the ledger picking up damage on the way.
    function test_Attack_BuyerHookCancelsItsOwnOtherListing() public {
        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, PRICE);

        CrossFunctionAttacker attacker = _newAttacker();
        nft.mint(address(attacker), ATTACKER_TOKEN);
        attacker.listToken(address(nft), ATTACKER_TOKEN, PRICE);

        attacker.armHook(
            CrossFunctionAttacker.Action.CancelTarget, address(nft), ATTACKER_TOKEN, 0
        );

        attacker.buy(address(nft), TOKEN_ID, PRICE);

        // The sale completed exactly as an honest one would have
        assertEq(nft.ownerOf(TOKEN_ID), address(attacker));
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
        assertEq(marketplace.getProceeds(seller), PRICE);
        _assertSolvent(seller, address(attacker));

        // The attacker's own listing is gone, and only that one
        assertEq(marketplace.getListing(address(nft), ATTACKER_TOKEN).price, 0);

        NftMarketplace.Listing memory untouched =
            marketplace.getListing(address(nft), OTHER_TOKEN_ID);
        assertEq(untouched.price, PRICE, "a bystander's listing was disturbed");
        assertEq(untouched.seller, seller, "a bystander's listing changed hands");
    }

    // The same for the other unguarded write. A reprice from inside the hook must land
    // on the listing it names and nowhere else — in particular it must not follow the
    // sale in flight and rewrite the price the buyer just paid.
    function test_Attack_BuyerHookRepricesItsOwnOtherListing() public {
        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, PRICE);

        CrossFunctionAttacker attacker = _newAttacker();
        nft.mint(address(attacker), ATTACKER_TOKEN);
        attacker.listToken(address(nft), ATTACKER_TOKEN, PRICE);

        attacker.armHook(
            CrossFunctionAttacker.Action.UpdateTarget,
            address(nft),
            ATTACKER_TOKEN,
            NEW_PRICE
        );

        attacker.buy(address(nft), TOKEN_ID, PRICE);

        assertEq(nft.ownerOf(TOKEN_ID), address(attacker));
        assertEq(marketplace.getProceeds(seller), PRICE, "the paid price changed");
        _assertSolvent(seller, address(attacker));

        NftMarketplace.Listing memory repriced =
            marketplace.getListing(address(nft), ATTACKER_TOKEN);
        assertEq(repriced.price, NEW_PRICE);
        assertEq(repriced.seller, address(attacker));

        assertEq(
            marketplace.getListing(address(nft), OTHER_TOKEN_ID).price,
            PRICE,
            "a bystander's listing was repriced"
        );
    }

    // Owning the token that has just arrived confers nothing over anyone ELSE's listing.
    // The ownership check is read live from the collection, so the attempt is refused by
    // name and the refusal takes the whole purchase down rather than half of it.
    function test_Attack_BuyerHookCannotCancelAnotherUsersListing() public {
        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, PRICE);

        CrossFunctionAttacker attacker = _newAttacker();
        attacker.armHook(
            CrossFunctionAttacker.Action.CancelTarget, address(nft), OTHER_TOKEN_ID, 0
        );

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        attacker.buy(address(nft), TOKEN_ID, PRICE);

        // Both listings survive, and no money changed hands
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
        assertEq(marketplace.getListing(address(nft), OTHER_TOKEN_ID).price, PRICE);
        assertEq(nft.ownerOf(TOKEN_ID), seller);
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0);
    }

    // A buyer who is ALSO a seller, claiming proceeds while its own purchase is still
    // open — the payout reads a ledger the sale has already written to. PROPERTY:
    // refused or served, this contract is paid its booked proceeds exactly once.
    function test_Attack_BuyerHookReentersTheProceedsPayout() public {
        CrossFunctionAttacker attacker = _newAttacker();
        nft.mint(address(attacker), ATTACKER_TOKEN);
        attacker.listToken(address(nft), ATTACKER_TOKEN, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), ATTACKER_TOKEN);
        assertEq(
            marketplace.getProceeds(address(attacker)), PRICE, "setup: nothing booked"
        );

        _list(TOKEN_ID, PRICE);
        attacker.armHook(
            CrossFunctionAttacker.Action.WithdrawProceeds, address(nft), 0, 0
        );

        try attacker.buy(address(nft), TOKEN_ID, PRICE) {
            // Served safely: paid once, and the sale still settled properly
            assertEq(attacker.receivedEth(), PRICE, "the payout ran more than once");
            assertEq(marketplace.getProceeds(address(attacker)), 0);
            assertEq(marketplace.getProceeds(seller), PRICE);
            assertEq(nft.ownerOf(TOKEN_ID), address(attacker));
        } catch {
            // Refused: the purchase unwinds whole and the proceeds stay booked
            assertEq(attacker.receivedEth(), 0, "ETH left despite the refusal");
            assertEq(marketplace.getProceeds(address(attacker)), PRICE);
            assertEq(marketplace.getProceeds(seller), 0);
            assertEq(nft.ownerOf(TOKEN_ID), seller);
            assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
        }

        _assertSolvent(seller, address(attacker));
    }

    // PROPERTY: the reentrancy guard has to hold even when the attacker is the token
    // contract itself, not the buyer's receiver hook
    function test_Attack_TokenContractReentersTheMarketplaceMidSale() public {
        MaliciousNft evil =
            new MaliciousNft(MaliciousNft.Mode.ReenterMarketplace, marketplace);
        evil.mint(seller, MALICIOUS_TOKEN);
        evil.mint(seller, SECOND_MALICIOUS_TOKEN);
        vm.deal(address(evil), 10 ether);

        vm.startPrank(seller);
        marketplace.listItem(address(evil), MALICIOUS_TOKEN, PRICE);
        marketplace.listItem(address(evil), SECOND_MALICIOUS_TOKEN, PRICE);
        vm.stopPrank();

        evil.armReentry(SECOND_MALICIOUS_TOKEN, PRICE);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(evil), MALICIOUS_TOKEN);

        // Neither listing was consumed
        assertEq(marketplace.getListing(address(evil), MALICIOUS_TOKEN).price, PRICE);
        assertEq(
            marketplace.getListing(address(evil), SECOND_MALICIOUS_TOKEN).price, PRICE
        );
    }

    // PROPERTY: claiming proceeds twice in one transaction must not pay out twice. The
    // guard should refuse the second claim, and the whole payout roll back.
    function test_Attack_SellerContractReentersTheProceedsPayout() public {
        MaliciousSeller evilSeller =
            new MaliciousSeller(MaliciousSeller.Mode.ReenterWithdraw, marketplace);

        nft.mint(address(evilSeller), EVIL_SELLER_TOKEN);
        evilSeller.listToken(nft, EVIL_SELLER_TOKEN, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), EVIL_SELLER_TOKEN);

        uint256 marketplaceBefore = address(marketplace).balance;

        // The re-entrant second claim fails, so the ETH transfer fails, so the whole
        // withdrawal reverts — the money stays booked, nothing is paid twice
        vm.expectRevert(NftMarketplace__TransferFailed.selector);
        evilSeller.withdraw();

        assertEq(address(marketplace).balance, marketplaceBefore);
        assertEq(marketplace.getProceeds(address(evilSeller)), PRICE);
        assertEq(address(evilSeller).balance, 0);
    }

    // The payout is the other door into the contract, and listItem is not behind the
    // guard — so a seller really can list while being paid. That is allowed; being paid
    // twice for it, or leaving the marketplace holding less than it owes, is not.
    function test_Attack_PayoutRecipientListsAnotherTokenMidWithdrawal() public {
        CrossFunctionAttacker attacker = _newAttacker();
        nft.mint(address(attacker), ATTACKER_TOKEN);
        nft.mint(address(attacker), SECOND_ATTACKER_TOKEN);
        attacker.listToken(address(nft), ATTACKER_TOKEN, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), ATTACKER_TOKEN);

        attacker.armPayout(
            CrossFunctionAttacker.Action.ListTarget,
            address(nft),
            SECOND_ATTACKER_TOKEN,
            PRICE
        );
        attacker.withdraw();

        assertEq(attacker.receivedEth(), PRICE, "the payout ran more than once");
        assertEq(marketplace.getProceeds(address(attacker)), 0);
        assertEq(address(marketplace).balance, 0, "money was left behind");

        NftMarketplace.Listing memory listedMidPayout =
            marketplace.getListing(address(nft), SECOND_ATTACKER_TOKEN);
        assertEq(listedMidPayout.price, PRICE);
        assertEq(listedMidPayout.seller, address(attacker));
    }

    // Buying with money the marketplace is in the middle of handing over. PROPERTY: no
    // ETH leaves the marketplace unaccounted for, and no token moves without its price
    // arriving — the proceeds are already zeroed, so this is never a free token.
    function test_Attack_PayoutRecipientBuysWhileBeingPaid() public {
        CrossFunctionAttacker attacker = _newAttacker();
        nft.mint(address(attacker), ATTACKER_TOKEN);
        attacker.listToken(address(nft), ATTACKER_TOKEN, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), ATTACKER_TOKEN);
        assertEq(
            marketplace.getProceeds(address(attacker)), PRICE, "setup: nothing booked"
        );

        _list(TOKEN_ID, PRICE);
        attacker.armPayout(
            CrossFunctionAttacker.Action.BuyTarget, address(nft), TOKEN_ID, PRICE
        );

        try attacker.withdraw() {
            // Served safely: paid once, and the token it bought was paid for in full
            assertEq(attacker.receivedEth(), PRICE, "the payout ran more than once");
            assertEq(nft.ownerOf(TOKEN_ID), address(attacker));
            assertEq(marketplace.getProceeds(seller), PRICE, "a token moved unpaid");
        } catch {
            // Refused: the failed call makes the transfer fail, so the payout unwinds
            assertEq(attacker.receivedEth(), 0, "ETH left despite the refusal");
            assertEq(marketplace.getProceeds(address(attacker)), PRICE);
            assertEq(nft.ownerOf(TOKEN_ID), seller);
        }

        _assertSolvent(seller, address(attacker));
    }

    // A guard that latched on after refusing something would be a denial of service of
    // its own — worse than the attack, because it needs no attacker to be triggered
    // twice. Both guarded functions must work normally once the dust has settled.
    function test_MarketplaceStillWorksAfterAReentrantAttemptWasRefused() public {
        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, PRICE);

        CrossFunctionAttacker attacker = _newAttacker();
        attacker.armHook(
            CrossFunctionAttacker.Action.BuyTarget, address(nft), OTHER_TOKEN_ID, PRICE
        );

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        attacker.buy(address(nft), TOKEN_ID, PRICE);

        // An honest buyer walks straight in afterwards
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);
        assertEq(nft.ownerOf(TOKEN_ID), buyer);

        // ...and so does the payout, which shares the very same guard
        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        marketplace.withdrawProceeds();
        assertEq(seller.balance, sellerBefore + PRICE);

        // A second sale still works too, so nothing was consumed one-way
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), OTHER_TOKEN_ID);
        assertEq(nft.ownerOf(OTHER_TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
    }
}
