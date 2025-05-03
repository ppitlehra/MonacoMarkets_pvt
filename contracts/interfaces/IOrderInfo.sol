// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title IOrderInfo
 * @dev Interface for order information and types
 */
interface IOrderInfo {
    // Order types
    enum OrderType {
        LIMIT,  // Limit order
        MARKET, // Market order
        IOC,    // Immediate-or-Cancel
        FOK     // Fill-or-Kill
    }

    // Order status
    enum OrderStatus {
        OPEN,            // Order is open
        PARTIALLY_FILLED, // Order is partially filled
        FILLED,          // Order is completely filled
        CANCELED         // Order is canceled
    }

    // Order structure
    struct Order {
        uint256 id;              // Order ID
        address trader;          // Trader address
        address baseToken;       // Base token address
        address quoteToken;      // Quote token address
        uint256 price;           // Price in quote token
        uint256 quantity;        // Quantity in base token
        bool isBuy;              // True if buy order, false if sell order
        OrderType orderType;     // Order type
        OrderStatus status;      // Order status
        uint256 filledQuantity;  // Filled quantity
        uint256 timestamp;       // Order timestamp
    }

    // Settlement structure
    struct Settlement {
        uint256 takerOrderId;    // Taker order ID
        uint256 makerOrderId;    // Maker order ID
        uint256 quantity;        // Quantity filled
        uint256 price;           // Execution price
        bool processed;          // Whether settlement has been processed
    }
}
