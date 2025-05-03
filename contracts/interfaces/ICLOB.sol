// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./IOrderInfo.sol";

/**
 * @title ICLOB
 * @dev Interface for the main CLOB contract
 */
interface ICLOB {
    /**
     * @dev Places an order
     * @param baseToken The address of the base token
     * @param quoteToken The address of the quote token
     * @param price The price in quote token
     * @param quantity The quantity in base token
     * @param isBuy True if buy order, false if sell order
     * @param orderType The type of order (LIMIT, MARKET, IOC, FOK)
     * @return The ID of the created order
     */
    function placeOrder(
        address baseToken,
        address quoteToken,
        uint256 price,
        uint256 quantity,
        bool isBuy,
        uint8 orderType
    ) external returns (uint256);

    /**
     * @dev Cancels an order
     * @param orderId The ID of the order
     */
    function cancelOrder(uint256 orderId) external;

    /**
     * @dev Gets the components of the CLOB
     * @return book The address of the book component
     * @return state The address of the state component
     * @return vault The address of the vault component
     */
    function getComponents() external view returns (address book, address state, address vault);

    /**
     * @dev Adds a supported trading pair
     * @param baseToken The address of the base token
     * @param quoteToken The address of the quote token
     */
    function addSupportedPair(address baseToken, address quoteToken) external;

    /**
     * @dev Checks if a trading pair is supported
     * @param baseToken The address of the base token
     * @param quoteToken The address of the quote token
     * @return True if the pair is supported, false otherwise
     */
    function isSupportedPair(address baseToken, address quoteToken) external view returns (bool);

    /**
     * @dev Sets the Symphony adapter address
     * @param symphonyAdapterAddress The address of the Symphony adapter
     */
    function setSymphonyAdapter(address symphonyAdapterAddress) external;

    /**
     * @dev Enables or disables Symphony integration
     * @param enabled True to enable, false to disable
     */
    function setSymphonyIntegrationEnabled(bool enabled) external;

    /**
     * @dev Gets the order book state
     * @param baseToken The address of the base token
     * @param quoteToken The address of the quote token
     * @param levels The number of price levels to return
     * @return bidPrices Array of bid prices
     * @return bidQuantities Array of bid quantities
     * @return askPrices Array of ask prices
     * @return askQuantities Array of ask quantities
     */
    function getOrderBook(
        address baseToken,
        address quoteToken,
        uint256 levels
    ) external view returns (
        uint256[] memory bidPrices,
        uint256[] memory bidQuantities,
        uint256[] memory askPrices,
        uint256[] memory askQuantities
    );
    
    /**
     * @dev Gets an order by ID
     * @param orderId The ID of the order
     * @return The order
     */
    function getOrder(uint256 orderId) external view returns (IOrderInfo.Order memory);
}
