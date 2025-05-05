## Intellectual Property Notice

All code in this repository is the intellectual property of Prajwal Pitlehra.

It is provided for evaluation purposes only and may not be copied, redistributed, or used in derivative works without explicit written permission.

Copyright © 2025 Prajwal Pitlehra. All Rights Reserved.


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
    git clone https://github.com/ppitlehra/MonacoMarkets.git
    cd MonacoMarkets
    ```

2.  **Install dependencies:**
    ```