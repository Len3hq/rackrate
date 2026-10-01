// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RackOracle} from "../src/RackOracle.sol";

contract RackOracleTest is Test {
    RackOracle internal oracle;

    bytes32 internal constant H100 = keccak256("H100");
    bytes32 internal constant H100_DEMO = keccak256("H100_DEMO");

    address internal owner = makeAddr("owner");
    address internal pubA = makeAddr("pubA");
    address internal pubB = makeAddr("pubB");
    address internal pubC = makeAddr("pubC");
    address internal outsider = makeAddr("outsider");

    uint32 internal constant EPOCH = 3600;
    uint32 internal constant DELAY = 300;
    uint64 internal genesis;

    function setUp() public {
        vm.warp(1_800_000_000);
        genesis = uint64(block.timestamp);
        oracle = new RackOracle(owner);

        vm.startPrank(owner);
        oracle.createFeed(H100, _cfg(false));
        oracle.setPublisher(H100, pubA, true);
        oracle.setPublisher(H100, pubB, true);
        oracle.setPublisher(H100, pubC, true);
        vm.stopPrank();
    }

    function _cfg(bool demo) internal view returns (RackOracle.FeedConfig memory) {
        return RackOracle.FeedConfig({
            genesis: genesis,
            epochLength: EPOCH,
            finalizeDelay: DELAY,
            minPublishers: 2,
            maxJumpBps: 2500, // 25%
            minPrice: 0.5e6,
            maxPrice: 20e6,
            isDemo: demo
        });
    }

    function _submit(address p, uint64 epoch, uint64 price) internal {
        vm.prank(p);
        oracle.submit(H100, epoch, price);
    }

    function _status(uint64 epoch) internal view returns (RackOracle.EpochStatus s, uint64 price) {
        (s,, price) = oracle.getEpoch(H100, epoch);
    }

    // --- median & finalization -------------------------------------------------

    function test_medianOfThree_finalizesEagerly() public {
        _submit(pubA, 0, 3.0e6);
        _submit(pubB, 0, 2.5e6);
        _submit(pubC, 0, 40e6); // outlier is ignored by the median
        (RackOracle.EpochStatus s, uint64 price) = _status(0);
        assertEq(uint8(s), uint8(RackOracle.EpochStatus.Printed));
        assertEq(price, 3.0e6);
        assertEq(oracle.getFeed(H100).nextEpoch, 1);
    }

    function test_medianOfTwo_averagesAfterDelay() public {
        _submit(pubA, 0, 3.0e6);
        _submit(pubB, 0, 2.0e6);
        assertFalse(oracle.canFinalize(H100));

        vm.warp(genesis + EPOCH + DELAY);
        oracle.finalize(H100, 10);
        (RackOracle.EpochStatus s, uint64 price) = _status(0);
        assertEq(uint8(s), uint8(RackOracle.EpochStatus.Printed));
        assertEq(price, 2.5e6);
    }

    function test_singleSubmission_isMissing() public {
        _submit(pubA, 0, 3.0e6);
        vm.warp(genesis + EPOCH + DELAY);
        oracle.finalize(H100, 1);
        (RackOracle.EpochStatus s, uint64 price) = _status(0);
        assertEq(uint8(s), uint8(RackOracle.EpochStatus.Missing));
        assertEq(price, 0);
    }

    function test_noSubmissions_recordedAsGaps() public {
        vm.warp(genesis + 3 * EPOCH + DELAY);
        uint64 n = oracle.finalize(H100, 10);
        assertEq(n, 3);
        (uint256 sum, uint256 printed, uint256 total) = oracle.windowStats(H100, 0, 2);
        assertEq(sum, 0);
        assertEq(printed, 0);
        assertEq(total, 3);
    }

    function test_cannotFinalizeEarly() public {
        _submit(pubA, 0, 3.0e6);
        _submit(pubB, 0, 3.0e6);
        vm.expectRevert(RackOracle.EpochNotFinalizable.selector);
        oracle.finalize(H100, 1);
    }

    function test_outOfBounds_rejected() public {
        _submit(pubA, 0, 25e6);
        _submit(pubB, 0, 26e6);
        _submit(pubC, 0, 27e6);
        (RackOracle.EpochStatus s, uint64 price) = _status(0);
        assertEq(uint8(s), uint8(RackOracle.EpochStatus.RejectedBounds));
        assertEq(price, 0);
    }

    function test_jumpRejected_thenAcceptedAfterMaxRejects() public {
        _printAll(0, 2.0e6);
        // +50% jumps exceed the 25% limit: rejected MAX_CONSECUTIVE_JUMP_REJECTS times...
        for (uint64 e = 1; e <= 3; ++e) {
            vm.warp(genesis + e * EPOCH);
            _printAll(e, 3.0e6);
            (RackOracle.EpochStatus s,) = _status(e);
            assertEq(uint8(s), uint8(RackOracle.EpochStatus.RejectedJump));
        }
        // ...then accepted as a regime change.
        vm.warp(genesis + 4 * EPOCH);
        _printAll(4, 3.0e6);
        (RackOracle.EpochStatus s4, uint64 p4) = _status(4);
        assertEq(uint8(s4), uint8(RackOracle.EpochStatus.Printed));
        assertEq(p4, 3.0e6);
    }

    function test_windowStats_skipsGaps() public {
        _printAll(0, 2.0e6);
        vm.warp(genesis + 2 * EPOCH); // epoch 1 gets no data
        _printAll(2, 2.2e6);
        vm.warp(genesis + 3 * EPOCH + DELAY);
        oracle.finalize(H100, 10); // finalizes epoch 1 as a gap, then epoch 2 (already fully submitted)

        (uint256 sum, uint256 printed, uint256 total) = oracle.windowStats(H100, 0, 2);
        assertEq(sum, 4.2e6);
        assertEq(printed, 2);
        assertEq(total, 3);
    }

    function test_windowStats_revertsOnUnfinalized() public {
        vm.expectRevert(RackOracle.InvalidWindow.selector);
        oracle.windowStats(H100, 0, 0);
    }

    // --- submission guards -----------------------------------------------------

    function test_revert_nonPublisher() public {
        vm.prank(outsider);
        vm.expectRevert(RackOracle.NotPublisher.selector);
        oracle.submit(H100, 0, 3e6);
    }

    function test_revert_duplicateSubmission() public {
        _submit(pubA, 0, 3e6);
        vm.prank(pubA);
        vm.expectRevert(RackOracle.AlreadySubmitted.selector);
        oracle.submit(H100, 0, 3e6);
    }

    function test_revert_futureEpoch() public {
        vm.prank(pubA);
        vm.expectRevert(RackOracle.EpochNotStarted.selector);
        oracle.submit(H100, 1, 3e6);
    }

    function test_revert_submitToFinalizedEpoch() public {
        _printAll(0, 3e6);
        vm.prank(pubA);
        vm.expectRevert(RackOracle.EpochAlreadyFinalized.selector);
        oracle.submit(H100, 0, 3e6);
    }

    function test_revert_zeroPrice() public {
        vm.prank(pubA);
        vm.expectRevert(RackOracle.ZeroPrice.selector);
        oracle.submit(H100, 0, 0);
    }

    // --- admin -----------------------------------------------------------------

    function test_onlyOwnerAdmin() public {
        vm.prank(outsider);
        vm.expectRevert();
        oracle.setPublisher(H100, outsider, true);
    }

    function test_scenario_onlyOnDemoFeeds() public {
        vm.prank(owner);
        vm.expectRevert(RackOracle.NotDemoFeed.selector);
        oracle.scenario(H100, 1);

        vm.startPrank(owner);
        oracle.createFeed(H100_DEMO, _cfg(true));
        vm.expectEmit(true, true, false, true);
        emit RackOracle.Scenario(H100_DEMO, 0, 2);
        oracle.scenario(H100_DEMO, 2);
        vm.stopPrank();
    }

    function test_revert_invalidConfig() public {
        RackOracle.FeedConfig memory cfg = _cfg(false);
        cfg.maxPrice = cfg.minPrice;
        vm.prank(owner);
        vm.expectRevert(RackOracle.InvalidConfig.selector);
        oracle.createFeed(keccak256("BAD"), cfg);
    }

    // --- seed commit-reveal ----------------------------------------------------

    function test_seedCommitReveal() public {
        bytes32 seed = keccak256("secret seed");
        uint64 revealAfter = genesis + 7 days;
        vm.prank(pubA);
        oracle.commitSeed(H100, 1, keccak256(abi.encodePacked(seed)), revealAfter);

        vm.prank(pubA);
        vm.expectRevert(RackOracle.SeedRevealTooEarly.selector);
        oracle.revealSeed(H100, 1, seed);

        vm.warp(revealAfter);
        vm.prank(pubA);
        vm.expectRevert(RackOracle.SeedMismatch.selector);
        oracle.revealSeed(H100, 1, keccak256("wrong"));

        vm.prank(pubA);
        oracle.revealSeed(H100, 1, seed);
        (,, bool revealed) = oracle.seedCommits(H100, 1, pubA);
        assertTrue(revealed);
    }

    // --- fuzz ------------------------------------------------------------------

    function testFuzz_medianWithinInputs(uint64 a, uint64 b, uint64 c) public {
        a = uint64(bound(a, 0.5e6, 20e6));
        b = uint64(bound(b, 0.5e6, 20e6));
        c = uint64(bound(c, 0.5e6, 20e6));
        _submit(pubA, 0, a);
        _submit(pubB, 0, b);
        _submit(pubC, 0, c);
        (, uint64 price) = _status(0);
        uint64 lo = a < b ? (a < c ? a : c) : (b < c ? b : c);
        uint64 hi = a > b ? (a > c ? a : c) : (b > c ? b : c);
        assertGe(price, lo);
        assertLe(price, hi);
        // the median is the value that is neither the strict min nor the strict max
        assertEq(uint256(price), uint256(a) + b + c - lo - hi);
    }

    // --- helpers ---------------------------------------------------------------

    function _printAll(uint64 epoch, uint64 price) internal {
        _submit(pubA, epoch, price);
        _submit(pubB, epoch, price);
        _submit(pubC, epoch, price);
    }
}
