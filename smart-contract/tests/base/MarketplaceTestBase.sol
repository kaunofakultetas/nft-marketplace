// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] MarketplaceTestBase — the fixture every test file inherits
//
//  One marketplace, one collection, three wallets. Foundry re-runs setUp() before every
//  single test, so no test can ever see another's state — not even across files.
//
//  The four events are redeclared here (a child contract inherits them and can pass them
//  to expectEmit) and must stay byte-identical to the contract's own declarations.
//
//  Used by:
//    - every suite under tests/ — all of them inherit this fixture, so the list is
//      deliberately not enumerated: it would go stale the moment a suite is added
// ---------------------------------------------------------------------------------------

import {Test} from "forge-std/Test.sol";

import {NftMarketplace} from "../../src/NftMarketplace.sol";
import {MockNft} from "../mocks/MockNft.sol";

abstract contract MarketplaceTestBase is Test {

    event ItemListed(
        address indexed seller,
        address indexed nftAddress,
        uint256 indexed tokenId,
        uint256 price
    );
    event ItemUpdated(
        address indexed seller,
        address indexed nftAddress,
        uint256 indexed tokenId,
        uint256 newPrice
    );
    event ItemCanceled(
        address indexed seller,
        address indexed nftAddress,
        uint256 indexed tokenId
    );
    event ItemBought(
        address indexed buyer,
        address indexed nftAddress,
        uint256 indexed tokenId,
        address seller,
        uint256 price
    );

    NftMarketplace internal marketplace;
    MockNft internal nft;

    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant TOKEN_ID = 0;
    uint256 internal constant OTHER_TOKEN_ID = 1;
    uint256 internal constant PRICE = 1 ether;

    // The seller owns TWO tokens: the second one is what the reentrancy attacker
    // reaches for while the first sale is still in flight
    function setUp() public virtual {
        marketplace = new NftMarketplace();
        nft = new MockNft();

        nft.mint(seller, TOKEN_ID);
        nft.mint(seller, OTHER_TOKEN_ID);

        vm.deal(buyer, 100 ether);
    }

    // Approve + list one token at `price`, as the seller
    function _list(uint256 tokenId, uint256 price) internal {
        vm.startPrank(seller);
        nft.approve(address(marketplace), tokenId);
        marketplace.listItem(address(nft), tokenId, price);
        vm.stopPrank();
    }
}
