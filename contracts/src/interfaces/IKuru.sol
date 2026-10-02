// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal interfaces for the Kuru contracts Rackrate calls (signatures from Kuru's public docs/SDK).
/// @dev Kuru OrderBook: prices are quote-per-base scaled by `pricePrecision`; sizes are base amounts scaled by
///      `sizePrecision`. Market orders with `_isMargin = false` settle directly with the caller's wallet.
interface IKuruOrderBook {
    function addBuyOrder(uint32 _price, uint96 size, bool _postOnly) external;
    function addSellOrder(uint32 _price, uint96 size, bool _postOnly) external;
    function placeAndExecuteMarketBuy(uint96 _quoteSize, uint256 _minAmountOut, bool _isMargin, bool _isFillOrKill)
        external
        payable
        returns (uint256);
    function placeAndExecuteMarketSell(uint96 _size, uint256 _minAmountOut, bool _isMargin, bool _isFillOrKill)
        external
        payable
        returns (uint256);
    function batchCancelOrders(uint40[] calldata _orderIds) external;
    function bestBidAsk() external view returns (uint256, uint256);
    function getMarketParams()
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseAsset,
            uint256 baseAssetDecimals,
            address quoteAsset,
            uint256 quoteAssetDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint256 takerFeeBps,
            uint256 makerFeeBps
        );
}

interface IKuruRouter {
    function deployProxy(
        uint8 _type,
        address _baseAssetAddress,
        address _quoteAssetAddress,
        uint96 _sizePrecision,
        uint32 _pricePrecision,
        uint32 _tickSize,
        uint96 _minSize,
        uint96 _maxSize,
        uint256 _takerFeeBps,
        uint256 _makerFeeBps,
        uint96 _kuruAmmSpread
    ) external returns (address proxy);
}

interface IKuruMarginAccount {
    function deposit(address _user, address _token, uint256 _amount) external payable;
    function withdraw(uint256 _amount, address _token) external;
    function getBalance(address _user, address _token) external view returns (uint256);
}
