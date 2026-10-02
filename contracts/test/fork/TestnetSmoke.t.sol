// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {RackOracle} from "../../src/RackOracle.sol";
import {RRUSD} from "../../src/RRUSD.sol";
import {Series} from "../../src/Series.sol";
import {SeriesFactory} from "../../src/SeriesFactory.sol";

/// @notice End-to-end smoke test against the contracts deployed on Monad testnet, run on a local fork
///         (nothing is broadcast). Enable with: RUN_FORK_TESTS=true forge test --match-path "test/fork/*"
contract TestnetSmokeTest is Test {
    using stdJson for string;

    RackOracle internal oracle;
    RRUSD internal usd;
    SeriesFactory internal factory;
    address internal owner;
    bool internal enabled;

    address internal pubA = makeAddr("pubA");
    address internal pubB = makeAddr("pubB");
    address internal pubC = makeAddr("pubC");
    address internal host = makeAddr("host");
    address internal startup = makeAddr("startup");

    function setUp() public {
        enabled = vm.envOr("RUN_FORK_TESTS", false);
        if (!enabled) return;
        vm.createSelectFork(vm.envString("MONAD_RPC_URL"));
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/10143.json"));
        oracle = RackOracle(json.readAddress(".RackOracle"));
        usd = RRUSD(json.readAddress(".rrUSD"));
        factory = SeriesFactory(json.readAddress(".SeriesFactory"));
        owner = json.readAddress(".deployer");
    }

    function test_endToEnd_demoSeriesOnDeployedContracts() public {
        if (!enabled) vm.skip(true);
        assertEq(block.chainid, 10143);
        assertEq(oracle.owner(), owner);
        assertEq(factory.owner(), owner);

        // Fresh demo feed for this session (no backlog of idle epochs).
        bytes32 feed = keccak256(abi.encodePacked("SMOKE_", block.timestamp));
        vm.startPrank(owner);
        oracle.createFeed(
            feed,
            RackOracle.FeedConfig({
                genesis: uint64(block.timestamp - (block.timestamp % 30)),
                epochLength: 30,
                finalizeDelay: 10,
                minPublishers: 2,
                maxJumpBps: 5000,
                minPrice: 0.5e6,
                maxPrice: 20e6,
                isDemo: true
            })
        );
        oracle.setPublisher(feed, pubA, true);
        oracle.setPublisher(feed, pubB, true);
        oracle.setPublisher(feed, pubC, true);

        uint64 e0 = oracle.currentEpoch(feed);
        Series s = Series(
            factory.createSeries(
                SeriesFactory.CreateParams({
                    feedId: feed,
                    startEpoch: e0,
                    endEpoch: e0 + 3,
                    floor: 1e6,
                    cap: 5e6,
                    minCoverageBps: 9000,
                    settleGrace: 60,
                    label: "H100 SMOKE",
                    symbolStem: "H100SMK"
                })
            )
        );
        vm.stopPrank();

        // GPU owner uses the real faucet, mints 1 GPU-window and passes LONG to an AI startup.
        vm.prank(host);
        usd.faucet();
        assertEq(usd.balanceOf(host), 10_000e6);
        vm.startPrank(host);
        usd.approve(address(s), type(uint256).max);
        assertEq(s.mint(1e6), 16e6); // (5 - 1) * 4 epochs
        s.long().transfer(startup, 1e6);
        vm.stopPrank();

        // Four demo epochs. In epoch 2 publisher C goes rogue ($40/hr); the median ignores it.
        uint64[4] memory prices = [uint64(2e6), 3e6, 3e6, 4e6];
        for (uint64 i; i < 4; ++i) {
            uint64 e = e0 + i;
            uint256 start = oracle.epochStart(feed, e);
            if (block.timestamp < start) vm.warp(start);
            vm.prank(pubA);
            oracle.submit(feed, e, prices[i]);
            vm.prank(pubB);
            oracle.submit(feed, e, prices[i]);
            vm.prank(pubC);
            oracle.submit(feed, e, i == 1 ? 40e6 : prices[i]);
            (RackOracle.EpochStatus st,, uint64 p) = oracle.getEpoch(feed, e);
            assertEq(uint8(st), uint8(RackOracle.EpochStatus.Printed));
            assertEq(p, prices[i]);
        }

        vm.warp(s.windowEnd());
        s.settle();
        assertEq(uint8(s.settlementKind()), uint8(Series.SettlementKind.Full));
        assertEq(s.settlementPrice(), 3e6);

        vm.prank(host);
        assertEq(s.claim(0, 1e6), 8e6);
        vm.prank(startup);
        assertEq(s.claim(1e6, 0), 8e6);
        assertEq(usd.balanceOf(address(s)), 0);
        console2.log("series", address(s), "settled at", s.settlementPrice());
    }

    /// @notice Measures the cost of catching up an idle feed (finalizing empty epochs).
    function test_gas_catchUpIdleDemoFeed() public {
        if (!enabled) vm.skip(true);
        bytes32 demo = keccak256("H100_DEMO");
        RackOracle.Feed memory f = oracle.getFeed(demo);
        uint64 backlog = oracle.currentEpoch(demo) - f.nextEpoch;
        uint256 g = gasleft();
        uint64 n = oracle.finalize(demo, 100);
        uint256 used = g - gasleft();
        console2.log("idle demo epochs pending:", backlog);
        console2.log("empty epochs finalized:", n);
        console2.log("gas per empty epoch:", used / n);
    }
}
