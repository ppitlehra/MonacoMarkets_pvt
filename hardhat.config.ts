import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter";
import * as dotenv from "dotenv";

dotenv.config(); // Load environment variables from .env file

const SEI_TESTNET_RPC_URL = process.env.SEI_TESTNET_RPC_URL || "https://rpc.atlantic-2.seinetwork.io/";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || ""; // Ensure this is set in .env

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    hardhat: {
      chainId: 1337 // Default Hardhat network
    },
    sei_testnet: {
      url: SEI_TESTNET_RPC_URL,
      chainId: 1328, // SEI Atlantic-2 Chain ID
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [], // Use private key from env
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  gasReporter: {
    enabled: (process.env.REPORT_GAS === 'true') ? true : false, // Enable via env var
    currency: "USD",
    outputFile: "gas-report.txt",
    noColors: true,
    // coinmarketcap: process.env.COINMARKETCAP_API_KEY, // Optional
  }
};

export default config;

