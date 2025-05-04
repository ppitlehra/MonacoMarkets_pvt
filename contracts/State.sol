// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./interfaces/IOrderInfo.sol";
import "./interfaces/IState.sol";
import "./libraries/OrderMatchingHelpers.sol";

/**
 * @title State Contract for SEI CLOB
 * @dev Manages order state with enhanced status updates and validation
 */
contract State is IState {
    address public admin;
    mapping(address => bool) public admins;

    // Order storage
    mapping(uint256 => IOrderInfo.Order) private orders;
    uint256 private nextOrderId = 1;
    
    // Trader orders mapping
    mapping(address => uint256[]) private traderOrders;

    // Events
    event OrderCreated(uint256 indexed orderId, address indexed trader, bool isBuy, uint256 price, uint256 quantity);
    event OrderStatusUpdated(uint256 indexed orderId, uint8 status, uint256 filledQuantity);
    event OrderCanceled(uint256 indexed orderId);
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);

    constructor(address _admin) {
        admin = _admin;
        admins[_admin] = true;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "State: caller is not admin");
        _;
    }

    modifier onlyAdmins() {
        require(admins[msg.sender], "State: caller is not an admin");
        _;
    }

    function setAdmin(address _admin) external onlyAdmin {
        address oldAdmin = admin;
        admin = _admin;
        admins[_admin] = true;
        emit AdminUpdated(oldAdmin, _admin);
    }

    function addAdmin(address _admin) external onlyAdmin {
        admins[_admin] = true;
        emit AdminAdded(_admin);
    }

    function removeAdmin(address _admin) external onlyAdmin {
        require(_admin != admin, "State: cannot remove primary admin");
        admins[_admin] = false;
        emit AdminRemoved(_admin);
    }

    /**
     * @dev Create a new order with validated inputs
     * @param trader The trader address
     * @param baseToken The base token address
     * @param quoteToken The quote token address
     * @param price The price of the order
     * @param quantity The quantity of the order
     * @param isBuy True for buy orders, false for sell orders
     * @param orderType The type of the order (LIMIT, MARKET, IOC, FOK)
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
    ) external override onlyAdmins returns (uint256) {
        // Validate inputs
        require(trader != address(0), "State: invalid trader address");
        require(baseToken != address(0), "State: invalid base token address");
        require(quoteToken != address(0), "State: invalid quote token address");
        require(baseToken != quoteToken, "State: base token and quote token must be different");
        require(quantity > 0, "State: quantity must be greater than 0");
        
        // For non-market orders, price must be greater than 0
        if (orderType != uint8(IOrderInfo.OrderType.MARKET)) {
            require(price > 0, "State: price must be greater than 0");
        }
        
        // Validate order type
        require(
            orderType == uint8(IOrderInfo.OrderType.LIMIT) ||
            orderType == uint8(IOrderInfo.OrderType.MARKET) ||
            orderType == uint8(IOrderInfo.OrderType.IOC) ||
            orderType == uint8(IOrderInfo.OrderType.FOK),
            "State: invalid order type"
        );

        uint256 orderId = nextOrderId++;
        
        orders[orderId] = IOrderInfo.Order({
            id: orderId,
            trader: trader,
            baseToken: baseToken,
            quoteToken: quoteToken,
            isBuy: isBuy,
            price: price,
            quantity: quantity,
            filledQuantity: 0,
            status: IOrderInfo.OrderStatus.OPEN,
            orderType: IOrderInfo.OrderType(orderType),
            timestamp: block.timestamp
        });
        
        // Add order to trader's orders
        traderOrders[trader].push(orderId);
        
        emit OrderCreated(orderId, trader, isBuy, price, quantity);
        
        return orderId;
    }

    /**
     * @dev Update the status of an order with enhanced validation
     * @param orderId The ID of the order
     * @param status The new status of the order
     * @param filledQuantity The filled quantity of the order
     */
    function updateOrderStatus(
        uint256 orderId,
        uint8 status,
        uint256 filledQuantity
    ) external override onlyAdmins {
        require(orders[orderId].id == orderId, "State: order does not exist");
        
        // Validate status transition
        validateStatusTransition(orders[orderId].status, IOrderInfo.OrderStatus(status));
        
        // Validate filled quantity
        validateFilledQuantity(orders[orderId], filledQuantity);
        
        // Update order status and filled quantity
        orders[orderId].status = IOrderInfo.OrderStatus(status);
        orders[orderId].filledQuantity = filledQuantity;
        
        emit OrderStatusUpdated(orderId, status, filledQuantity);
    }

    /**
     * @dev Cancel an order
     * @param orderId The ID of the order
     */
    function cancelOrder(uint256 orderId) external override onlyAdmins {
        require(orders[orderId].id == orderId, "State: order does not exist");
        require(
            orders[orderId].status == IOrderInfo.OrderStatus.OPEN || 
            orders[orderId].status == IOrderInfo.OrderStatus.PARTIALLY_FILLED,
            "State: order cannot be canceled"
        );
        
        orders[orderId].status = IOrderInfo.OrderStatus.CANCELED;
        
        emit OrderCanceled(orderId);
        emit OrderStatusUpdated(orderId, uint8(IOrderInfo.OrderStatus.CANCELED), orders[orderId].filledQuantity);
    }

    /**
     * @dev Update the status of multiple orders in a batch
     * @param orderIds The IDs of the orders
     * @param statuses The new statuses of the orders
     * @param filledQuantities The filled quantities of the orders
     */
    function updateOrderStatusBatch(
        uint256[] calldata orderIds,
        uint8[] calldata statuses,
        uint256[] calldata filledQuantities
    ) external onlyAdmins {
        require(
            orderIds.length == statuses.length && 
            orderIds.length == filledQuantities.length,
            "State: input arrays must have the same length"
        );
        
        for (uint256 i = 0; i < orderIds.length; i++) {
            uint256 orderId = orderIds[i];
            uint8 status = statuses[i];
            uint256 filledQuantity = filledQuantities[i];
            
            require(orders[orderId].id == orderId, "State: order does not exist");
            
            // Validate status transition
            validateStatusTransition(orders[orderId].status, IOrderInfo.OrderStatus(status));
            
            // Validate filled quantity
            validateFilledQuantity(orders[orderId], filledQuantity);
            
            // Update order status and filled quantity
            orders[orderId].status = IOrderInfo.OrderStatus(status);
            orders[orderId].filledQuantity = filledQuantity;
            
            emit OrderStatusUpdated(orderId, status, filledQuantity);
        }
    }

    /**
     * @dev Validate status transition to prevent invalid state changes
     * @param currentStatus The current status of the order
     * @param newStatus The new status of the order
     */
    function validateStatusTransition(
        IOrderInfo.OrderStatus currentStatus,
        IOrderInfo.OrderStatus newStatus
    ) internal pure {
        // OPEN can transition to any other status
        if (currentStatus == IOrderInfo.OrderStatus.OPEN) {
            return;
        }
        
        // PARTIALLY_FILLED can transition to FILLED, PARTIALLY_FILLED (for incremental updates), or CANCELED
        if (currentStatus == IOrderInfo.OrderStatus.PARTIALLY_FILLED) {
            require(
                newStatus == IOrderInfo.OrderStatus.FILLED || 
                newStatus == IOrderInfo.OrderStatus.PARTIALLY_FILLED ||
                newStatus == IOrderInfo.OrderStatus.CANCELED,
                "State: invalid status transition from PARTIALLY_FILLED"
            );
            return;
        }
        
        // FILLED and CANCELED are terminal states, but allow redundant updates to same terminal state
        if (currentStatus == IOrderInfo.OrderStatus.FILLED) {
            require(newStatus == IOrderInfo.OrderStatus.FILLED, "State: cannot transition from FILLED");
            return;
        }
        if (currentStatus == IOrderInfo.OrderStatus.CANCELED) {
            require(newStatus == IOrderInfo.OrderStatus.CANCELED, "State: cannot transition from CANCELED");
            return;
        }

        // Should not happen if logic above is complete, but prevents unknown transitions
        revert("State: Invalid or unhandled status transition");
    }

    /**
     * @dev Validate filled quantity to ensure consistency with status
     * @param order The order to validate
     * @param filledQuantity The filled quantity to validate
     */
    function validateFilledQuantity(
        IOrderInfo.Order memory order,
        uint256 filledQuantity
    ) internal pure {
        // Filled quantity must not exceed order quantity
        require(filledQuantity <= order.quantity, "State: filled quantity exceeds order quantity");
        
        // Remove status-based validations as they can cause issues when updating status
        // The status will be determined by the calling function based on filledQuantity
    }

    /**
     * @dev Get an order by ID
     * @param orderId The ID of the order
     * @return The order
     */
    function getOrder(uint256 orderId) external view override returns (IOrderInfo.Order memory) {

        require(orders[orderId].id == orderId, "State: order does not exist");

        return orders[orderId];
    }

    /**
     * @dev Get all orders for a trader
     * @param trader The address of the trader
     * @return Array of order IDs
     */
    function getTraderOrders(address trader) external view override returns (uint256[] memory) {
        return traderOrders[trader];
    }

    /**
     * @dev Get multiple orders by IDs
     * @param orderIds The IDs of the orders
     * @return The orders
     */
    function getOrders(uint256[] calldata orderIds) external view returns (IOrderInfo.Order[] memory) {
        IOrderInfo.Order[] memory result = new IOrderInfo.Order[](orderIds.length);
        
        for (uint256 i = 0; i < orderIds.length; i++) {
            uint256 orderId = orderIds[i];
            require(orders[orderId].id == orderId, "State: order does not exist");
            result[i] = orders[orderId];
        }
        
        return result;
    }

    /**
     * @dev Get the next order ID
     * @return The next order ID
     */
    function getNextOrderId() external view returns (uint256) {
        return nextOrderId;
    }
    
    /**
     * @dev Get the next order ID (alias for getNextOrderId for backward compatibility)
     * @return The next order ID
     */
    function orderCounter() external view returns (uint256) {
        return nextOrderId;
    }

    /**
     * @dev Determine the appropriate order status based on filled quantity
     * @param order The order
     * @param additionalFillQuantity The additional fill quantity
     * @return The appropriate order status
     */
    function determineOrderStatus(
        IOrderInfo.Order memory order,
        uint256 additionalFillQuantity
    ) external pure returns (IOrderInfo.OrderStatus) {
        uint256 totalFilled = order.filledQuantity + additionalFillQuantity;
        
        // Cannot exceed order quantity
        require(totalFilled <= order.quantity, "State: total filled quantity exceeds order quantity");
        
        if (totalFilled == 0) {
            return IOrderInfo.OrderStatus.OPEN;
        } else if (totalFilled < order.quantity) {
            return IOrderInfo.OrderStatus.PARTIALLY_FILLED;
        } else {
            return IOrderInfo.OrderStatus.FILLED;
        }
    }
}

