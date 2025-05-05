/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Book, CLOB, State, Vault, MockERC20 } from "../typechain-types";

// Helper function to parse units (assuming 18 decimals for base, 6 for quote)
const parseBase = (amount: string | number) => ethers.parseUnits(amount.toString(), 18);
const parseQuote = (amount: string | number) => ethers.parseUnits(amount.toString(), 6);

describe("Complex Scenarios Tests", function () {
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
    
    await baseToken.connect(owner).mint(trader1Address, parseBase("1000"));
    await quoteToken.connect(owner).mint(trader1Address, parseQuote("100000"));
    
    await baseToken.connect(owner).mint(trader2Address, parseBase("1000"));
    await quoteToken.connect(owner).mint(trader2Address, parseQuote("100000"));
    
    await baseToken.connect(owner).mint(trader3Address, parseBase("1000"));
    await quoteToken.connect(owner).mint(trader3Address, parseQuote("100000"));

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
    if (!receipt || !receipt.logs) {
      throw new Error("Transaction receipt is null or missing logs");
    }
    for (const log of receipt.logs) {
      try {
        const parsedLog = clob.interface.parseLog(log); // Parse using CLOB interface for OrderPlaced
        if (parsedLog && parsedLog.name === "OrderPlaced") {
          return parsedLog.args.orderId;
        }
      } catch (e) { /* ignore */ }
    }
    throw new Error("OrderPlaced event not found");
  }

  // Helper to place a market order
  async function placeMarketOrder(trader: Signer, isBuy: boolean, quantity: bigint, quoteAmount: bigint = 0n) {
    const baseTokenAddress = await baseToken.getAddress();
    const quoteTokenAddress = await quoteToken.getAddress();
    const tx = await clob.connect(trader).placeMarketOrder(baseTokenAddress, quoteTokenAddress, isBuy, quantity, quoteAmount);
    return tx.wait();
  }

  // Helper to get order status
  async function getOrderStatus(orderId: bigint): Promise<bigint> {
    const order = await state.getOrder(orderId);
    return order.status;
  }

  // Helper to count settlement events in receipt
  async function countSettlementEvents(receipt: any): Promise<number> {
    let count = 0;
    if (!receipt || !receipt.logs) {
      return count;
    }
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

  describe("Partial Fill Scenarios", function() {
    beforeEach(deployAndSetup);

    it("Should partially fill a limit order and leave the remainder in the book", async function () {
      // Trader1 places a limit buy order for 10 BASE at 100 QUOTE
      const buyPrice = parseQuote("100");
      const buyQuantity = parseBase("10");
      const buyOrderId = await placeLimitOrder(trader1, true, buyPrice, buyQuantity);
      
      // Trader2 places a limit sell order for 5 BASE at 100 QUOTE (half the buy quantity)
      const sellPrice = parseQuote("100");
      const sellQuantity = parseBase("5");
      const sellTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(), 
        await quoteToken.getAddress(), 
        false, 
        sellPrice, 
        sellQuantity
      );
      const sellReceipt = await sellTx.wait();
      
      // Verify settlement occurred
      const settlementCount = await countSettlementEvents(sellReceipt);
      expect(settlementCount).to.equal(1, "Should have 1 settlement event");
      
      // Verify buy order is partially filled (status should be PARTIALLY_FILLED = 1)
      const buyOrderStatus = await getOrderStatus(buyOrderId);
      expect(buyOrderStatus).to.equal(1, "Buy order should be partially filled");
      
      // Verify the remaining quantity in the book
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.quantity).to.equal(buyQuantity);
      expect(buyOrder.filledQuantity).to.equal(sellQuantity);
      expect(buyOrder.quantity - buyOrder.filledQuantity).to.equal(parseBase("5"), "Remaining quantity should be 5 BASE");
    });

    it("Should fill multiple orders at different price levels with a single market order", async function () {
      // Trader1 places a limit buy order for 5 BASE at 100 QUOTE
      const buyPrice1 = parseQuote("100");
      const buyQuantity1 = parseBase("5");
      const buyOrderId1 = await placeLimitOrder(trader1, true, buyPrice1, buyQuantity1);
      
      // Trader1 places another limit buy order for 5 BASE at 95 QUOTE (lower price)
      const buyPrice2 = parseQuote("95");
      const buyQuantity2 = parseBase("5");
      const buyOrderId2 = await placeLimitOrder(trader1, true, buyPrice2, buyQuantity2);
      
      // Trader2 places a market sell order for 8 BASE (should fill the first order completely and the second partially)
      const sellQuantity = parseBase("8");
      const sellTx = await placeMarketOrder(trader2, false, sellQuantity);
      
      // Verify multiple settlements occurred
      const settlementCount = await countSettlementEvents(sellTx);
      expect(settlementCount).to.equal(2, "Should have 2 settlement events");
      
      // Verify first buy order is completely filled
      const buyOrder1Status = await getOrderStatus(buyOrderId1);
      expect(buyOrder1Status).to.equal(2, "First buy order should be completely filled");
      
      // Verify second buy order is partially filled
      const buyOrder2Status = await getOrderStatus(buyOrderId2);
      expect(buyOrder2Status).to.equal(1, "Second buy order should be partially filled");
      
      // Verify the remaining quantity in the second order
      const buyOrder2 = await state.getOrder(buyOrderId2);
      expect(buyOrder2.filledQuantity).to.equal(parseBase("3"), "Should have filled 3 BASE from second order");
      expect(buyOrder2.quantity - buyOrder2.filledQuantity).to.equal(parseBase("2"), "Remaining quantity should be 2 BASE");
    });
  });

  describe("Order Cancellation Scenarios", function() {
    beforeEach(deployAndSetup);

    it("Should allow cancellation of an open order", async function () {
      // Trader1 places a limit buy order
      const buyPrice = parseQuote("100");
      const buyQuantity = parseBase("10");
      const buyOrderId = await placeLimitOrder(trader1, true, buyPrice, buyQuantity);
      
      // Verify order is open
      const initialStatus = await getOrderStatus(buyOrderId);
      expect(initialStatus).to.equal(0n, "Order should be open initially");
      
      // Cancel the order
      await clob.connect(trader1).cancelOrder(buyOrderId);
      
      // Verify order is cancelled
      const finalStatus = await getOrderStatus(buyOrderId);
      expect(finalStatus).to.equal(3n, "Order should be cancelled");
    });

    it("Should not allow cancellation of an order by a different trader", async function () {
      // Trader1 places a limit buy order
      const buyPrice = parseQuote("100");
      const buyQuantity = parseBase("10");
      const buyOrderId = await placeLimitOrder(trader1, true, buyPrice, buyQuantity);
      
      // Attempt to cancel the order as Trader2 (should fail)
      await expect(
        clob.connect(trader2).cancelOrder(buyOrderId)
      ).to.be.revertedWith("CLOB: caller is not the trader");
    });

    it("Should not allow cancellation of a filled order", async function () {
      // Trader1 places a limit buy order
      const buyPrice = parseQuote("100");
      const buyQuantity = parseBase("10");
      const buyOrderId = await placeLimitOrder(trader1, true, buyPrice, buyQuantity);
      
      // Trader2 places a matching sell order to fill it
      const sellPrice = parseQuote("100");
      const sellQuantity = parseBase("10");
      await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(), 
        await quoteToken.getAddress(), 
        false, 
        sellPrice, 
        sellQuantity
      );
      
      // Verify order is filled
      const filledStatus = await getOrderStatus(buyOrderId);
      expect(filledStatus).to.equal(2n, "Order should be filled");
      
      // Attempt to cancel the filled order (should fail)
      await expect(
        clob.connect(trader1).cancelOrder(buyOrderId)
      ).to.be.revertedWith("CLOB: order is not open or partially filled");
    });

    it("Should allow cancellation of a partially filled order", async function () {
      // Trader1 places a limit buy order
      const buyPrice = parseQuote("100");
      const buyQuantity = parseBase("10");
      const buyOrderId = await placeLimitOrder(trader1, true, buyPrice, buyQuantity);
      
      // Trader2 places a smaller sell order to partially fill it
      const sellPrice = parseQuote("100");
      const sellQuantity = parseBase("5");
      await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(), 
        await quoteToken.getAddress(), 
        false, 
        sellPrice, 
        sellQuantity
      );
      
      // Verify order is partially filled
      const partialStatus = await getOrderStatus(buyOrderId);
      expect(partialStatus).to.equal(1n, "Order should be partially filled");
      
      // Cancel the partially filled order
      await clob.connect(trader1).cancelOrder(buyOrderId);
      
      // Verify order is cancelled
      const finalStatus = await getOrderStatus(buyOrderId);
      expect(finalStatus).to.equal(3n, "Order should be cancelled");
    });
  });

  describe("Self-Trading Prevention", function() {
    beforeEach(deployAndSetup);

    it("Should prevent a trader from matching against their own order", async function () {
      // Trader1 places a limit buy order
      const buyPrice = parseQuote("100");
      const buyQuantity = parseBase("10");
      const buyOrderId = await placeLimitOrder(trader1, true, buyPrice, buyQuantity);
      
      // Trader1 attempts to place a matching sell order (should not match against own order)
      const sellPrice = parseQuote("100");
      const sellQuantity = parseBase("10");
      const sellTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(), 
        await quoteToken.getAddress(), 
        false, 
        sellPrice, 
        sellQuantity
      );
      const sellReceipt = await sellTx.wait();
      
      // Extract sell order ID
      let sellOrderId;
      if (sellReceipt && sellReceipt.logs) {
        for (const log of sellReceipt.logs) {
          try {
            const parsedLog = clob.interface.parseLog(log); // Parse using CLOB interface
            if (parsedLog && parsedLog.name === "OrderPlaced") {
              sellOrderId = parsedLog.args.orderId;
              break;
            }
          } catch (e) { /* ignore */ }
        }
      }
      
      // Verify no settlement occurred (self-trade prevention)
      const settlementCount = await countSettlementEvents(sellReceipt);
      expect(settlementCount).to.equal(0, "Should have no settlement events (self-trade prevention)");
      
      // Verify both orders remain open
      const buyOrderStatus = await getOrderStatus(buyOrderId);
      const sellOrderStatus = await getOrderStatus(sellOrderId);
      expect(buyOrderStatus).to.equal(0n, "Buy order should remain open");
      expect(sellOrderStatus).to.equal(0n, "Sell order should be open");
    });
  });

  describe("Dust Amount Handling", function() {
    beforeEach(deployAndSetup);

    it("Should handle very small (dust) order quantities", async function () {
      // Trader1 places a limit buy order with a very small quantity
      const buyPrice = parseQuote("100");
      const buyQuantity = parseBase("0.000001"); // Very small amount
      const buyOrderId = await placeLimitOrder(trader1, true, buyPrice, buyQuantity);
      
      // Trader2 places a matching sell order
      const sellPrice = parseQuote("100");
      const sellQuantity = parseBase("0.000001");
      const sellTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(), 
        await quoteToken.getAddress(), 
        false, 
        sellPrice, 
        sellQuantity
      );
      const sellReceipt = await sellTx.wait();
      
      // Verify settlement occurred even with dust amounts
      const settlementCount = await countSettlementEvents(sellReceipt);
      expect(settlementCount).to.equal(1, "Should have 1 settlement event");
      
      // Verify buy order is filled
      const buyOrderStatus = await getOrderStatus(buyOrderId);
      expect(buyOrderStatus).to.equal(2n, "Buy order should be filled");
    });
  });
});

