# Event Emission Recommendations for SEI CLOB

## Overview

This document provides recommendations for adding events to the SEI Central Limit Order Book (CLOB) system. Events are crucial in blockchain applications for:

1. **Off-chain monitoring and indexing**: Events allow external systems to track and index on-chain activity
2. **User interface updates**: Events enable real-time updates in user interfaces
3. **Audit trails**: Events provide a complete history of all actions taken on-chain
4. **Integration with external systems**: Events facilitate integration with other systems

Currently, the SEI CLOB contracts (CLOB.sol, State.sol, Book.sol, and Vault.sol) do not emit any events for key operations like order placement, matching, and settlement. This document outlines recommended events that should be added to each contract following best practices.

## Recommended Events by Contract

### CLOB.sol

```solidity
// Order placement event
event OrderPlaced(
    uint256 indexed orderId,
    address indexed trader,
    address baseToken,
    address quoteToken,
    uint256 price,
    uint256 quantity,
    bool isBuy,
    uint8 orderType
);

// Order cancellation event
event OrderCancelled(
    uint256 indexed orderId,
    address indexed trader
);

// Trading pair added event
event TradingPairAdded(
    address indexed baseToken,
    address indexed quoteToken
);

// Symphony adapter set event
event SymphonyAdapterSet(
    address indexed symphonyAdapter
);

// Symphony integration status changed event
event SymphonyIntegrationStatusChanged(
    bool enabled
);

// Order processed event
event OrderProcessed(
    uint256 indexed orderId,
    uint256 settlementCount
);
```

### State.sol

```solidity
// Order created event
event OrderCreated(
    uint256 indexed orderId,
    address indexed trader,
    address baseToken,
    address quoteToken,
    uint256 price,
    uint256 quantity,
    bool isBuy,
    uint8 orderType,
    uint256 timestamp
);

// Order status updated event
event OrderStatusUpdated(
    uint256 indexed orderId,
    uint8 status,
    uint256 filledQuantity
);

// Admin added event
event AdminAdded(
    address indexed admin
);

// Admin removed event
event AdminRemoved(
    address indexed admin
);
```

### Book.sol

```solidity
// Order added to book event
event OrderAddedToBook(
    uint256 indexed orderId,
    uint256 price,
    uint256 quantity,
    bool isBuy
);

// Order removed from book event
event OrderRemovedFromBook(
    uint256 indexed orderId,
    uint256 price,
    bool isBuy
);

// Orders matched event
event OrdersMatched(
    uint256 indexed takerOrderId,
    uint256 indexed makerOrderId,
    uint256 price,
    uint256 quantity
);

// Price level created event
event PriceLevelCreated(
    uint256 price,
    bool isBuy
);

// Price level removed event
event PriceLevelRemoved(
    uint256 price,
    bool isBuy
);

// Admin changed event
event AdminChanged(
    address indexed oldAdmin,
    address indexed newAdmin
);

// Vault set event
event VaultSet(
    address indexed vault
);
```

### Vault.sol

```solidity
// Settlement processed event
event SettlementProcessed(
    uint256 indexed takerOrderId,
    uint256 indexed makerOrderId,
    uint256 price,
    uint256 quantity,
    uint256 takerFee,
    uint256 makerFee
);

// Fee rates changed event
event FeeRatesChanged(
    uint256 takerFeeRate,
    uint256 makerFeeRate
);

// Fee recipient changed event
event FeeRecipientChanged(
    address indexed oldFeeRecipient,
    address indexed newFeeRecipient
);

// Book set event
event BookSet(
    address indexed book
);

// Admin transferred event
event AdminTransferred(
    address indexed oldAdmin,
    address indexed newAdmin
);

// Token transfer event
event TokenTransferred(
    address indexed token,
    address indexed from,
    address indexed to,
    uint256 amount
);
```

## Implementation Guidelines

When implementing these events, follow these best practices:

1. **Use indexed parameters**: Index parameters that will be frequently used for filtering (e.g., orderId, trader address)
2. **Emit events after state changes**: Ensure events are emitted after all state changes have been made
3. **Include all relevant information**: Events should contain all information needed to understand what happened
4. **Be consistent with naming**: Use a consistent naming convention for all events
5. **Document events**: Add NatSpec comments to explain the purpose of each event

## Example Implementation

Here's an example of how to implement the `OrderPlaced` event in the CLOB contract:

```solidity
/**
 * @dev Places an order
 * @param baseToken The address of the base token
 * @param quoteToken The address of the quote token
 * @param price The price in quote token
 * @param quantity The quantity in base token
 * @param isBuy True if buy order, false if sell order
 * @param orderType The type of order (LIMIT, MARKET, IOC, FOK)
 * @return The ID of the created order
 */
function placeOrder(
    address baseToken,
    address quoteToken,
    uint256 price,
    uint256 quantity,
    bool isBuy,
    uint8 orderType
) external override returns (uint256) {
    require(supportedPairs[baseToken][quoteToken], "CLOB: unsupported trading pair");
    require(quantity > 0, "CLOB: quantity must be greater than 0");
    
    // For market orders, price is not relevant
    if (orderType == uint8(IOrderInfo.OrderType.MARKET)) {
        price = 0;
    } else {
        require(price > 0, "CLOB: price must be greater than 0");
    }
    
    // Create the order in the state contract with the original trader address
    address trader = msg.sender;
    
    uint256 orderId = IState(state).createOrder(
        trader,
        baseToken,
        quoteToken,
        price,
        quantity,
        isBuy,
        orderType
    );
    
    // Process the order based on its type
    _processOrder(orderId, orderType);
    
    // Emit the OrderPlaced event
    emit OrderPlaced(
        orderId,
        trader,
        baseToken,
        quoteToken,
        price,
        quantity,
        isBuy,
        orderType
    );
    
    return orderId;
}
```

## Benefits of Adding Events

Adding these events to the SEI CLOB system will provide several benefits:

1. **Improved observability**: External systems can monitor and track all activities in the CLOB
2. **Better debugging**: Events make it easier to debug issues by providing a clear audit trail
3. **Enhanced user experience**: UIs can provide real-time updates based on events
4. **Easier integration**: Other systems can integrate with the CLOB by listening to events
5. **Comprehensive analytics**: Events enable detailed analytics and reporting

## Conclusion

Adding events to the SEI CLOB system is a critical improvement that will enhance its usability, observability, and integration capabilities. The recommended events in this document follow best practices and cover all key operations in the system. Implementing these events will make the SEI CLOB more robust and developer-friendly.
