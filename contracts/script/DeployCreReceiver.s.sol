// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {RackOracle} from "../src/RackOracle.sol";
import {CreReceiver} from "../src/CreReceiver.sol";

/// @notice Deploys CreReceiver (the Chainlink CRE workflow's publisher address), allowlists it on the given
///         feeds and records it in deployments/<chainId>.json.
///
/// The forwarder defaults to Chainlink's MockKeystoneForwarder for monad-testnet (used by
/// `cre workflow simulate --broadcast`). After CRE deploy access is granted, switch with
/// CreReceiver.setForwarder(<production KeystoneForwarder>) — no redeploy needed.
///
/// Usage:
///   PUBLISH_FEEDS=H100 forge script script/DeployCreReceiver.s.sol --rpc-url $MONAD_RPC_URL --broadcast
contract DeployCreReceiver is Script {
    using stdJson for string;

    address internal constant MOCK_FORWARDER_MONAD_TESTNET = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;

    function run() external {
        uint256 ownerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        RackOracle oracle = RackOracle(vm.readFile(path).readAddress(".RackOracle"));
        address forwarder = vm.envOr("CRE_FORWARDER", MOCK_FORWARDER_MONAD_TESTNET);
        string[] memory feeds = vm.envOr("PUBLISH_FEEDS", ",", new string[](0));
        if (feeds.length == 0) {
            feeds = new string[](1);
            feeds[0] = "H100";
        }

        vm.startBroadcast(ownerKey);
        CreReceiver receiver = new CreReceiver(vm.addr(ownerKey), oracle, forwarder);
        for (uint256 i; i < feeds.length; ++i) {
            oracle.setPublisher(keccak256(bytes(feeds[i])), address(receiver), true);
        }
        vm.stopBroadcast();

        console2.log("CreReceiver", address(receiver));
        console2.log("forwarder  ", forwarder);
        vm.writeJson(vm.toString(address(receiver)), path, ".CreReceiver");
        vm.writeJson(vm.toString(forwarder), path, ".CreForwarder");
    }
}
