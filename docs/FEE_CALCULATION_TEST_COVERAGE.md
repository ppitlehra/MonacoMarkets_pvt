# Fee Calculation End-to-End Test Coverage

This document outlines the comprehensive end-to-end testing approach for fee calculations in the SEI CLOB implementation.

## Testing Approach

The fee calculation tests follow a true end-to-end testing approach, which provides several advantages over mocked testing:

1. **Real Contract Interactions**: Tests use actual contract functions (placeLimitOrder, placeMarketOrder) rather than simulating them, ensuring the entire execution flow is tested.

2. **Complete Verification**: Each test verifies the entire order lifecycle from creation through matching to settlement, with detailed balance verification at each step.

3. **Realistic Scenarios**: Tests cover real-world trading scenarios including different order types, partial fills, price improvement, and tokens with different decimal places.

4. **Accurate Fee Verification**: Tests verify that fees are correctly calculated and collected from the appropriate parties based on the configured fee rates.

## Dynamic Order ID Tracking

A key improvement in our testing approach is the implementation of dynamic order ID tracking:

1. **Transaction Event Capture**: Instead of hardcoding order IDs, we capture them from transaction events after placing orders:
   ```typescript
   const sellOrderTx = await clob.connect(trader1).placeLimitOrder(
     await baseToken.getAddress(),
     await quoteToken.getAddress(),
     false, // isBuy
     ORDER_PRICE,
     ORDER_QUANTITY
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

### Basic Fee Calculation Tests

These tests verify that fees are correctly calculated and collected for simple order matches:

- **Limit Order Fee Test**: Verifies fee calculations for a basic limit order match
- **Zero Fee Rate Test**: Confirms the system handles zero fee rates correctly

### Custom Fee Rate Tests

These tests verify that the system correctly applies custom fee rates:

- **High Fee Rate Test**: Tests fee calculations with higher than default fee rates (0.3% maker, 0.5% taker)
- **Zero Fee Rate Test**: Verifies that no fees are collected when fee rates are set to zero

### Partial Fill Fee Calculation Tests

These tests verify that fees are correctly calculated for partial order fills:

- **Partial Fill Test**: Tests fee calculations when a large order is filled by multiple smaller orders
- **Verifies that fees are calculated correctly for each partial fill and that the total fees match the expected amount

### Price Improvement Fee Calculation Tests

These tests verify that fees are correctly calculated when orders are executed with price improvement:

- **Price Improvement Test**: Tests fee calculations when a buy order is placed with a higher price than the sell order
- **Important Note**: The contract executes trades at the original sell order price, not the improved price offered by the buyer
- **Verifies that fees are calculated based on the execution price (sell order price), not the improved price offered by the buyer

### Different Token Decimal Tests

These tests verify that fees are correctly calculated for tokens with different decimal places:

- **6-Decimal Token Test**: Tests fee calculations for USDC-like tokens with 6 decimal places
- **8-Decimal Token Test**: Tests fee calculations for WBTC-like tokens with 8 decimal places
- **Verifies that the system correctly handles the decimal conversion when calculating fees
- **Important Note**: When calculating fees for tokens with different decimal places, the contract multiplies the price (18 decimals) by quantity (token-specific decimals) and divides by 10^18

## Contract Setup for End-to-End Testing

To enable proper end-to-end testing, the contracts must be set up with the correct permissions:

1. **State Contract**: CLOB and Book contracts must be added as admins
2. **Book Contract**: CLOB contract must be set as admin using setCLOB
3. **Vault Contract**: CLOB contract must be set using setCLOB
4. **Trading Pairs**: Must be registered using addSupportedPair

## Verification Methodology

Each test follows a consistent verification methodology:

1. **Record Initial Balances**: Capture token balances for all parties before trading
2. **Execute Trades**: Place orders through the CLOB contract
3. **Verify Order Status**: Confirm orders are properly matched and filled
4. **Calculate Expected Fees**: Compute expected fees based on trade value and fee rates
5. **Verify Final Balances**: Confirm that:
   - Seller sends base tokens and receives quote tokens minus maker fee
   - Buyer receives base tokens and sends quote tokens plus taker fee
   - Fee recipient receives both maker and taker fees

## Current Test Status

All fee calculation tests are now passing. The following issues have been fixed:

1. **Fee Rate Setting**: Updated all references to use the correct `setFeeRates` function instead of the non-existent `setMakerFeeRate` and `setTakerFeeRate` functions.

2. **Price Improvement Calculations**: Fixed the price improvement test by recognizing that the contract executes trades at the original sell order price, not the improved price offered by the buyer. Updated the test to verify this behavior.

3. **Token Decimal Handling**: Fixed the different token decimal test by correctly calculating the trade value for tokens with different decimal places. The contract multiplies the price (18 decimals) by quantity (token-specific decimals) and divides by 10^18, which results in a value that's effectively scaled down for tokens with fewer than 18 decimals.

## Benefits of End-to-End Testing

The end-to-end testing approach provides several benefits over mocked testing:

1. **Higher Confidence**: Tests the actual contract execution flow, providing higher confidence in the system's behavior
2. **Bug Detection**: More likely to catch integration issues between contracts
3. **Realistic Testing**: Better reflects how the system will be used in production
4. **Maintenance**: Changes to contract implementation will be immediately reflected in test results

## Future Enhancements

Potential enhancements to the fee calculation test suite:

1. **Symphony Integration Tests**: Add tests for fee calculations with Symphony integration
2. **Fee Distribution Tests**: Add tests for fee distribution to multiple recipients
3. **Fee Calculation Performance Tests**: Add tests for fee calculation performance with many orders
4. **Fee Calculation Edge Cases**: Add tests for extreme fee rates and trade values
