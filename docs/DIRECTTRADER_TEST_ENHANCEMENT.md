# DirectTraderTests Enhancement Plan

## Price Improvement Scenarios

1. **Test: Buy order with higher price than sell order**
   - Create a sell limit order at price X
   - Create a buy limit order at price X+10%
   - Verify execution happens at sell order's price (X)
   - Verify correct token transfers for both traders

2. **Test: Multiple price levels with price improvement**
   - Create sell orders at prices X, X+5%, X+10%
   - Create a buy order at price X+15%
   - Verify execution matches against all three sell orders
   - Verify each match happens at the respective sell order's price

## Multiple Order Matching

3. **Test: Single buy order matching multiple sell orders**
   - Create multiple sell orders at the same price with different quantities
   - Create a buy order large enough to match all sell orders
   - Verify all sell orders are filled
   - Verify correct token transfers for all parties

4. **Test: Single buy order matching sell orders at different price levels**
   - Create sell orders at increasing price levels
   - Create a buy order large enough to match all sell orders
   - Verify orders are matched in ascending price order
   - Verify correct token transfers and remaining quantities

5. **Test: Partial fills across multiple orders**
   - Create multiple sell orders
   - Create a buy order that partially fills the last matched sell order
   - Verify correct partial fill status and quantities
   - Verify correct token transfers for partial fills

## Order Modification Tests

6. **Test: Decreasing order quantity**
   - Create a limit order
   - Modify the order to decrease quantity
   - Verify order book reflects updated quantity
   - Verify correct token balances after modification

7. **Test: Increasing order quantity**
   - Create a limit order
   - Modify the order to increase quantity
   - Verify order book reflects updated quantity
   - Verify correct token balances after modification

8. **Test: Modifying partially filled order**
   - Create a limit order
   - Partially fill the order
   - Modify the remaining quantity
   - Verify correct order status and filled/unfilled quantities
   - Verify correct token balances

## Comprehensive Balance Verification

9. **Test: Detailed balance tracking for simple match**
   - Record exact balances of all tokens for both traders before trade
   - Execute a simple match between buy and sell orders
   - Verify exact balance changes including fees
   - Verify fee recipient received correct fee amount

10. **Test: Balance verification with different fee rates**
    - Set different maker/taker fee rates
    - Execute trades with different order types
    - Verify correct fee calculations and transfers
    - Verify trader balances reflect fees paid

11. **Test: Balance verification for cancelled orders**
    - Record balances before order placement
    - Place and then cancel an order
    - Verify balances return to original state (minus gas)

## Basic Edge Cases

12. **Test: Minimum valid order sizes**
    - Create orders with minimum allowed quantities
    - Verify they can be matched correctly
    - Verify correct token transfers for small amounts

13. **Test: Non-round numbers**
    - Create orders with non-round quantities (e.g., 1.23456 tokens)
    - Match these orders
    - Verify exact quantities are transferred without rounding errors

14. **Test: Cancellation of partially filled orders**
    - Create a limit order
    - Partially fill the order
    - Cancel the remaining quantity
    - Verify order status changes to cancelled
    - Verify correct token refunds for unfilled portion

15. **Test: Order expiration handling**
    - Create orders with expiration timestamps
    - Test matching before and after expiration
    - Verify expired orders are handled correctly
    - Verify token balances after expiration
