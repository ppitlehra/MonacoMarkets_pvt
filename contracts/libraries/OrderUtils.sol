// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../interfaces/IOrderInfo.sol";

/**
 * @title OrderUtils
 * @dev Library for order-related utility functions
 */
library OrderUtils {
    /**
     * @dev Constants for price and quantity precision
     */
    uint256 public constant PRICE_PRECISION = 1e6;
    uint256 public constant QUANTITY_PRECISION = 1e6;
    
    /**
     * @dev Constants for fee calculation
     */
    uint256 public constant FEE_PRECISION = 10000; // 100.00%
    
    /**
     * @dev Calculate the total value of an order (price * quantity)
     * @param price Order price
     * @param quantity Order quantity
     * @return Total value
     */
    function calculateOrderValue(uint256 price, uint256 quantity) internal pure returns (uint256) {
        return (price * quantity) / PRICE_PRECISION;
    }
    
    /**
     * @dev Calculate the fee for an order
     * @param orderValue Total value of the order
     * @param feeRate Fee rate in basis points (1/100 of a percent)
     * @return Fee amount
     */
    function calculateFee(uint256 orderValue, uint256 feeRate) internal pure returns (uint256) {
        return (orderValue * feeRate) / FEE_PRECISION;
    }
    
    /**
     * @dev Check if two orders can match
     * @param buyPrice Buy order price
     * @param sellPrice Sell order price
     * @return True if orders can match
     */
    function canMatch(uint256 buyPrice, uint256 sellPrice) internal pure returns (bool) {
        return buyPrice >= sellPrice;
    }
    
    /**
     * @dev Calculate the execution price for a match
     * @param makerPrice Maker order price
     * @param takerPrice Taker order price
     * @param makerIsBuy True if maker is a buy order
     * @return Execution price
     */
    function calculateExecutionPrice(
        uint256 makerPrice,
        uint256 takerPrice,
        bool makerIsBuy
    ) internal pure returns (uint256) {
        // For price-time priority:
        // If maker is buying, use the higher price (taker's ask price)
        // If maker is selling, use the lower price (taker's bid price)
        if (makerIsBuy) {
            return makerPrice > takerPrice ? takerPrice : makerPrice;
        } else {
            return makerPrice < takerPrice ? takerPrice : makerPrice;
        }
    }
    
    /**
     * @dev Calculate the maximum quantity that can be matched
     * @param remainingBuyQuantity Remaining quantity of buy order
     * @param remainingSellQuantity Remaining quantity of sell order
     * @return Maximum matchable quantity
     */
    function calculateMatchQuantity(
        uint256 remainingBuyQuantity,
        uint256 remainingSellQuantity
    ) internal pure returns (uint256) {
        return remainingBuyQuantity < remainingSellQuantity ? 
               remainingBuyQuantity : 
               remainingSellQuantity;
    }
    
    /**
     * @dev Check if an order should be immediately executed based on its type
     * @param orderType Type of the order
     * @return True if the order should be immediately executed
     */
    function isImmediateExecution(IOrderInfo.OrderType orderType) internal pure returns (bool) {
        return orderType == IOrderInfo.OrderType.MARKET || 
               orderType == IOrderInfo.OrderType.IOC || 
               orderType == IOrderInfo.OrderType.FOK;
    }
    
    /**
     * @dev Check if an order requires full fill
     * @param orderType Type of the order
     * @return True if the order requires full fill
     */
    function requiresFullFill(IOrderInfo.OrderType orderType) internal pure returns (bool) {
        return orderType == IOrderInfo.OrderType.FOK;
    }
    
    /**
     * @dev Generate a unique order ID
     * @param trader Address of the trader
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @param timestamp Timestamp when order was placed
     * @param nonce Unique nonce for the order
     * @return Unique order ID
     */
    function generateOrderId(
        address trader,
        address baseToken,
        address quoteToken,
        uint256 timestamp,
        uint256 nonce
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(
            trader,
            baseToken,
            quoteToken,
            timestamp,
            nonce
        )));
    }
    
    /**
     * @dev Generate a trading pair ID
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @return Trading pair ID
     */
    function generatePairId(
        address baseToken,
        address quoteToken
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(baseToken, quoteToken));
    }
}
