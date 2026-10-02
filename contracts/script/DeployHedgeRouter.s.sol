// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HedgeRouter} from "../src/HedgeRouter.sol";

/// @notice Deploys HedgeRouter against the deployed rrUSD and records it (plus Kuru's testnet addresses) in
///         deployments/<chainId>.json.
///
/// Usage:
///   forge script script/DeployHedgeRouter.s.sol --rpc-url $MONAD_RPC_URL --broadcast
contract DeployHedgeRouter is Script {
    using stdJson for string;

    address internal constant KURU_ROUTER = 0x7EFbE105Ca7415dE98F96622173458ac1c054630;
    address internal constant KURU_MARGIN_ACCOUNT = 0xd029C2D98ff85D8F64799017fE00a59B1159CE02;

    function run() external {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        IERC20 usd = IERC20(vm.readFile(path).readAddress(".rrUSD"));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        HedgeRouter router = new HedgeRouter(usd);
        vm.stopBroadcast();

        console2.log("HedgeRouter", address(router));
        vm.writeJson(vm.toString(address(router)), path, ".HedgeRouter");
        vm.writeJson(vm.toString(KURU_ROUTER), path, ".KuruRouter");
        vm.writeJson(vm.toString(KURU_MARGIN_ACCOUNT), path, ".KuruMarginAccount");
    }
}
