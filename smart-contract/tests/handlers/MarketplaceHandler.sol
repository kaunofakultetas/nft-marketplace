// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] MarketplaceHandler — the random actor the invariant suite drives
//
//  Invariant testing throws RANDOM SEQUENCES of actions at the marketplace and checks
//  the invariants after every step. Pointing the fuzzer straight at the contract would
//  waste every call on nonsense arguments, so it drives this handler instead: the seeds
//  it invents are folded down to one of three wallets and one of five tokens, and every
//  action checks it makes sense before making it.
//
//  Nothing here asserts anything — the assertions live in the invariant_ functions of
//  tests/Invariants.t.sol. This file only produces plausible marketplace traffic, plus
//  the GHOST VARIABLES that record what that traffic actually was: how much ETH really
//  went in, how much really came out, and who really owned each token when it was
//  listed. An invariant that compares the contract's books against a ghost is checking
//  history the contract cannot rewrite.
//
//  Used by:
//    - tests/Invariants.t.sol — targetContract(address(handler))
// ---------------------------------------------------------------------------------------

import {Test} from "forge-std/Test.sol";

import {NftMarketplace} from "../../src/NftMarketplace.sol";
import {MockNft} from "../mocks/MockNft.sol";

contract MarketplaceHandler is Test {

    uint256 public constant TOKEN_COUNT = 5;

    // A ceiling on the griefing action below, so a run cannot spend its whole depth
    // budget inflating one balance into something meaningless
    uint256 private constant FORCED_ETH_CAP = 100 ether;

    NftMarketplace private immutable i_marketplace;
    MockNft private immutable i_nft;
    address[3] private s_actors;

    // Ghost state — the handler's own tally of what happened, never read by the
    // marketplace and never written by it
    uint256 public ghost_totalPaidIn;
    uint256 public ghost_totalWithdrawn;
    uint256 public ghost_totalForcedIn;
    mapping(uint256 => address) public ghost_ownerWhenListed;

    constructor(NftMarketplace marketplace, MockNft nft, address[3] memory actors) {
        i_marketplace = marketplace;
        i_nft = nft;
        s_actors = actors;
    }

    function _actor(uint256 seed) private view returns (address) {
        return s_actors[seed % s_actors.length];
    }

    function _token(uint256 seed) private pure returns (uint256) {
        return seed % TOKEN_COUNT;
    }

    // The same question the marketplace asks itself before settling a sale — both
    // approval styles count, so the guards here refuse exactly what it would refuse
    function _marketplaceApproved(uint256 tokenId) private view returns (bool) {
        return i_nft.getApproved(tokenId) == address(i_marketplace)
            || i_nft.isApprovedForAll(i_nft.ownerOf(tokenId), address(i_marketplace));
    }


    // Every guard mirrors a refusal the marketplace would make anyway — a rejected
    // action burns a fuzz step without exploring anything new
    function list(uint256 actorSeed, uint256 tokenSeed, uint256 rawPrice) external {
        address actor = _actor(actorSeed);
        uint256 tokenId = _token(tokenSeed);
        uint256 price = _bound(rawPrice, 1, 10 ether);

        if (i_nft.ownerOf(tokenId) != actor) return;
        if (i_marketplace.getListing(address(i_nft), tokenId).price != 0) return;

        vm.startPrank(actor);
        i_nft.approve(address(i_marketplace), tokenId);
        i_marketplace.listItem(address(i_nft), tokenId, price);
        vm.stopPrank();

        // Read back from the TOKEN, not copied from `actor`: an invariant comparing the
        // marketplace's seller against this is then comparing two independent sources
        ghost_ownerWhenListed[tokenId] = i_nft.ownerOf(tokenId);
    }


    // Only the recorded seller who still owns the token may reprice, so the handler
    // asks the same three questions the contract does
    function updatePrice(uint256 actorSeed, uint256 tokenSeed, uint256 rawPrice)
        external
    {
        address actor = _actor(actorSeed);
        uint256 tokenId = _token(tokenSeed);
        uint256 price = _bound(rawPrice, 1, 10 ether);

        NftMarketplace.Listing memory listing =
            i_marketplace.getListing(address(i_nft), tokenId);
        if (listing.price == 0) return;
        if (listing.seller != actor) return;
        if (i_nft.ownerOf(tokenId) != actor) return;
        // A reprice needs a live approval as much as a listing does
        if (!_marketplaceApproved(tokenId)) return;

        vm.prank(actor);
        i_marketplace.updateListing(address(i_nft), tokenId, price);
    }


    // Cancelling is guarded by CURRENT ownership, which is what lets a new owner
    // clear a listing they inherited — the handler mirrors that, not seller identity
    function cancel(uint256 actorSeed, uint256 tokenSeed) external {
        address actor = _actor(actorSeed);
        uint256 tokenId = _token(tokenSeed);

        if (i_marketplace.getListing(address(i_nft), tokenId).price == 0) return;
        if (i_nft.ownerOf(tokenId) != actor) return;

        vm.prank(actor);
        i_marketplace.cancelListing(address(i_nft), tokenId);
    }


    // The one action that moves money, so it is where the ledger invariants earn
    // their keep
    function buy(uint256 actorSeed, uint256 tokenSeed) external {
        address actor = _actor(actorSeed);
        uint256 tokenId = _token(tokenSeed);

        NftMarketplace.Listing memory listing =
            i_marketplace.getListing(address(i_nft), tokenId);
        if (listing.price == 0) return;
        // Three actors and five tokens means the fuzzer picks the seller as the buyer
        // often; the marketplace refuses that, and a refusal explores nothing
        if (listing.seller == actor) return;
        // A listing whose seller moved the token on is stale and cannot be bought
        if (i_nft.ownerOf(tokenId) != listing.seller) return;
        // ...and neither can one whose approval was pulled back since
        if (!_marketplaceApproved(tokenId)) return;
        // The PRANKED ACTOR pays: prank rewrites the call frame's caller, and that same
        // field is where the value transfer is taken from — so the actor's balance is
        // what has to cover the price, never this handler's. Top them up rather than
        // skipping, or the fuzzer stops buying entirely once wallets run dry and the
        // most interesting sequences are never explored.
        if (actor.balance < listing.price) {
            vm.deal(actor, actor.balance + listing.price);
        }

        vm.prank(actor);
        i_marketplace.buyListing{value: listing.price}(address(i_nft), tokenId);

        ghost_totalPaidIn += listing.price;
    }


    // Draining proceeds is the only way ETH leaves the marketplace; the invariants
    // check the books balance after every one
    function withdraw(uint256 actorSeed) external {
        address actor = _actor(actorSeed);

        uint256 owed = i_marketplace.getProceeds(actor);
        if (owed == 0) return;

        vm.prank(actor);
        i_marketplace.withdrawProceeds();

        // Booked as what the marketplace SAID it owed, so the ledger invariant catches a
        // payout that quietly hands over less than the amount it just zeroed
        ghost_totalWithdrawn += owed;
    }


    // Tokens changing hands outside the marketplace is normal life, and the source of
    // every stale listing — the fuzzer gets to do it too
    function transferOutside(uint256 actorSeed, uint256 tokenSeed) external {
        address from = _actor(actorSeed);
        address to = _actor(actorSeed + 1);
        uint256 tokenId = _token(tokenSeed);

        if (i_nft.ownerOf(tokenId) != from) return;
        if (from == to) return;

        vm.prank(from);
        i_nft.transferFrom(from, to, tokenId);
    }


    // A seller may pull the approval back at any moment and the marketplace is never
    // told: the listing stays advertised while it can no longer be settled. Sequences
    // that end in this state are exactly where a marketplace tends to lose track of
    // whose money is whose, so the fuzzer must be able to reach it.
    function revokeApproval(uint256 actorSeed, uint256 tokenSeed) external {
        address actor = _actor(actorSeed);
        uint256 tokenId = _token(tokenSeed);

        if (i_nft.ownerOf(tokenId) != actor) return;
        if (i_nft.getApproved(tokenId) == address(0)) return;

        vm.prank(actor);
        i_nft.approve(address(0), tokenId);
    }


    // ETH can be forced into ANY address — selfdestruct pays out without calling the
    // recipient, so a contract with no receive() cannot refuse it. vm.deal reproduces
    // the end state of that grief in one line: a balance nobody credited to anybody.
    function forceEth(uint256 rawAmount) external {
        uint256 amount = _bound(rawAmount, 1, 10 ether);

        if (ghost_totalForcedIn + amount > FORCED_ETH_CAP) return;

        vm.deal(address(i_marketplace), address(i_marketplace).balance + amount);

        ghost_totalForcedIn += amount;
    }

    // UNGUARDED probes. Every other action mirrors the marketplace's own guards, which
    // means they can only ever produce states the marketplace already agreed to — so a
    // listing conjured out of nothing (the 2024 dead-guard bug) could never appear in a
    // fuzz run. These three ask for the impossible with no pre-checks at all; try/catch
    // swallows the refusal so one rejected probe does not end the sequence.
    function probeUpdateAnything(uint256 actorSeed, uint256 tokenSeed, uint256 rawPrice)
        external
    {
        uint256 price = _bound(rawPrice, 1, 10 ether);

        vm.prank(_actor(actorSeed));
        try i_marketplace.updateListing(address(i_nft), _token(tokenSeed), price) {}
        catch {}
    }

    function probeCancelAnything(uint256 actorSeed, uint256 tokenSeed) external {
        vm.prank(_actor(actorSeed));
        try i_marketplace.cancelListing(address(i_nft), _token(tokenSeed)) {} catch {}
    }

    function probeBuyAnything(uint256 actorSeed, uint256 tokenSeed, uint256 rawValue)
        external
    {
        address actor = _actor(actorSeed);
        uint256 value = _bound(rawValue, 0, 10 ether);
        vm.deal(actor, actor.balance + value);

        vm.prank(actor);
        try i_marketplace.buyListing{value: value}(address(i_nft), _token(tokenSeed)) {
            ghost_totalPaidIn += value;
        } catch {}
    }
}
