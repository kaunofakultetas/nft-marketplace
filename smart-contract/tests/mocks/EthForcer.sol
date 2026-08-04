// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] EthForcer — pushes ETH into a contract that never agreed to receive it
//
//  The marketplace has no receive() and no fallback(), so an ordinary transfer to it is
//  refused. selfdestruct is the hole in that defence: it moves the whole balance to a
//  target address without executing a single opcode there, so no amount of Solidity can
//  turn it down. Since EIP-6780 the account is only erased when it was created in the
//  same transaction, but the BALANCE always moves — which is the part that matters here.
//
//  Anybody can do this to any address for the price of the ETH they give away, which is
//  why an "address(this).balance equals what we owe" invariant can never be an equality.
//
//  Used by:
//    - tests/Availability.t.sol
// ---------------------------------------------------------------------------------------

contract EthForcer {

    // Funded at construction — the balance this contract will shove at the target
    constructor() payable {}

    function forceInto(address payable target) external {
        selfdestruct(target);
    }
}
