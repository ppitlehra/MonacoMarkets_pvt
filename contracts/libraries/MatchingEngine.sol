// SPDX-License-Identifier: MIT
// Copyright © 2025 Prajwal Pitlehra
// This file is proprietary and confidential.
// Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
pragma solidity ^0.8.17;

import "../interfaces/IOrderInfo.sol";
import "../interfaces/IBook.sol";

/**
 * @title MatchingEngine
 * @dev Library for matching orders in the order book
 */
library MatchingEngine {
    /**
     * @dev Match structure to track individual matches
     */
    struct Match {
        uint256 makerOrderId;
        uint256 takerOrderId;
        uint256 quantity;
        uint256 price;
    }

    /**
     * @dev MatchResult structure to track all matches for an order
     */
    struct MatchResult {
        Match[] matches;
        uint256 totalQuantity;
        bool fullyMatched;
    }

    /**
     * @dev Matches a taker order against maker orders in the book
     * @param takerOrderId The ID of the taker order
     * @param takerOrder The taker order
     * @param makerOrderIds Array of maker order IDs
     * @param makerOrders Array of maker orders
     * @param maxMatches Maximum number of matches to process
     * @return result The match result
     */
    function matchOrder(
        uint256 takerOrderId,
        IOrderInfo.Order memory takerOrder,
        uint256[] memory makerOrderIds,
        IOrderInfo.Order[] memory makerOrders,
        uint256 maxMatches
    ) internal pure returns (MatchResult memory result) {
        result.matches = new Match[](maxMatches);
        result.totalQuantity = 0;
        result.fullyMatched = false;
        
        uint256 matchCount = 0;
        uint256 remainingQuantity = takerOrder.quantity - takerOrder.filledQuantity;
        
        for (uint256 i = 0; i < makerOrderIds.length && remainingQuantity > 0 && matchCount < maxMatches; i++) {
            IOrderInfo.Order memory makerOrder = makerOrders[i];
            
            // Skip filled or canceled orders
            if (makerOrder.status != IOrderInfo.OrderStatus.OPEN && 
                makerOrder.status != IOrderInfo.OrderStatus.PARTIALLY_FILLED) {
                continue;
            }
            
            // Check price matching
            bool priceMatches = false;
            if (takerOrder.isBuy) {
                // Buy order matches if taker price >= maker price
                priceMatches = takerOrder.price >= makerOrder.price;
            } else {
                // Sell order matches if taker price <= maker price
                priceMatches = takerOrder.price <= makerOrder.price;
            }
            
            if (!priceMatches) {
                continue;
            }
            
            // Calculate match quantity
            uint256 makerAvailable = makerOrder.quantity - makerOrder.filledQuantity;
            uint256 matchQuantity = remainingQuantity < makerAvailable ? remainingQuantity : makerAvailable;
            
            if (matchQuantity > 0) {
                // Create match
                result.matches[matchCount] = Match({
                    makerOrderId: makerOrderIds[i],
                    takerOrderId: takerOrderId,
                    quantity: matchQuantity,
                    price: makerOrder.price
                });
                
                matchCount++;
                result.totalQuantity += matchQuantity;
                remainingQuantity -= matchQuantity;
            }
        }
        
        // Resize matches array to actual match count
        // Using a safer approach without assembly
        Match[] memory resizedMatches = new Match[](matchCount);
        for (uint256 i = 0; i < matchCount; i++) {
            resizedMatches[i] = result.matches[i];
        }
        result.matches = resizedMatches;
        
        // Check if fully matched
        result.fullyMatched = (remainingQuantity == 0);
        
        return result;
    }

    /**
     * @dev Converts matches to settlements
     * @param matchResult The match result
     * @return settlements Array of settlements
     */
    function toSettlements(MatchResult memory matchResult) internal pure returns (IOrderInfo.Settlement[] memory) {
        IOrderInfo.Settlement[] memory settlements = new IOrderInfo.Settlement[](matchResult.matches.length);
        
        for (uint256 i = 0; i < matchResult.matches.length; i++) {
            Match memory matchItem = matchResult.matches[i];
            
            settlements[i] = IOrderInfo.Settlement({
                takerOrderId: matchItem.takerOrderId,
                makerOrderId: matchItem.makerOrderId,
                quantity: matchItem.quantity,
                price: matchItem.price,
                processed: false
            });
        }
        
        return settlements;
    }
}
