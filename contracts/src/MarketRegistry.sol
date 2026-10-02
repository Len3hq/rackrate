// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Series} from "./Series.sol";
import {SeriesFactory} from "./SeriesFactory.sol";
import {IKuruRouter} from "./interfaces/IKuru.sol";

/// @title MarketRegistry
/// @notice Creates and records the Kuru order book for each Rackrate series. Permissionless and ownerless:
///         anyone can create the book for any series made by the SeriesFactory, but only once, and always with
///         the same fixed market parameters. Apps and indexers discover markets from `MarketCreated` events or
///         `bookOf(series)`.
contract MarketRegistry {
    /// Kuru market parameters (see docs/DECISIONS.md 010). LONG/collateral, both 6 decimals.
    uint8 internal constant MARKET_TYPE = 0; // ERC20 / ERC20
    uint96 internal constant SIZE_PRECISION = 1e6; // = 10 ** LONG decimals: size units equal token units
    uint32 internal constant PRICE_PRECISION = 1e4; // $0.0001
    uint32 internal constant TICK_SIZE = 100; // $0.01
    uint96 internal constant MIN_SIZE = 1e4; // 0.01 GPU-window
    uint96 internal constant MAX_SIZE = 1e12;
    uint256 internal constant TAKER_FEE_BPS = 0; // testnet
    uint256 internal constant MAKER_FEE_BPS = 0;
    uint96 internal constant KURU_AMM_SPREAD = 30;

    SeriesFactory public immutable factory;
    IKuruRouter public immutable kuruRouter;

    mapping(address series => address book) public bookOf;
    address[] public allSeriesWithBooks;

    event MarketCreated(address indexed series, address indexed book, address indexed long, bytes32 feedId);

    error UnknownSeries();
    error MarketExists();

    constructor(SeriesFactory factory_, IKuruRouter kuruRouter_) {
        factory = factory_;
        kuruRouter = kuruRouter_;
    }

    function createMarket(Series series) external returns (address book) {
        address s = address(series);
        if (factory.seriesByStart(series.feedId(), series.startEpoch()) != s) revert UnknownSeries();
        if (bookOf[s] != address(0)) revert MarketExists();

        book = kuruRouter.deployProxy(
            MARKET_TYPE,
            address(series.long()),
            address(factory.collateral()),
            SIZE_PRECISION,
            PRICE_PRECISION,
            TICK_SIZE,
            MIN_SIZE,
            MAX_SIZE,
            TAKER_FEE_BPS,
            MAKER_FEE_BPS,
            KURU_AMM_SPREAD
        );
        bookOf[s] = book;
        allSeriesWithBooks.push(s);
        emit MarketCreated(s, book, address(series.long()), series.feedId());
    }

    function marketCount() external view returns (uint256) {
        return allSeriesWithBooks.length;
    }
}
