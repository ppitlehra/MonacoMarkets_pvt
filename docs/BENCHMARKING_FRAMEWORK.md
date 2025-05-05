# SEI CLOB Benchmarking Framework

This document outlines the framework for benchmarking the SEI Central Limit Order Book (CLOB) implementation. It defines Key Performance Indicators (KPIs), measurement methodologies, competitor comparisons, performance targets, and optimization priorities to guide future development and ensure competitiveness.

## 1. Key Performance Indicators (KPIs)

We will track the following KPIs to measure the performance and efficiency of the SEI CLOB:

### 1.1. Gas Consumption per Order Match
- **Technical:** Measures the average and worst-case gas units consumed when matching orders of various sizes against different order book depths.
- **Simple Terms:** How much it costs (in fees) to execute trades, especially when a large order matches against many small orders.
- **Competitive Edge:** Lower gas costs make our platform more economical for traders, especially high-frequency traders and market makers.
- **Monitoring Value:** Tracks optimization progress and identifies gas-intensive operations.

### 1.2. Throughput (Orders Processed per Second)
- **Technical:** Maximum number of order placements, cancellations, and matches that can be processed within a time unit under various network conditions.
- **Simple Terms:** How many trades our system can handle per second without slowing down.
- **Competitive Edge:** Higher throughput ensures the platform can handle high trading activity during volatile periods.
- **Monitoring Value:** Helps identify scaling bottlenecks and ensures support for growing trading volumes.

### 1.3. Latency (Time to Match)
- **Technical:** Time elapsed from order submission to complete matching and settlement, measured across different order types and market conditions.
- **Simple Terms:** How quickly a trade completes after a user submits an order.
- **Competitive Edge:** Lower latency provides a better user experience and attracts algorithmic traders.
- **Monitoring Value:** Helps identify processing bottlenecks in the matching algorithm.

### 1.4. Price-Time Priority Accuracy
- **Technical:** Percentage of matches that correctly follow price-time priority rules, especially in complex scenarios.
- **Simple Terms:** How fairly and accurately our system processes orders in the correct sequence.
- **Competitive Edge:** Higher accuracy builds trust with traders who rely on fair order execution.
- **Monitoring Value:** Ensures optimizations don't compromise market fairness.

### 1.5. Settlement Success Rate
- **Technical:** Percentage of matched orders that successfully complete settlement without reverting.
- **Simple Terms:** How reliably trades complete once matched, without failing during payment.
- **Competitive Edge:** Higher reliability builds user trust and reduces failed transactions.
- **Monitoring Value:** Helps identify edge cases in token transfers or approvals.

### 1.6. Memory Usage / Stack Depth
- **Technical:** Peak memory consumption or stack depth reached during order matching, especially for large sweeps.
- **Simple Terms:** How efficiently our system uses computational resources during trades.
- **Competitive Edge:** Prevents errors like "stack too deep" or "out of gas" during complex operations.
- **Monitoring Value:** Identifies potential resource limits before they occur in production.

### 1.7. Order Book Depth Impact
- **Technical:** How performance metrics (gas, latency) scale as order book depth increases.
- **Simple Terms:** How well our system handles very active markets with many orders.
- **Competitive Edge:** Better scaling makes the platform suitable for highly liquid markets.
- **Monitoring Value:** Predicts performance as markets grow.

### 1.8. Cross-Token Precision Handling
- **Technical:** Accuracy of calculations when matching orders between tokens with different decimal places.
- **Simple Terms:** How accurately our system handles trades between different token types.
- **Competitive Edge:** Reduces unexpected rounding errors.
- **Monitoring Value:** Ensures fairness across all trading pairs.

### 1.9. Recovery Time After Reorg (Qualitative/Testnet)
- **Technical:** Time required to restore consistent order book state after a blockchain reorganization.
- **Simple Terms:** How quickly our system recovers from blockchain forks.
- **Competitive Edge:** Faster recovery means less downtime.
- **Monitoring Value:** Ensures system resilience.

### 1.10. Fee Calculation Accuracy
- **Technical:** Precision of fee calculations across different scenarios.
- **Simple Terms:** How accurately we calculate and collect trading fees.
- **Competitive Edge:** Ensures fair revenue collection.
- **Monitoring Value:** Prevents revenue leakage and user complaints.

## 2. Measurement Methodology

We will primarily use Hardhat tests and associated tools to measure these KPIs:

- **Gas Consumption:** Use `hardhat-gas-reporter` during test execution with specific benchmark scenarios (`GasBenchmarkTests.ts`).
- **Throughput:** Estimate based on average transaction gas cost, SEI block gas limit, and block time.
- **Latency:** Record timestamps (`block.timestamp` or JS `Date.now()`) within Hardhat tests before submission and after confirmation.
- **Price-Time Priority Accuracy:** Design specific test cases verifying event sequences and final order statuses.
- **Settlement Success Rate:** Track expected vs. actual successful settlements in test suites.
- **Memory Usage / Stack Depth:** Monitor tests for stack/gas exceptions related to depth/memory limits during complex scenarios.
- **Order Book Depth Impact:** Create benchmark tests with varying book depths and measure gas/latency scaling.
- **Cross-Token Precision Handling:** Use `DecimalHandlingTest.ts` and verify final balances against calculated expectations.
- **Recovery Time After Reorg:** Qualitative assessment or future testnet experiments.
- **Fee Calculation Accuracy:** Use `FeeCalculationTest.ts` and verify final balances against calculated expectations.

## 3. Competitor Benchmark Comparison & Targets

We aim to be competitive with leading DEXes on other high-performance blockchains, acknowledging platform differences.

- **Competitor DEX B (Sui):** Known for Critbit Tree structure, efficient gas scaling, high throughput via Sui's parallelism.
- **Competitor DEX A (Solana):** Extremely gas/speed optimized for Solana, specialized data structures, market-wide crossing.

**Realistic Targets for SEI CLOB:**

- **Gas Consumption:** Aim for significant reduction (e.g., 50%) in gas for multi-match sweeps compared to baseline.
- **Throughput:** Target 100+ order operations per second on SEI mainnet.
- **Latency:** Target <100ms contract execution time (excluding network).
- **Order Book Depth Impact:** Aim for sub-linear gas/latency scaling with depth.
- **Settlement Success Rate:** Target 100% for valid scenarios.
- **Cross-Token Precision:** Target minimal (<1 unit) precision loss.

## 4. Optimization Priorities

Based on the goal of improving performance efficiently:

1.  **Priority 1: Optimize Gas Consumption for Order Matching (Incremental Improvements):** Focus on reducing gas for the current incremental matching logic (e.g., caching `getOrder`, optimizing array ops).
2.  **Priority 2: Analyze and Optimize Order Book Data Structures:** Evaluate current mappings/arrays for gas efficiency on SEI, especially storage access. Research alternatives.
3.  **Priority 3: Streamline Settlement Logic:** Review `Vault._processSettlementInternal` for micro-optimizations.

**Deferred Priority:**

- **Simultaneous Matching Algorithm Rewrite:** Consider only if benchmarking proves necessity and incremental optimizations are insufficient.

## 5. Next Steps

The immediate next step is to implement the benchmarking tests (`GasBenchmarkTests.ts`, etc.) described in the methodology section to establish baseline performance data for the current implementation. This data will guide subsequent optimization efforts.

