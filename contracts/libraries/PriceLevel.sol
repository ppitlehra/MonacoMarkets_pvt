// SPDX-License-Identifier: MIT
// Copyright © 2025 Prajwal Pitlehra
// This file is proprietary and confidential.
// Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
pragma solidity ^0.8.17;

import "../interfaces/IPriceLevel.sol";

/**
 * @title PriceLevel
 * @dev Library for managing orders at a specific price level
 */
library PriceLevel {
    /**
     * @dev Struct representing a price level in the order book
     */
    struct PriceLevelData {
        uint256 price;           // Price of this level
        uint256 totalQuantity;   // Total quantity at this price level
        uint256[] orderIds;      // Order IDs at this price level (in time priority)
        mapping(uint256 => uint256) orderIdToIndex; // Maps order ID to its index in orderIds array
        bool initialized;        // Whether this price level has been initialized
    }

    /**
     * @dev Initialize a price level
     * @param self Price level to initialize
     * @param price Price for this level
     */
    function initialize(PriceLevelData storage self, uint256 price) internal {
        require(!self.initialized, "PriceLevel: already initialized");
        self.price = price;
        self.totalQuantity = 0;
        self.initialized = true;
    }

    /**
     * @dev Add an order to a price level
     * @param self Price level to add to
     * @param orderId ID of the order to add
     * @param quantity Quantity of the order
     * @return True if the order was added successfully
     */
    function addOrder(
        PriceLevelData storage self,
        uint256 orderId,
        uint256 quantity
    ) internal returns (bool) {
        require(self.initialized, "PriceLevel: not initialized");
        require(quantity > 0, "PriceLevel: quantity must be positive");
        require(!containsOrder(self, orderId), "PriceLevel: order already exists");

        // Add order ID to the end of the array (time priority)
        self.orderIds.push(orderId);
        self.orderIdToIndex[orderId] = self.orderIds.length - 1;
        self.totalQuantity += quantity;

        return true;
    }

    /**
     * @dev Remove an order from a price level
     * @param self Price level to remove from
     * @param orderId ID of the order to remove
     * @param quantity Quantity of the order to remove
     * @return True if the order was removed successfully
     */
    function removeOrder(
        PriceLevelData storage self,
        uint256 orderId,
        uint256 quantity
    ) internal returns (bool) {
        require(self.initialized, "PriceLevel: not initialized");
        require(containsOrder(self, orderId), "PriceLevel: order does not exist");
        require(self.totalQuantity >= quantity, "PriceLevel: insufficient quantity");

        uint256 index = self.orderIdToIndex[orderId];
        uint256 lastIndex = self.orderIds.length - 1;

        if (index != lastIndex) {
            // Move the last order to the position of the removed order
            uint256 lastOrderId = self.orderIds[lastIndex];
            self.orderIds[index] = lastOrderId;
            self.orderIdToIndex[lastOrderId] = index;
        }

        // Remove the last element
        self.orderIds.pop();
        delete self.orderIdToIndex[orderId];
        self.totalQuantity -= quantity;

        return true;
    }

    /**
     * @dev Update an order's quantity at a price level
     * @param self Price level to update
     * @param orderId ID of the order to update
     * @param oldQuantity Old quantity of the order
     * @param newQuantity New quantity for the order
     * @return True if the order was updated successfully
     */
    function updateOrderQuantity(
        PriceLevelData storage self,
        uint256 orderId,
        uint256 oldQuantity,
        uint256 newQuantity
    ) internal returns (bool) {
        require(self.initialized, "PriceLevel: not initialized");
        require(containsOrder(self, orderId), "PriceLevel: order does not exist");
        require(newQuantity > 0, "PriceLevel: quantity must be positive");
        require(self.totalQuantity >= oldQuantity, "PriceLevel: insufficient quantity");

        self.totalQuantity = self.totalQuantity - oldQuantity + newQuantity;
        return true;
    }

    /**
     * @dev Get the total quantity at this price level
     * @param self Price level to query
     * @return Total quantity
     */
    function getTotalQuantity(PriceLevelData storage self) internal view returns (uint256) {
        require(self.initialized, "PriceLevel: not initialized");
        return self.totalQuantity;
    }

    /**
     * @dev Get all order IDs at this price level
     * @param self Price level to query
     * @return Array of order IDs
     */
    function getOrderIds(PriceLevelData storage self) internal view returns (uint256[] memory) {
        require(self.initialized, "PriceLevel: not initialized");
        return self.orderIds;
    }

    /**
     * @dev Check if a price level contains an order
     * @param self Price level to check
     * @param orderId ID of the order to check
     * @return True if the price level contains the order
     */
    function containsOrder(PriceLevelData storage self, uint256 orderId) internal view returns (bool) {
        if (self.orderIds.length == 0) return false;
        
        // If the order ID has a valid index and that index in the array contains the order ID
        uint256 index = self.orderIdToIndex[orderId];
        return index < self.orderIds.length && self.orderIds[index] == orderId;
    }

    /**
     * @dev Get the price of this price level
     * @param self Price level to query
     * @return Price
     */
    function getPrice(PriceLevelData storage self) internal view returns (uint256) {
        require(self.initialized, "PriceLevel: not initialized");
        return self.price;
    }

    /**
     * @dev Get the number of orders at this price level
     * @param self Price level to query
     * @return Number of orders
     */
    function getOrderCount(PriceLevelData storage self) internal view returns (uint256) {
        require(self.initialized, "PriceLevel: not initialized");
        return self.orderIds.length;
    }

    /**
     * @dev Check if this price level is empty
     * @param self Price level to check
     * @return True if the price level is empty
     */
    function isEmpty(PriceLevelData storage self) internal view returns (bool) {
        require(self.initialized, "PriceLevel: not initialized");
        return self.orderIds.length == 0;
    }
}
