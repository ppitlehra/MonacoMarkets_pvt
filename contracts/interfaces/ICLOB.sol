// SPDX-License-Identifier: MIT
// Copyright © 2025 Prajwal Pitlehra
// This file is proprietary and confidential.
// Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
pragma solidity ^0.8.17;

import "./IOrderInfo.sol";

/**
 * @title ICLOB
 * @dev Interface for the main CLOB contract
 */
interface ICLOB {
    // Note: Removed generic placeOrder as CLOB implements specific types
    // and SymphonyAdapter calls placeMarketOrder directly.
    /*
    function placeOrder(
        address baseToken,
        address quoteToken,
        uint256 price,
        uint256 quantity,
        bool isBuy,
        uint8 orderType
    ) external returns (uint256);
    */

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

    /**
     * @dev Places a market order (specifically for SymphonyAdapter)
     * @param baseToken The address of the base token
     * @param quoteToken The address of the quote token
     * @param isBuy True if buy order, false if sell order
     * @param quantity The quantity in base token (used for sell orders)
     * @param quoteAmount The amount in quote token (used for buy orders)
     * @return filledQuantity The total quantity of base token filled
     * @return filledQuoteAmount The total amount of quote token filled
     */
    function placeMarketOrder(
        address baseToken,
        address quoteToken,
        bool isBuy,
        uint256 quantity,
        uint256 quoteAmount
    ) external returns (uint256 filledQuantity, uint256 filledQuoteAmount);
}

