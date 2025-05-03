# SEI CLOB vs. Phoenix (Solana) vs. DeepBook (Sui): Performance Comparison

## Introduction

This document provides a comparative analysis of our SEI CLOB implementation against two prominent decentralized exchanges (DEXs) on other high-performance blockchains: Phoenix on Solana and DeepBook on Sui. The comparison focuses on key performance indicators (KPIs) such as architecture, gas/compute costs, latency, and fees, based on our internal benchmarks and publicly available information for the competitors.

**Disclaimer:** Direct comparison is challenging due to differences in blockchain architectures (SEI vs. Solana vs. Sui), programming languages (Solidity vs. Rust vs. Move), measurement environments (Hardhat simulation vs. live network descriptions), and the availability of specific public benchmark data for competitors.

## SEI CLOB (Our Implementation)

*   **Architecture:** Implemented in Solidity for the SEI blockchain. Primarily custody-free, with assets held by users until settlement. Utilizes a **crankless** mechanism for matching and settlement, where orders are processed and settled within the same transaction.
*   **Gas Costs (Hardhat Simulation):**
    *   `placeLimitOrder` (No Match): ~547,265 gas
    *   `placeMarketOrder` (Simple Match): ~549,207 gas
    *   `cancelOrder`: ~95,649 gas
    *   Market Sweep (Depth 10): ~1,261,993 gas
    *   Market Sweep (Depth 50): ~4,704,473 gas
    *   Market Sweep (Depth 100): ~9,129,473 gas
*   **Latency (Hardhat Simulation - Execution Time):**
    *   Place Limit Order (No Match): ~11.2 ms
    *   Place Limit Order (Simple Match): ~19.2 ms
    *   Place Market Order (Simple Match): ~12.4 ms
    *   Cancel Open Order: ~5.2 ms
    *   Market Sweep (Depth 10): ~72.0 ms
    *   Market Sweep (Depth 50): ~95.3 ms
    *   Market Sweep (Depth 100): ~198.1 ms
*   **Fees:** Implemented as a configurable percentage (basis points) set by the market authority. Our tests used a rate equivalent to 0.1% (10 bps).

## Phoenix (Solana)

*   **Architecture:** Implemented in Rust for the Solana blockchain. Features a fully on-chain, **crankless** limit order book design with **instant settlement**. Described as highly composable.
*   **Gas/Compute Costs:** Specific compute unit (CU) costs for operations like placing or cancelling orders were not found in publicly accessible documentation. Generally described as leveraging Solana's low fees and fast block times, enabling frequent order placement/cancellation for market makers. Documentation notes that `PlaceLimitOrderWithFreeFunds` consumes less compute than `PlaceLimitOrder`. Requires users to acquire a 'Seat' for trading, costing ~0.0018 SOL in rent.
*   **Latency:** Described as the "fastest on-chain orderbook in DeFi" leveraging Solana's high throughput and fast blocks. Specific latency figures (e.g., time-to-finality for a trade) were not found in the documentation.
*   **Fees:** Specific fee structures were not detailed in the technical documentation reviewed. Likely configurable per market or determined by the protocol/integrator.

## DeepBook (Sui)

*   **Architecture:** Implemented in Move for the Sui blockchain. A central limit order book designed as a native liquidity layer. Leverages Sui's object model and parallel execution capabilities. Requires users to interact via a `BalanceManager` object.
*   **Gas/Compute Costs:** Described as having "extremely low" and "predictable" gas costs due to Sui's architecture. Specific gas unit figures for standard operations were not found in the documentation reviewed. Sui's average transaction fees are generally cited as being very low (e.g., fractions of a cent).
*   **Latency:** Described as a "high-throughput and low latency DEX" providing a "trading experience similar to that of a CEX". Specific latency figures were not found.
*   **Fees:** Uses the native DEEP token. For staked users:
    *   Taker fees: 0.25 bps (0.0025%) for stable pairs, 2.5 bps (0.025%) for volatile pairs.
    *   Maker fees: Staked makers can earn rebates.
    *   Whitelisted pools (e.g., DEEP/SUI, DEEP/USDC) have 0% trading fees initially.
    *   Fees are subject to governance by DEEP token stakers.

## Comparative Summary

| Feature             | SEI CLOB (Hardhat)                     | Phoenix (Solana)                       | DeepBook (Sui)                             |
| :------------------ | :------------------------------------- | :------------------------------------- | :----------------------------------------- |
| **Architecture**    | Solidity, **Crankless**                | Rust, Crankless, Instant Settlement    | Move, Parallel Execution, BalanceManager   |
| **Gas/Compute**     | Measured (e.g., ~550k gas/order)       | Described as low; Specifics N/A        | Described as extremely low; Specifics N/A  |
| **Latency**         | Measured locally (e.g., 10-20ms/order) | Described as fast; Specifics N/A       | Described as low latency; Specifics N/A    |
| **Fees (Taker)**    | Configurable % (e.g., 10 bps)          | Unclear from docs                      | 0.25 / 2.5 bps (staked); Uses DEEP token |
| **Settlement**      | Instant (within tx)                    | Instant                                | Implicitly fast via Sui execution          |

**Key Observations:**

*   **Architecture:** Both our SEI CLOB and Phoenix utilize a crankless design, potentially offering advantages in settlement speed and reduced operational overhead compared to traditional crank-based models. DeepBook leverages Sui's specific object model and parallel processing.
*   **Gas/Compute:** While our Hardhat gas figures provide a baseline, they are likely higher than the actual compute costs on Solana or Sui, which are optimized for such operations. However, without specific benchmarks from Phoenix or DeepBook, a direct cost comparison is impossible.
*   **Latency:** Our local latency figures are computational only. Real-world latency is dominated by network confirmation times, where Solana and Sui generally offer faster finality than typical EVM chains, though SEI is also optimized for speed.
*   **Fees:** DeepBook offers significantly lower fees for staked users compared to our baseline 10 bps, utilizing its native token for staking and fee payments.

## Conclusion & Potential Next Steps

Our SEI CLOB demonstrates functional correctness and provides baseline performance metrics. Compared to descriptions of Phoenix and DeepBook, potential areas for future investigation and optimization include:

1.  **Gas Optimization:** Further reducing the gas cost of core operations (placement, matching, cancellation) remains a high priority to be competitive, especially the cost scaling with order book depth during sweeps.
2.  **Live Network Benchmarking:** Once deployed to a SEI testnet or mainnet, obtaining real-world gas costs and latency figures will be crucial for a more accurate comparison.
3.  **Fee Structure:** Evaluating the fee model, potentially incorporating staking mechanics similar to DeepBook if a native token is introduced, could enhance competitiveness.

This comparison highlights the architectural choices and performance claims of leading DEXs on comparable blockchains, providing valuable context for the continued development and optimization of the SEI CLOB.
