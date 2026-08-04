// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Hostile-token tests — the collection itself is the attacker
//
//  nftAddress is supplied by whoever calls listItem, and from that moment the marketplace
//  calls four functions on a contract it knows nothing about: ownerOf, getApproved,
//  isApprovedForAll and safeTransferFrom. Each is a chance for the collection to lie, to
//  revert, to spend the caller's whole gas budget, or to answer one way and then another.
//  A marketplace cannot verify a stranger's honesty — what it CAN do is keep the damage
//  inside that collection: no other listing disturbed, no proceeds misrouted, no buyer
//  out of pocket for a sale that never happened.
//
//  Covers:
//    - safeTransferFrom that does nothing, that reverts, or that delivers another token
//    - getApproved that lies while the transfer then refuses
//    - ownerOf that names nobody, that lies, or that answers twice with two names
//    - ownerOf that burns the caller's entire gas budget
//    - an ERC-20, a silent contract, the marketplace itself and an EOA as nftAddress
//    - a hostile collection reaching across into an honest collection's listing
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {GasBurningNft} from "./mocks/GasBurningNft.sol";
import {MaliciousNft} from "./mocks/MaliciousNft.sol";
import {TocTouNft} from "./mocks/TocTouNft.sol";
import {WrongInterfaceToken} from "./mocks/WrongInterfaceToken.sol";
import {
    MisbehavingNft,
    MisbehavingNft__NotReallyApproved,
    MisbehavingNft__TransferRefused
} from "./mocks/MisbehavingNft.sol";
import {NftMarketplace, NftMarketplace__NotOwner} from "../src/NftMarketplace.sol";

contract HostileTokenTest is MarketplaceTestBase {

    uint256 private constant MALICIOUS_TOKEN = 7;
    uint256 private constant HOSTILE_TOKEN = 11;
    uint256 private constant DECOY_TOKEN = 12;

    // Everything a hostile collection is allowed to spend on our behalf. A well-behaved
    // listing or purchase fits inside this many times over.
    uint256 private constant BOUNDED_GAS = 400_000;

    // Wider, because the two-faced collection burns a third of the budget per answer
    uint256 private constant BOUNDED_BUY_GAS = 1_000_000;

    // Sits between the two answers of a TocTouNft asked at 200k and at 5M gas
    uint256 private constant FLIP_THRESHOLD = 400_000;


    // PROPERTY: a buyer who pays must end up owning the token — or the sale must be
    // refused and the money stay put. A token contract whose safeTransferFrom quietly
    // does nothing must not be able to take the ETH and keep the NFT.
    // EXPECTED FAILURE: nothing re-reads ownerOf after the transfer, so the sale is
    // recorded as complete while the token never moved.
    function test_Attack_TokenContractThatDoesNotActuallyTransfer() public {
        MaliciousNft evil =
            new MaliciousNft(MaliciousNft.Mode.SkipTransfer, marketplace);
        evil.mint(seller, MALICIOUS_TOKEN);

        vm.prank(seller);
        marketplace.listItem(address(evil), MALICIOUS_TOKEN, PRICE);

        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        try marketplace.buyListing{value: PRICE}(address(evil), MALICIOUS_TOKEN) {
            // The sale went through, so the buyer must have the token
            assertEq(
                evil.realOwnerOf(MALICIOUS_TOKEN),
                buyer,
                "buyer paid but the token never moved"
            );
        } catch {
            // Refusing the sale is the other acceptable answer — the money is untouched
            assertEq(buyer.balance, buyerBefore, "buy failed but the ETH is gone");
        }
    }

    // The one that CANNOT be defended against, kept as documentation rather than as a
    // demand: if the token contract lies about ownership, every check the marketplace
    // could make is answered by the liar. The lesson is that trading an unknown
    // collection is a trust decision, not a technical one.
    function test_Attack_TokenContractThatLiesAboutOwnershipIsUndefendable() public {
        MaliciousNft evil =
            new MaliciousNft(MaliciousNft.Mode.LieAboutOwnership, marketplace);
        evil.mint(seller, MALICIOUS_TOKEN);

        vm.prank(seller);
        marketplace.listItem(address(evil), MALICIOUS_TOKEN, PRICE);

        vm.prank(buyer);
        try marketplace.buyListing{value: PRICE}(address(evil), MALICIOUS_TOKEN) {
            // The token now CLAIMS the buyer owns it...
            assertEq(evil.ownerOf(MALICIOUS_TOKEN), buyer);
            // ...while its own books still say otherwise. Nothing on-chain can tell.
            assertEq(evil.realOwnerOf(MALICIOUS_TOKEN), seller);
        } catch {
            // A marketplace that refuses unknown collections outright is fine too
        }
    }

    // PROPERTY: a transfer that reverts must take the whole purchase down with it. The
    // listing is deleted and the proceeds booked BEFORE the token moves, so atomicity is
    // the only thing standing between a failed transfer and a buyer who paid for nothing.
    function test_Attack_SafeTransferFromThatRevertsLeavesTheBuyerWhole() public {
        MisbehavingNft evil =
            new MisbehavingNft(MisbehavingNft.Mode.RevertOnTransfer, marketplace);
        evil.mint(seller, HOSTILE_TOKEN);

        vm.prank(seller);
        marketplace.listItem(address(evil), HOSTILE_TOKEN, PRICE);

        uint256 buyerBefore = buyer.balance;

        vm.expectRevert(MisbehavingNft__TransferRefused.selector);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(evil), HOSTILE_TOKEN);

        assertEq(buyer.balance, buyerBefore, "the buyer paid for a reverted transfer");
        assertEq(marketplace.getProceeds(seller), 0, "the seller was credited anyway");
        assertEq(address(marketplace).balance, 0, "ETH was left behind in the contract");
        assertEq(
            marketplace.getListing(address(evil), HOSTILE_TOKEN).price,
            PRICE,
            "a sale that never happened consumed the listing"
        );
    }

    // PROPERTY: the buyer must receive the token they paid for, not whatever the
    // collection felt like sending.
    // EXPECTED FAILURE: safeTransferFrom is fire-and-forget — the marketplace never
    // checks WHICH token arrived, so a collection can accept a sale of one token, hand
    // the buyer a worthless second one, and have the sale recorded as successful. Reading
    // ownerOf(tokenId) back after the transfer is what would catch it.
    function test_Attack_SafeTransferFromDeliversADifferentTokenId() public {
        MisbehavingNft evil =
            new MisbehavingNft(MisbehavingNft.Mode.TransferWrongToken, marketplace);
        evil.mint(seller, HOSTILE_TOKEN);
        evil.mint(seller, DECOY_TOKEN);
        evil.setDecoy(DECOY_TOKEN);

        vm.prank(seller);
        marketplace.listItem(address(evil), HOSTILE_TOKEN, PRICE);

        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        try marketplace.buyListing{value: PRICE}(address(evil), HOSTILE_TOKEN) {
            assertEq(
                evil.realOwnerOf(HOSTILE_TOKEN),
                buyer,
                "the buyer paid for one token and was handed another"
            );
        } catch {
            assertEq(buyer.balance, buyerBefore, "buy failed but the ETH is gone");
        }
    }

    // PROPERTY: an approval the marketplace was told about but does not really hold must
    // cost the buyer nothing. The pre-flight check passes on a lie and the truth surfaces
    // only during the transfer, after the listing was deleted and the money booked — the
    // revert has to undo all of it.
    function test_Attack_LyingGetApprovedWithAFailingTransfer() public {
        MisbehavingNft evil =
            new MisbehavingNft(MisbehavingNft.Mode.LyingApproval, marketplace);
        evil.mint(seller, HOSTILE_TOKEN);

        vm.prank(seller);
        marketplace.listItem(address(evil), HOSTILE_TOKEN, PRICE);

        uint256 buyerBefore = buyer.balance;

        vm.expectRevert(MisbehavingNft__NotReallyApproved.selector);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(evil), HOSTILE_TOKEN);

        assertEq(buyer.balance, buyerBefore, "the buyer paid for a lied-about approval");
        assertEq(marketplace.getProceeds(seller), 0, "the seller was credited anyway");
        assertEq(address(marketplace).balance, 0, "ETH was left behind in the contract");
        assertEq(
            marketplace.getListing(address(evil), HOSTILE_TOKEN).price,
            PRICE,
            "a sale that never happened consumed the listing"
        );
    }

    // PROPERTY: a collection that names nobody as the owner must be unlistable. Whoever
    // asks, they are not the zero address, so the ownership guard has to turn them away
    // with the named error rather than a bare revert from inside the token.
    function test_Attack_OwnerOfReturningZeroAddressCannotBeListed() public {
        MisbehavingNft evil =
            new MisbehavingNft(MisbehavingNft.Mode.ZeroOwner, marketplace);
        evil.mint(seller, HOSTILE_TOKEN);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(seller);
        marketplace.listItem(address(evil), HOSTILE_TOKEN, PRICE);

        assertEq(marketplace.getListing(address(evil), HOSTILE_TOKEN).price, 0);
    }

    // PROPERTY: no listing may name the zero address as its seller — proceeds booked
    // there can never be withdrawn by anybody, so the buyer's ETH would be burnt inside
    // the marketplace while the books still claim it is owed to someone.
    // EXPECTED FAILURE: listItem only compares ownerOf against msg.sender, and the zero
    // address matches its own reflection. A hardened listItem rejects a zero owner
    // outright instead of trusting the comparison.
    function test_Attack_NoListingIsEverCreatedForAZeroAddressSeller() public {
        MisbehavingNft evil =
            new MisbehavingNft(MisbehavingNft.Mode.ZeroOwner, marketplace);
        evil.mint(seller, HOSTILE_TOKEN);

        // The zero address is the one caller this collection's ownerOf agrees with
        vm.prank(address(0));
        try marketplace.listItem(address(evil), HOSTILE_TOKEN, PRICE) {
            // Reachable today; the assertion below is what states the property
        } catch {
            // Refusing the collection outright is the desired answer
        }

        assertEq(
            marketplace.getListing(address(evil), HOSTILE_TOKEN).price,
            0,
            "a listing was created whose seller can never claim the proceeds"
        );
    }

    // PROPERTY: an expensive collection may ruin its OWN listings and nothing else. The
    // caller lends it a bounded amount of gas, the bomb goes off inside that budget, and
    // every other collection still trades in the very same transaction.
    function test_Attack_GasBurningOwnerOfCannotBeListedWithinABoundedBudget() public {
        GasBurningNft bomb = new GasBurningNft(marketplace);
        bomb.mint(seller, HOSTILE_TOKEN);
        bomb.setBurning(true);

        vm.prank(seller);
        (bool listed, ) = address(marketplace).call{gas: BOUNDED_GAS}(
            abi.encodeCall(NftMarketplace.listItem, (address(bomb), HOSTILE_TOKEN, PRICE))
        );

        assertFalse(listed, "the gas bomb fitted inside a bounded budget");
        assertEq(marketplace.getListing(address(bomb), HOSTILE_TOKEN).price, 0);

        // The marketplace is untouched for everybody else
        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer, "an honest sale was wedged by the bomb");
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // PROPERTY: a collection that only turns expensive AFTER it was listed strands that
    // one listing and no more. The would-be buyer gets their ETH back and the honest
    // collection is still perfectly tradeable.
    function test_Attack_GasBurningOwnerOfOnlyStrandsItsOwnListing() public {
        GasBurningNft bomb = new GasBurningNft(marketplace);
        bomb.mint(seller, HOSTILE_TOKEN);

        vm.prank(seller);
        marketplace.listItem(address(bomb), HOSTILE_TOKEN, PRICE);

        bomb.setBurning(true);

        // This test contract stands in for the buyer: capping the gas lent to the
        // collection needs a low-level call, and the ETH must come from the caller
        vm.deal(address(this), 10 ether);
        uint256 balanceBefore = address(this).balance;

        (bool bought, ) = address(marketplace).call{gas: BOUNDED_GAS, value: PRICE}(
            abi.encodeCall(NftMarketplace.buyListing, (address(bomb), HOSTILE_TOKEN))
        );

        assertFalse(bought, "the gas bomb fitted inside a bounded budget");
        assertEq(address(this).balance, balanceBefore, "the buyer lost ETH to a failure");
        assertEq(marketplace.getProceeds(seller), 0, "the seller was credited anyway");
        assertEq(bomb.realOwnerOf(HOSTILE_TOKEN), seller, "the token moved anyway");

        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer, "an honest sale was wedged by the bomb");
    }

    // The sweep below is only worth having if a collection really can answer the same
    // question twice with two different names inside ONE transaction. This pins that down
    // on its own: identical calls, one gas budget either side of the switch point.
    function test_TwoFacedOwnerOfAnswersDifferentlyWithinOneTransaction() public {
        TocTouNft evil = new TocTouNft(stranger);
        evil.mint(seller, HOSTILE_TOKEN);
        evil.setFlipBelowGas(FLIP_THRESHOLD);

        assertEq(evil.ownerOf{gas: 5_000_000}(HOSTILE_TOKEN), seller);
        assertEq(evil.ownerOf{gas: 200_000}(HOSTILE_TOKEN), stranger);
    }

    // PROPERTY: buyListing asks ownerOf twice — once for the stale check, once more to
    // decide whose approval to read — and a collection that changes its answer in between
    // must never redirect the money. Payment follows the seller RECORDED at listing time,
    // never whoever ownerOf happens to name at the moment of payout. The threshold is
    // fuzzed because the flip can land before, between or after the two calls, and all
    // three outcomes have to be safe.
    function testFuzz_Attack_TwoFacedOwnerOfNeverPaysTheWrongParty(uint32 rawThreshold)
        public
    {
        uint256 threshold = _bound(uint256(rawThreshold), 1, BOUNDED_BUY_GAS);

        TocTouNft evil = new TocTouNft(stranger);
        evil.mint(seller, HOSTILE_TOKEN);
        evil.setApproval(seller, true);

        vm.prank(seller);
        marketplace.listItem(address(evil), HOSTILE_TOKEN, PRICE);

        evil.setFlipBelowGas(threshold);

        vm.deal(address(this), 10 ether);
        uint256 balanceBefore = address(this).balance;

        (bool bought, ) = address(marketplace).call{gas: BOUNDED_BUY_GAS, value: PRICE}(
            abi.encodeCall(NftMarketplace.buyListing, (address(evil), HOSTILE_TOKEN))
        );

        // Whichever answers were given, the impostor is neither paid nor served
        assertEq(marketplace.getProceeds(stranger), 0, "the impostor was credited");
        assertTrue(
            evil.realOwnerOf(HOSTILE_TOKEN) != stranger, "the impostor got the token"
        );

        if (bought) {
            assertEq(
                evil.realOwnerOf(HOSTILE_TOKEN), address(this), "buyer paid, got nothing"
            );
            assertEq(marketplace.getProceeds(seller), PRICE, "seller was not credited");
        } else {
            assertEq(address(this).balance, balanceBefore, "failed buy still cost ETH");
            assertEq(marketplace.getProceeds(seller), 0, "credited by a failed buy");
            assertEq(
                marketplace.getListing(address(evil), HOSTILE_TOKEN).price,
                PRICE,
                "a sale that never happened consumed the listing"
            );
        }
    }

    // PROPERTY: an ERC-20 address pasted in place of a collection has no ownerOf at all,
    // so the listing attempt must die where it stands rather than half-succeed. This is
    // the commonest hostile-token case of the lot, and it is usually an accident.
    function test_Attack_Erc20PassedAsAnNftCollectionIsRefused() public {
        WrongInterfaceToken erc20 = new WrongInterfaceToken(false);
        erc20.mint(seller, 1_000 ether);

        vm.prank(seller);
        (bool listed, ) = address(marketplace).call(
            abi.encodeCall(NftMarketplace.listItem, (address(erc20), TOKEN_ID, PRICE))
        );

        assertFalse(listed, "an ERC-20 was accepted as an NFT collection");
        assertEq(marketplace.getListing(address(erc20), TOKEN_ID).price, 0);
    }

    // PROPERTY: a contract that answers every call with success and NO data must not get
    // an owner decoded out of thin air. The refusal has to happen at the ABI boundary,
    // before any listing exists — an empty return is not an address.
    function test_Attack_CollectionThatAnswersEverythingWithNothingIsRefused() public {
        WrongInterfaceToken silent = new WrongInterfaceToken(true);

        vm.prank(seller);
        (bool listed, ) = address(marketplace).call(
            abi.encodeCall(NftMarketplace.listItem, (address(silent), TOKEN_ID, PRICE))
        );

        assertFalse(listed, "an empty return was decoded into an owner");
        assertEq(marketplace.getListing(address(silent), TOKEN_ID).price, 0);
    }

    // PROPERTY: the marketplace is not an ERC-721 either. Handing it its own address must
    // fail like any other wrong interface — no self-listing, and no ETH in the contract.
    function test_Attack_MarketplaceItselfPassedAsTheNftAddress() public {
        vm.prank(seller);
        (bool listed, ) = address(marketplace).call(
            abi.encodeCall(
                NftMarketplace.listItem, (address(marketplace), TOKEN_ID, PRICE)
            )
        );

        assertFalse(listed, "the marketplace listed itself as a collection");
        assertEq(marketplace.getListing(address(marketplace), TOKEN_ID).price, 0);
        assertEq(address(marketplace).balance, 0);
    }

    // PROPERTY: an nftAddress that is not a contract must fail loudly at listing time,
    // never create a listing nobody can ever buy
    function test_Attack_ListingAnAddressThatIsNotAContract() public {
        address notAContract = makeAddr("definitely not a token");

        vm.expectRevert();
        vm.prank(seller);
        marketplace.listItem(notAContract, TOKEN_ID, PRICE);

        assertEq(marketplace.getListing(notAContract, TOKEN_ID).price, 0);
    }

    // PROPERTY: the blast radius of a hostile collection ends at its own collection.
    // Listings are keyed by (nftAddress, tokenId) and every guard reads ownership from
    // the collection being touched, so a token re-entering mid-sale cannot cancel or
    // consume a listing that belongs to an honest one — cancelListing carries no
    // reentrancy guard, and it is the ownership check alone that turns the attacker away.
    function test_Attack_HostileTokenCannotTouchAnHonestCollectionsListing() public {
        _list(TOKEN_ID, PRICE);

        MisbehavingNft evil =
            new MisbehavingNft(MisbehavingNft.Mode.ReenterCancelForeign, marketplace);
        evil.mint(seller, HOSTILE_TOKEN);
        evil.armForeignCancel(address(nft), TOKEN_ID);

        vm.prank(seller);
        marketplace.listItem(address(evil), HOSTILE_TOKEN, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(evil), HOSTILE_TOKEN);

        assertTrue(evil.foreignCancelRefused(), "a foreign listing was cancelled");
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, seller);

        // And the honest listing is still perfectly buyable afterwards
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), 2 * PRICE);
    }
}
