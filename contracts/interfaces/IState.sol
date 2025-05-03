// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./IOrderInfo.sol";

/**
 * @title IState
 * @dev Interface for the State component
 */
interface IState {
    /**
     * @dev Creates a new order
     * @param trader The address of the trader
     * @param baseToken The address of the base token
     * @param quoteToken The address of the quote token
     * @param price The price in quote token
     * @param quantity The quantity in base token
     * @param isBuy True if buy order, false if sell order
     * @param orderType The type of order (LIMIT, MARKET, IOC, FOK)
     * @return The ID of the created order
     */
    function createOrder(
        address trader,
        address baseToken,
        address quoteToken,
        uint256 price,
        uint256 quantity,
        bool isBuy,
        uint8 orderType
    ) external returns (uint256);

    /**
     * @dev Updates the status of an order
     * @param orderId The ID of the order
     * @param status The new status
     * @param filledQuantity The filled quantity
     */
    function updateOrderStatus(
        uint256 orderId,
        uint8 status,
        uint256 filledQuantity
    ) external;

    /**
     * @dev Cancels an order
     * @param orderId The ID of the order
     */
    function cancelOrder(uint256 orderId) external;

    /**
     * @dev Gets an order by ID
     * @param orderId The ID of the order
     * @return The order
     */
    function getOrder(uint256 orderId) external view returns (IOrderInfo.Order memory);

    /**
     * @dev Gets all orders for a trader
     * @param trader The address of the trader
     * @return Array of order IDs
     */
    function getTraderOrders(address trader) external view returns (uint256[] memory);
}
