# MonacoMarkets CLOB Implementation

## Overview

This repository contains a Solidity implementation of a Central Limit Order Book (CLOB) system, initially designed as a high-performance, custody-free liquidity engine, primarily for integration with aggregators like Symphony. The architecture draws inspiration from established DEX designs and is built using Hardhat.

## Key Features

- **Modular Architecture**: Core components include `CLOB`, `Book`, `State`, and `Vault` for distinct responsibilities.
- **Multiple Order Types**: Supports standard order types (e.g., LIMIT, MARKET - specific types depend on `CLOB.sol` implementation details).
- **Custody-Free Settlement**: `Vault.sol` handles atomic, custody-free settlement directly between traders upon a match.
- **Synchronous Aggregator Integration**: `SymphonyAdapter.sol` facilitates integration with external aggregators (like a mocked Symphony) via a synchronous `executeSwapViaCLOB` function call.
- **Price-Time Priority**: `Book.sol` implements order matching based on price-time priority.
- **Configurable Fees**: `Vault.sol` allows setting maker and taker fees.

## Directory Structure

```
.
├── contracts/
│   ├── interfaces/       # Solidity interfaces (IState, IVault, ICLOB, etc.)
│   ├── mocks/            # Mock contracts (MockERC20, MockSymphony)
│   ├── Book.sol          # Order book matching logic
│   ├── CLOB.sol          # Main CLOB entry point and coordination contract
│   ├── State.sol         # Order state management
│   ├── SymphonyAdapter.sol # Synchronous integration adapter
│   └── Vault.sol         # Custody-free settlement and fee handling
├── docs/
│   └── Architecture_02052025.md # Comprehensive architecture document
├── ignition/             # Hardhat Ignition deployment scripts (if used)
├── node_modules/         # Project dependencies
├── scripts/              # Deployment and utility scripts (e.g., deploy.ts)
├── test/                 # Hardhat tests (TypeScript)
├── .gitignore
├── hardhat.config.ts     # Hardhat configuration
├── package.json          # Project metadata and dependencies
├── package-lock.json
├── README.md             # This file
└── tsconfig.json         # TypeScript configuration
```
*(Note: Some directories like `deepbookv3-main` and `Symphony` might exist but are not part of the core Hardhat project structure shown here)*

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/ppitlehra/MonacoMarkets_pvt.git
    cd MonacoMarkets_pvt
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

### Compilation

Compile the Solidity contracts:
```bash
npx hardhat compile
```
This will generate TypeChain artifacts in `typechain-types/` and contract artifacts in `artifacts/`.

## Testing

Run the full test suite (written in TypeScript using Hardhat/Waffle/Chai):
```bash
npx hardhat test
```

To run a specific test file:
```bash
npx hardhat test test/Vault.test.ts
```

## Core Components

-   **`CLOB.sol`**: The primary user-facing contract. Handles order placement (`placeOrder`, `placeMarketOrder`, etc.) and cancellation. Coordinates interactions between the `Book`, `State`, and `Vault`. Routes external swaps via the `SymphonyAdapter`.
-   **`Book.sol`**: Manages the order book data structures (bids and asks). Implements the matching logic based on price-time priority. Generates `Settlement` structs upon successful matches.
-   **`State.sol`**: Stores the canonical state of all orders (status, quantity remaining, etc.). Provides functions for creating, updating (filling/canceling), and retrieving orders. Access is restricted to authorized contracts (Admin, CLOB, Book, Vault, Adapter).
-   **`Vault.sol`**: Handles the financial aspects of trade settlement. In a custody-free manner, it pulls the required base/quote tokens and fees from traders (based on prior approvals) during `processSettlements` (called by `CLOB` after matching). It then transfers tokens between the buyer, seller, and the fee recipient. Also manages fee rate configuration.
-   **`SymphonyAdapter.sol`**: Acts as a bridge for external systems (like Symphony) to interact with the CLOB via a single, synchronous swap function (`executeSwapViaCLOB`). It translates the swap request into a CLOB market order, handles token transfers to/from the caller (e.g., `MockSymphony`), interacts with the `CLOB`, and returns the result.

## License

Copyright (c) 2025 Prajwal Pitlehra

*(Suggestion: Consider adding a standard open-source license file like `LICENSE` (e.g., MIT, Apache 2.0) to clarify usage rights.)*
