// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Invariant tests — properties that must survive ANY sequence of actions
//
//  The unit tests each check one story the author thought of. This suite checks
//  statements that must hold no matter WHAT happens: Foundry generates random sequences
//  of list / reprice / cancel / buy / withdraw / transfer / revoke-approval / force-ETH
//  through MarketplaceHandler and re-checks every invariant after each step. Bugs that
//  only appear after an odd order of events are what this finds and unit tests never do.
//
//  Several invariants compare the marketplace's books against GHOST state the handler
//  recorded as it went. That distinction matters: a contract can be wrong about its own
//  history, so an invariant that only reads the contract can be fooled by a bug that is
//  self-consistent. The handler's tally of what it actually did cannot be.
//
//  Covers:
//    - solvency — the balance always covers the proceeds still owed
//    - accounting — every wei paid in, forced in or paid out is explained
//    - custody — the marketplace holds ETH, never a token of the collection
//    - listings — well formed while live, no residue once cleared, never priced at 0
//    - provenance — a live listing names whoever really owned the token when listed
// ---------------------------------------------------------------------------------------

import {Test} from "forge-std/Test.sol";

import {NftMarketplace} from "../src/NftMarketplace.sol";
import {MockNft} from "./mocks/MockNft.sol";
import {MarketplaceHandler} from "./handlers/MarketplaceHandler.sol";

contract InvariantsTest is Test {

    uint256 private constant TOKEN_COUNT = 5;
    uint256 private constant STARTING_BALANCE = 100 ether;
    uint256 private constant BUYING_BUDGET = 1000 ether;

    NftMarketplace private marketplace;
    MockNft private nft;
    MarketplaceHandler private handler;
    address[3] private actors;

    function setUp() public {
        marketplace = new NftMarketplace();
        nft = new MockNft();

        actors[0] = makeAddr("alice");
        actors[1] = makeAddr("bob");
        actors[2] = makeAddr("carol");

        for (uint256 i = 0; i < actors.length; i++) {
            vm.deal(actors[i], STARTING_BALANCE);
        }
        // Alice starts with the whole collection; the fuzzer redistributes it
        for (uint256 tokenId = 0; tokenId < TOKEN_COUNT; tokenId++) {
            nft.mint(actors[0], tokenId);
        }

        handler = new MarketplaceHandler(marketplace, nft, actors);

        // The HANDLER is what pays for a purchase, not the actor it pranks: vm.prank
        // swaps msg.sender and nothing else, so the ETH leaves whoever makes the call.
        // Leave it broke and every buy reverts, every sale never happens, and each money
        // invariant below passes over an empty ledger without ever being tested.
        vm.deal(address(handler), BUYING_BUDGET);

        targetContract(address(handler));
    }


    // Solvency: everybody the marketplace owes can be paid. An inequality on purpose —
    // ETH is forced into contracts with selfdestruct, which pays out without ever
    // calling the recipient, so demanding an exact match would hand any passer-by a
    // one-wei way to turn this suite red with the contract having done nothing wrong.
    function invariant_BalanceCoversOutstandingProceeds() public view {
        assertGe(
            address(marketplace).balance,
            _owedToActors(),
            "marketplace cannot cover the proceeds it owes"
        );
    }

    // Solvency alone would not notice a slow leak, so the surplus is explained too:
    // every wei is either still held, or was actually handed to the seller who was owed
    // it. A sale that credits more than it received, or a payout that transfers less
    // than it just zeroed, breaks this line and nothing else in the suite.
    function invariant_EveryWeiIsAccountedFor() public view {
        assertEq(
            address(marketplace).balance + handler.ghost_totalWithdrawn(),
            handler.ghost_totalPaidIn() + handler.ghost_totalForcedIn(),
            "ETH appeared in or vanished from the marketplace unaccounted for"
        );
    }

    // This marketplace is self-custodial: it escrows the ETH and never the token. A
    // token that somehow ended up owned by the marketplace would be stuck there for
    // good — no function in the contract can ever transfer one out again.
    function invariant_MarketplaceNeverCustodiesAToken() public view {
        for (uint256 tokenId = 0; tokenId < TOKEN_COUNT; tokenId++) {
            assertTrue(
                nft.ownerOf(tokenId) != address(marketplace),
                "the marketplace took custody of a token it can never release"
            );
        }

        assertEq(nft.balanceOf(address(marketplace)), 0, "marketplace holds tokens");
    }

    // A listing either does not exist (price 0) or is complete — price 0 is the sentinel
    // for "not listed", so a listing with a price must always name a seller
    function invariant_ActiveListingsAreWellFormed() public view {
        for (uint256 tokenId = 0; tokenId < TOKEN_COUNT; tokenId++) {
            NftMarketplace.Listing memory listing =
                marketplace.getListing(address(nft), tokenId);

            if (listing.price > 0) {
                assertTrue(listing.seller != address(0), "listing without a seller");
            } else {
                assertEq(listing.seller, address(0), "cleared listing kept its seller");
            }
        }
    }

    // The other half of the sentinel, stated from the seller's side: a stored seller
    // with a price of 0 is a listing that exists and does not exist at once — isListed
    // refuses to touch it, while notListed happily lets a second party list the same
    // token straight over the top of it.
    function invariant_LiveListingsHaveANonZeroPrice() public view {
        for (uint256 tokenId = 0; tokenId < TOKEN_COUNT; tokenId++) {
            NftMarketplace.Listing memory listing =
                marketplace.getListing(address(nft), tokenId);

            if (listing.seller != address(0)) {
                assertTrue(
                    listing.price != 0,
                    "a listing names a seller but is invisible to isListed"
                );
            }
        }
    }

    // Nobody can be owed money that nobody paid. The right-hand side is the handler's
    // tally of purchases that actually completed, so credit conjured by an arithmetic
    // slip rather than by a sale has nowhere to hide.
    function invariant_ProceedsNeverExceedWhatWasPaidIn() public view {
        assertLe(
            _owedToActors(),
            handler.ghost_totalPaidIn(),
            "the marketplace owes more than was ever paid into it"
        );
    }

    // Whoever a live listing names as its seller must be whoever the TOKEN said owned it
    // when the listing was created. The 2024 contract's dead isListed guard let
    // updateListing conjure listings nobody had ever listed; a conjured listing has no
    // recorded owner at all, so this line catches that whole family of bugs.
    function invariant_ListingsWereCreatedByTheTokenOwner() public view {
        for (uint256 tokenId = 0; tokenId < TOKEN_COUNT; tokenId++) {
            NftMarketplace.Listing memory listing =
                marketplace.getListing(address(nft), tokenId);
            if (listing.price == 0) continue;

            assertEq(
                listing.seller,
                handler.ghost_ownerWhenListed(tokenId),
                "a live listing credits somebody who never listed that token"
            );
        }
    }


    // Everything the marketplace still owes. The handler only ever acts as one of these
    // three wallets, so no proceeds can be booked outside this sum.
    function _owedToActors() private view returns (uint256 owed) {
        for (uint256 i = 0; i < actors.length; i++) {
            owed += marketplace.getProceeds(actors[i]);
        }
    }
}
