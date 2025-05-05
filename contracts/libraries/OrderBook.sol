// SPDX-License-Identifier: MIT
// Copyright © 2025 Prajwal Pitlehra
// This file is proprietary and confidential.
// Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
pragma solidity ^0.8.17;

import "../interfaces/IOrderInfo.sol";

/**
 * @title OrderBook
 * @dev Library for managing the order book data structures
 */
library OrderBook {
    /**
     * @dev Struct representing the order book for a trading pair
     */
    struct OrderBookData {
        // Price levels for buy orders (bids), sorted in descending order
        uint256[] bidPrices;
        // Price levels for sell orders (asks), sorted in ascending order
        uint256[] askPrices;
        // Maps price to index in the bidPrices array
        mapping(uint256 => uint256) bidPriceToIndex;
        // Maps price to index in the askPrices array
        mapping(uint256 => uint256) askPriceToIndex;
        // Maps order ID to its price
        mapping(uint256 => uint256) orderIdToPrice;
        // Maps order ID to whether it's a buy order
        mapping(uint256 => bool) orderIdToBuy;
        // Trading pair identifier
        bytes32 pairId;
        // Whether this order book has been initialized
        bool initialized;
        // Maps price to array of buy orders
        mapping(uint256 => uint256[]) buyOrders;
        // Maps price to array of sell orders
        mapping(uint256 => uint256[]) sellOrders;
    }

    /**
     * @dev Initialize an order book
     * @param self Order book to initialize
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     */
    function initialize(
        OrderBookData storage self,
        address baseToken,
        address quoteToken
    ) internal {
        require(!self.initialized, "OrderBook: already initialized");
        self.pairId = keccak256(abi.encodePacked(baseToken, quoteToken));
        self.initialized = true;
    }

    /**
     * @dev Add a price level to the order book
     * @param self Order book to add to
     * @param price Price level to add
     * @param isBuy True for bid side, false for ask side
     * @return True if the price level was added successfully
     */
    function addPriceLevel(
        OrderBookData storage self,
        uint256 price,
        bool isBuy
    ) internal returns (bool) {
        require(self.initialized, "OrderBook: not initialized");
        require(price > 0, "OrderBook: price must be positive");

        if (isBuy) {
            // Check if price level already exists
            if (bidPriceExists(self, price)) {
                return true;
            }

            // Add price to bids, maintaining descending order
            uint256 insertIndex = findBidInsertIndex(self, price);
            
            // Extend array and shift elements
            self.bidPrices.push(0); // Extend array
            for (uint256 i = self.bidPrices.length - 1; i > insertIndex; i--) {
                self.bidPrices[i] = self.bidPrices[i - 1];
                self.bidPriceToIndex[self.bidPrices[i]] = i;
            }
            
            // Insert new price
            self.bidPrices[insertIndex] = price;
            self.bidPriceToIndex[price] = insertIndex;
        } else {
            // Check if price level already exists
            if (askPriceExists(self, price)) {
                return true;
            }

            // Add price to asks, maintaining ascending order
            uint256 insertIndex = findAskInsertIndex(self, price);
            
            // Extend array and shift elements
            self.askPrices.push(0); // Extend array
            for (uint256 i = self.askPrices.length - 1; i > insertIndex; i--) {
                self.askPrices[i] = self.askPrices[i - 1];
                self.askPriceToIndex[self.askPrices[i]] = i;
            }
            
            // Insert new price
            self.askPrices[insertIndex] = price;
            self.askPriceToIndex[price] = insertIndex;
        }

        return true;
    }

    /**
     * @dev Remove a price level from the order book
     * @param self Order book to remove from
     * @param price Price level to remove
     * @param isBuy True for bid side, false for ask side
     * @return True if the price level was removed successfully
     */
    function removePriceLevel(
        OrderBookData storage self,
        uint256 price,
        bool isBuy
    ) internal returns (bool) {
        require(self.initialized, "OrderBook: not initialized");

        if (isBuy) {
            if (!bidPriceExists(self, price)) {
                return false;
            }

            uint256 index = self.bidPriceToIndex[price];
            
            // Shift elements and update indices
            for (uint256 i = index; i < self.bidPrices.length - 1; i++) {
                self.bidPrices[i] = self.bidPrices[i + 1];
                self.bidPriceToIndex[self.bidPrices[i]] = i;
            }
            
            // Remove last element and delete mapping
            self.bidPrices.pop();
            delete self.bidPriceToIndex[price];
        } else {
            if (!askPriceExists(self, price)) {
                return false;
            }

            uint256 index = self.askPriceToIndex[price];
            
            // Shift elements and update indices
            for (uint256 i = index; i < self.askPrices.length - 1; i++) {
                self.askPrices[i] = self.askPrices[i + 1];
                self.askPriceToIndex[self.askPrices[i]] = i;
            }
            
            // Remove last element and delete mapping
            self.askPrices.pop();
            delete self.askPriceToIndex[price];
        }

        return true;
    }

    /**
     * @dev Add an order to the order book
     * @param self Order book to add to
     * @param orderId ID of the order to add
     * @param price Price of the order
     * @param isBuy True for buy order, false for sell order
     * @return True if the order was added successfully
     */
    function addOrder(
        OrderBookData storage self,
        uint256 orderId,
        uint256 price,
        bool isBuy
    ) internal returns (bool) {
        require(self.initialized, "OrderBook: not initialized");
        require(price > 0, "OrderBook: price must be positive");
        require(orderId > 0, "OrderBook: invalid order ID");
        require(self.orderIdToPrice[orderId] == 0, "OrderBook: order already exists");

        // Add price level if it doesn't exist
        if (isBuy && !bidPriceExists(self, price)) {
            addPriceLevel(self, price, true);
        } else if (!isBuy && !askPriceExists(self, price)) {
            addPriceLevel(self, price, false);
        }

        // Store order information
        self.orderIdToPrice[orderId] = price;
        self.orderIdToBuy[orderId] = isBuy;

        return true;
    }

    /**
     * @dev Remove an order from the order book
     * @param self Order book to remove from
     * @param orderId ID of the order to remove
     * @return True if the order was removed successfully
     */
    function removeOrder(
        OrderBookData storage self,
        uint256 orderId
    ) internal returns (bool) {
        require(self.initialized, "OrderBook: not initialized");
        
        uint256 price = self.orderIdToPrice[orderId];
        if (price == 0) {
            return false; // Order doesn't exist
        }
        
        bool isBuy = self.orderIdToBuy[orderId];
        
        // Clean up order mappings
        delete self.orderIdToPrice[orderId];
        delete self.orderIdToBuy[orderId];
        
        // Remove price level if it becomes empty
        if (isBuy) {
            if (bidPriceExists(self, price)) {
                // If there are no more orders at this price level, remove it
                if (getOrderCountAtPrice(self, price, true) == 1) {
                    removePriceLevel(self, price, true);
                }
            }
        } else {
            if (askPriceExists(self, price)) {
                // If there are no more orders at this price level, remove it
                if (getOrderCountAtPrice(self, price, false) == 1) {
                    removePriceLevel(self, price, false);
                }
            }
        }
        
        return true;
    }

    /**
     * @dev Gets the number of orders at a specific price level
     * @param self Order book to query
     * @param price Price level to check
     * @param isBuy True for bid side, false for ask side
     * @return Number of orders at the price level
     */
    function getOrderCountAtPrice(
        OrderBookData storage self,
        uint256 price,
        bool isBuy
    ) internal view returns (uint256) {
        if (isBuy) {
            if (self.buyOrders[price].length == 0) {
                return 0;
            }
            return self.buyOrders[price].length;
        } else {
            if (self.sellOrders[price].length == 0) {
                return 0;
            }
            return self.sellOrders[price].length;
        }
    }

    /**
     * @dev Get the best bid price
     * @param self Order book to query
     * @return Best bid price, 0 if no bids
     */
    function getBestBidPrice(OrderBookData storage self) internal view returns (uint256) {
        require(self.initialized, "OrderBook: not initialized");
        if (self.bidPrices.length == 0) {
            return 0;
        }
        return self.bidPrices[0]; // Highest bid is at index 0
    }

    /**
     * @dev Get the best ask price
     * @param self Order book to query
     * @return Best ask price, 0 if no asks
     */
    function getBestAskPrice(OrderBookData storage self) internal view returns (uint256) {
        require(self.initialized, "OrderBook: not initialized");
        if (self.askPrices.length == 0) {
            return 0;
        }
        return self.askPrices[0]; // Lowest ask is at index 0
    }

    /**
     * @dev Check if a bid price exists in the order book
     * @param self Order book to check
     * @param price Price to check
     * @return True if the price exists in bids
     */
    function bidPriceExists(OrderBookData storage self, uint256 price) internal view returns (bool) {
        require(self.initialized, "OrderBook: not initialized");
        if (self.bidPrices.length == 0) return false;
        
        uint256 index = self.bidPriceToIndex[price];
        return index < self.bidPrices.length && self.bidPrices[index] == price;
    }

    /**
     * @dev Check if an ask price exists in the order book
     * @param self Order book to check
     * @param price Price to check
     * @return True if the price exists in asks
     */
    function askPriceExists(OrderBookData storage self, uint256 price) internal view returns (bool) {
        require(self.initialized, "OrderBook: not initialized");
        if (self.askPrices.length == 0) return false;
        
        uint256 index = self.askPriceToIndex[price];
        return index < self.askPrices.length && self.askPrices[index] == price;
    }

    /**
     * @dev Find the index to insert a bid price (maintaining descending order)
     * @param self Order book to check
     * @param price Price to insert
     * @return Index to insert at
     */
    function findBidInsertIndex(OrderBookData storage self, uint256 price) internal view returns (uint256) {
        require(self.initialized, "OrderBook: not initialized");
        
        // If no bids, insert at index 0
        if (self.bidPrices.length == 0) {
            return 0;
        }
        
        // Binary search to find insertion point (maintaining descending order)
        uint256 left = 0;
        uint256 right = self.bidPrices.length;
        
        while (left < right) {
            uint256 mid = (left + right) / 2;
            if (self.bidPrices[mid] > price) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        
        return left;
    }

    /**
     * @dev Find the index to insert an ask price (maintaining ascending order)
     * @param self Order book to check
     * @param price Price to insert
     * @return Index to insert at
     */
    function findAskInsertIndex(OrderBookData storage self, uint256 price) internal view returns (uint256) {
        require(self.initialized, "OrderBook: not initialized");
        
        // If no asks, insert at index 0
        if (self.askPrices.length == 0) {
            return 0;
        }
        
        // Binary search to find insertion point (maintaining ascending order)
        uint256 left = 0;
        uint256 right = self.askPrices.length;
        
        while (left < right) {
            uint256 mid = (left + right) / 2;
            if (self.askPrices[mid] < price) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        
        return left;
    }

    /**
     * @dev Get all bid prices
     * @param self Order book to query
     * @return Array of bid prices
     */
    function getBidPrices(OrderBookData storage self) internal view returns (uint256[] memory) {
        require(self.initialized, "OrderBook: not initialized");
        return self.bidPrices;
    }

    /**
     * @dev Get all ask prices
     * @param self Order book to query
     * @return Array of ask prices
     */
    function getAskPrices(OrderBookData storage self) internal view returns (uint256[] memory) {
        require(self.initialized, "OrderBook: not initialized");
        return self.askPrices;
    }

    /**
     * @dev Check if the order book is empty
     * @param self Order book to check
     * @return True if the order book is empty
     */
    function isEmpty(OrderBookData storage self) internal view returns (bool) {
        require(self.initialized, "OrderBook: not initialized");
        return self.bidPrices.length == 0 && self.askPrices.length == 0;
    }

    function getNextOrderId() internal pure returns (uint256) {
        return 1;
    }
}
