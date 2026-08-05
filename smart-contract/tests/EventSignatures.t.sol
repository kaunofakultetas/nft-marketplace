// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Event signature tests — the deploy tripwire between contract and backend
//
//  The backend indexer reads raw logs: it matches topic[0] against the TOPIC_* constants
//  in backend/app/marketplace/indexer.py, takes the actor / nftAddress / tokenId out of
//  topics 1..3, and decodes the rest from the data field. Rename an event, reorder its
//  parameters, or move one in or out of `indexed`, and the indexer silently stops seeing
//  it — the marketplace would simply look empty.
//
//  Every test performs a real marketplace action and inspects the log the contract
//  ACTUALLY emitted. Hashing a signature string would prove nothing: the string would
//  have to be edited by hand to match a renamed event, which is the very mistake being
//  guarded against.
//
//  The INDEXER_TOPIC_* constants below are copied VERBATIM from backend/main.py's
//  EVENT_TOPICS — the other system's belief rather than this contract's. Change an event
//  here without pasting the new hash there and one of these tests goes red before
//  anything reaches a chain.
// ---------------------------------------------------------------------------------------

import {Vm} from "forge-std/Vm.sol";

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";

contract EventSignaturesTest is MarketplaceTestBase {

    // Verbatim from backend/main.py's EVENT_TOPICS — do not recompute these from the
    // contract, that would make every test below compare the contract with itself
    bytes32 private constant INDEXER_TOPIC_ITEM_LISTED =
        0xd547e933094f12a9159076970143ebe73234e64480317844b0dcb36117116de4;
    bytes32 private constant INDEXER_TOPIC_ITEM_UPDATED =
        0x3c33e65e8698294810b631d476d60b44425303828da0b1f8b635231bfda12be2;
    bytes32 private constant INDEXER_TOPIC_ITEM_BOUGHT =
        0x93c830507acd24c092e291f65f36eccf9df2be394d8b7a1802669761ff1ed995;
    bytes32 private constant INDEXER_TOPIC_ITEM_CANCELED =
        0x9ba1a3cb55ce8d63d072a886f94d2a744f50cddf82128e897d0661f5ec623158;

    // The indexer's decoder reads three indexed params out of every event: topic[0] plus
    // three more
    uint256 private constant EXPECTED_TOPIC_COUNT = 4;


    // The one log the MARKETPLACE emitted during the recorded action — the NFT contract
    // emits its own Approval and Transfer logs in the same transactions, so filtering by
    // emitter is what isolates ours
    function _marketplaceLog() private returns (Vm.Log memory) {
        Vm.Log[] memory logs = vm.getRecordedLogs();

        for (uint256 i = logs.length; i > 0; i--) {
            if (logs[i - 1].emitter == address(marketplace)) {
                return logs[i - 1];
            }
        }
        revert("no log was emitted by the marketplace");
    }


    // Listing still announces what the backend expects, and carries price alone in data
    function test_ItemListed_MatchesTheIndexersConstant() public {
        vm.recordLogs();
        _list(TOKEN_ID, PRICE);

        Vm.Log memory log = _marketplaceLog();
        assertEq(log.topics[0], INDEXER_TOPIC_ITEM_LISTED, "ItemListed topic changed");
        assertEq(log.topics.length, EXPECTED_TOPIC_COUNT, "indexed params changed");
        assertEq(log.data.length, 32, "data should hold price only");
    }

    // Cancelling likewise, with nothing at all in the data field
    function test_ItemCanceled_MatchesTheIndexersConstant() public {
        _list(TOKEN_ID, PRICE);

        vm.recordLogs();
        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        Vm.Log memory log = _marketplaceLog();
        assertEq(
            log.topics[0], INDEXER_TOPIC_ITEM_CANCELED, "ItemCanceled topic changed"
        );
        assertEq(log.topics.length, EXPECTED_TOPIC_COUNT, "indexed params changed");
        assertEq(log.data.length, 0, "data should be empty");
    }

    // Buying announces the seller-carrying event the backend's decoder reads two data
    // words out of
    function test_ItemBought_MatchesTheIndexersConstant() public {
        _list(TOKEN_ID, PRICE);

        vm.recordLogs();
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        Vm.Log memory log = _marketplaceLog();
        assertEq(
            log.topics[0],
            INDEXER_TOPIC_ITEM_BOUGHT,
            "ItemBought topic no longer matches the backend's EVENT_SIGNATURES"
        );
        assertEq(log.topics.length, EXPECTED_TOPIC_COUNT, "indexed params changed");
    }

    // A reprice announces its own event — matched by the backend as 'Updated' directly,
    // and distinct from every other topic it knows, so no replay guessing is ever needed
    function test_ItemUpdated_MatchesTheIndexersConstant() public {
        _list(TOKEN_ID, PRICE);

        vm.recordLogs();
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 2 ether);

        Vm.Log memory log = _marketplaceLog();
        assertEq(
            log.topics[0],
            INDEXER_TOPIC_ITEM_UPDATED,
            "ItemUpdated topic no longer matches the backend's EVENT_SIGNATURES"
        );
        assertTrue(log.topics[0] != INDEXER_TOPIC_ITEM_LISTED, "must differ from Listed");
        assertTrue(log.topics[0] != INDEXER_TOPIC_ITEM_BOUGHT, "must differ from Bought");
        assertTrue(
            log.topics[0] != INDEXER_TOPIC_ITEM_CANCELED, "must differ from Canceled"
        );
        assertEq(log.topics.length, EXPECTED_TOPIC_COUNT, "indexed params changed");
        assertEq(log.data.length, 32, "data should hold newPrice only");
    }

    // Whatever the topic ends up being, the SHAPE the decoder assumes must hold: three
    // indexed params, then seller and price as two data words in that order
    function test_ItemBought_ShapeMatchesTheIndexersDecoder() public {
        _list(TOKEN_ID, PRICE);

        vm.recordLogs();
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        Vm.Log memory log = _marketplaceLog();
        assertEq(log.topics.length, EXPECTED_TOPIC_COUNT, "indexed params changed");
        assertEq(log.data.length, 64, "data should hold seller then price");

        (address loggedSeller, uint256 loggedPrice) =
            abi.decode(log.data, (address, uint256));
        assertEq(loggedSeller, seller, "seller must be the first data word");
        assertEq(loggedPrice, PRICE, "price must be the second data word");
    }
}
