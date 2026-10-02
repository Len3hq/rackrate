// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Chainlink CRE report receiver interface (as published in the CRE documentation).
///         The forwarder calls `onReport` with abi.encodePacked(workflowId, workflowName, workflowOwner) metadata
///         and the workflow's ABI-encoded report.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
