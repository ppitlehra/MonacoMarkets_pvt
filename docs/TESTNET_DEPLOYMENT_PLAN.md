# SEI CLOB Testnet Deployment Plan (Atlantic-2)

This document outlines the steps and requirements for deploying and testing the SEI CLOB project on the SEI Atlantic-2 testnet.

## 1. Prerequisites

*   **SEI Testnet Wallet:** You need a wallet (e.g., MetaMask, Keplr, Leap) configured for the SEI network.
*   **Private Key:** Obtain the private key for the wallet you intend to use for deployment.
*   **Testnet SEI Tokens:** Fund the deployment wallet with SEI tokens from an Atlantic-2 testnet faucet. Several options are available (e.g., the official Sei App Faucet linked in the Sei documentation).
*   **Environment File (`.env`):** Create a `.env` file in the project root (`/home/ubuntu/sei-clob/`). Add your deployer private key to this file:
    ```
    DEPLOYER_PRIVATE_KEY="YOUR_PRIVATE_KEY_HERE"
    ```
    Refer to the `.env.example` file for structure.

## 2. Configuration (`hardhat.config.ts`)

The Hardhat configuration file has been updated to include:

*   **`dotenv` Integration:** Loads environment variables from the `.env` file.
*   **`sei_testnet` Network Definition:**
    *   **RPC URL:** Uses `process.env.SEI_TESTNET_RPC_URL` or defaults to `https://rpc.atlantic-2.seinetwork.io/`.
    *   **Chain ID:** Set to `1328` (Atlantic-2).
    *   **Accounts:** Configured to use the `DEPLOYER_PRIVATE_KEY` from the `.env` file.

## 3. Deployment Process

*   **Deployment Script:** A new deployment script `scripts/deploy.ts` has been created. This script handles:
    *   Deploying Mock ERC20 tokens (TBASE, TQUOTE) for testing purposes.
    *   Deploying the core contracts: `State`, `Vault`, `Book`, `CLOB`.
    *   Setting up all necessary dependencies and admin roles between the contracts.
    *   Adding the TBASE/TQUOTE pair to the CLOB.
*   **Execution:** To deploy to the SEI testnet, run the following command from the `/home/ubuntu/sei-clob` directory:
    ```bash
    npx hardhat run scripts/deploy.ts --network sei_testnet
    ```
    Monitor the console output for deployment progress and final contract addresses.

## 4. Code Modifications

*   **Contracts:** No modifications were required in the core Solidity contracts (`CLOB.sol`, `Book.sol`, etc.) for testnet deployment.
*   **Deployment Script:** The `deploy.ts` script currently deploys `MockERC20` tokens. For more realistic testing, this could optionally be modified later to use existing, recognized SEI testnet tokens if suitable ones are identified.

## 5. Testing on Testnet

*   **Existing Test Suite:** The test files (`test/*.ts`) are designed for the local Hardhat network. They provide fast, isolated testing and regression checks.
*   **Testnet Testing:** Running the full automated test suite against the live testnet is generally **not recommended** due to:
    *   Slow execution speed.
    *   Real gas costs (consuming testnet SEI).
    *   Dependency on specific deployed contract states and potential network fluctuations.
*   **Manual Testing/Interaction:** Use the Hardhat console or build simple interaction scripts to manually test functionality on the deployed testnet contracts.
    ```bash
    npx hardhat console --network sei_testnet
    ```
    Inside the console, you can attach to the deployed contracts using their addresses (output by the deployment script) and call functions.

## 6. Switching Between Environments

Switching between the local Hardhat network and the SEI testnet is controlled by the `--network` flag in your Hardhat commands:

*   **Testnet:** Use `--network sei_testnet` (e.g., `npx hardhat run ... --network sei_testnet`).
*   **Local:** Use `--network hardhat` or omit the flag if Hardhat is the default (e.g., `npx hardhat test`, `npx hardhat run ... --network hardhat`).

Your core contract code and local test suite remain unchanged regardless of the target network for deployment or interaction.

## 7. Deliverables

*   Updated `hardhat.config.ts`
*   New `.env.example`
*   New `scripts/deploy.ts`

These files are included in the latest project archive.

