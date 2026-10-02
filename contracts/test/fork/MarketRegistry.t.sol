// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RackOracle} from "../../src/RackOracle.sol";
import {RRUSD} from "../../src/RRUSD.sol";
import {Series} from "../../src/Series.sol";
import {SeriesFactory} from "../../src/SeriesFactory.sol";
import {HedgeRouter} from "../../src/HedgeRouter.sol";
import {MarketRegistry} from "../../src/MarketRegistry.sol";
import {IKuruOrderBook, IKuruRouter, IKuruMarginAccount} from "../../src/interfaces/IKuru.sol";

/// @notice MarketRegistry against Kuru's real testnet router (local fork). Enable with RUN_FORK_TESTS=true.
contract MarketRegistryForkTest is Test {
    using stdJson for string;

    IKuruRouter internal constant KURU_ROUTER = IKuruRouter(0x7EFbE105Ca7415dE98F96622173458ac1c054630);
    IKuruMarginAccount internal constant KURU_MARGIN = IKuruMarginAccount(0xd029C2D98ff85D8F64799017fE00a59B1159CE02);

    RackOracle internal oracle;
    RRUSD internal usd;
    SeriesFactory internal factory;
    HedgeRouter internal router;
    MarketRegistry internal registry;
    address internal owner;
    bool internal enabled;
    bytes32 internal feed = keccak256("H100");

    function setUp() public {
        enabled = vm.envOr("RUN_FORK_TESTS", false);
        if (!enabled) return;
        vm.createSelectFork(vm.envString("MONAD_RPC_URL"));
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/10143.json"));
        oracle = RackOracle(json.readAddress(".RackOracle"));
        usd = RRUSD(json.readAddress(".rrUSD"));
        factory = SeriesFactory(json.readAddress(".SeriesFactory"));
        router = HedgeRouter(json.readAddress(".HedgeRouter"));
        owner = json.readAddress(".deployer");
        registry = new MarketRegistry(factory, KURU_ROUTER);
    }

    function _week(uint64 start) internal returns (Series s) {
        vm.prank(owner);
        uint256 g = gasleft();
        s = Series(
            factory.createSeries(
                SeriesFactory.CreateParams({
                    feedId: feed,
                    startEpoch: start,
                    endEpoch: start + 167,
                    floor: 1e6,
                    cap: 5e6,
                    minCoverageBps: 9000,
                    settleGrace: 1 days,
                    label: "H100 FORKTEST",
                    symbolStem: "H100FT"
                })
            )
        );
        console2.log("gas: createSeries (weekly)", g - gasleft());
    }

    function test_fork_createMarket_fixedParams() public {
        if (!enabled) vm.skip(true);
        uint64 start = oracle.currentEpoch(feed) + 1000; // a far-future week, unused on testnet
        Series s = _week(start);

        uint256 g = gasleft();
        address bookAddr = registry.createMarket(s); // permissionless: called by this test contract
        console2.log("gas: createMarket (Kuru book)", g - gasleft());

        IKuruOrderBook book = IKuruOrderBook(bookAddr);
        assertEq(registry.bookOf(address(s)), bookAddr);
        assertEq(registry.marketCount(), 1);
        (uint32 pp, uint96 sp, address base,, address quote,, uint32 tick, uint96 minSize,, uint256 tf, uint256 mf) =
            book.getMarketParams();
        assertEq(base, address(s.long()));
        assertEq(quote, address(usd));
        assertEq(pp, 1e4);
        assertEq(sp, 1e6);
        assertEq(tick, 100);
        assertEq(minSize, 1e4);
        assertEq(tf, 0);
        assertEq(mf, 0);

        vm.expectRevert(MarketRegistry.MarketExists.selector);
        registry.createMarket(s);
    }

    function test_fork_rejectsSeriesNotFromFactory() public {
        if (!enabled) vm.skip(true);
        Series fake = new Series(
            Series.Params({
                oracle: oracle,
                collateral: usd,
                feedId: feed,
                startEpoch: oracle.currentEpoch(feed) + 2000,
                endEpoch: oracle.currentEpoch(feed) + 2167,
                floor: 1e6,
                cap: 5e6,
                minCoverageBps: 9000,
                settleGrace: 1 days,
                isDemo: false,
                longName: "FAKE LONG",
                longSymbol: "FL",
                shortName: "FAKE SHORT",
                shortSymbol: "FS"
            })
        );
        vm.expectRevert(MarketRegistry.UnknownSeries.selector);
        registry.createMarket(fake);
    }

    /// The registry-created book works with the deployed HedgeRouter: a maker bids, a GPU owner hedges.
    function test_fork_registryBookTradesThroughHedgeRouter() public {
        if (!enabled) vm.skip(true);
        Series s = _week(oracle.currentEpoch(feed) + 3000);
        IKuruOrderBook book = IKuruOrderBook(registry.createMarket(s));

        address mm = makeAddr("mm");
        address host = makeAddr("host");
        deal(address(usd), mm, 10_000e6);
        deal(address(usd), host, 10_000e6);
        vm.startPrank(mm);
        usd.approve(address(KURU_MARGIN), type(uint256).max);
        KURU_MARGIN.deposit(mm, address(usd), 5_000e6);
        book.addBuyOrder(4_500_000, 2e6, true); // bid $450.00 per GPU-week (implied ~$3.68/hr)
        vm.stopPrank();

        HedgeRouter.HedgeLeg[] memory legs = new HedgeRouter.HedgeLeg[](1);
        legs[0] = HedgeRouter.HedgeLeg({series: s, book: book, units: 1e6, minProceeds: 450e6});
        vm.startPrank(host);
        usd.approve(address(router), type(uint256).max);
        (uint256 cost, uint256 proceeds) = router.hedge(legs);
        vm.stopPrank();
        assertEq(cost, 672e6, "(5 - 1) x 168 hours");
        assertEq(proceeds, 450e6);
        assertEq(IERC20(address(s.short())).balanceOf(host), 1e6);
    }
}
