// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] BurnableNft — a collection that can stop answering the marketplace
//
//  Every listing path asks the collection who owns the token, so a collection that cannot
//  answer takes its listings hostage. This mock is the three ways that happens in the
//  wild, switched on when a test wants them:
//
//    burn(tokenId)    the token ceases to exist and ownerOf REVERTS instead of naming an
//                     owner — the ERC-721 standard demands exactly that, so this is
//                     honest behaviour, not hostile behaviour
//    breakOwnerOf()   ownerOf reverts for every token while the rest of the collection
//                     still answers: a botched proxy upgrade, a frozen accessor
//    brick()          every function reverts: a paused, abandoned or destroyed collection
//
//  Only the four functions the marketplace actually calls are implemented — ownerOf,
//  getApproved, isApprovedForAll and the 3-argument safeTransferFrom — plus the mint and
//  approval helpers a test needs to build a listing. rawOwnerOf reads the books directly,
//  so a test can still see the truth after the collection has stopped talking.
//
//  Used by:
//    - tests/Availability.t.sol
// ---------------------------------------------------------------------------------------

contract BurnableNft {

    error BurnableNft__TokenBurned(uint256 tokenId);
    error BurnableNft__OwnerOfUnavailable(uint256 tokenId);
    error BurnableNft__CollectionBricked();
    error BurnableNft__NotTheOwner();

    mapping(uint256 => address) private s_owners;
    mapping(uint256 => address) private s_approved;
    mapping(address => mapping(address => bool)) private s_approvedForAll;

    bool private s_ownerOfBroken;
    bool private s_bricked;


    // --- the test's controls: the marketplace never calls any of these ---

    function mint(address to, uint256 tokenId) external {
        s_owners[tokenId] = to;
    }

    // The approval goes with the token, as a real burn would take it
    function burn(uint256 tokenId) external {
        delete s_owners[tokenId];
        delete s_approved[tokenId];
    }

    function breakOwnerOf() external {
        s_ownerOfBroken = true;
    }

    function brick() external {
        s_bricked = true;
    }

    // The books, still readable once the collection refuses to answer the marketplace
    function rawOwnerOf(uint256 tokenId) external view returns (address) {
        return s_owners[tokenId];
    }


    // --- everything below is what the marketplace sees ---

    function approve(address to, uint256 tokenId) external {
        if (s_owners[tokenId] != msg.sender) {
            revert BurnableNft__NotTheOwner();
        }
        s_approved[tokenId] = to;
    }

    function setApprovalForAll(address operator, bool approved) external {
        s_approvedForAll[msg.sender][operator] = approved;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        if (s_bricked) {
            revert BurnableNft__CollectionBricked();
        }
        if (s_ownerOfBroken) {
            revert BurnableNft__OwnerOfUnavailable(tokenId);
        }

        address holder = s_owners[tokenId];
        if (holder == address(0)) {
            revert BurnableNft__TokenBurned(tokenId);
        }
        return holder;
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        if (s_bricked) {
            revert BurnableNft__CollectionBricked();
        }
        return s_approved[tokenId];
    }

    function isApprovedForAll(address holder, address operator)
        external
        view
        returns (bool)
    {
        if (s_bricked) {
            revert BurnableNft__CollectionBricked();
        }
        return s_approvedForAll[holder][operator];
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        if (s_bricked) {
            revert BurnableNft__CollectionBricked();
        }
        if (s_owners[tokenId] == address(0)) {
            revert BurnableNft__TokenBurned(tokenId);
        }
        if (s_owners[tokenId] != from) {
            revert BurnableNft__NotTheOwner();
        }

        s_owners[tokenId] = to;
        delete s_approved[tokenId];
    }
}
