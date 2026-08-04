// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] CrossFunctionAttacker — one hostile counterparty, five re-entrant moves
//
//  Both moments where the marketplace hands control to somebody else land in this
//  contract: onERC721Received (it is buying) and receive() (it is being paid). Each is
//  armed separately with a PLAN — list, cancel, update, buy or withdraw, against a token
//  of the test's choosing — so one test aims exactly one re-entrant call at exactly one
//  function and then asserts what survived.
//
//  Reverts are deliberately NOT caught: a refusal has to bubble all the way out so the
//  test can name the layer that refused instead of accepting any revert at all.
//
//  Used by:
//    - tests/Reentrancy.t.sol
// ---------------------------------------------------------------------------------------

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import {NftMarketplace} from "../../src/NftMarketplace.sol";

contract CrossFunctionAttacker is IERC721Receiver {

    // Every marketplace function reachable from a callback. Only BuyTarget and
    // WithdrawProceeds meet nonReentrant; the other three are unguarded, which is
    // precisely why they are worth aiming at.
    enum Action {
        None,
        ListTarget,
        CancelTarget,
        UpdateTarget,
        BuyTarget,
        WithdrawProceeds
    }

    // `fired` makes a plan single-shot: an action that lands this contract back in the
    // same callback would otherwise recurse until the gas ran out
    struct Plan {
        Action action;
        address nftAddress;
        uint256 tokenId;
        uint256 price;
        bool fired;
    }

    NftMarketplace private immutable i_marketplace;

    Plan private s_hookPlan;
    Plan private s_payoutPlan;
    uint256 private s_received;

    constructor(NftMarketplace marketplace) {
        i_marketplace = marketplace;
    }

    // Where proceeds land. Counting them rather than ignoring them is the point: the
    // tests assert this contract was paid what it was owed exactly once
    receive() external payable {
        s_received += msg.value;
        _fire(s_payoutPlan);
    }


    // --- arming ---

    function armHook(
        Action action,
        address nftAddress,
        uint256 tokenId,
        uint256 price
    ) external {
        s_hookPlan = Plan(action, nftAddress, tokenId, price, false);
    }

    function armPayout(
        Action action,
        address nftAddress,
        uint256 tokenId,
        uint256 price
    ) external {
        s_payoutPlan = Plan(action, nftAddress, tokenId, price, false);
    }


    // --- the honest half: this attacker also trades for real ---

    // A token moving to a new owner loses its single-token approval, so anything this
    // contract intends to list from inside a callback has to be approved collection-wide
    // beforehand — there is no other approval left to lean on mid-transfer
    function approveMarketplaceForAll(address nftAddress) external {
        IERC721(nftAddress).setApprovalForAll(address(i_marketplace), true);
    }

    function listToken(address nftAddress, uint256 tokenId, uint256 price) external {
        IERC721(nftAddress).approve(address(i_marketplace), tokenId);
        i_marketplace.listItem(nftAddress, tokenId, price);
    }

    function buy(address nftAddress, uint256 tokenId, uint256 price) external {
        i_marketplace.buyListing{value: price}(nftAddress, tokenId);
    }

    function withdraw() external {
        i_marketplace.withdrawProceeds();
    }

    function receivedEth() external view returns (uint256) {
        return s_received;
    }


    // --- the strike ---

    // The marketplace is mid-purchase while this runs, and this contract ALREADY owns
    // the token: OpenZeppelin moves ownership before it asks the recipient to accept
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external returns (bytes4) {
        _fire(s_hookPlan);
        return IERC721Receiver.onERC721Received.selector;
    }

    // Marked spent BEFORE the call, so a plan whose action re-enters this contract
    // cannot fire itself a second time
    function _fire(Plan storage plan) private {
        if (plan.action == Action.None || plan.fired) {
            return;
        }
        plan.fired = true;

        if (plan.action == Action.ListTarget) {
            i_marketplace.listItem(plan.nftAddress, plan.tokenId, plan.price);
        } else if (plan.action == Action.CancelTarget) {
            i_marketplace.cancelListing(plan.nftAddress, plan.tokenId);
        } else if (plan.action == Action.UpdateTarget) {
            i_marketplace.updateListing(plan.nftAddress, plan.tokenId, plan.price);
        } else if (plan.action == Action.BuyTarget) {
            i_marketplace.buyListing{value: plan.price}(plan.nftAddress, plan.tokenId);
        } else {
            i_marketplace.withdrawProceeds();
        }
    }
}
