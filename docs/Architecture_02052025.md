# Architecture Documentation (02/05/2025)

This document provides a comprehensive and cumulative overview of the MonacoMarkets CLOB system architecture as of 02/05/2025. It consolidates information from previous design documents and reflects the final implementation state after testing and refactoring.

The system is designed as a high-performance, custody-free liquidity engine primarily for the Symphony aggregator, but also for direct traders. The architecture draws inspiration from industry-leading DEXes like DeepBook (Solana) and Phoenix (Solana), adapting their proven concepts to the target environment using Solidity.

## Architectural Goals

### Primary Goals
1.  **Symphony Integration**: Serve as a reliable, high-performance liquidity source for the Symphony aggregator via a **synchronous** execution model, ensuring seamless integration.
2.  **Custody-Free Operation**: Ensure users retain full control over their assets until the point of trade execution. The system, particularly the Vault, only facilitates transfers (`transferFrom`) between counterparties during settlement and does not pool or hold user funds.
3.  **Performance**: Achieve high throughput and low latency for order placement, cancellation, matching, and settlement, optimized for the target blockchain environment.
4.  **Crankless Design Principles**: Implement matching and settlement logic that minimizes reliance on external triggers (cranks), promoting efficiency and decentralization. Matching and settlement are triggered intrinsically by order placement.
5.  **Security & Reliability**: Ensure robustness, safety, and correctness through secure coding practices, comprehensive testing, and sound architectural design.

### Technical Requirements
1.  **Performance**: Optimized gas consumption, efficient batch processing, and algorithms aiming for O(1) placement/cancellation and efficient matching.
2.  **Security**: Robust access control (Ownable, role-based), secure state management, safe token handling (SafeERC20, overflow checks, dynamic decimal handling), input validation, reentrancy guards (implicitly via checks-effects-interactions pattern), and prevention of common exploits (e.g., self-trading, duplicate settlement).
3.  **Flexibility**: Support for multiple order types (LIMIT, MARKET, IOC, FOK), configurable fee structure, and adaptable matching engine.
4.  **Reliability**: Atomic operations, safe state transitions, and robust error handling.

## Core Components

*   **`CLOB.sol`**: Central Limit Order Book contract.
    *   Handles order placement requests (limit, market, IOC, FOK).
    *   Validates pairs and parameters.
    *   Interacts with `State` to create/update orders.
    *   Interacts with `Book` for order matching.
    *   Interacts with `Vault` for settlement processing.
    *   Interacts with `SymphonyAdapter` for routing external swaps.
*   **`State.sol`**: Stores the canonical state of all orders.
    *   Holds `Order` structs containing details (trader, tokens, price, quantity, status, etc.).
    *   Provides functions for creating, updating, and retrieving orders.
    *   Managed by admin roles (Owner, CLOB, Book, Vault, SymphonyAdapter).
*   **`Book.sol`**: Manages the order book logic for a *single* trading pair (one deployment per pair).
    *   Maintains sorted lists of bids and asks (or equivalent efficient structure).
    *   Contains the core `matchOrders` logic to find compatible orders based on price-time priority.
    *   Generates `Settlement` structs when matches occur.
    *   Updates order statuses in `State` during matching.
    *   Provides `getPendingSettlements` for `CLOB` to retrieve.
*   **`Vault.sol`**: Handles token custody, transfers, and CLOB fee calculations.
    *   Requires traders to `approve` it for token transfers.
    *   `processSettlementsBatched`: Receives settlements from `CLOB`.
    *   For each settlement:
        *   Calculates CLOB maker/taker fees based on configured rates (`makerFeeRateBps`, `takerFeeRateBps`).
        *   Performs `safeTransferFrom` for base tokens, quote tokens, and fees.
        *   **Dynamic Decimal Handling**: Uses `IERC20Decimals` interface to fetch token decimals for accurate quote amount calculation (`Math.mulDiv`), ensuring precision across pairs with different decimals.
        *   Transfers calculated CLOB fees to the designated `feeRecipient`.
        *   Updates final order statuses in `State`.
        *   Prevents duplicate settlement processing.
*   **`SymphonyAdapter.sol`**: Acts as the bridge between the CLOB and external aggregators (like Symphony) using the **synchronous** flow.
    *   Exposes `executeSwapViaCLOB(tokenIn, tokenOut, amountIn) returns (uint amountOut)` for synchronous execution.
    *   Receives swap details from the caller (e.g., `MockSymphony`).
    *   Pulls required input tokens (`tokenIn`, plus estimated CLOB fee if applicable) from the caller.
    *   Approves `Vault` for necessary transfers.
    *   Places an order (typically Market) on the `CLOB` acting as the taker.
    *   Receives the output token (`tokenOut`, net of CLOB fees) from the resulting settlement via the `Vault`.
    *   Transfers the *gross* `amountOut` received back to the caller (`MockSymphony`).
    *   Provides view functions for estimated CLOB fee rates (`clobTakerFeeRateEstimate`, `clobMakerFeeRateEstimate`).
*   **`MockSymphony.sol`**: (Test Contract) Simulates an external aggregator interacting with `SymphonyAdapter` via the **synchronous** flow.
    *   `executeSwap`: Entry point for end-users.
    *   Pulls `tokenIn` from the user.
    *   Estimates CLOB taker fee (using `SymphonyAdapter.clobTakerFeeRateEstimate()`) and pulls required quote tokens for fees from the user if buying base.
    *   Approves `SymphonyAdapter` for the tokens.
    *   Calls `SymphonyAdapter.executeSwapViaCLOB`.
    *   Receives gross `amountOut` back from the adapter.
    *   Calculates its own Symphony fee based on `amountOut` and its internal `symphonyFeeRate`.
    *   Transfers `amountOut - symphonyFee` (net amount) to the user.
    *   Transfers `symphonyFee` to its `symphonyFeeRecipient`.

## Order Lifecycles

### Direct CLOB Order Lifecycle

1.  **Placement:** Trader calls `CLOB.placeLimitOrder` (or other order types). Requires traders to have approved `Vault` for relevant tokens.
2.  **Validation:** `CLOB` checks pair validity, parameters.
3.  **Order Creation:** `CLOB` calls `State.createOrder(trader, ..., status=OPEN)`.
4.  **Matching:** `CLOB` calls `Book.matchOrders(orderId)`.
5.  **Settlement Generation (in Book):**
    *   `Book` finds opposing orders that cross the incoming order's price.
    *   For each match, creates a `Settlement` struct (taker order ID, maker order ID, quantity, price).
    *   Updates matched orders' status (FILLED/PARTIALLY_FILLED) and remaining quantity in `State`.
    *   Stores `Settlement` structs internally.
6.  **Settlement Retrieval (by CLOB):**
    *   `CLOB` calls `Book.getPendingSettlements()` to get the generated `Settlement` structs.
7.  **Settlement Processing (by CLOB):**
    *   `CLOB` calls `Vault.processSettlementsBatched(settlements)`.
8.  **Token Transfer & Fees (in Vault):**
    *   `Vault` iterates through settlements.
    *   For each settlement:
        *   Identifies taker/maker, base/quote tokens, amounts.
        *   Calculates CLOB maker fee and taker fee (in quote token) using `makerFeeRateBps` and `takerFeeRateBps`.
        *   Checks `balanceOf` and `allowance` for both traders for required amounts (base, quote, fees). Reverts if insufficient.
        *   Performs `IERC20(quoteToken).safeTransferFrom(taker, maker, quoteAmount - makerFee)`.
        *   Performs `IERC20(quoteToken).safeTransferFrom(maker, feeRecipient, makerFee)`.
        *   Performs `IERC20(quoteToken).safeTransferFrom(taker, feeRecipient, takerFee)`.
        *   Performs `IERC20(baseToken).safeTransferFrom(maker, taker, baseAmount)`.
        *   Calls `State.updateOrderStatus` for both orders involved in the settlement.

### Symphony Order Lifecycle (Synchronous Flow)

1.  **User Initiates:** User approves `MockSymphony` (or real Symphony contract) for `tokenIn` (+ potential quote fee). User calls `MockSymphony.executeSwap(tokenIn, tokenOut, amountIn)`.
2.  **MockSymphony Prepares:**
    *   `safeTransferFrom(user, address(this), amountIn)` for `tokenIn`.
    *   Determines direction (buy/sell base).
    *   Calls `SymphonyAdapter.clobTakerFeeRateEstimate()` to get the CLOB taker fee rate.
    *   Calculates `estimatedQuoteFee`.
    *   If buying base (input is quote), performs `safeTransferFrom(user, address(this), estimatedQuoteFee)` for the quote token fee.
    *   `approve(symphonyAdapterAddress, amountIn + estimatedQuoteFee)` if buying base, or `approve(symphonyAdapterAddress, amountIn)` if selling base.
3.  **Adapter Call:** `MockSymphony` calls `SymphonyAdapter.executeSwapViaCLOB(tokenIn, tokenOut, amountIn)`.
4.  **Adapter Executes:**
    *   Pulls `tokenIn` from `MockSymphony` (which includes the estimated fee if buying base).
    *   Determines parameters for `CLOB.placeOrder`.
    *   Approves `Vault` for the necessary tokens (base quantity if selling; quote `amountIn` + `estimatedFee` if buying).
    *   Calls `CLOB.placeOrder(..., orderType=MARKET)` acting as the taker (`msg.sender` within CLOB will be `SymphonyAdapter`).
5.  **CLOB/Book/Vault Interaction:**
    *   The CLOB matching and settlement process occurs as described in the "Direct CLOB Order Lifecycle" (Steps 4-8).
    *   The `Vault` uses its actual fee rates, performs transfers, and collects CLOB fees to its `feeRecipient`. `SymphonyAdapter` pays the taker fee.
6.  **Output Transfer to MockSymphony:**
    *   `CLOB.placeOrder` completes. The `Vault` has transferred the resulting `tokenOut` to the `SymphonyAdapter`.
    *   `SymphonyAdapter` calculates the received `amountOut = balanceAfter - balanceBefore`.
    *   `SymphonyAdapter` performs `IERC20(tokenOut).transfer(msg.sender, amountOut)` sending the gross output back to `MockSymphony`.
7.  **MockSymphony Finalizes:**
    *   Receives `amountOut` (gross amount after CLOB fees).
    *   Calculates `symphonyFee = amountOut * symphonyFeeRate / DENOMINATOR`.
    *   Calculates `netAmountOut = amountOut - symphonyFee`.
    *   Performs `IERC20(tokenOut).safeTransfer(user, netAmountOut)`.
    *   Performs `IERC20(tokenOut).safeTransfer(symphonyFeeRecipient, symphonyFee)`.
    *   Returns `netAmountOut`.

## Fee Lifecycle Summary

*   **CLOB Maker/Taker Fees:**
    *   **Source:** Configured rates (`makerFeeRateBps`, `takerFeeRateBps`) in `Vault`.
    *   **Calculation:** `Vault` during settlement.
    *   **Payment Token:** Quote token of the pair.
    *   **Payer:** Maker pays maker fee, Taker pays taker fee. Deducted from their balances by `Vault` (requires approval). In the Symphony flow, the `SymphonyAdapter` acts as the taker and pays the taker fee (and implicitly funds the maker fee deduction via the quote amount transfer).
    *   **Recipient:** `Vault.feeRecipient`.
*   **Symphony Fees:**
    *   **Source:** Configured rate in the external Symphony contract (e.g., `MockSymphony.symphonyFeeRate`).
    *   **Calculation:** Symphony contract *after* receiving gross output from `SymphonyAdapter`.
    *   **Payment Token:** The `tokenOut` received from the swap.
    *   **Payer:** End user (implicitly, as it's deducted from their gross output).
    *   **Recipient:** Symphony contract's fee recipient (`symphonyFeeRecipient`).
*   **Fee Funding (Synchronous Flow):** The external system (`MockSymphony`) must pull enough input token *and* estimated quote fee from the user *before* calling the adapter if the trade involves buying the base token, ensuring the adapter can pay the CLOB taker fee during settlement.

## Design Evolution & History

An earlier iteration of the Symphony integration utilized a **two-stage, asynchronous settlement flow**. Key aspects of this **obsolete** design were:

*   **`relaySymphonyOrder`:** The adapter had functions like `relaySymphonyOrder`.
*   **Adapter as Trader:** The adapter still placed orders using its own address.
*   **Stage 1 (Vault Settlement):** The `Vault` processed CLOB settlement normally, transferring net proceeds to the adapter's balance.
*   **Stage 2 (Adapter Settlement):** An external Symphony Operator was required to monitor `Vault` events. Upon detecting a relevant settlement, the Operator would call a separate `processSettlements` function on the `SymphonyAdapter`.
*   **Fund Return:** The adapter's `processSettlements` was responsible for calculating Symphony fees and transferring the final net amount from the adapter's balance to the original user.
*   **Challenges:** This model faced challenges in reliably mapping Vault settlements back to the original Symphony user and placed significant responsibility on the external operator. It also meant the adapter held user funds for a longer duration between Stage 1 and Stage 2.

This asynchronous model was **superseded by the current synchronous `executeSwapViaCLOB` flow** described earlier, which aligns better with typical aggregator interaction patterns, simplifies the fee logic, and minimizes the time the adapter holds funds.

## Conclusion

This architecture provides a robust, secure, and performant CLOB system. It prioritizes custody-free operation and integrates seamlessly with aggregators like Symphony through the synchronous adapter interface (`executeSwapViaCLOB`), while maintaining clear separation of concerns. The design incorporates best practices and lessons learned from established DEXes and previous iterations of this project. 