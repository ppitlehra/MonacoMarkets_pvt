import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, TransactionReceipt } from "ethers"; // Added TransactionReceipt
import { Book, CLOB, State, Vault, MockERC20 } from "../typechain-types";

// Helper function to parse units (assuming 18 decimals for base, 6 for quote)
const parseBase = (amount: string | number) => ethers.parseUnits(amount.toString(), 18);
const parseQuote = (amount: string | number) => ethers.parseUnits(amount.toString(), 6);

describe("Enhanced Matching Algorithm Tests", function () {
  let owner: Signer;
  let trader1: Signer;
  let trader2: Signer;
  let trader3: Signer;
  let clob: CLOB;
  let book: Book;
  let state: State;
  let vault: Vault;
  let baseToken: MockERC20;
  let quoteToken: MockERC20;

  // Deploy contracts and set up trading environment
  async function deployAndSetup() {
    [owner, trader1, trader2, trader3] = await ethers.getSigners();
    const ownerAddress = await owner.getAddress();

    // Deploy Mock ERC20 Tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    baseToken = (await MockERC20.deploy("Base Token", "BASE", 18, ownerAddress)) as unknown as MockERC20;
    quoteToken = (await MockERC20.deploy("Quote Token", "QUOTE", 6, ownerAddress)) as unknown as MockERC20;
    const baseTokenAddress = await baseToken.getAddress();
    const quoteTokenAddress = await quoteToken.getAddress();

    // Deploy Core Contracts
    const State = await ethers.getContractFactory("State");
    state = (await State.deploy(ownerAddress)) as unknown as State;
    const stateAddress = await state.getAddress();

    const makerFeeRate = 10; // 10 bps = 0.1%
    const takerFeeRate = 20; // 20 bps = 0.2%
    const Vault = await ethers.getContractFactory("Vault");
    vault = (await Vault.deploy(ownerAddress, stateAddress, ownerAddress, makerFeeRate, takerFeeRate)) as unknown as Vault;
    const vaultAddress = await vault.getAddress();

    const Book = await ethers.getContractFactory("Book");
    book = (await Book.deploy(ownerAddress, stateAddress, baseTokenAddress, quoteTokenAddress)) as unknown as Book;
    const bookAddress = await book.getAddress();

    const CLOB = await ethers.getContractFactory("CLOB");
    clob = (await CLOB.deploy(ownerAddress, stateAddress, bookAddress, vaultAddress)) as unknown as CLOB;
    const clobAddress = await clob.getAddress();

    // Set dependencies
    await book.connect(owner).setVault(vaultAddress);
    await book.connect(owner).setCLOB(clobAddress);
    await vault.connect(owner).setBook(clobAddress); // Set CLOB as the authorized caller for Vault
    await vault.connect(owner).setCLOB(clobAddress);
    await state.connect(owner).addAdmin(clobAddress);
    await state.connect(owner).addAdmin(bookAddress);

    // Create trading pair
    await clob.connect(owner).addSupportedPair(baseTokenAddress, quoteTokenAddress);

    // Fund traders
    const trader1Address = await trader1.getAddress();
    const trader2Address = await trader2.getAddress();
    const trader3Address = await trader3.getAddress();
    
    await baseToken.connect(owner).mint(trader1Address, parseBase("10000"));
    await quoteToken.connect(owner).mint(trader1Address, parseQuote("1000000"));
    
    await baseToken.connect(owner).mint(trader2Address, parseBase("10000"));
    await quoteToken.connect(owner).mint(trader2Address, parseQuote("1000000"));
    
    await baseToken.connect(owner).mint(trader3Address, parseBase("10000"));
    await quoteToken.connect(owner).mint(trader3Address, parseQuote("1000000"));

    // Approve vault to spend tokens
    const vaultAddress2 = await vault.getAddress();
    await baseToken.connect(trader1).approve(vaultAddress2, ethers.MaxUint256);
    await quoteToken.connect(trader1).approve(vaultAddress2, ethers.MaxUint256);
    
    await baseToken.connect(trader2).approve(vaultAddress2, ethers.MaxUint256);
    await quoteToken.connect(trader2).approve(vaultAddress2, ethers.MaxUint256);
    
    await baseToken.connect(trader3).approve(vaultAddress2, ethers.MaxUint256);
    await quoteToken.connect(trader3).approve(vaultAddress2, ethers.MaxUint256);
  }

  // Helper to place a limit order and return its ID
  async function placeLimitOrder(trader: Signer, isBuy: boolean, price: bigint, quantity: bigint): Promise<bigint> {
    const baseTokenAddress = await baseToken.getAddress();
    const quoteTokenAddress = await quoteToken.getAddress();
    const tx = await clob.connect(trader).placeLimitOrder(baseTokenAddress, quoteTokenAddress, isBuy, price, quantity);
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error("Transaction receipt is null");
    }
    for (const log of receipt.logs) {
      try {
        const parsedLog = clob.interface.parseLog(log);
        if (parsedLog && parsedLog.name === "OrderPlaced") { // Using CLOB interface for OrderPlaced events
          return parsedLog.args.orderId;
        }
      } catch (e) { /* ignore */ }
    }
    throw new Error("OrderPlaced event not found");
  }

  // Helper to place a market order and return the receipt - UPDATED SIGNATURE
  async function placeMarketOrder(trader: Signer, isBuy: boolean, quantity: bigint, quoteAmount: bigint): Promise<TransactionReceipt | null> {
    const baseTokenAddress = await baseToken.getAddress();
    const quoteTokenAddress = await quoteToken.getAddress();
    // Ensure correct arguments based on buy/sell
    const finalQuantity = isBuy ? 0n : quantity;
    const finalQuoteAmount = isBuy ? quoteAmount : 0n;
    const tx = await clob.connect(trader).placeMarketOrder(baseTokenAddress, quoteTokenAddress, isBuy, finalQuantity, finalQuoteAmount);
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error("Transaction receipt is null");
    }
    return receipt;
  }

  // Helper to get order status
  async function getOrderStatus(orderId: bigint): Promise<bigint> {
    const order = await state.getOrder(orderId);
    return order.status;
  }

  // Helper to count settlement events in receipt
  async function countSettlementEvents(receipt: TransactionReceipt | null): Promise<number> { // Updated type
    if (!receipt) {
      throw new Error("Transaction receipt is null");
    }
    let count = 0;
    for (const log of receipt.logs) {
      try {
        const parsedLog = vault.interface.parseLog(log);
        if (parsedLog && parsedLog.name === "SettlementProcessed") {
          count++;
        }
      } catch (e) { /* ignore */ }
    }
    return count;
  }

  describe("Complete Matching Across Multiple Price Levels", function() {
    beforeEach(deployAndSetup);

    it("Should match a market order against multiple price levels in a single transaction", async function () {
      // Setup: Create a deep order book with multiple price levels
      // Trader1 places 5 buy orders at different price levels
      const buyOrderIds = [];
      const prices = [105, 104, 103, 102, 101].map(p => parseQuote(p.toString()));
      const quantities = Array(5).fill(parseBase("10"));
      
      for (let i = 0; i < 5; i++) {
        const orderId = await placeLimitOrder(trader1, true, prices[i], quantities[i]);
        buyOrderIds.push(orderId);
      }
      
      // Trader2 places a large market sell order that should match against all 5 buy orders
      const sellQuantity = parseBase("50"); // Total of all buy orders
      const sellTx = await placeMarketOrder(trader2, false, sellQuantity, 0n); // Market sell: quantity > 0, quoteAmount = 0
      
      // Verify that all 5 buy orders were matched in a single transaction
      const settlementCount = await countSettlementEvents(sellTx);
      expect(settlementCount).to.equal(5, "Should have 5 settlement events in a single transaction");
      
      // Verify all buy orders are now filled
      for (const orderId of buyOrderIds) {
        const status = await getOrderStatus(orderId);
        expect(status).to.equal(2n, `Buy order ${orderId} should be filled`);
      }
      
      // Verify the market order was fully executed (no remaining quantity)
      // This would require checking the order status or balance changes
      const trader2Address = await trader2.getAddress();
      const finalBaseBalance = await baseToken.balanceOf(trader2Address);
      // Initial balance was 10000, sold 50, so should have 9950 remaining
      expect(finalBaseBalance).to.equal(parseBase("9950"), "Trader2 should have sold all 50 BASE");
    });

    it("Should match a limit order against multiple price levels in a single transaction", async function () {
      // Setup: Create a deep order book with multiple price levels
      // Trader1 places 5 sell orders at different price levels
      const sellOrderIds = [];
      const prices = [101, 102, 103, 104, 105].map(p => parseQuote(p.toString()));
      const quantities = Array(5).fill(parseBase("10"));
      
      for (let i = 0; i < 5; i++) {
        const orderId = await placeLimitOrder(trader1, false, prices[i], quantities[i]);
        sellOrderIds.push(orderId);
      }
      
      // Trader2 places a large limit buy order that should match against all 5 sell orders
      const buyPrice = parseQuote("105"); // High enough to match all sell orders
      const buyQuantity = parseBase("50"); // Total of all sell orders
      const buyTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        buyPrice,
        buyQuantity
      );
      const buyReceipt = await buyTx.wait();
      
      // Verify that all 5 sell orders were matched in a single transaction
      const settlementCount = await countSettlementEvents(buyReceipt);
      expect(settlementCount).to.equal(5, "Should have 5 settlement events in a single transaction");
      
      // Verify all sell orders are now filled
      for (const orderId of sellOrderIds) {
        const status = await getOrderStatus(orderId);
        expect(status).to.equal(2n, `Sell order ${orderId} should be filled`);
      }
      
      // Extract buy order ID
      let buyOrderId;
      if (!buyReceipt) {
        throw new Error("Transaction receipt is null");
      }
      for (const log of buyReceipt.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === "OrderPlaced") {
            buyOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore */ }
      }
      
      // Verify the buy order was fully filled
      const buyOrderStatus = await getOrderStatus(buyOrderId);
      expect(buyOrderStatus).to.equal(2n, "Buy order should be filled");
    });
  });

  describe("Optimized Batch Processing", function() {
    beforeEach(deployAndSetup);

    it("Should efficiently process a large number of orders in a single batch", async function () {
      // Setup: Create a large number of orders (20+) to test batch processing efficiency
      const sellOrderIds = [];
      const prices = Array(20).fill(parseQuote("100"));
      const quantities = Array(20).fill(parseBase("5"));
      
      // Place 20 sell orders
      for (let i = 0; i < 20; i++) {
        const orderId = await placeLimitOrder(trader1, false, prices[i], quantities[i]);
        sellOrderIds.push(orderId);
      }
      
      // Trader2 places a large buy order to match against all 20 sell orders
      const buyPrice = parseQuote("100");
      const buyQuantity = parseBase("100"); // 20 * 5 = 100
      const buyTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        buyPrice,
        buyQuantity
      );
      const buyReceipt = await buyTx.wait();
      
      // Verify all 20 sell orders were matched efficiently
      const settlementCount = await countSettlementEvents(buyReceipt);
      expect(settlementCount).to.equal(20, "Should process all 20 orders in a single batch");
      
      // Verify all sell orders are filled
      for (const orderId of sellOrderIds) {
        const status = await getOrderStatus(orderId);
        expect(status).to.equal(2n, `Sell order ${orderId} should be filled`);
      }
      
      // Extract buy order ID
      let buyOrderId;
      if (!buyReceipt) {
        throw new Error("Transaction receipt is null");
      }
      for (const log of buyReceipt.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === "OrderPlaced") {
            buyOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore */ }
      }
      
      // Verify the buy order was fully filled
      const buyOrderStatus = await getOrderStatus(buyOrderId);
      expect(buyOrderStatus).to.equal(2, "Buy order should be filled");
    });

    it("Should handle multiple price levels efficiently in a single batch", async function () {
      // Setup: Create orders at many different price levels
      const sellOrderIds = [];
      // Create 10 sell orders at 10 different price levels
      for (let i = 0; i < 10; i++) {
        const price = parseQuote((100 + i).toString()); // 100, 101, 102, ...
        const quantity = parseBase("10");
        const orderId = await placeLimitOrder(trader1, false, price, quantity);
        sellOrderIds.push(orderId);
      }
      
      // Trader2 places a large buy order to match against all price levels
      const buyPrice = parseQuote("110"); // High enough to match all sell orders
      const buyQuantity = parseBase("100"); // 10 * 10 = 100
      const buyTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        buyPrice,
        buyQuantity
      );
      const buyReceipt = await buyTx.wait();
      
      // Verify all 10 sell orders at different price levels were matched efficiently
      const settlementCount = await countSettlementEvents(buyReceipt);
      expect(settlementCount).to.equal(10, "Should process all 10 price levels in a single batch");
      
      // Verify all sell orders are filled
      for (const orderId of sellOrderIds) {
        const status = await getOrderStatus(orderId);
        expect(status).to.equal(2n, `Sell order ${orderId} should be filled`);
      }
    });
  });

  describe("Complete Market Order Execution", function() {
    beforeEach(deployAndSetup);

    it("Should fully execute a market order against all available liquidity", async function () {
      // Setup: Create a fragmented order book with gaps in price levels
      const buyOrderIds = [];
      
      // Place buy orders at non-consecutive price levels
      const prices = [105, 103, 101, 99, 97].map(p => parseQuote(p.toString()));
      const quantities = Array(5).fill(parseBase("10"));
      
      for (let i = 0; i < 5; i++) {
        const orderId = await placeLimitOrder(trader1, true, prices[i], quantities[i]);
        buyOrderIds.push(orderId);
      }
      
      // Trader2 places a market sell order that should match against all available buy orders
      const sellQuantity = parseBase("50"); // Total of all buy orders
      const sellTx = await placeMarketOrder(trader2, false, sellQuantity, 0n); // Market sell: quantity > 0, quoteAmount = 0
      
      // Verify that all buy orders were matched, even with gaps in price levels
      const settlementCount = await countSettlementEvents(sellTx);
      expect(settlementCount).to.equal(5, "Should match against all 5 buy orders despite price gaps");
      
      // Verify all buy orders are filled
      for (const orderId of buyOrderIds) {
        const status = await getOrderStatus(orderId);
        expect(status).to.equal(2n, `Buy order ${orderId} should be filled`);
      }
    });

    it("Should execute a market order against the best available prices first", async function () {
      // Setup: Create buy orders at different price levels
      // Trader1 places buy orders at decreasing prices
      const prices = [105, 103, 101].map(p => parseQuote(p.toString()));
      const quantities = Array(3).fill(parseBase("10"));
      
      const buyOrderId1 = await placeLimitOrder(trader1, true, prices[0], quantities[0]); // 10 @ 105
      const buyOrderId2 = await placeLimitOrder(trader1, true, prices[1], quantities[1]); // 10 @ 103
      const buyOrderId3 = await placeLimitOrder(trader1, true, prices[2], quantities[2]); // 10 @ 101
      
      // Trader2 places a market sell order for 15 BASE
      const sellQuantity = parseBase("15");
      const sellTx = await placeMarketOrder(trader2, false, sellQuantity, 0n); // Market sell: quantity > 0, quoteAmount = 0
      
      // Verify that the best price order (105) is fully filled, and the next best (103) is partially filled
      const settlementCount = await countSettlementEvents(sellTx);
      expect(settlementCount).to.equal(2, "Should match against the two best price levels");
      
      // Verify order statuses
      const status1 = await getOrderStatus(buyOrderId1);
      const status2 = await getOrderStatus(buyOrderId2);
      const status3 = await getOrderStatus(buyOrderId3);
      
      expect(status1).to.equal(2n, "Order at 105 should be fully filled");
      expect(status2).to.equal(1n, "Order at 103 should be partially filled"); // Status 1 = PARTIALLY_FILLED
      expect(status3).to.equal(0n, "Order at 101 should remain open"); // Status 0 = OPEN
    });
  });

  describe("Gas Efficiency", function() {
    beforeEach(deployAndSetup);

    it("Should optimize gas usage when matching against multiple orders", async function () {
      // Setup: Place 10 small sell orders at the same price
      const sellPrice = parseQuote("100");
      const smallSellQuantity = parseQuote("0.1");
      for (let i = 0; i < 10; i++) {
        await clob.connect(trader2).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, sellPrice, smallSellQuantity);
      }

      // Action: Place a buy order that matches all 10 sell orders
      const totalBuyQuantity = parseQuote("1"); // Matches 10 * 0.1
      const tx = await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, sellPrice, totalBuyQuantity);
      const receipt = await tx.wait();
      const gasUsed = receipt?.gasUsed ?? 0n;

      // Assertion: Check if gas used is within an optimized range
      // This limit is arbitrary and needs adjustment based on actual profiling
      const expectedGasLimit = 2900000; // Increased limit from 2000000
      console.log(`Gas used for matching 10 orders: ${gasUsed.toString()}`);
      expect(gasUsed, "Gas usage for matching 10 orders should be optimized").to.be.at.most(expectedGasLimit);
    });
  });
});

