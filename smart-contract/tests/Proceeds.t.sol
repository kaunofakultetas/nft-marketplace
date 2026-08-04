// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Proceeds tests — the pull-payment balance
//
//  Sale money waits inside the marketplace until the seller pulls it, which is what
//  stops a seller whose wallet rejects ETH from blocking a sale. The balance is zeroed
//  before the transfer, so there is never anything left to claim twice.
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {NftMarketplace__NoProceeds} from "../src/NftMarketplace.sol";

contract ProceedsTest is MarketplaceTestBase {

    // The seller ends up with the ETH and the contract with nothing
    function test_WithdrawProceeds_PaysTheSeller() public {
        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        uint256 balanceBefore = seller.balance;

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, balanceBefore + PRICE);
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0);
    }

    // Nothing earned, nothing to withdraw
    function test_WithdrawProceeds_RevertsWithNoProceeds() public {
        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        vm.prank(seller);
        marketplace.withdrawProceeds();
    }

    // The balance is zeroed before the transfer, so a second call finds nothing — the
    // same property that makes reentrancy here pointless
    function test_WithdrawProceeds_CannotBeDrainedTwice() public {
        _list(TOKEN_ID, PRICE);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.startPrank(seller);
        marketplace.withdrawProceeds();

        vm.expectRevert(NftMarketplace__NoProceeds.selector);
        marketplace.withdrawProceeds();
        vm.stopPrank();
    }
}
