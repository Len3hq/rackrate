// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RRUSD} from "../src/RRUSD.sol";

contract RRUSDTest is Test {
    RRUSD internal token;
    address internal treasury = makeAddr("treasury");
    address internal user = makeAddr("user");

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new RRUSD(treasury, 1_000_000e6);
    }

    function test_metadataAndInitialSupply() public view {
        assertEq(token.decimals(), 6);
        assertEq(token.symbol(), "rrUSD");
        assertEq(token.balanceOf(treasury), 1_000_000e6);
    }

    function test_faucet() public {
        vm.prank(user);
        token.faucet();
        assertEq(token.balanceOf(user), token.FAUCET_AMOUNT());
    }

    function test_faucetCooldown() public {
        vm.prank(user);
        token.faucet();

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(RRUSD.FaucetCooldown.selector, block.timestamp + 1 days));
        token.faucet();

        vm.warp(block.timestamp + 1 days);
        vm.prank(user);
        token.faucet();
        assertEq(token.balanceOf(user), 2 * token.FAUCET_AMOUNT());
    }
}
