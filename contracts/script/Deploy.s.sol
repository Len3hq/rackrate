// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {RRUSD} from "../src/RRUSD.sol";
import {RackOracle} from "../src/RackOracle.sol";
import {SeriesFactory} from "../src/SeriesFactory.sol";

/// @notice Deploys rrUSD, RackOracle and SeriesFactory, and creates the real (hourly) and demo (30 s) feeds.
///         Publishers are added in a separate step once the publisher wallets exist.
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url $MONAD_RPC_URL --broadcast
contract Deploy is Script {
    uint32 internal constant HOUR = 3600;
    uint32 internal constant DEMO_TICK = 30; // CRE cron minimum

    // Initial rrUSD supply minted to the deployer to seed test market-maker liquidity (disclosed in README).
    uint256 internal constant INITIAL_SUPPLY = 10_000_000e6;

    struct GpuSpec {
        string name;
        uint64 minPrice; // oracle bounds, USD per GPU-hour (6 dp)
        uint64 maxPrice;
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        GpuSpec[3] memory gpus = [
            GpuSpec("H100", 0.5e6, 20e6),
            GpuSpec("H200", 0.75e6, 25e6),
            GpuSpec("B200", 1e6, 40e6)
        ];

        uint64 hourGenesis = uint64(block.timestamp - (block.timestamp % HOUR));
        uint64 demoGenesis = uint64(block.timestamp - (block.timestamp % DEMO_TICK));

        vm.startBroadcast(pk);

        RRUSD usd = new RRUSD(deployer, INITIAL_SUPPLY);
        RackOracle oracle = new RackOracle(deployer);
        SeriesFactory factory = new SeriesFactory(deployer, oracle, usd);

        for (uint256 i; i < gpus.length; ++i) {
            oracle.createFeed(
                keccak256(bytes(gpus[i].name)),
                RackOracle.FeedConfig({
                    genesis: hourGenesis,
                    epochLength: HOUR,
                    finalizeDelay: 300,
                    minPublishers: 2,
                    maxJumpBps: 2500,
                    minPrice: gpus[i].minPrice,
                    maxPrice: gpus[i].maxPrice,
                    isDemo: false
                })
            );
            oracle.createFeed(
                keccak256(bytes(string.concat(gpus[i].name, "_DEMO"))),
                RackOracle.FeedConfig({
                    genesis: demoGenesis,
                    epochLength: DEMO_TICK,
                    finalizeDelay: 10,
                    minPublishers: 2,
                    maxJumpBps: 5000,
                    minPrice: gpus[i].minPrice,
                    maxPrice: gpus[i].maxPrice,
                    isDemo: true
                })
            );
        }

        vm.stopBroadcast();

        console2.log("deployer      ", deployer);
        console2.log("rrUSD         ", address(usd));
        console2.log("RackOracle    ", address(oracle));
        console2.log("SeriesFactory ", address(factory));

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "rrUSD", address(usd));
        vm.serializeAddress(key, "RackOracle", address(oracle));
        vm.serializeUint(key, "hourGenesis", hourGenesis);
        vm.serializeUint(key, "demoGenesis", demoGenesis);
        string memory json = vm.serializeAddress(key, "SeriesFactory", address(factory));
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json"));
    }
}
