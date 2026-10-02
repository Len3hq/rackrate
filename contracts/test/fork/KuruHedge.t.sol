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
import {IKuruOrderBook, IKuruRouter, IKuruMarginAccount} from "../../src/interfaces/IKuru.sol";

/// @notice Full lifecycle on Kuru's real testnet contracts (local fork, nothing broadcast): three weekly series,
///         one Kuru LONG/rrUSD book each, a maker quoting both sides, a 3-week hedge ladder and a 3-week buy ladder
///         through HedgeRouter, then settlement and claims. Enable with RUN_FORK_TESTS=true.
contract KuruHedgeForkTest is Test {
    using stdJson for string;

    IKuruRouter internal constant KURU_ROUTER = IKuruRouter(0x7EFbE105Ca7415dE98F96622173458ac1c054630);
    IKuruMarginAccount internal constant KURU_MARGIN = IKuruMarginAccount(0xd029C2D98ff85D8F64799017fE00a59B1159CE02);

    // Kuru market parameters used for Rackrate books (see docs/DECISIONS.md 010).
    uint32 internal constant PRICE_PRECISION = 1e4; // $0.0001
    uint32 internal constant TICK = 100; // $0.01
    uint96 internal constant SIZE_PRECISION = 1e6; // = 10 ** LONG decimals
    uint96 internal constant MIN_SIZE = 1e4; // 0.01 GPU-window
    uint96 internal constant MAX_SIZE = 1e12;

    RackOracle internal oracle;
    RRUSD internal usd;
    SeriesFactory internal factory;
    HedgeRouter internal router;
    address internal owner;
    bool internal enabled;
    bytes32 internal feed;

    address internal pubA = makeAddr("pubA");
    address internal pubB = makeAddr("pubB");
    address internal host = makeAddr("host");
    address internal startup = makeAddr("startup");
    address internal mm = makeAddr("mm");

    Series[3] internal wk;
    IKuruOrderBook[3] internal books;
    uint32[3] internal bids = [uint32(70_000), 72_000, 74_000]; // $7.00 $7.20 $7.40 per GPU-window
    uint32[3] internal asks = [uint32(80_000), 82_000, 84_000];

    function setUp() public {
        enabled = vm.envOr("RUN_FORK_TESTS", false);
        if (!enabled) return;
        vm.createSelectFork(vm.envString("MONAD_RPC_URL"));
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/10143.json"));
        oracle = RackOracle(json.readAddress(".RackOracle"));
        usd = RRUSD(json.readAddress(".rrUSD"));
        factory = SeriesFactory(json.readAddress(".SeriesFactory"));
        owner = json.readAddress(".deployer");
        router = HedgeRouter(json.readAddress(".HedgeRouter")); // the deployed router

        feed = keccak256(abi.encodePacked("KURUHEDGE_", block.timestamp));
        vm.startPrank(owner);
        oracle.createFeed(
            feed,
            RackOracle.FeedConfig({
                genesis: uint64(block.timestamp - (block.timestamp % 30)),
                epochLength: 30,
                finalizeDelay: 10,
                minPublishers: 2,
                maxJumpBps: 5000,
                minPrice: 0.5e6,
                maxPrice: 20e6,
                isDemo: true
            })
        );
        oracle.setPublisher(feed, pubA, true);
        oracle.setPublisher(feed, pubB, true);
        uint64 e0 = oracle.currentEpoch(feed);
        for (uint64 i; i < 3; ++i) {
            wk[i] = Series(
                factory.createSeries(
                    SeriesFactory.CreateParams({
                        feedId: feed,
                        startEpoch: e0 + i * 4,
                        endEpoch: e0 + i * 4 + 3,
                        floor: 1e6,
                        cap: 5e6,
                        minCoverageBps: 9000,
                        settleGrace: 60,
                        label: "H100 FORK",
                        symbolStem: "H100F"
                    })
                )
            );
        }
        vm.stopPrank();

        for (uint256 i; i < 3; ++i) {
            books[i] = IKuruOrderBook(
                KURU_ROUTER.deployProxy(
                    0,
                    address(wk[i].long()),
                    address(usd),
                    SIZE_PRECISION,
                    PRICE_PRECISION,
                    TICK,
                    MIN_SIZE,
                    MAX_SIZE,
                    0,
                    0,
                    30
                )
            );
        }
        deal(address(usd), host, 100_000e6);
        deal(address(usd), startup, 100_000e6);
        deal(address(usd), mm, 100_000e6);
    }

    /// Maker rests 20-unit bids on every book, funded from its Kuru margin account.
    function _makerBids() internal {
        vm.startPrank(mm);
        usd.approve(address(KURU_MARGIN), type(uint256).max);
        KURU_MARGIN.deposit(mm, address(usd), 10_000e6);
        for (uint256 i; i < 3; ++i) {
            books[i].addBuyOrder(bids[i], 20e6, true);
        }
        vm.stopPrank();
    }

    /// Maker mints its own LONG inventory and rests 20-unit asks on every book.
    function _makerAsks() internal {
        vm.startPrank(mm);
        for (uint256 i; i < 3; ++i) {
            usd.approve(address(wk[i]), type(uint256).max);
            wk[i].mint(20e6);
            IERC20(address(wk[i].long())).approve(address(KURU_MARGIN), type(uint256).max);
            KURU_MARGIN.deposit(mm, address(wk[i].long()), 20e6);
            books[i].addSellOrder(asks[i], 20e6, true);
        }
        vm.stopPrank();
    }

    function test_fork_hedgeLadderOnKuru() public {
        if (!enabled) vm.skip(true);
        _makerBids();

        HedgeRouter.HedgeLeg[] memory legs = new HedgeRouter.HedgeLeg[](3);
        for (uint256 i; i < 3; ++i) {
            uint256 expected = uint256(bids[i]) * 10 * 1e6 / PRICE_PRECISION; // 10 units at the bid
            legs[i] = HedgeRouter.HedgeLeg({series: wk[i], book: books[i], units: 10e6, minProceeds: expected});
        }
        vm.startPrank(host);
        usd.approve(address(router), type(uint256).max);
        uint256 before = usd.balanceOf(host);
        (uint256 totalIn, uint256 proceeds) = router.hedge(legs);
        vm.stopPrank();

        assertEq(totalIn, 3 * 10 * 16e6, "collateral: $16 x 10 GPUs x 3 weeks");
        assertEq(proceeds, 10 * (7e6 + 7.2e6 + 7.4e6), "sold at the resting bids");
        assertEq(before - usd.balanceOf(host), totalIn - proceeds);
        for (uint256 i; i < 3; ++i) {
            assertEq(wk[i].short().balanceOf(host), 10e6, "host keeps SHORT");
            assertEq(wk[i].long().balanceOf(host), 0);
            assertEq(KURU_MARGIN.getBalance(mm, address(wk[i].long())), 10e6, "maker credited LONG");
        }
        assertEq(usd.balanceOf(address(router)), 0, "router holds nothing");
        console2.log("hedge ladder: collateral in", totalIn, "proceeds", proceeds);
    }

    function test_fork_buyLadderOnKuru() public {
        if (!enabled) vm.skip(true);
        _makerAsks();

        HedgeRouter.BuyLeg[] memory legs = new HedgeRouter.BuyLeg[](3);
        for (uint256 i; i < 3; ++i) {
            uint256 budget = uint256(asks[i]) * 5 * 1e6 / PRICE_PRECISION; // 5 units at the ask
            legs[i] = HedgeRouter.BuyLeg({book: books[i], quoteIn: budget, minLongOut: 5e6});
        }
        vm.startPrank(startup);
        usd.approve(address(router), type(uint256).max);
        uint256 before = usd.balanceOf(startup);
        uint256 got = router.buyLongs(legs);
        vm.stopPrank();

        assertEq(got, 15e6);
        for (uint256 i; i < 3; ++i) {
            assertEq(wk[i].long().balanceOf(startup), 5e6);
        }
        assertEq(before - usd.balanceOf(startup), 5 * (8e6 + 8.2e6 + 8.4e6));
        assertEq(usd.balanceOf(address(router)), 0);
    }

    /// Hedge on Kuru, then settle week 1 through the oracle and claim: the host's revenue is locked.
    function test_fork_fullLifecycle_hedgeSettleClaim() public {
        if (!enabled) vm.skip(true);
        _makerBids();
        HedgeRouter.HedgeLeg[] memory legs = new HedgeRouter.HedgeLeg[](1);
        legs[0] = HedgeRouter.HedgeLeg({series: wk[0], book: books[0], units: 1e6, minProceeds: 7e6});
        vm.startPrank(host);
        usd.approve(address(router), type(uint256).max);
        uint256 start = usd.balanceOf(host);
        router.hedge(legs);
        vm.stopPrank();

        uint64 settlePrice = 2e6; // GPU rents crash to $2/hr
        Series s = wk[0];
        for (uint64 e = s.startEpoch(); e <= s.endEpoch(); ++e) {
            uint256 t = oracle.epochStart(feed, e);
            if (block.timestamp < t) vm.warp(t);
            vm.prank(pubA);
            oracle.submit(feed, e, settlePrice);
            vm.prank(pubB);
            oracle.submit(feed, e, settlePrice);
        }
        vm.warp(s.windowEnd());
        s.settle();
        vm.prank(host);
        s.claim(0, 1e6);

        int256 cashFlow = int256(usd.balanceOf(host)) - int256(start);
        // Locked: LONG sale ($7) + floor x epochs ($4) = $11 per GPU-window, whatever the index did.
        assertEq(cashFlow + int256(uint256(settlePrice) * 4), 11e6, "revenue locked through Kuru");
    }
}
