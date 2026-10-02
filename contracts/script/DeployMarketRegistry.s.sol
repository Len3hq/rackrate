// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {SeriesFactory} from "../src/SeriesFactory.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {IKuruRouter} from "../src/interfaces/IKuru.sol";

/// @notice Deploys MarketRegistry (permissionless, ownerless Kuru book creation for factory series) and records
///         it in deployments/<chainId>.json.
///
/// Usage:
///   forge script script/DeployMarketRegistry.s.sol --rpc-url $MONAD_RPC_URL --broadcast
contract DeployMarketRegistry is Script {
    using stdJson for string;

    function run() external {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);
        SeriesFactory factory = SeriesFactory(json.readAddress(".SeriesFactory"));
        IKuruRouter kuru = IKuruRouter(json.readAddress(".KuruRouter"));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        MarketRegistry registry = new MarketRegistry(factory, kuru);
        vm.stopBroadcast();

        console2.log("MarketRegistry", address(registry));
        vm.writeJson(vm.toString(address(registry)), path, ".MarketRegistry");
    }
}
