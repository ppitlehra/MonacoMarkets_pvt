// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./IOrderInfo.sol";

/**
 * @title IBook
 * @dev Interface for the Book component
 */
interface IBook {
    /**
     * @dev Adds an order to the book
     * @param orderId The ID of the order to add
     */
    function addOrder(uint256 orderId) external;

    /**
     * @dev Removes an order from the book
     * @param orderId The ID of the order to remove
     */
    function removeOrder(uint256 orderId) external;

    /**
     * @dev Matches an order against existing orders in the book.
     * Stores generated settlements internally for later retrieval.
     * @param orderId The ID of the order to match
     * @return settlementCount The number of settlements generated
     */
    function matchOrders(uint256 orderId) external returns (uint256 settlementCount);

    /**
     * @dev Retrieves and clears pending settlements for a given taker order ID.
     * Should be called after matchOrders returns a count > 0.
     * @param takerOrderId The ID of the taker order for which settlements were generated
     * @return settlements Array of settlements resulting from the match
     */
    function getPendingSettlements(uint256 takerOrderId) external returns (IOrderInfo.Settlement[] memory settlements);

    /**
     * @dev Checks if an order can be fully filled against the current order book
     * @param orderId The ID of the order to check
     * @return canBeFilled True if the order can be fully filled, false otherwise
     * @return fillableQuantity The quantity that can be filled
     */
    function canOrderBeFullyFilled(uint256 orderId) external view returns (bool canBeFilled, uint256 fillableQuantity);

    /**
     * @dev Gets the best bid price
     * @return The best bid price, or 0 if no bids
     */
    function getBestBidPrice() external view returns (uint256);

    /**
     * @dev Gets the best ask price
     * @return The best ask price, or 0 if no asks
     */
    function getBestAskPrice() external view returns (uint256);

    /**
     * @dev Gets the quantity available at a specific price
     * @param price The price level
     * @param isBuy Whether to check buy or sell side
     * @return The quantity available at the price
     */
    function getQuantityAtPrice(uint256 price, bool isBuy) external view returns (uint256);

    /**
     * @dev Sets the vault address
     * @param vaultAddress The address of the vault
     */
    function setVault(address vaultAddress) external;

    /**
     * @dev Gets the order IDs at a specific price level
     * @param price The price level
     * @param isBuy True for buy orders, false for sell orders
     * @return The order IDs at the price level
     */
    function getOrdersAtPrice(uint256 price, bool isBuy) external view returns (uint256[] memory);

    /**
     * @dev Gets the quantity of a specific order in the book
     * @param orderId The ID of the order
     * @param price The price level of the order
     * @param isBuy True for buy orders, false for sell orders
     * @return The quantity of the order in the book
     */
    function getOrderQuantity(uint256 orderId, uint256 price, bool isBuy) external view returns (uint256);

    /**
     * @dev Gets all buy prices
     * @return The buy prices
     */
    function getBuyPrices() external view returns (uint256[] memory);

    /**
     * @dev Gets all sell prices
     * @return The sell prices
     */
    function getSellPrices() external view returns (uint256[] memory);
}

