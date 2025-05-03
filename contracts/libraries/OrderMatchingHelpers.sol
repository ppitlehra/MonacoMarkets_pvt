// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../interfaces/IOrderInfo.sol";

/**
 * @title Order Matching Helpers Library
 * @dev Library of helper functions for order matching and settlement processing
 */
library OrderMatchingHelpers {
    /**
     * @dev Sort settlements by maker order ID for optimized storage access
     * @param settlements The settlements to sort
     */
    function sortSettlementsByMakerOrderId(IOrderInfo.Settlement[] memory settlements) internal pure {
        // Skip sorting if array is empty or has only one element
        if (settlements.length <= 1) {
            return;
        }
        
        // Use a safer bubble sort algorithm to avoid arithmetic overflow
        for (uint256 i = 0; i < settlements.length - 1; i++) {
            for (uint256 j = 0; j < settlements.length - i - 1; j++) {
                if (settlements[j].makerOrderId > settlements[j + 1].makerOrderId) {
                    // Swap settlements[j] and settlements[j+1]
                    IOrderInfo.Settlement memory temp = settlements[j];
                    settlements[j] = settlements[j + 1];
                    settlements[j + 1] = temp;
                }
            }
        }
    }
    
    /**
     * @dev Sort settlements by maker trader address for optimized batch processing
     * @param settlements The settlements to sort
     * @param makerTraders The maker trader addresses corresponding to each settlement
     */
    function sortSettlementsByMakerTrader(
        IOrderInfo.Settlement[] memory settlements,
        address[] memory makerTraders
    ) internal pure {
        // Simple insertion sort for small arrays
        for (uint256 i = 1; i < settlements.length; i++) {
            IOrderInfo.Settlement memory keySettlement = settlements[i];
            address keyTrader = makerTraders[i];
            int256 j = int256(i) - 1;
            
            while (j >= 0 && 
                   uint160(makerTraders[uint256(j)]) > uint160(keyTrader)) {
                settlements[uint256(j) + 1] = settlements[uint256(j)];
                makerTraders[uint256(j) + 1] = makerTraders[uint256(j)];
                j--;
            }
            
            settlements[uint256(j) + 1] = keySettlement;
            makerTraders[uint256(j) + 1] = keyTrader;
        }
    }
    
    /**
     * @dev Group settlements by maker trader
     * @param settlements The settlements to group
     * @param makerTraders The maker trader addresses corresponding to each settlement
     * @return uniqueTraders Array of unique maker traders
     * @return traderSettlementCounts Array of settlement counts for each unique trader
     * @return uniqueTradersCount Number of unique traders
     */
    function groupSettlementsByMakerTrader(
        IOrderInfo.Settlement[] memory settlements,
        address[] memory makerTraders
    ) internal pure returns (
        address[] memory uniqueTraders,
        uint256[] memory traderSettlementCounts,
        uint256 uniqueTradersCount
    ) {
        // First, sort settlements by maker trader
        sortSettlementsByMakerTrader(settlements, makerTraders);
        
        // Initialize arrays for unique traders and their settlement counts
        uniqueTraders = new address[](settlements.length);
        traderSettlementCounts = new uint256[](settlements.length);
        uniqueTradersCount = 0;
        
        // Group settlements by maker trader
        for (uint256 i = 0; i < settlements.length; i++) {
            if (i == 0 || makerTraders[i] != makerTraders[i - 1]) {
                // New unique trader
                uniqueTraders[uniqueTradersCount] = makerTraders[i];
                traderSettlementCounts[uniqueTradersCount] = 1;
                uniqueTradersCount++;
            } else {
                // Existing trader, increment count
                traderSettlementCounts[uniqueTradersCount - 1]++;
            }
        }
    }
    
    /**
     * @dev Find the best price in a price array
     * @param prices The price array
     * @param isBuy True to find the highest price (for buy orders), false to find the lowest price (for sell orders)
     * @return The best price, or 0 if the array is empty
     */
    function findBestPrice(uint256[] memory prices, bool isBuy) internal pure returns (uint256) {
        if (prices.length == 0) {
            return 0;
        }
        
        if (isBuy) {
            // Find the highest price for buy orders
            uint256 bestPrice = 0;
            for (uint256 i = 0; i < prices.length; i++) {
                if (prices[i] > bestPrice) {
                    bestPrice = prices[i];
                }
            }
            return bestPrice;
        } else {
            // Find the lowest price for sell orders
            uint256 bestPrice = type(uint256).max;
            for (uint256 i = 0; i < prices.length; i++) {
                if (prices[i] < bestPrice) {
                    bestPrice = prices[i];
                }
            }
            return bestPrice == type(uint256).max ? 0 : bestPrice;
        }
    }
    
    /**
     * @dev Determine the appropriate order status based on filled quantity
     * @param quantity The total order quantity
     * @param filledQuantity The filled quantity
     * @return The appropriate order status
     */
    function determineOrderStatus(
        uint256 quantity,
        uint256 filledQuantity
    ) internal pure returns (IOrderInfo.OrderStatus) {
        require(filledQuantity <= quantity, "OrderMatchingHelpers: filled quantity exceeds order quantity");
        
        if (filledQuantity == 0) {
            return IOrderInfo.OrderStatus.OPEN;
        } else if (filledQuantity < quantity) {
            return IOrderInfo.OrderStatus.PARTIALLY_FILLED;
        } else {
            return IOrderInfo.OrderStatus.FILLED;
        }
    }
    
    /**
     * @dev Calculate the average match size for a trading pair
     * @param currentAverage The current average match size
     * @param newMatchSize The new match size
     * @param weight The weight to give to the current average (0-100)
     * @return The updated average match size
     */
    function calculateAverageMatchSize(
        uint256 currentAverage,
        uint256 newMatchSize,
        uint256 weight
    ) internal pure returns (uint256) {
        require(weight <= 100, "OrderMatchingHelpers: weight must be between 0 and 100");
        
        if (currentAverage == 0) {
            return newMatchSize;
        }
        
        // Calculate weighted average
        return (currentAverage * weight + newMatchSize * (100 - weight)) / 100;
    }
    
    /**
     * @dev Estimate the maximum number of settlements for an order
     * @param orderQuantity The order quantity
     * @param averageMatchSize The average match size
     * @param minSettlements The minimum number of settlements
     * @param maxSettlements The maximum number of settlements
     * @return The estimated maximum number of settlements
     */
    function estimateMaxSettlements(
        uint256 orderQuantity,
        uint256 averageMatchSize,
        uint256 minSettlements,
        uint256 maxSettlements
    ) internal pure returns (uint256) {
        // If average match size is zero (no history), use a default value
        if (averageMatchSize == 0) {
            averageMatchSize = 10 ** 18; // 1 token with 18 decimals as default
        }
        
        // Calculate max settlements with a safety factor of 2x
        uint256 estimate = (orderQuantity / averageMatchSize) * 2;
        
        // Ensure at least minSettlements and at most maxSettlements
        if (estimate < minSettlements) {
            return minSettlements;
        } else if (estimate > maxSettlements) {
            return maxSettlements;
        }
        
        return estimate;
    }
    
    /**
     * @dev Check if an order can be fully filled
     * @param orderQuantity The order quantity
     * @param filledQuantity The already filled quantity
     * @param availableLiquidity The available liquidity
     * @return canBeFilled True if the order can be fully filled
     * @return fillableQuantity The fillable quantity
     */
    function canOrderBeFullyFilled(
        uint256 orderQuantity,
        uint256 filledQuantity,
        uint256 availableLiquidity
    ) internal pure returns (bool canBeFilled, uint256 fillableQuantity) {
        uint256 remainingQuantity = orderQuantity - filledQuantity;
        
        if (availableLiquidity >= remainingQuantity) {
            return (true, remainingQuantity);
        } else {
            return (false, availableLiquidity);
        }
    }
    
    /**
     * @dev Calculate the safe match quantity to avoid overflow
     * @param remainingTakerQuantity The remaining taker quantity
     * @param makerQuantity The maker quantity
     * @return The safe match quantity
     */
    function calculateSafeMatchQuantity(
        uint256 remainingTakerQuantity,
        uint256 makerQuantity
    ) internal pure returns (uint256) {
        return remainingTakerQuantity < makerQuantity ? remainingTakerQuantity : makerQuantity;
    }
}
