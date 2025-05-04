# Architecture Overview - Monaco Markets (Optimized) - 03/05/2025

## 1. Introduction

This document provides an updated overview of the Monaco Markets Central Limit Order Book (CLOB) system architecture as of March 5th, 2025. It incorporates insights gained from previous architecture reviews, recent development, and test debugging sessions. The system is designed with modularity, separation of concerns, and gas efficiency in mind, aiming for a robust and performant decentralized exchange. It operates in a "crankless" manner, where order matching and settlement occur automatically within the transaction that places a matching order, without requiring external keeper processes.

## 2. Core Components

The system comprises four main smart contracts, each with distinct responsibilities, interacting through defined interfaces:

*   **`CLOB.sol` (Central Limit Order Book Orchestrator):**
    *   The primary entry point for traders and external systems (like Symphony).
    *   Handles order placement requests (Limit, Market, IOC, FOK) and cancellations.
    *   Validates inputs and trading pair support.
    *   Coordinates interactions between `State`, `Book`, and `Vault`.
    *   Orchestrates the matching and settlement process initiated by new orders.
    *   Manages administrative functions like adding supported pairs and setting component addresses.
    *   Includes logic for Symphony integration enablement.

*   **`State.sol` (Order State Management):**
    *   The single source of truth for order details and status.
    *   Stores all orders (`IOrderInfo.Order` struct) indexed by a unique `orderId`.
    *   Provides functions to create, retrieve, update status (`OPEN`, `PARTIALLY_FILLED`, `FILLED`, `CANCELED`), and cancel orders.
    *   Authorization checks ensure only permitted contracts (like `CLOB`, `Book`) can modify order states.

*   **`Book.sol` (Order Matching Engine):**
    *   Manages the active buy and sell orders for a specific trading pair.
    *   Organizes orders into price levels (`PriceLevel` struct) using sorted arrays for buy (`buyPrices`) and sell (`sellPrices`) prices.
    *   Contains the core matching logic (`matchOrders`, `matchMarketOrder`, `matchBuyOrder`, `matchSellOrder`).
    *   When `matchOrders` is called by `CLOB`, it finds matching maker orders against the incoming taker order, generates `IOrderInfo.Settlement` data, and updates the status of *matched maker orders* in the `State` contract.
    *   Crucially, for market buy orders, it enforces the `quoteAmountLimit` passed from `CLOB` to prevent spending more quote currency than specified.
    *   Provides functions to add/remove limit orders from the book (`addOrder`, `removeOrder`).
    *   Stores generated settlements temporarily per taker order (`pendingSettlements`) until retrieved by `CLOB`.

*   **`Vault.sol` (Settlement and Fee Handling):**
    *   Executes the financial settlement of matched trades based on data provided by `CLOB`.
    *   Holds logic for calculating maker and taker fees (`makerFeeRateBps`, `takerFeeRateBps`).
    *   Performs secure ERC20 token transfers (`safeTransferFrom`) between traders and the fee recipient using settlement data.
    *   Maintains a record of processed settlements (`processedSettlements` mapping) to prevent double-spending/re-execution.
    *   Requires authorization (currently via a potentially confusingly named `onlyBook` modifier that checks against an address set via `setBook`, which in practice is the `CLOB` address) to process settlements.

*   **Interfaces (`IOrderInfo.sol`, `ICLOB.sol`, `IBook.sol`, `IState.sol`, `IVault.sol`):**
    *   Define the function signatures and data structures (like `Order`, `Settlement`, `OrderType`, `OrderStatus`) used for interaction between the core components, ensuring modularity and upgradeability.

## 3. Order Lifecycle & Flow

### 3.1. Direct Trader Order Flow (e.g., Limit Order)

1.  **Placement:** A trader calls a function on `CLOB.sol` (e.g., `placeLimitOrder`) specifying `baseToken`, `quoteToken`, `isBuy`, `price`, and `quantity`.
2.  **Validation:** `CLOB` checks if the trading pair is supported and validates inputs.
3.  **State Creation:** `CLOB` calls `State.createOrder`, which creates the `Order` struct, assigns an `orderId`, sets the status to `OPEN`, and stores it.
4.  **Book Insertion (Limit Only):** For limit orders, `CLOB` calls `Book.addOrder` to place the order into the correct price level in the `Book`.
5.  **Matching Attempt:** `CLOB` calls `Book.matchOrders`, passing the `orderId` (and `quoteAmount` if a market buy).
6.  **Book Matching:**
    *   `Book` retrieves the taker order details from `State`.
    *   It iterates through the opposite side of the book (sell levels for a buy order, buy levels for a sell order) looking for orders that cross or match the taker's price (or any price for market orders).
    *   For each match found:
        *   It calculates the `fillQuantity`.
        *   For market buys, it checks against the `quoteAmountLimit`.
        *   It generates an `IOrderInfo.Settlement` struct containing `takerOrderId`, `makerOrderId`, `price`, and `quantity`.
        *   It calls `State.updateOrderStatus` to update the *maker* order's status (e.g., to `PARTIALLY_FILLED` or `FILLED`) and `filledQuantity`.
        *   It updates its internal `PriceLevel` data (reducing maker quantity, potentially removing the maker order or the entire price level if empty).
    *   `Book` stores the generated `Settlement` structs in its `pendingSettlements` mapping, keyed by the `takerOrderId`.
    *   `Book` returns the total `settlementCount` to `CLOB`.
7.  **Settlement Retrieval:** If `settlementCount > 0`, `CLOB` calls `Book.getPendingSettlements` (passing the `takerOrderId`) to retrieve the array of `Settlement` structs. `Book` returns the array and clears it from its internal storage.
8.  **Settlement Execution:** `CLOB` calls `Vault.processSettlements` (using batching via `processSettlementsBatched` for gas efficiency) with the retrieved `Settlement` array.
9.  **Vault Processing:** (See Section 4 for detailed fee flow)
    *   `Vault` iterates through the batch of settlements.
    *   For each settlement, it checks the `processedSettlements` mapping.
    *   If not processed, it fetches full order details from `State`, calculates fees, performs ERC20 transfers (base, quote, fees), marks the settlement as processed, and emits `SettlementProcessed` and `FeeCollected` events.
10. **Taker Status Update:** `CLOB` fetches the final state of the taker order from `State` (which reflects the total filled quantity potentially updated indirectly via `Book`'s maker updates, although direct taker updates happen here too). It determines the final status (`OPEN`, `PARTIALLY_FILLED`, `FILLED`).
11. **IOC/FOK Handling:** If the order was IOC or FOK and not fully `FILLED` after matching, `CLOB` calls `Book.removeOrder` and `State.cancelOrder`.
12. **Return:** `CLOB` returns the `orderId` and final fill amounts (`finalFilledQuantity`, `finalFilledQuoteAmount`) to the calling trader.

### 3.2. Symphony Integration Order Flow

*   **Origination:** Orders originate from an external Symphony system.
*   **Adapter:** A dedicated (off-chain or on-chain) `SymphonyAdapter` contract/service is responsible for translating Symphony requests into calls to the `CLOB` contract. (This adapter is not part of the core contracts).
*   **Placement/Cancellation:** The `SymphonyAdapter` calls the standard `CLOB` functions (`placeLimitOrder`, `placeMarketOrder`, `cancelOrder`, etc.). Permissions might be set up so only the designated `symphonyAdapter` address (set by the admin in `CLOB`) can interact, although this is not strictly enforced in the current `CLOB` implementation beyond an administrative flag (`symphonyIntegrationEnabled`).
*   **Processing:** Once the call reaches `CLOB`, the lifecycle (validation, state creation, matching, settlement, status updates) is **identical** to the Direct Trader Flow described above. The `CLOB` does not differentiate the internal processing based on the caller being a direct trader or the Symphony adapter.

## 4. Settlement and Fee Flow (Detailed - within `Vault.processSettlements`)

1.  **Invocation:** `CLOB` calls `Vault.processSettlements` with a batch of `IOrderInfo.Settlement` structs retrieved from `Book`.
2.  **Iteration & Check:** `Vault` loops through the settlements. For each one, it checks `!processedSettlements[takerOrderId][makerOrderId]`. If `true`, it proceeds.
3.  **Data Fetch:** `Vault` calls `State.getOrder` for both `takerOrderId` and `makerOrderId` to get the full `Order` details (trader addresses, tokens, etc.).
4.  **Validation:** Performs checks (orders exist, not a self-trade, tokens match).
5.  **Quote Calculation:** Determines the `quoteAmount` involved in this specific settlement: `Math.mulDiv(settlement.quantity, makerOrder.price, 10**baseDecimals)`.
6.  **Fee Calculation:**
    *   `makerFee = (quoteAmount * makerFeeRateBps) / 10000`
    *   `takerFee = (quoteAmount * takerFeeRateBps) / 10000`
7.  **Token Transfers (using `safeTransferFrom`):** The exact transfers depend on whether the *taker* was buying or selling base tokens:
    *   **If Taker was SELLING Base:**
        *   **Quote (Maker -> Taker):** Maker transfers `quoteAmount` to Taker.
        *   **Maker Fee (Maker -> Fee Recipient):** Maker transfers `makerFee` (in quote token).
        *   **Taker Fee (Taker -> Fee Recipient):** Taker transfers `takerFee` (in quote token).
        *   **Base (Taker -> Maker):** Taker transfers `settlement.quantity` (base token).
    *   **If Taker was BUYING Base:**
        *   **Quote (Taker -> Maker):** Taker transfers `quoteAmount - makerFee` to Maker.
        *   **Maker Fee (Taker -> Fee Recipient):** Taker transfers `makerFee` (in quote token).
        *   **Taker Fee (Taker -> Fee Recipient):** Taker transfers `takerFee` (in quote token).
        *   **Base (Maker -> Taker):** Maker transfers `settlement.quantity` (base token).
8.  **Mark Processed:** Sets `processedSettlements[takerOrderId][makerOrderId] = true`.
9.  **Emit Events:** Emits `SettlementProcessed(...)` and `FeeCollected(...)` (once for maker fee, once for taker fee).

## 5. Gas & Optimizations

*   **Crankless Design:** Matching and settlement occur synchronously within the taker's transaction, simplifying the system and removing reliance on external keepers.
*   **Batching:** `CLOB.processSettlementsBatched` processes settlements in batches (`MAX_BATCH_SIZE`) sent to the `Vault` to avoid exceeding block gas limits during large matches.
*   **State Separation:** Separating order state (`State`) from matching logic (`Book`) allows for potentially different optimization strategies for storage and computation.
*   **Sorted Price Levels:** Using sorted arrays (`buyPrices`, `sellPrices`) in `Book` allows for efficient identification of the best prices during matching.

## 6. Future Considerations / Open Questions

*   **Vault Authorization:** The `onlyBook` modifier in `Vault.sol` seems misaligned with the actual call flow (`CLOB` calls `Vault`). The `bookAddress` variable in `Vault` is set to the `CLOB` address during deployment in tests. While functionally correct in that context (only CLOB can call), the naming is confusing and should be clarified or refactored (e.g., `onlyCLOB` modifier, `setClob` function).
*   **Symphony Integration Enforcement:** The `symphonyIntegrationEnabled` flag in `CLOB` currently acts more like an administrative toggle than a runtime check gating specific functions. A robust implementation might involve checks within `CLOB` or rely on permissions granted exclusively to the `symphonyAdapter` address.
*   **Market Order State:** For market buy orders, the initial quantity stored in `State` is `type(uint256).max`. While the `Book` enforces the `quoteAmountLimit`, the final `filledQuantity` reported in the `State` contract for a partially filled market buy (due to quote limit) might reflect the actual base filled, but the initial/total quantity remains max, which could be confusing for off-chain indexers. The status correctly reflects `PARTIALLY_FILLED`.
*   **Error Handling:** Robust handling of potential edge cases (e.g., token transfer failures beyond the test setup, reentrancy) should be continuously reviewed.

This document reflects the current understanding of the system. Further refinements and optimizations may occur as development progresses. 