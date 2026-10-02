// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";
import {RackOracle} from "./RackOracle.sol";

/// @title CreReceiver
/// @notice RackOracle publisher operated by a Chainlink CRE workflow. The workflow's signed reports arrive through
///         Chainlink's forwarder; each report is a batch of oracle actions executed with this contract as the
///         publisher (it is the allowlisted publisher address, commits and reveals its own seeds).
///
/// Actions are executed independently: one failing action (e.g. an epoch another publisher already finalized)
/// is reported in an event and does not discard the rest of the batch.
///
/// Admin powers (owner): set the forwarder (simulation -> production switch) and the expected workflow owner.
/// The owner cannot publish prices; only reports from the configured forwarder can.
contract CreReceiver is IReceiver, Ownable2Step {
    enum ActionKind {
        Submit, // a = epoch, b = price
        CommitSeed, // a = period, b = revealAfter, data = seed hash
        RevealSeed, // a = period, data = seed
        Finalize // a = max epochs
    }

    struct Action {
        ActionKind kind;
        bytes32 feedId;
        uint64 a;
        uint64 b;
        bytes32 data;
    }

    RackOracle public immutable oracle;
    address public forwarder;
    /// @notice If set, only reports from workflows owned by this address are accepted.
    address public expectedWorkflowOwner;

    event ForwarderUpdated(address indexed previous, address indexed current);
    event ExpectedWorkflowOwnerUpdated(address indexed previous, address indexed current);
    event ReportProcessed(bytes32 indexed workflowId, uint256 actions, uint256 failed);
    event ActionFailed(uint256 indexed index, ActionKind kind, bytes32 indexed feedId, bytes reason);

    error InvalidForwarder();
    error InvalidSender(address sender);
    error InvalidMetadata();
    error InvalidWorkflowOwner(address received);

    constructor(address initialOwner, RackOracle oracle_, address forwarder_) Ownable(initialOwner) {
        if (forwarder_ == address(0)) revert InvalidForwarder();
        oracle = oracle_;
        forwarder = forwarder_;
        emit ForwarderUpdated(address(0), forwarder_);
    }

    function setForwarder(address forwarder_) external onlyOwner {
        if (forwarder_ == address(0)) revert InvalidForwarder();
        emit ForwarderUpdated(forwarder, forwarder_);
        forwarder = forwarder_;
    }

    function setExpectedWorkflowOwner(address workflowOwner) external onlyOwner {
        emit ExpectedWorkflowOwnerUpdated(expectedWorkflowOwner, workflowOwner);
        expectedWorkflowOwner = workflowOwner;
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert InvalidSender(msg.sender);
        // Metadata: abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner)
        if (metadata.length < 62) revert InvalidMetadata();
        bytes32 workflowId = bytes32(metadata[0:32]);
        if (expectedWorkflowOwner != address(0)) {
            address workflowOwner = address(bytes20(metadata[42:62]));
            if (workflowOwner != expectedWorkflowOwner) revert InvalidWorkflowOwner(workflowOwner);
        }

        Action[] memory actions = abi.decode(report, (Action[]));
        uint256 failed;
        for (uint256 i; i < actions.length; ++i) {
            if (!_execute(actions[i], i)) ++failed;
        }
        emit ReportProcessed(workflowId, actions.length, failed);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function _execute(Action memory act, uint256 index) internal returns (bool ok) {
        bytes memory reason;
        if (act.kind == ActionKind.Submit) {
            try oracle.submit(act.feedId, act.a, act.b) {
                return true;
            } catch (bytes memory r) {
                reason = r;
            }
        } else if (act.kind == ActionKind.CommitSeed) {
            try oracle.commitSeed(act.feedId, act.a, act.data, act.b) {
                return true;
            } catch (bytes memory r) {
                reason = r;
            }
        } else if (act.kind == ActionKind.RevealSeed) {
            try oracle.revealSeed(act.feedId, act.a, act.data) {
                return true;
            } catch (bytes memory r) {
                reason = r;
            }
        } else {
            try oracle.finalize(act.feedId, act.a) returns (uint64) {
                return true;
            } catch (bytes memory r) {
                reason = r;
            }
        }
        emit ActionFailed(index, act.kind, act.feedId, reason);
        return false;
    }
}
