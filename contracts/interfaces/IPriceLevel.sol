// SPDX-License-Identifier: MIT
// Copyright © 2025 Prajwal Pitlehra
// This file is proprietary and confidential.
// Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
pragma solidity ^0.8.17;

/**
 * @title IPriceLevel
 * @dev Interface for the PriceLevel component
 */
interface IPriceLevel {
    /**
     * @dev Adds an order to the price level
     * @param orderId The ID of the order to add
     * @param quantity The quantity of the order
     */
    function addOrder(uint256 orderId, uint256 quantity) external;

    /**
     * @dev Removes an order from the price level
     * @param orderId The ID of the order to remove
     * @return The quantity of the removed order
     */
    function removeOrder(uint256 orderId) external returns (uint256);

    /**
     * @dev Gets the total quantity at this price level
     * @return The total quantity
     */
    function getTotalQuantity() external view returns (uint256);

    /**
     * @dev Gets the best order ID at this price level
     * @return The best order ID (oldest order with price-time priority)
     */
    function getBestOrderId() external view returns (uint256);

    /**
     * @dev Gets all order IDs at this price level
     * @return Array of order IDs
     */
    function getAllOrderIds() external view returns (uint256[] memory);

    /**
     * @dev Checks if the price level is empty
     * @return True if empty, false otherwise
     */
    function isEmpty() external view returns (bool);

    /**
     * @dev Gets the quantity of a specific order
     * @param orderId The ID of the order
     * @return The quantity of the order
     */
    function getOrderQuantity(uint256 orderId) external view returns (uint256);
}
