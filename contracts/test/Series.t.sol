// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RackOracle} from "../src/RackOracle.sol";
import {RRUSD} from "../src/RRUSD.sol";
import {Series} from "../src/Series.sol";
import {OutcomeToken} from "../src/OutcomeToken.sol";
import {SeriesFactory} from "../src/SeriesFactory.sol";

contract SeriesTest is Test {
    RackOracle internal oracle;
    RRUSD internal usd;
    SeriesFactory internal factory;
    Series internal series;

    bytes32 internal constant H100 = keccak256("H100");
    uint32 internal constant EPOCH = 3600;
    uint32 internal constant DELAY = 300;
    uint32 internal constant GRACE = 1 days;
    uint64 internal constant FLOOR = 1e6; // $1.00 / GPU-hour
    uint64 internal constant CAP = 5e6; // $5.00 / GPU-hour
    uint64 internal constant EPOCHS = 4;

    address internal owner = makeAddr("owner");
    address internal pubA = makeAddr("pubA");
    address internal pubB = makeAddr("pubB");
    address internal pubC = makeAddr("pubC");
    address internal host = makeAddr("host"); // GPU owner (keeps SHORT)
    address internal startup = makeAddr("startup"); // AI startup (holds LONG)

    uint64 internal genesis;

    function setUp() public {
        vm.warp(1_800_000_000);
        genesis = uint64(block.timestamp);

        oracle = new RackOracle(owner);
        usd = new RRUSD(owner, 0);
        factory = new SeriesFactory(owner, oracle, usd);

        vm.startPrank(owner);
        oracle.createFeed(
            H100,
            RackOracle.FeedConfig({
                genesis: genesis,
                epochLength: EPOCH,
                finalizeDelay: DELAY,
                minPublishers: 2,
                maxJumpBps: 0,
                minPrice: 0.5e6,
                maxPrice: 20e6,
                isDemo: false
            })
        );
        oracle.setPublisher(H100, pubA, true);
        oracle.setPublisher(H100, pubB, true);
        oracle.setPublisher(H100, pubC, true);
        series = Series(factory.createSeries(_params(0)));
        vm.stopPrank();

        deal(address(usd), host, 1_000_000e6);
        deal(address(usd), startup, 1_000_000e6);
        vm.prank(host);
        usd.approve(address(series), type(uint256).max);
        vm.prank(startup);
        usd.approve(address(series), type(uint256).max);
    }

    function _params(uint64 start) internal pure returns (SeriesFactory.CreateParams memory) {
        return SeriesFactory.CreateParams({
            feedId: H100,
            startEpoch: start,
            endEpoch: start + EPOCHS - 1,
            floor: FLOOR,
            cap: CAP,
            minCoverageBps: 9000,
            settleGrace: GRACE,
            label: "H100 TEST",
            symbolStem: "H100T"
        });
    }

    function _print(uint64 epoch, uint64 price) internal {
        vm.warp(genesis + uint256(epoch) * EPOCH);
        vm.prank(pubA);
        oracle.submit(H100, epoch, price);
        vm.prank(pubB);
        oracle.submit(H100, epoch, price);
        vm.prank(pubC);
        oracle.submit(H100, epoch, price);
    }

    function _printWindow(uint64[4] memory prices) internal {
        for (uint64 e; e < EPOCHS; ++e) {
            _print(e, prices[e]);
        }
        vm.warp(series.windowEnd());
    }

    // --- mint / redeem -----------------------------------------------------------

    function test_mintPullsExactCollateral() public {
        // 2 GPUs: (5 - 1) * 4 epochs * 2 = $32
        vm.prank(host);
        uint256 paid = series.mint(2e6);
        assertEq(paid, 32e6);
        assertEq(series.long().balanceOf(host), 2e6);
        assertEq(series.short().balanceOf(host), 2e6);
        assertEq(usd.balanceOf(address(series)), 32e6);
    }

    function test_redeemPairReturnsCollateral() public {
        vm.startPrank(host);
        series.mint(3e6);
        uint256 out = series.redeemPair(3e6);
        vm.stopPrank();
        assertEq(out, 48e6);
        assertEq(usd.balanceOf(host), 1_000_000e6);
        assertEq(series.long().totalSupply(), 0);
    }

    function test_mintSupportsFractionalUnits() public {
        vm.prank(host);
        uint256 paid = series.mint(1); // 1 micro-unit: 16e6 * 1 / 1e6 = 16 micro-dollars
        assertEq(paid, 16);
        vm.prank(host);
        paid = series.mint(0.25e6); // a quarter GPU-window
        assertEq(paid, 4e6);
    }

    // --- settlement ----------------------------------------------------------------

    function test_hedgeFlow_fullSettlement() public {
        // Host mints 1 GPU-window, keeps SHORT and transfers LONG to the startup (stands in for a Kuru trade).
        vm.startPrank(host);
        series.mint(1e6);
        series.long().transfer(startup, 1e6);
        vm.stopPrank();

        _printWindow([uint64(2e6), 3e6, 3e6, 4e6]); // average $3.00
        series.settle();

        assertEq(uint8(series.settlementKind()), uint8(Series.SettlementKind.Full));
        assertEq(series.settlementPrice(), 3e6);
        assertEq(series.longPayoutPerUnit(), 8e6); // (3 - 1) * 4
        assertEq(series.shortPayoutPerUnit(), 8e6); // (5 - 3) * 4

        uint256 hostBefore = usd.balanceOf(host);
        vm.prank(host);
        series.claim(0, 1e6);
        assertEq(usd.balanceOf(host) - hostBefore, 8e6);

        uint256 startupBefore = usd.balanceOf(startup);
        vm.prank(startup);
        series.claim(1e6, 0);
        assertEq(usd.balanceOf(startup) - startupBefore, 8e6);
        assertEq(usd.balanceOf(address(series)), 0);
    }

    function test_settlementClampsToCap() public {
        vm.prank(host);
        series.mint(1e6);
        _printWindow([uint64(9e6), 9e6, 9e6, 9e6]);
        series.settle();
        assertEq(series.settlementPrice(), CAP);
        assertEq(series.longPayoutPerUnit(), 16e6);
        assertEq(series.shortPayoutPerUnit(), 0);
    }

    function test_settlementClampsToFloor() public {
        _printWindow([uint64(0.6e6), 0.6e6, 0.6e6, 0.6e6]);
        series.settle();
        assertEq(series.settlementPrice(), FLOOR);
        assertEq(series.longPayoutPerUnit(), 0);
        assertEq(series.shortPayoutPerUnit(), 16e6);
    }

    function test_revert_settleBeforeWindowEnds() public {
        _print(0, 3e6);
        vm.expectRevert(Series.WindowNotEnded.selector);
        series.settle();
    }

    function test_revert_settleBeforeOracleFinalized() public {
        for (uint64 e; e < EPOCHS - 1; ++e) {
            _print(e, 3e6);
        }
        vm.warp(series.windowEnd()); // last epoch has no data and its finalize delay hasn't passed
        vm.expectRevert(Series.OracleNotFinalized.selector);
        series.settle();
    }

    function test_gapRule_partialAfterGrace() public {
        _print(0, 2e6);
        _print(1, 4e6); // epochs 2 and 3 never printed: 50% coverage
        vm.warp(series.windowEnd() + DELAY);
        oracle.finalize(H100, 10);

        vm.expectRevert(
            abi.encodeWithSelector(Series.CoverageTooLow.selector, 2, 4, series.windowEnd() + GRACE)
        );
        series.settle();

        vm.warp(series.windowEnd() + GRACE);
        series.settle();
        assertEq(uint8(series.settlementKind()), uint8(Series.SettlementKind.Partial));
        assertEq(series.settlementPrice(), 3e6); // average of the two printed epochs
    }

    function test_gapRule_noDataSettlesAtMidpoint() public {
        vm.warp(genesis + uint256(EPOCHS) * EPOCH + DELAY);
        oracle.finalize(H100, 10);
        vm.warp(series.windowEnd() + GRACE);
        series.settle();
        assertEq(uint8(series.settlementKind()), uint8(Series.SettlementKind.NoData));
        assertEq(series.settlementPrice(), 3e6); // midpoint of [1, 5]
    }

    function test_revert_actionsAfterSettlement() public {
        vm.prank(host);
        series.mint(1e6);
        _printWindow([uint64(3e6), 3e6, 3e6, 3e6]);
        series.settle();

        vm.expectRevert(Series.AlreadySettled.selector);
        series.settle();

        vm.prank(host);
        vm.expectRevert(Series.AlreadySettled.selector);
        series.mint(1e6);

        vm.prank(host);
        vm.expectRevert(Series.AlreadySettled.selector);
        series.redeemPair(1e6);
    }

    function test_revert_claimBeforeSettlement() public {
        vm.prank(host);
        series.mint(1e6);
        vm.prank(host);
        vm.expectRevert(Series.NotSettled.selector);
        series.claim(1e6, 1e6);
    }

    // --- factory -------------------------------------------------------------------

    function test_factory_tokenMetadata() public view {
        assertEq(series.long().symbol(), "rrH100TL");
        assertEq(series.short().symbol(), "rrH100TS");
        assertEq(series.long().name(), "Rackrate H100 TEST LONG");
        assertEq(series.long().decimals(), 6);
        assertEq(factory.seriesCount(), 1);
        assertEq(factory.seriesByStart(H100, 0), address(series));
    }

    function test_factory_revertsOnDuplicateRealSeries() public {
        vm.prank(owner);
        vm.expectRevert(SeriesFactory.SeriesExists.selector);
        factory.createSeries(_params(0));
    }

    function test_factory_onlyOwner() public {
        vm.prank(host);
        vm.expectRevert();
        factory.createSeries(_params(8));
    }

    function test_factory_revertsOnUnknownFeed() public {
        SeriesFactory.CreateParams memory p = _params(8);
        p.feedId = keccak256("NOPE");
        vm.prank(owner);
        vm.expectRevert(SeriesFactory.UnknownFeed.selector);
        factory.createSeries(p);
    }

    function test_revert_onlySeriesCanMintOrBurnTokens() public {
        OutcomeToken longToken = series.long();
        vm.prank(host);
        vm.expectRevert(OutcomeToken.OnlySeries.selector);
        longToken.mint(host, 1);

        vm.prank(host);
        vm.expectRevert(OutcomeToken.OnlySeries.selector);
        longToken.burn(host, 1);
    }

    // --- solvency fuzz ---------------------------------------------------------------

    /// @notice Whatever the amounts and settlement price, total payouts never exceed collateral held,
    ///         and the dust left behind is at most a few micro-dollars.
    function testFuzz_neverPaysMoreThanCollateral(uint256 unitsHost, uint256 unitsStartup, uint64 price) public {
        unitsHost = bound(unitsHost, 1, 50_000e6);
        unitsStartup = bound(unitsStartup, 1, 50_000e6);
        price = uint64(bound(price, 0.5e6, 20e6));

        vm.prank(host);
        series.mint(unitsHost);
        vm.prank(startup);
        series.mint(unitsStartup);
        // Host sells its LONG to the startup.
        vm.startPrank(host);
        series.long().transfer(startup, unitsHost);
        vm.stopPrank();

        uint256 deposited = usd.balanceOf(address(series));
        _printWindow([price, price, price, price]);
        series.settle();

        vm.prank(host);
        series.claim(0, unitsHost);
        vm.prank(startup);
        series.claim(unitsHost + unitsStartup, unitsStartup);

        uint256 left = usd.balanceOf(address(series));
        assertLe(left, deposited);
        assertLe(left, 4); // rounding dust only
        assertEq(series.long().totalSupply(), 0);
        assertEq(series.short().totalSupply(), 0);
    }
}
