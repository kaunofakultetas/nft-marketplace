// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Listing tests — listItem writes the row, announces it, and touches nothing else
//
//  The marketplace never takes custody, so listing is only a promise backed by an
//  approval: these tests check the promise is recorded, announced, and never accepted
//  from someone who cannot keep it.
//
//  The other half of the job is everything listItem must NOT do. It moves no token, no
//  ether and no approval; it writes exactly one row and exactly one log; and it leaves
//  every other seller, token and collection precisely as it found them. A function that
//  quietly touches a neighbour is the bug this file is built to catch — the backend
//  rebuilds the entire market from the logs, so a second event or a missing topic is a
//  storefront that lies.
//
//  Covers:
//    - the stored row, the single ItemListed log, and the exact values in its topics
//    - the non-effects: custody, balances, proceeds and the seller's own ERC-721 approval
//    - refusals that leave nothing behind, including a re-list that must not overwrite
//    - approvals are per token, per collection and per owner — none of them stretches
//    - two sellers, two tokens and two collections as fully independent entries
//    - a tokenId nobody ever minted, refused by the collection before the marketplace
//    - a contract as the seller, and a table of plausible prices coexisting exactly
// ---------------------------------------------------------------------------------------

import {Vm} from "forge-std/Vm.sol";

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {MockNft} from "./mocks/MockNft.sol";
import {
    NftMarketplace,
    NftMarketplace__PriceMustBeAboveZero,
    NftMarketplace__NotApprovedForMarketplace,
    NftMarketplace__AlreadyListed,
    NftMarketplace__NotOwner
} from "../src/NftMarketplace.sol";

contract ListingTest is MarketplaceTestBase {

    uint256 private constant OTHER_PRICE = 2.5 ether;
    uint256 private constant STRANGER_TOKEN = 7;
    uint256 private constant CONTRACT_TOKEN = 42;
    uint256 private constant NEVER_MINTED_TOKEN = 999;
    uint256 private constant PRICE_TABLE_BASE = 300;

    // The indexer reads three indexed params plus the event signature out of every log
    uint256 private constant EXPECTED_TOPIC_COUNT = 4;


    // "Nothing is listed here" has to mean BOTH fields: a surviving seller address would
    // still be read by anything that takes the struct apart
    function _assertNoListing(address collection, uint256 tokenId) private {
        NftMarketplace.Listing memory listing =
            marketplace.getListing(collection, tokenId);
        assertEq(listing.price, 0, "a price exists where none should");
        assertEq(listing.seller, address(0), "a seller exists where none should");
    }

    // The mirror: a row is only right if BOTH halves are, since the price decides what a
    // buyer pays and the seller decides who receives it
    function _assertListing(
        address collection,
        uint256 tokenId,
        address expectedSeller,
        uint256 expectedPrice
    ) private {
        NftMarketplace.Listing memory listing =
            marketplace.getListing(collection, tokenId);
        assertEq(listing.price, expectedPrice, "the stored price is wrong");
        assertEq(listing.seller, expectedSeller, "the stored seller is wrong");
    }


    // The happy path: the listing is stored with its seller, and the event carries both
    function test_ListItem_StoresListingAndEmits() public {
        vm.prank(seller);
        nft.approve(address(marketplace), TOKEN_ID);

        vm.expectEmit(true, true, true, true);
        emit ItemListed(seller, address(nft), TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, PRICE);
        assertEq(listing.seller, seller);
        // The marketplace never takes custody — the token stays put
        assertEq(nft.ownerOf(TOKEN_ID), seller);
    }

    // REGRESSION: the 2024 contract only accepted approve(), so a student who had used
    // setApprovalForAll was refused
    function test_ListItem_AcceptsSetApprovalForAll() public {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
        vm.stopPrank();

        _assertListing(address(nft), TOKEN_ID, seller, PRICE);
    }

    // Listing without any approval must be refused, not stored — and the refusal must
    // leave the token and the empty row exactly as they were
    function test_ListItem_RevertsWithoutApproval() public {
        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        _assertNoListing(address(nft), TOKEN_ID);
        assertEq(nft.ownerOf(TOKEN_ID), seller);
        assertEq(nft.getApproved(TOKEN_ID), address(0), "a refusal granted an approval");
    }

    // Price 0 is the "not listed" sentinel, so it can never be a real price. The refused
    // attempt must also cost the seller nothing: the same token lists straight afterwards
    function test_ListItem_RevertsOnZeroPrice() public {
        vm.prank(seller);
        nft.approve(address(marketplace), TOKEN_ID);

        vm.expectRevert(NftMarketplace__PriceMustBeAboveZero.selector);
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, 0);

        _assertNoListing(address(nft), TOKEN_ID);

        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        _assertListing(address(nft), TOKEN_ID, seller, PRICE);
    }

    // Only the owner may sell it, and the rejected attempt must not leave a half-written
    // row behind for the owner's own listing to inherit
    function test_ListItem_RevertsForNonOwner() public {
        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(stranger);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        _assertNoListing(address(nft), TOKEN_ID);
        assertEq(nft.ownerOf(TOKEN_ID), seller);

        _list(TOKEN_ID, PRICE);

        _assertListing(address(nft), TOKEN_ID, seller, PRICE);
    }

    // Listing twice would silently overwrite the first listing — so the second attempt
    // names a DIFFERENT price, and the original price and seller must both survive it
    function test_ListItem_RevertsIfAlreadyListed() public {
        _list(TOKEN_ID, PRICE);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__AlreadyListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, OTHER_PRICE);

        _assertListing(address(nft), TOKEN_ID, seller, PRICE);
    }

    // Listing is bookkeeping and nothing else: the promise is recorded while the token,
    // the approval behind it and every balance in sight stay exactly where they were
    function test_ListItem_MovesNoTokenNoEtherAndNoApproval() public {
        vm.prank(seller);
        nft.approve(address(marketplace), TOKEN_ID);

        uint256 sellerBefore = seller.balance;
        uint256 buyerBefore = buyer.balance;

        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        assertEq(nft.ownerOf(TOKEN_ID), seller, "the marketplace took custody");
        assertEq(nft.balanceOf(address(marketplace)), 0, "the marketplace holds a token");
        assertEq(
            nft.getApproved(TOKEN_ID),
            address(marketplace),
            "listing consumed the approval it relies on"
        );
        assertFalse(
            nft.isApprovedForAll(seller, address(marketplace)),
            "listing widened a single-token approval into a blanket one"
        );

        assertEq(address(marketplace).balance, 0, "listing moved ether");
        assertEq(seller.balance, sellerBefore, "the seller paid to advertise");
        assertEq(buyer.balance, buyerBefore);
        assertEq(marketplace.getProceeds(seller), 0, "advertising credited the seller");
        assertEq(marketplace.getProceeds(buyer), 0);
        assertEq(marketplace.getProceeds(stranger), 0);
    }

    // The indexer rebuilds the whole market from logs, so one listing must produce ONE
    // log and no other: a second event would conjure a listing nobody made, and the three
    // topics are the only place the actor, the collection and the token are carried
    function test_ListItem_EmitsExactlyOneEventCarryingTheIndexedTruth() public {
        vm.prank(seller);
        nft.approve(address(marketplace), TOKEN_ID);

        vm.recordLogs();
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "listing emitted something besides its own event");
        assertEq(logs[0].emitter, address(marketplace), "another contract logged");
        assertEq(logs[0].topics.length, EXPECTED_TOPIC_COUNT, "indexed params changed");
        assertEq(logs[0].topics[0], ItemListed.selector, "the event signature changed");
        assertEq(
            address(uint160(uint256(logs[0].topics[1]))), seller, "wrong seller topic"
        );
        assertEq(
            address(uint160(uint256(logs[0].topics[2]))),
            address(nft),
            "wrong collection topic"
        );
        assertEq(uint256(logs[0].topics[3]), TOKEN_ID, "wrong tokenId topic");
        assertEq(abi.decode(logs[0].data, (uint256)), PRICE, "wrong price in the data");
    }

    // Listings are keyed by token, never by seller: one wallet putting something on the
    // market must leave what another wallet already advertised bit for bit alone
    function test_ListItem_ASecondSellerNeverDisturbsTheFirstOnesEntry() public {
        _list(TOKEN_ID, PRICE);
        nft.mint(stranger, STRANGER_TOKEN);

        vm.startPrank(stranger);
        nft.approve(address(marketplace), STRANGER_TOKEN);
        marketplace.listItem(address(nft), STRANGER_TOKEN, OTHER_PRICE);
        vm.stopPrank();

        _assertListing(address(nft), TOKEN_ID, seller, PRICE);
        _assertListing(address(nft), STRANGER_TOKEN, stranger, OTHER_PRICE);

        // A third listing, by the first seller again, leaves both earlier rows standing
        _list(OTHER_TOKEN_ID, 3 ether);

        _assertListing(address(nft), TOKEN_ID, seller, PRICE);
        _assertListing(address(nft), STRANGER_TOKEN, stranger, OTHER_PRICE);
        _assertListing(address(nft), OTHER_TOKEN_ID, seller, 3 ether);

        // Nobody has earned anything by advertising, and nothing has changed hands
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(marketplace.getProceeds(stranger), 0);
        assertEq(nft.ownerOf(TOKEN_ID), seller);
        assertEq(nft.ownerOf(STRANGER_TOKEN), stranger);
    }

    // An approve() names ONE token. Granting it for the second must not open the first,
    // or a seller approving a trinket would be putting their whole wallet on the market
    function test_ListItem_ApprovalForOneTokenDoesNotCoverAnother() public {
        vm.prank(seller);
        nft.approve(address(marketplace), OTHER_TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        _assertNoListing(address(nft), TOKEN_ID);

        // The token that WAS approved still lists, so the refusal above was about the
        // token asked for and not about the approval being unusable
        vm.prank(seller);
        marketplace.listItem(address(nft), OTHER_TOKEN_ID, PRICE);

        _assertListing(address(nft), OTHER_TOKEN_ID, seller, PRICE);
        _assertNoListing(address(nft), TOKEN_ID);
    }

    // The approval must be looked up on the collection being listed. Every collection
    // numbers its tokens from zero, so an approval read off the wrong contract would slip
    // through unnoticed for id 0 and open a collection its owner never approved
    function test_ListItem_ApprovalInOneCollectionDoesNotCoverAnother() public {
        MockNft second = new MockNft();
        second.mint(seller, TOKEN_ID);

        _list(TOKEN_ID, PRICE);

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(seller);
        marketplace.listItem(address(second), TOKEN_ID, OTHER_PRICE);

        _assertNoListing(address(second), TOKEN_ID);

        vm.startPrank(seller);
        second.approve(address(marketplace), TOKEN_ID);
        marketplace.listItem(address(second), TOKEN_ID, OTHER_PRICE);
        vm.stopPrank();

        // Two rows, the same id, two collections, neither written over by the other
        _assertListing(address(nft), TOKEN_ID, seller, PRICE);
        _assertListing(address(second), TOKEN_ID, seller, OTHER_PRICE);
        assertEq(nft.getApproved(TOKEN_ID), address(marketplace));
        assertEq(second.getApproved(TOKEN_ID), address(marketplace));
    }

    // One setApprovalForAll is meant to cover the whole collection for as long as it
    // stands: listing under it must neither spend it nor demand a second grant for the
    // next token, which is the whole reason a seller chooses it over approve()
    function test_ListItem_OneBlanketApprovalCoversEveryTokenInTheCollection() public {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
        marketplace.listItem(address(nft), OTHER_TOKEN_ID, OTHER_PRICE);
        vm.stopPrank();

        _assertListing(address(nft), TOKEN_ID, seller, PRICE);
        _assertListing(address(nft), OTHER_TOKEN_ID, seller, OTHER_PRICE);

        assertTrue(
            nft.isApprovedForAll(seller, address(marketplace)),
            "listing spent the collection-wide approval"
        );
        // And the marketplace never writes a per-token approval on the seller's behalf
        assertEq(nft.getApproved(TOKEN_ID), address(0), "a per-token approval appeared");
        assertEq(nft.getApproved(OTHER_TOKEN_ID), address(0));
    }

    // A blanket approval belongs to the OWNER who granted it, so it must be read against
    // whoever holds the token now. A check that consulted the previous owner would let
    // the new one list on a permission they never gave
    function test_ListItem_TheSellersBlanketApprovalDoesNotCoverTheNewOwner() public {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
        vm.stopPrank();

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertTrue(nft.isApprovedForAll(seller, address(marketplace)));
        assertFalse(
            nft.isApprovedForAll(buyer, address(marketplace)),
            "the buyer inherited an approval they never granted"
        );

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(buyer);
        marketplace.listItem(address(nft), TOKEN_ID, OTHER_PRICE);

        _assertNoListing(address(nft), TOKEN_ID);

        vm.prank(seller);
        marketplace.listItem(address(nft), OTHER_TOKEN_ID, OTHER_PRICE);

        _assertListing(address(nft), OTHER_TOKEN_ID, seller, OTHER_PRICE);
    }

    // A listing is a promise recorded here, not a lock on the token: the seller may hand
    // the approval to somebody else afterwards and the row stays exactly as written. The
    // way back out is a cancel — re-listing over a live row is still refused
    function test_ListItem_EntrySurvivesTheApprovalBeingHandedElsewhere() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.approve(stranger, TOKEN_ID);

        assertEq(nft.getApproved(TOKEN_ID), stranger, "the reassignment did not happen");
        _assertListing(address(nft), TOKEN_ID, seller, PRICE);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__AlreadyListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, OTHER_PRICE);

        _assertListing(address(nft), TOKEN_ID, seller, PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), TOKEN_ID);
    }

    // Sellers are not always wallets — a treasury, a vault or a game contract lists the
    // same way. Any contract account will do as the stand-in, so a second MockNft serves
    // as one: what matters is that msg.sender has code and is not tx.origin
    function test_ListItem_AcceptsASellerThatIsAContract() public {
        address contractSeller = address(new MockNft());
        assertTrue(contractSeller.code.length > 0, "the stand-in seller has no code");

        nft.mint(contractSeller, CONTRACT_TOKEN);

        vm.prank(contractSeller);
        nft.approve(address(marketplace), CONTRACT_TOKEN);

        vm.expectEmit(true, true, true, true);
        emit ItemListed(contractSeller, address(nft), CONTRACT_TOKEN, PRICE);

        vm.prank(contractSeller);
        marketplace.listItem(address(nft), CONTRACT_TOKEN, PRICE);

        _assertListing(address(nft), CONTRACT_TOKEN, contractSeller, PRICE);
        assertEq(nft.ownerOf(CONTRACT_TOKEN), contractSeller);
        assertEq(marketplace.getProceeds(contractSeller), 0);
    }

    // Prices a seller might really type, all live at the same time. Checking each one
    // right after its own listItem would miss the worse version of this bug: a later
    // listing writing over an earlier row, which only a second pass at the end can see
    function test_ListItem_ManyPricesCoexistExactlyAcrossTokens() public {
        uint256[5] memory prices =
            [uint256(1), 1 gwei, 0.05 ether, 1 ether, 100000 ether];

        for (uint256 i = 0; i < prices.length; i++) {
            uint256 tokenId = PRICE_TABLE_BASE + i;
            nft.mint(seller, tokenId);
            _list(tokenId, prices[i]);
        }

        for (uint256 i = 0; i < prices.length; i++) {
            _assertListing(address(nft), PRICE_TABLE_BASE + i, seller, prices[i]);
        }

        assertEq(address(marketplace).balance, 0, "advertising moved money");
        assertEq(marketplace.getProceeds(seller), 0);
    }

    // PROPERTY: whatever the seller asks and for whichever token, the stored row and the
    // log must agree with the arguments to the wei. The backend believes the log and
    // Remix believes the struct, so a truncation on either side would part the two
    function testFuzz_ListItem_StorageAndLogAgreeWithTheArguments(
        uint256 rawTokenId,
        uint256 rawPrice
    ) public {
        uint256 tokenId = _bound(rawTokenId, 2, type(uint256).max);
        uint256 price = _bound(rawPrice, 1, type(uint256).max);

        nft.mint(seller, tokenId);

        vm.prank(seller);
        nft.approve(address(marketplace), tokenId);

        vm.recordLogs();
        vm.prank(seller);
        marketplace.listItem(address(nft), tokenId, price);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "listing emitted more than its own event");
        assertEq(uint256(logs[0].topics[3]), tokenId, "the logged tokenId differs");
        assertEq(abi.decode(logs[0].data, (uint256)), price, "the logged price differs");

        _assertListing(address(nft), tokenId, seller, price);

        // However wild the fuzzed pair is, the fixture's own tokens stay unlisted
        _assertNoListing(address(nft), TOKEN_ID);
        _assertNoListing(address(nft), OTHER_TOKEN_ID);
    }

    // A token id nobody ever minted has no owner for the isOwner modifier to compare
    // against, so the collection reverts before the marketplace forms an opinion: the
    // caller gets a bare ERC-721 error, not one of the marketplace's own
    function test_ListItem_OnANonExistentTokenIdFailsInTheCollection() public {
        vm.expectRevert(
            abi.encodeWithSignature(
                "ERC721NonexistentToken(uint256)", NEVER_MINTED_TOKEN
            )
        );
        vm.prank(seller);
        marketplace.listItem(address(nft), NEVER_MINTED_TOKEN, PRICE);

        _assertNoListing(address(nft), NEVER_MINTED_TOKEN);
    }
}
