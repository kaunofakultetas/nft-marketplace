// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] WrongInterfaceToken — an address that is a contract but not an ERC-721
//
//  nftAddress is whatever the caller typed, and the commonest mistake is not malice but a
//  paste error: an ERC-20 address, a router, a proxy, anything at all. There is no
//  registry the marketplace could consult, so the only line of defence is the ABI itself
//  — a call to a function the contract does not implement must fail loudly and leave no
//  half-built listing behind.
//
//  Two shapes, because they fail at different places:
//    swallowsEverything = false  no ownerOf and a fallback that reverts empty-handed,
//                                exactly what a plain ERC-20 does
//    swallowsEverything = true   every unknown selector SUCCEEDS and returns no data at
//                                all, so it is the caller's ABI decoder that must refuse
//                                to conjure an address out of an empty return
//
//  Used by:
//    - tests/HostileToken.t.sol
// ---------------------------------------------------------------------------------------

contract WrongInterfaceToken {

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    bool private immutable i_swallowsEverything;

    constructor(bool swallowsEverything) {
        i_swallowsEverything = swallowsEverything;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    // An empty revert() is byte-for-byte what an address with no such function does, so
    // the strict flavour is indistinguishable from a real ERC-20 to any caller
    fallback() external {
        if (!i_swallowsEverything) {
            revert();
        }
    }
}
