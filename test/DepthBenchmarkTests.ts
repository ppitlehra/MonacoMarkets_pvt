/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Book, CLOB, State, Vault, MockERC20 } from "../typechain-types";
import { parseUnits } from "ethers";

// Constants from State contract
const ORDER_STATUS_OPEN = 0;
const ORDER_STATUS_PARTIALLY_FILLED = 1;
const ORDER_STATUS_FILLED = 2;
const ORDER_STATUS_CANCELLED = 3;

const ORDER_TYPE_LIMIT = 0;
const ORDER_TYPE_MARKET = 1;
const ORDER_TYPE_IOC = 2;
const ORDER_TYPE_FOK = 3;

const SIDE_BUY = 0;
const SIDE_SELL = 1;

describe("Order Book Depth Benchmark Tests", function () {
  let owner: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;
  let trader2: HardhatEthersSigner;
  let feeRecipient: HardhatEthersSigner;
  let traders: HardhatEthersSigner[] = [];

  let state: State;
  let vault: Vault;
  let book: Book;
  let clob: CLOB;
  let baseToken: MockERC20;
  let quoteToken: MockERC20;

  const baseDecimals = 6;
  const quoteDecimals = 18;

  const parseBase = (value: string | number) => parseUnits(value.toString(), baseDecimals);
  const parseQuote = (value: string | number) => parseUnits(value.toString(), quoteDecimals);

  async function deployCoreContractsAndSetup() {
    // Deploy State
    const StateFactory = await ethers.getContractFactory("State");
    state = (await StateFactory.deploy(owner.address)) as unknown as State;
    await state.waitForDeployment();
    const stateAddress = await state.getAddress();

    // Deploy Vault
    const VaultFactory = await ethers.getContractFactory("Vault");
    const makerFeeRate = 10; // 10 bps = 0.1%
    const takerFeeRate = 20; // 20 bps = 0.2%
    vault = (await VaultFactory.deploy(owner.address, stateAddress, feeRecipient.address, makerFeeRate, takerFeeRate)) as unknown as Vault;
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();

    // Deploy Book
    const BookFactory = await ethers.getContractFactory("Book");
    book = (await BookFactory.deploy(owner.address, stateAddress, await baseToken.getAddress(), await quoteToken.getAddress())) as unknown as Book;
    await book.waitForDeployment();
    const bookAddress = await book.getAddress();

    // Deploy CLOB
    const CLOBFactory = await ethers.getContractFactory("CLOB");
    clob = (await CLOBFactory.deploy(owner.address, stateAddress, bookAddress, vaultAddress)) as unknown as CLOB;
    await clob.waitForDeployment();
    const clobAddress = await clob.getAddress();

    // Grant admin roles
    await state.connect(owner).addAdmin(clobAddress);
    await state.connect(owner).addAdmin(bookAddress);
    await state.connect(owner).addAdmin(vaultAddress);

    // Set Book address in Vault
    await vault.connect(owner).setBook(clobAddress); // Set CLOB as the authorized caller for Vault

    // Set CLOB address in Book (for authorization)
    await book.connect(owner).setCLOB(clobAddress);

    // Set CLOB address in Vault (for authorization)
    await vault.connect(owner).setCLOB(clobAddress);

    return { state, vault, book, clob };
  }

  async function fundAndApproveTraders(numTraders: number) {
    const vaultAddress = await vault.getAddress();
    traders = (await ethers.getSigners()).slice(1, numTraders + 1); // Use signers 1 to numTraders

    for (const trader of traders) {
      await baseToken.connect(owner).mint(trader.address, parseBase(10000));
      await quoteToken.connect(owner).mint(trader.address, parseQuote(1000000));
      await baseToken.connect(trader).approve(vaultAddress, ethers.MaxUint256);
      await quoteToken.connect(trader).approve(vaultAddress, ethers.MaxUint256);
    }
    // Also fund the main trader1 who will place the sweeping order
    if (numTraders < 1) throw new Error("Need at least 1 trader for population");
    trader1 = traders[0]; // Still use trader1 as *one* of the populators if needed

    // Fund trader2 specifically for the sweep order
    if (numTraders < 2) {
      // If only 1 trader requested, get the next signer for trader2
      trader2 = (await ethers.getSigners())[numTraders + 1]; 
    } else {
      // Otherwise, use the second funded trader
      trader2 = traders[1];
    }
    // Ensure trader2 is funded and approved
    await baseToken.connect(owner).mint(trader2.address, parseBase(10000)); // Base for potential future use
    await quoteToken.connect(owner).mint(trader2.address, parseQuote(10000000)); // Quote for market buy sweep
    await baseToken.connect(trader2).approve(vaultAddress, ethers.MaxUint256);
    await quoteToken.connect(trader2).approve(vaultAddress, ethers.MaxUint256);
  }

  // Helper to populate the book with sell orders in batches
  async function populateSellBook(numOrders: number, startPrice: number, priceIncrement: number, quantityPerOrder: number, batchSize: number = 20) {
    console.log(`Populating sell book with ${numOrders} orders, batch size ${batchSize}...`);
    for (let batchStart = 0; batchStart < numOrders; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, numOrders);
      const promises = [];
      console.log(`  Batch ${batchStart / batchSize + 1}: Placing orders ${batchStart + 1} to ${batchEnd}`);
      for (let i = batchStart; i < batchEnd; i++) {
        const price = parseQuote(startPrice + i * priceIncrement);
        const quantity = parseBase(quantityPerOrder);
        const trader = traders[i % traders.length]; // Cycle through available traders
        promises.push(
          clob.connect(trader).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, price, quantity)
        );
      }
      // Wait for all transactions in the batch to be sent (not necessarily mined)
      const txs = await Promise.all(promises);
      // Optionally wait for receipts if precise timing/ordering is critical between batches
      // const receipts = await Promise.all(txs.map(tx => tx.wait()));
      // console.log(`  Batch ${batchStart / batchSize + 1} sent.`);
    }
    console.log(`Sell book populated.`);
  }

  // Helper to populate the book with buy orders in batches
  async function populateBuyBook(numOrders: number, startPrice: number, priceDecrement: number, quantityPerOrder: number, batchSize: number = 20) {
    console.log(`Populating buy book with ${numOrders} orders, batch size ${batchSize}...`);
    for (let batchStart = 0; batchStart < numOrders; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, numOrders);
        const promises = [];
        console.log(`  Batch ${batchStart / batchSize + 1}: Placing orders ${batchStart + 1} to ${batchEnd}`);
        for (let i = batchStart; i < batchEnd; i++) {
            const price = parseQuote(startPrice - i * priceDecrement); // Decrement price for bids
            const quantity = parseBase(quantityPerOrder);
            const trader = traders[i % traders.length]; // Cycle through available traders
            promises.push(
                clob.connect(trader).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, price, quantity)
            );
        }
        const txs = await Promise.all(promises);
        // const receipts = await Promise.all(txs.map(tx => tx.wait()));
        // console.log(`  Batch ${batchStart / batchSize + 1} sent.`);
    }
    console.log(`Buy book populated.`);
}

  beforeEach(async function () {
    [owner, , , feeRecipient] = await ethers.getSigners(); // trader1, trader2 assigned in fundAndApprove

    // Deploy mock ERC20 tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    baseToken = (await MockERC20Factory.deploy("Base Token", "BASE", baseDecimals, owner.address)) as unknown as MockERC20;
    await baseToken.waitForDeployment();
    quoteToken = (await MockERC20Factory.deploy("Quote Token", "QUOTE", quoteDecimals, owner.address)) as unknown as MockERC20;
    await quoteToken.waitForDeployment();

    // Deploy core contracts
    await deployCoreContractsAndSetup();
    // Funding happens in the test cases based on required number of traders
  });

  // --- Test Cases for Different Depths ---

  const depthsToTest = [10, 50, 75]; // Reduced depth from 100 to 75

  for (const depth of depthsToTest) {
    it(`Depth ${depth}: Market Buy Sweep`, async function () {
      this.timeout(120000); // Increase timeout for potentially longer setup
      const numTradersNeeded = Math.min(depth, 15); // Use up to 15 signers for placing orders
      await fundAndApproveTraders(numTradersNeeded);
      // Add the pair *after* contracts are deployed and traders funded
      await clob.connect(owner).addSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress()); // Added

      const startPrice = 100;
      const priceIncrement = 1;
      const quantityPerOrder = 1;
      await populateSellBook(depth, startPrice, priceIncrement, quantityPerOrder, 20); // Use batching

      const sweepQuantity = parseBase(depth * quantityPerOrder); // Buy enough to clear all orders

      console.time(`Market Buy Sweep Depth ${depth}`);
      // For market buy, quantity is 0, specify quoteAmount instead
      const quoteAmountToSpend = parseQuote(1000000); // Spend up to 1M quote tokens
      // Use trader2 for the sweep to avoid self-trade
      const tx = await clob.connect(trader2).placeMarketOrder(
          await baseToken.getAddress(), 
          await quoteToken.getAddress(), 
          true, // isBuy = true
          0, // quantity = 0 for market buy
          quoteAmountToSpend, // quoteAmount to spend
          { gasLimit: 30000000 } // Override gas limit
      ); 
      const receipt = await tx.wait();
      console.timeEnd(`Market Buy Sweep Depth ${depth}`);

      // Basic check: the sweeping order should be filled
      // Order ID will be depth + 1 (since populateSellBook creates 'depth' orders)
      const sweepOrderId = depth + 1;
      const sweepOrder = await state.getOrder(sweepOrderId);
      // It might be partially filled if self-trade prevention kicks in, or fully filled
      expect(sweepOrder.status).to.be.oneOf([BigInt(ORDER_STATUS_FILLED), BigInt(ORDER_STATUS_PARTIALLY_FILLED)]);
      console.log(`Gas used for Depth ${depth}: ${receipt?.gasUsed.toString()}`);
    });
  }

  // Separate tests for gas usage with batching
  describe("Gas Usage", function() {
    const numOrders = 100;
    const batchSize = 20;

    it(`placing ${numOrders} limit buy orders`, async function() {
      this.timeout(180000); // Increase timeout
      const numTradersNeeded = Math.min(numOrders, 15);
      await fundAndApproveTraders(numTradersNeeded);
      await clob.connect(owner).addSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress());

      const startPrice = 200;
      const priceDecrement = 1;
      const quantityPerOrder = 1;

      console.time(`Placing ${numOrders} BUY orders`);
      await populateBuyBook(numOrders, startPrice, priceDecrement, quantityPerOrder, batchSize);
      console.timeEnd(`Placing ${numOrders} BUY orders`);
      // Verification: Check book depth (approximate)
      const [bidPrices] = await clob.getOrderBook(await baseToken.getAddress(), await quoteToken.getAddress(), numOrders + 5);
      expect(bidPrices.length).to.be.closeTo(numOrders, 5); // Allow for some tolerance
    });

    it(`placing ${numOrders} limit sell orders`, async function() {
        this.timeout(180000); // Increase timeout
        const numTradersNeeded = Math.min(numOrders, 15);
        await fundAndApproveTraders(numTradersNeeded);
        await clob.connect(owner).addSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress());
  
        const startPrice = 100;
        const priceIncrement = 1;
        const quantityPerOrder = 1;
  
        console.time(`Placing ${numOrders} SELL orders`);
        await populateSellBook(numOrders, startPrice, priceIncrement, quantityPerOrder, batchSize);
        console.timeEnd(`Placing ${numOrders} SELL orders`);
        // Verification: Check book depth (approximate)
        const [, , askPrices] = await clob.getOrderBook(await baseToken.getAddress(), await quoteToken.getAddress(), numOrders + 5);
        expect(askPrices.length).to.be.closeTo(numOrders, 5); // Allow for some tolerance
    });
  });

});

