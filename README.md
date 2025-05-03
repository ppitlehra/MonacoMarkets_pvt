# SEI CLOB Implementation README

## Overview

This repository contains a Central Limit Order Book (CLOB) implementation for the SEI blockchain, designed to serve as a liquidity engine for Symphony (an aggregator). The implementation is inspired by DeepBook's architecture but adapted for SEI using Solidity.

## Key Features

- **Three-Layer Architecture**: Book → State → Vault for clear separation of concerns
- **Multiple Order Types**: Support for LIMIT, MARKET, IOC, and FOK orders
- **Custody-Free Settlement**: Direct trader-to-trader transfers without taking custody
- **Symphony Integration**: Dedicated adapter for Symphony as an aggregator
- **Price-Time Priority**: Efficient order matching with price-time priority
- **Flexible Fee Structure**: Configurable maker and taker fees

## Directory Structure

```
sei-clob/
├── contracts/
│   ├── interfaces/       # Contract interfaces
│   ├── libraries/        # Utility libraries
│   ├── test/             # Test contracts
│   ├── Book.sol          # Order book implementation
│   ├── CLOB.sol          # Main CLOB contract
│   ├── CustodyFreeVault.sol # Custody-free settlement
│   ├── EnhancedBook.sol  # Enhanced order book with improved matching
│   ├── EnhancedCLOB.sol  # Enhanced CLOB with Symphony integration
│   ├── State.sol         # Order state management
│   ├── SymphonyAdapter.sol # Symphony integration adapter
│   └── Vault.sol         # Basic vault implementation
├── docs/
│   └── DOCUMENTATION.md  # Detailed documentation
└── README.md             # This file
```

## Getting Started

### Prerequisites

- Solidity ^0.8.17
- OpenZeppelin Contracts

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/sei-clob.git
cd sei-clob
```

2. Install dependencies:
```bash
npm install
```

### Usage

The main entry point for interacting with the CLOB is the `CLOB` contract. See the `DOCUMENTATION.md` file for detailed usage instructions.

## Core Components

### CLOB

The main contract that coordinates the Book, State, and Vault components. It provides functions for placing and canceling orders, querying the order book, and integrating with Symphony.

### Book

Manages the order book and matching logic. It maintains price levels, matches orders based on price-time priority, and supports different order types.

### State

Stores order details and manages the order lifecycle. It keeps track of order status, filled quantities, and trader information.

### Vault

Handles token settlement with custody-free transfers. It calculates fees, executes transfers between traders, and ensures no residual balances are held.

### SymphonyAdapter

Provides integration with Symphony as an aggregator. It allows Symphony to relay orders to the CLOB and supports batch order processing.

## Testing

The implementation includes comprehensive test contracts:

- **CLOBTestHelper**: Tests basic CLOB functionality and order types
- **SymphonyIntegrationTest**: Tests Symphony integration
- **CustodyFreeTest**: Tests custody-free settlement
- **MockToken**: Provides mock ERC20 tokens for testing

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Inspired by DeepBook's architecture
- Designed for Symphony as a liquidity engine
- Optimized for the SEI blockchain
