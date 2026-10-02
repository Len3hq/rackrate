// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RackOracle} from "../src/RackOracle.sol";
import {RRUSD} from "../src/RRUSD.sol";
import {Series} from "../src/Series.sol";
import {SeriesFactory} from "../src/SeriesFactory.sol";
import {HedgeRouter} from "../src/HedgeRouter.sol";
import {IKuruOrderBook} from "../src/interfaces/IKuru.sol";
import {MockKuruOrderBook} from "./mocks/MockKuruOrderBook.sol";

contract HedgeRouterTest is Test {
    RackOracle internal oracle;
    RRUSD internal usd;
    SeriesFactory internal factory;
    HedgeRouter internal router;

    bytes32 internal constant H100 = keccak256("H100");
    address internal owner = makeAddr("owner");
    address internal host = makeAddr("host");
    address internal startup = makeAddr("startup");

    Series[3] internal wk;
    MockKuruOrderBook[3] internal books;
    // LONG prices per GPU-window (4 epochs, range $1-$5, collateral $16): implied rates $3.00, $3.10, $3.20
    uint256[3] internal longPrice = [uint256(8e6), 8.4e6, 8.8e6];

    function setUp() public {
        vm.warp(1_800_000_000);
        oracle = new RackOracle(owner);
        usd = new RRUSD(owner, 0);
        factory = new SeriesFactory(owner, oracle, usd);
        router = new HedgeRouter(usd);

        vm.startPrank(owner);
        oracle.createFeed(
            H100,
            RackOracle.FeedConfig({
                genesis: uint64(block.timestamp),
                epochLength: 3600,
                finalizeDelay: 300,
                minPublishers: 2,
                maxJumpBps: 0,
                minPrice: 0.5e6,
                maxPrice: 20e6,
                isDemo: false
            })
        );
        for (uint64 i; i < 3; ++i) {
            wk[i] = Series(
                factory.createSeries(
                    SeriesFactory.CreateParams({
                        feedId: H100,
                        startEpoch: i * 4,
                        endEpoch: i * 4 + 3,
                        floor: 1e6,
                        cap: 5e6,
                        minCoverageBps: 9000,
                        settleGrace: 1 days,
                        label: "H100 TEST",
                        symbolStem: "H100T"
                    })
                )
            );
        }
        vm.stopPrank();

        for (uint256 i; i < 3; ++i) {
            books[i] = new MockKuruOrderBook(IERC20(address(wk[i].long())), usd, 1e4, 1e6, 6, 6, longPrice[i]);
            deal(address(usd), address(books[i]), 1_000_000e6); // bid-side liquidity
        }
        deal(address(usd), host, 1_000_000e6);
        deal(address(usd), startup, 1_000_000e6);
        vm.prank(host);
        usd.approve(address(router), type(uint256).max);
        vm.prank(startup);
        usd.approve(address(router), type(uint256).max);
    }

    function _hedgeLegs(uint256 units) internal view returns (HedgeRouter.HedgeLeg[] memory legs) {
        legs = new HedgeRouter.HedgeLeg[](3);
        for (uint256 i; i < 3; ++i) {
            legs[i] = HedgeRouter.HedgeLeg({
                series: wk[i],
                book: IKuruOrderBook(address(books[i])),
                units: units,
                minProceeds: longPrice[i] * units / 1e6
            });
        }
    }

    function test_hedgeLadder_oneTransaction() public {
        uint256 before = usd.balanceOf(host);
        vm.prank(host);
        (uint256 totalIn, uint256 totalProceeds) = router.hedge(_hedgeLegs(64e6)); // 64 GPUs, 3 wk

        assertEq(totalIn, 3 * 64 * 16e6); // $16 collateral per GPU-window
        assertEq(totalProceeds, 64 * (8e6 + 8.4e6 + 8.8e6));
        assertEq(before - usd.balanceOf(host), totalIn - totalProceeds);
        for (uint256 i; i < 3; ++i) {
            assertEq(wk[i].short().balanceOf(host), 64e6, "host keeps SHORT");
            assertEq(wk[i].long().balanceOf(host), 0, "host sold all LONG");
            assertEq(wk[i].long().balanceOf(address(books[i])), 64e6, "LONG went to the book");
        }
        assertEq(usd.balanceOf(address(router)), 0, "router holds nothing");
    }

    function test_hedge_slippageRevertsWholeLadder() public {
        HedgeRouter.HedgeLeg[] memory legs = _hedgeLegs(10e6);
        legs[2].minProceeds += 1; // third week's price is one micro-dollar too low
        uint256 before = usd.balanceOf(host);
        vm.prank(host);
        vm.expectRevert(MockKuruOrderBook.SlippageExceeded.selector);
        router.hedge(legs);
        assertEq(usd.balanceOf(host), before, "nothing happened");
        assertEq(wk[0].short().balanceOf(host), 0, "no partial ladder");
    }

    function test_hedge_revertsOnBookForOtherSeries() public {
        HedgeRouter.HedgeLeg[] memory legs = _hedgeLegs(1e6);
        legs[0].book = IKuruOrderBook(address(books[1])); // week 2's book for week 1's series
        vm.prank(host);
        vm.expectRevert(HedgeRouter.MarketMismatch.selector);
        router.hedge(legs);
    }

    function test_buyLongsLadder() public {
        // Books need LONG inventory to sell: the host hedges first (sells LONG into the books).
        vm.prank(host);
        router.hedge(_hedgeLegs(10e6));

        HedgeRouter.BuyLeg[] memory legs = new HedgeRouter.BuyLeg[](3);
        for (uint256 i; i < 3; ++i) {
            legs[i] = HedgeRouter.BuyLeg({
                book: IKuruOrderBook(address(books[i])),
                quoteIn: longPrice[i] * 5, // 5 GPU-windows' worth
                minLongOut: 5e6
            });
        }
        uint256 before = usd.balanceOf(startup);
        vm.prank(startup);
        uint256 got = router.buyLongs(legs);
        assertEq(got, 15e6);
        for (uint256 i; i < 3; ++i) {
            assertEq(wk[i].long().balanceOf(startup), 5e6);
        }
        assertEq(before - usd.balanceOf(startup), 5 * (8e6 + 8.4e6 + 8.8e6));
        assertEq(usd.balanceOf(address(router)), 0);
    }

    function test_buyLongs_revertsOnInexactBudget() public {
        HedgeRouter.BuyLeg[] memory legs = new HedgeRouter.BuyLeg[](1);
        // 1 micro-dollar can't be expressed in Kuru's 1e4 price precision (1e6 decimals): 1 * 1e4 / 1e6.
        legs[0] = HedgeRouter.BuyLeg({book: IKuruOrderBook(address(books[0])), quoteIn: 1, minLongOut: 0});
        vm.prank(startup);
        vm.expectRevert(HedgeRouter.InexactAmount.selector);
        router.buyLongs(legs);
    }

    function test_revert_emptyAndZero() public {
        vm.startPrank(host);
        vm.expectRevert(HedgeRouter.EmptyLegs.selector);
        router.hedge(new HedgeRouter.HedgeLeg[](0));
        HedgeRouter.HedgeLeg[] memory legs = _hedgeLegs(1e6);
        legs[1].units = 0;
        vm.expectRevert(HedgeRouter.ZeroAmount.selector);
        router.hedge(legs);
        vm.stopPrank();
    }

    /// @notice A hedge locks revenue: for any settlement price inside the range, the host's cash flow from Rackrate
    ///         (LONG sale - collateral + SHORT payout) plus its GPUs' spot revenue (settle x epochs) is a constant:
    ///         LONG sale price + floor x epochs.
    function testFuzz_hedgeLocksRevenue(uint64 settlePrice) public {
        settlePrice = uint64(bound(settlePrice, 1e6, 5e6));
        address pubA = makeAddr("pubA");
        address pubB = makeAddr("pubB");
        vm.startPrank(owner);
        oracle.setPublisher(H100, pubA, true);
        oracle.setPublisher(H100, pubB, true);
        vm.stopPrank();

        uint256 start = usd.balanceOf(host);
        HedgeRouter.HedgeLeg[] memory legs = new HedgeRouter.HedgeLeg[](1);
        legs[0] = _hedgeLegs(1e6)[0];
        vm.prank(host);
        router.hedge(legs);

        Series s = wk[0];
        for (uint64 e; e < 4; ++e) {
            vm.warp(1_800_000_000 + uint256(e) * 3600);
            vm.prank(pubA);
            oracle.submit(H100, e, settlePrice);
            vm.prank(pubB);
            oracle.submit(H100, e, settlePrice);
        }
        vm.warp(s.windowEnd());
        s.settle();
        vm.prank(host);
        s.claim(0, 1e6);

        int256 cashFlow = int256(usd.balanceOf(host)) - int256(start);
        int256 spotRevenue = int256(uint256(settlePrice) * 4);
        assertEq(cashFlow + spotRevenue, int256(longPrice[0] + 1e6 * 4), "revenue locked regardless of settlement");
    }
}
