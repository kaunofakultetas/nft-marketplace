// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] MockNft — a throwaway ERC-721 for the marketplace tests
//
//  The marketplace never cares WHICH collection it trades, so the tests need any honest
//  ERC-721 to move around: OpenZeppelin's implementation with a public mint bolted on.
//  It exists only inside the test EVM and is never deployed anywhere.
//
//  Used by:
//    - tests/Bounds.t.sol
//    - tests/Invariants.t.sol
//    - tests/StateMachine.t.sol
//    - tests/base/MarketplaceTestBase.sol
//    - tests/handlers/MarketplaceHandler.sol
// ---------------------------------------------------------------------------------------

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockNft is ERC721 {

    constructor() ERC721("Mock NFT", "MOCK") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}
