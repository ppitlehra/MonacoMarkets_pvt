# Edge Case Test Coverage

This document outlines the comprehensive end-to-end testing approach for edge cases in the SEI CLOB implementation.

## Testing Approach

The edge case tests follow a true end-to-end testing approach, which provides several advantages over mocked testing:

1. **Real Contract Interactions**: Tests use actual contract functions (placeLimitOrder, placeMarketOrder) rather than simulating them, ensuring the entire execution flow is tested.

2. **Complete Verification**: Each test verifies the entire order lifecycle from creation through matching to settlement, with detailed balance verification at each step.

3. **Realistic Scenarios**: Tests cover real-world edge cases including minimum/maximum order sizes, extreme prices, and zero values.

4. **System Limitations Discovery**: End-to-end testing reveals actual system constraints and limitations that weren't apparent in mocked tests.

## Dynamic Order ID Tracking

A key improvement in our testing approach is the implementation of dynamic order ID tracking:

1. **Transaction Event Capture**: Instead of hardcoding order IDs, we capture them from transaction events after placing orders:
   ```typescript
   const sellOrderTx = await clob.connect(trader1).placeLimitOrder(
     await baseToken.getAddress(),
     await quoteToken.getAddress(),
     false, // isBuy
     STANDARD_PRICE,
     MINIMUM_QUANTITY
   );
   
   const sellOrderReceipt = await sellOrderTx.wait();
   const sellOrderEvent = sellOrderReceipt.logs.find(
     log => log.fragment && log.fragment.name === 'OrderPlaced'
   );
   const sellOrderId = sellOrderEvent.args[0];
   ```

2. **Resilience to State Changes**: This approach ensures tests work correctly regardless of how order IDs are assigned or reset between test cases.

3. **Realistic Testing**: Better reflects real-world usage where order IDs are not known in advance.

## Test Categories

### Minimum Order Size Tests

These tests verify that the system correctly handles orders with very small quantities:

- **Minimum Quantity Test**: Tests order placement and matching with the smallest allowed quantity (0.000001 tokens)
- **Verifies that fees are calculated correctly even for very small trade values
- **Status: PASSING** - The system correctly handles minimum order sizes

### Maximum Order Size Tests

These tests verify that the system correctly handles orders with very large quantities:

- **Maximum Quantity Test**: Tests order placement and matching with the largest allowed quantity (1,000,000 tokens)
- **Status: FAILING** - The test fails with "Vault: token transfer failed" error
- **Finding**: This reveals a real limitation in the contract implementation that wasn't apparent in mocked tests. The system cannot handle extremely large orders, likely due to gas limitations or arithmetic overflow issues.

### Extreme Price Tests

These tests verify that the system correctly handles orders with extremely high or low prices:

- **Extreme High Price Test**: Tests order placement and matching with a very high price (999,999,999 tokens)
- **Status: FAILING** - The test fails with "Vault: token transfer failed" error
- **Finding**: This reveals a real limitation in the contract implementation. The system cannot handle extremely high prices, likely due to arithmetic overflow when calculating the trade value.

- **Extreme Low Price Test**: Tests order placement and matching with a very low price (0.000001 tokens)
- **Status: PASSING** - The system correctly handles extremely low prices

### Zero Value Tests

These tests verify that the system correctly handles edge cases with zero values:

- **Zero Quantity Test**: Verifies that the system correctly rejects orders with zero quantity
- **Status: PASSING** - The system correctly rejects orders with zero quantity

- **Market Order Test**: Tests market order placement and matching with zero price
- **Status: PASSING** - The system correctly handles market orders with zero price, executing them at the best available price

## Contract Setup for End-to-End Testing

To enable proper end-to-end testing, the contracts must be set up with the correct permissions:

1. **State Contract**: CLOB and Book contracts must be added as admins
2. **Book Contract**: CLOB contract must be set as admin using setCLOB
3. **Vault Contract**: CLOB contract must be set using setCLOB
4. **Trading Pairs**: Must be registered using addSupportedPair

## System Limitations Discovered

The end-to-end testing approach revealed important system limitations that weren't apparent in the mocked tests:

1. **Maximum Order Size Limitation**: The system cannot handle extremely large orders (1,000,000 tokens), failing with "Vault: token transfer failed" error. Through iterative testing, we determined that:
   - Orders up to 1,000 tokens (with 18 decimals) can be processed successfully
   - Orders between 1,000 and 10,000 tokens fail with token transfer errors
   - This suggests gas limitations or arithmetic overflow issues in the Vault contract

2. **Extreme Price Limitation**: The system cannot handle extremely high prices (999,999,999 tokens), failing with the same error. Through testing, we determined that:
   - Prices up to 100,000 tokens (with 18 decimals) can be processed successfully
   - Higher prices fail with token transfer errors
   - This suggests arithmetic overflow when calculating trade value (price * quantity)

These findings are valuable for understanding the actual constraints of the system and setting appropriate limits for order sizes and prices in production.

## Benefits of End-to-End Testing

The end-to-end testing approach provides several benefits over mocked testing:

1. **Higher Confidence**: Tests the actual contract execution flow, providing higher confidence in the system's behavior
2. **Bug Detection**: More likely to catch integration issues between contracts
3. **Realistic Testing**: Better reflects how the system will be used in production
4. **Limitation Discovery**: Reveals actual system constraints and limitations

## Future Enhancements

Potential enhancements to the edge case test suite:

1. **Boundary Testing**: Add tests at the exact boundaries of what the system can handle
2. **Error Handling Tests**: Add more tests for error conditions and recovery
3. **Gas Optimization Tests**: Add tests to measure gas usage for edge cases
4. **Stress Tests**: Add tests with many simultaneous orders to test system capacity
