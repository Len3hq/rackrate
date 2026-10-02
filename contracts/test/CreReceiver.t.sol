// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {RackOracle} from "../src/RackOracle.sol";
import {CreReceiver} from "../src/CreReceiver.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";

contract CreReceiverTest is Test {
    RackOracle internal oracle;
    CreReceiver internal receiver;

    bytes32 internal constant H100 = keccak256("H100");
    address internal owner = makeAddr("owner");
    address internal forwarder = makeAddr("forwarder");
    address internal pubB = makeAddr("pubB");
    address internal workflowOwner = makeAddr("workflowOwner");
    bytes32 internal constant WORKFLOW_ID = keccak256("rackrate-price-publisher");

    function setUp() public {
        vm.warp(1_800_000_000);
        oracle = new RackOracle(owner);
        receiver = new CreReceiver(owner, oracle, forwarder);
        vm.startPrank(owner);
        oracle.createFeed(
            H100,
            RackOracle.FeedConfig({
                genesis: uint64(block.timestamp),
                epochLength: 3600,
                finalizeDelay: 300,
                minPublishers: 2,
                maxJumpBps: 2500,
                minPrice: 0.5e6,
                maxPrice: 20e6,
                isDemo: false
            })
        );
        oracle.setPublisher(H100, address(receiver), true);
        oracle.setPublisher(H100, pubB, true);
        vm.stopPrank();
    }

    function _metadata(address wfOwner) internal pure returns (bytes memory) {
        return abi.encodePacked(WORKFLOW_ID, bytes10("rackrate01"), wfOwner);
    }

    function _act(CreReceiver.ActionKind kind, uint64 a, uint64 b, bytes32 data)
        internal
        pure
        returns (CreReceiver.Action memory)
    {
        return CreReceiver.Action({kind: kind, feedId: H100, a: a, b: b, data: data});
    }

    function _send(CreReceiver.Action[] memory actions) internal {
        vm.prank(forwarder);
        receiver.onReport(_metadata(workflowOwner), abi.encode(actions));
    }

    function test_batch_commitAndSubmit_asPublisher() public {
        bytes32 seed = keccak256("cre seed");
        CreReceiver.Action[] memory actions = new CreReceiver.Action[](2);
        actions[0] = _act(
            CreReceiver.ActionKind.CommitSeed, 0, uint64(block.timestamp + 7 days), keccak256(abi.encodePacked(seed))
        );
        actions[1] = _act(CreReceiver.ActionKind.Submit, 0, 3e6, bytes32(0));
        _send(actions);

        assertTrue(oracle.hasSubmitted(H100, 0, address(receiver)), "receiver is the publisher");
        (bytes32 hash,,) = oracle.seedCommits(H100, 0, address(receiver));
        assertEq(hash, keccak256(abi.encodePacked(seed)));

        // Second publisher completes the epoch: the median includes the CRE price.
        vm.prank(pubB);
        oracle.submit(H100, 0, 4e6);
        (RackOracle.EpochStatus st,, uint64 price) = oracle.getEpoch(H100, 0);
        assertEq(uint8(st), uint8(RackOracle.EpochStatus.Printed));
        assertEq(price, 3.5e6);

        // Reveal after the period.
        vm.warp(block.timestamp + 7 days);
        CreReceiver.Action[] memory reveal = new CreReceiver.Action[](1);
        reveal[0] = _act(CreReceiver.ActionKind.RevealSeed, 0, 0, seed);
        _send(reveal);
        (,, bool revealed) = oracle.seedCommits(H100, 0, address(receiver));
        assertTrue(revealed);
    }

    function test_failedActionDoesNotDiscardBatch() public {
        CreReceiver.Action[] memory actions = new CreReceiver.Action[](3);
        actions[0] = _act(CreReceiver.ActionKind.Submit, 0, 3e6, bytes32(0));
        actions[1] = _act(CreReceiver.ActionKind.Submit, 0, 3e6, bytes32(0)); // duplicate -> AlreadySubmitted
        actions[2] = _act(CreReceiver.ActionKind.Finalize, 10, 0, bytes32(0)); // nothing finalizable yet

        vm.recordLogs();
        _send(actions);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 failures;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == CreReceiver.ActionFailed.selector) failures++;
            if (logs[i].topics[0] == CreReceiver.ReportProcessed.selector) {
                (uint256 total, uint256 failed) = abi.decode(logs[i].data, (uint256, uint256));
                assertEq(total, 3);
                assertEq(failed, 2);
            }
        }
        assertEq(failures, 2);
        assertTrue(oracle.hasSubmitted(H100, 0, address(receiver)), "first action still applied");
    }

    function test_revert_notForwarder() public {
        CreReceiver.Action[] memory actions = new CreReceiver.Action[](1);
        actions[0] = _act(CreReceiver.ActionKind.Submit, 0, 3e6, bytes32(0));
        vm.prank(pubB);
        vm.expectRevert(abi.encodeWithSelector(CreReceiver.InvalidSender.selector, pubB));
        receiver.onReport(_metadata(workflowOwner), abi.encode(actions));
    }

    function test_revert_shortMetadata() public {
        vm.prank(forwarder);
        vm.expectRevert(CreReceiver.InvalidMetadata.selector);
        receiver.onReport(hex"1234", abi.encode(new CreReceiver.Action[](0)));
    }

    function test_expectedWorkflowOwner() public {
        vm.prank(owner);
        receiver.setExpectedWorkflowOwner(workflowOwner);

        CreReceiver.Action[] memory actions = new CreReceiver.Action[](1);
        actions[0] = _act(CreReceiver.ActionKind.Submit, 0, 3e6, bytes32(0));
        address attacker = makeAddr("attacker");
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(CreReceiver.InvalidWorkflowOwner.selector, attacker));
        receiver.onReport(_metadata(attacker), abi.encode(actions));

        _send(actions); // correct owner passes
        assertTrue(oracle.hasSubmitted(H100, 0, address(receiver)));
    }

    function test_forwarderSwitch_onlyOwner() public {
        address production = makeAddr("productionForwarder");
        vm.prank(pubB);
        vm.expectRevert();
        receiver.setForwarder(production);

        vm.prank(owner);
        receiver.setForwarder(production);
        assertEq(receiver.forwarder(), production);

        CreReceiver.Action[] memory actions = new CreReceiver.Action[](1);
        actions[0] = _act(CreReceiver.ActionKind.Submit, 0, 3e6, bytes32(0));
        vm.prank(forwarder); // old (simulation) forwarder is no longer accepted
        vm.expectRevert(abi.encodeWithSelector(CreReceiver.InvalidSender.selector, forwarder));
        receiver.onReport(_metadata(workflowOwner), abi.encode(actions));

        vm.prank(owner);
        vm.expectRevert(CreReceiver.InvalidForwarder.selector);
        receiver.setForwarder(address(0));
    }

    function test_supportsInterface() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
        assertFalse(receiver.supportsInterface(0xdeadbeef));
    }
}
