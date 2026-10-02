// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {RackOracle} from "../src/RackOracle.sol";

/// @notice Allowlists the publisher bots on the given feeds. Publisher addresses are derived from the
///         PUBLISHER_*_PRIVATE_KEY variables, so no addresses are hard-coded. Idempotent.
///
/// Usage:
///   PUBLISH_FEEDS=H100 forge script script/SetPublishers.s.sol --rpc-url $MONAD_RPC_URL --broadcast
contract SetPublishers is Script {
    using stdJson for string;

    function run() external {
        uint256 ownerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory json =
            vm.readFile(string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json"));
        RackOracle oracle = RackOracle(json.readAddress(".RackOracle"));
        string[] memory feeds = vm.envOr("PUBLISH_FEEDS", ",", new string[](0));
        if (feeds.length == 0) {
            feeds = new string[](1);
            feeds[0] = "H100";
        }

        address[2] memory publishers =
            [vm.addr(vm.envUint("PUBLISHER_B_PRIVATE_KEY")), vm.addr(vm.envUint("PUBLISHER_C_PRIVATE_KEY"))];

        vm.startBroadcast(ownerKey);
        for (uint256 i; i < feeds.length; ++i) {
            bytes32 feedId = keccak256(bytes(feeds[i]));
            for (uint256 j; j < publishers.length; ++j) {
                if (!oracle.isPublisher(feedId, publishers[j])) {
                    oracle.setPublisher(feedId, publishers[j], true);
                }
                console2.log(feeds[i], publishers[j]);
            }
        }
        vm.stopBroadcast();
    }
}
