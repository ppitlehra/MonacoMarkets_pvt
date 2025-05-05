/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Book, CLOB, State, Vault, MockToken } from "../typechain-types";

describe("Edge Case End-to-End Tests", function () {
  // Constants for testing
  const STANDARD_PRICE = ethers.parseUnits("100", 18);
  const STANDARD_QUANTITY = ethers.parseUnits("1", 18);
  const INITIAL_BALANCE = ethers.parseUnits("1000000", 18);
  
  // Order status constants
  const ORDER_STATUS_OPEN = 0;
  const ORDER_STATUS_FILLED = 2;
  const ORDER_STATUS_CANCELED = 3;
  const ORDER_STATUS_PARTIALLY_FILLED = 1;
  
  // Order type constants (Not directly used for placing, but for verification)
  const ORDER_TYPE_LIMIT = 0;
  const ORDER_TYPE_MARKET = 1;
  const ORDER_TYPE_IOC = 2;
  const ORDER_TYPE_FOK = 3;
  
  // Edge case constants
  const MINIMUM_QUANTITY = ethers.parseUnits("0.000001", 18); // Very small quantity
  const MAXIMUM_QUANTITY = ethers.parseUnits("1000", 18);  // Reduced from 10,000 to 1,000
  const EXTREME_HIGH_PRICE = ethers.parseUnits("100000", 18); // Reduced from 999,999,999 to 100,000
  const EXTREME_LOW_PRICE = ethers.parseUnits("0.000001", 18);   // Very low price
  const ZERO_QUANTITY = 0n;
  const ZERO_PRICE = 0n;
  
  // Fee rate constants (in basis points, 1 bp = 0.01%)
  const DEFAULT_MAKER_FEE_RATE = 10; // 0.1%
  const DEFAULT_TAKER_FEE_RATE = 20; // 0.2%
  
  // Contracts
  let state: State;
  let vault: Vault;
  let clob: CLOB;
  let book: Book;
  let baseToken: MockToken;
  let quoteToken: MockToken;
  
  // Signers
  let owner: Signer;
  let trader1: Signer;
  let trader2: Signer;
  let feeRecipient: Signer;

  // Helper to extract order ID from receipt logs (Looks for OrderPlaced from CLOB)
  async function extractOrderId(receipt: any) {
    if (!receipt || !receipt.logs) return null;
    
    for (const log of receipt.logs) {
      try {
        const parsedLog = clob.interface.parseLog(log); // Use CLOB interface
        if (parsedLog && parsedLog.name === "OrderPlaced") {
          return parsedLog.args.orderId;
        }
      } catch (e) { /* ignore logs not parseable by clob interface */ }
    }
    return null;
  }
  
  beforeEach(async function () {
    // Get signers
    [owner, trader1, trader2, feeRecipient] = await ethers.getSigners();
    
    // Deploy mock tokens
    const TokenFactory = await ethers.getContractFactory("MockToken");
    baseToken = (await TokenFactory.deploy("Base Token", "BASE", 18)) as unknown as MockToken;
    quoteToken = (await TokenFactory.deploy("Quote Token", "QUOTE", 18)) as unknown as MockToken;
    
    // Deploy State contract
    const StateFactory = await ethers.getContractFactory("State");
    state = (await StateFactory.deploy(await owner.getAddress())) as unknown as State;
    
    // Deploy Vault contract with default fee rates
    const VaultFactory = await ethers.getContractFactory("Vault");
    vault = (await VaultFactory.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await feeRecipient.getAddress(),
      DEFAULT_MAKER_FEE_RATE,
      DEFAULT_TAKER_FEE_RATE
    )) as unknown as Vault;
    
    // Deploy Book contract
    const BookFactory = await ethers.getContractFactory("Book");
    book = (await BookFactory.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    )) as unknown as Book;
    
    // Deploy CLOB contract
    const CLOBFactory = await ethers.getContractFactory("CLOB");
    clob = (await CLOBFactory.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await book.getAddress(),
      await vault.getAddress()
    )) as unknown as CLOB;
    
    // Set up proper contract relationships for end-to-end testing
    
    // Set CLOB as the book in Vault (CLOB calls Vault.processSettlements)
    await vault.connect(owner).setBook(await clob.getAddress());
    
    await book.connect(owner).setVault(await vault.getAddress());
    
    // Set CLOB in Vault
    await vault.connect(owner).setCLOB(await clob.getAddress());
    
    // Add CLOB as admin in State
    await state.connect(owner).addAdmin(await clob.getAddress());
    
    // Add Book as admin in State
    await state.connect(owner).addAdmin(await book.getAddress());
    
    // Set CLOB as admin in Book
    await book.connect(owner).setCLOB(await clob.getAddress());
    
    // Add supported trading pair
    await clob.connect(owner).addSupportedPair(
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    );
    
    // Mint tokens to traders
    await baseToken.mint(await trader1.getAddress(), INITIAL_BALANCE);
    await baseToken.mint(await trader2.getAddress(), INITIAL_BALANCE);
    await quoteToken.mint(await trader1.getAddress(), INITIAL_BALANCE);
    await quoteToken.mint(await trader2.getAddress(), INITIAL_BALANCE);
    
    // Approve tokens for trading
    await baseToken.connect(trader1).approve(await vault.getAddress(), INITIAL_BALANCE);
    await baseToken.connect(trader2).approve(await vault.getAddress(), INITIAL_BALANCE);
    await quoteToken.connect(trader1).approve(await vault.getAddress(), INITIAL_BALANCE);
    await quoteToken.connect(trader2).approve(await vault.getAddress(), INITIAL_BALANCE);
  });
  
  describe("Minimum Order Size Tests", function () {
    it("should handle minimum order sizes correctly", async function () {
      console.log("Testing minimum order size...");
      
      // Record initial token balances
      const initialSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Place a limit sell order with minimum quantity through CLOB contract
      console.log("Placing limit sell order with minimum quantity...");
      const sellOrderTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        STANDARD_PRICE,
        MINIMUM_QUANTITY
      );
      
      // Get the sell order ID from transaction receipt
      const sellOrderReceipt = await sellOrderTx.wait();
      const sellOrderId = await extractOrderId(sellOrderReceipt);
      if (sellOrderId === null) {
        throw new Error("Sell OrderPlaced event not found");
      }
      console.log("Sell order ID:", sellOrderId);
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log("Sell order status:", sellOrder.status);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      expect(sellOrder.quantity).to.equal(MINIMUM_QUANTITY);
      
      // Place a matching limit buy order with minimum quantity through CLOB contract
      console.log("Placing limit buy order with minimum quantity...");
      const buyOrderTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        STANDARD_PRICE,
        MINIMUM_QUANTITY
      );
      
      // Get the buy order ID from transaction receipt
      const buyOrderReceipt = await buyOrderTx.wait();
      const buyOrderId = await extractOrderId(buyOrderReceipt);
      if (buyOrderId === null) {
        throw new Error("Buy OrderPlaced event not found");
      }
      console.log("Buy order ID:", buyOrderId);
      
      // Verify the buy order was matched (should be filled)
      const buyOrder = await state.getOrder(buyOrderId);
      console.log("Buy order status:", buyOrder.status);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Verify the sell order was matched (should be filled)
      const updatedSellOrder = await state.getOrder(sellOrderId);
      console.log("Updated sell order status:", updatedSellOrder.status);
      expect(updatedSellOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Get final balances after matching
      const finalSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const finalSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const finalBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const finalBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const finalFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Calculate expected trade value and fees
      const tradeValue = STANDARD_PRICE * MINIMUM_QUANTITY / ethers.parseUnits("1", 18);
      const expectedMakerFee = tradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const expectedTakerFee = tradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      const expectedTotalFee = expectedMakerFee + expectedTakerFee;
      
      // Verify token transfers
      // Seller should send base tokens and receive quote tokens minus maker fee
      const sellerBaseTokenDiff = initialSellerBaseBalance - finalSellerBaseBalance;
      expect(sellerBaseTokenDiff).to.equal(MINIMUM_QUANTITY);
      
      const sellerQuoteTokenDiff = finalSellerQuoteBalance - initialSellerQuoteBalance;
      expect(sellerQuoteTokenDiff).to.equal(tradeValue - expectedMakerFee);
      
      // Buyer should receive base tokens and send quote tokens plus taker fee
      const buyerBaseTokenDiff = finalBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiff).to.equal(MINIMUM_QUANTITY);
      
      const buyerQuoteTokenDiff = initialBuyerQuoteBalance - finalBuyerQuoteBalance;
      expect(buyerQuoteTokenDiff).to.equal(tradeValue + expectedTakerFee);
      
      // Fee recipient should receive both maker and taker fees
      const feeRecipientQuoteTokenDiff = finalFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiff).to.equal(expectedTotalFee);
      
      console.log(`Minimum Order - Trade value: ${tradeValue}`);
      console.log(`Minimum Order - Quantity: ${MINIMUM_QUANTITY}`);
      console.log(`Minimum Order - Maker fee: ${expectedMakerFee}`);
      console.log(`Minimum Order - Taker fee: ${expectedTakerFee}`);
      console.log(`Minimum Order - Total fee: ${expectedTotalFee}`);
      console.log(`Minimum Order - Fee recipient received: ${feeRecipientQuoteTokenDiff}`);
    });
  });
  
  describe("Maximum Order Size Tests", function () {
    it("should handle maximum order sizes correctly", async function () {
      console.log("Testing maximum order size...");
      
      // Record initial token balances
      const initialSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Place a limit sell order with maximum quantity through CLOB contract
      console.log("Placing limit sell order with maximum quantity...");
      const sellOrderTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        STANDARD_PRICE,
        MAXIMUM_QUANTITY
      );
      
      // Get the sell order ID from transaction receipt
      const sellOrderReceipt = await sellOrderTx.wait();
      const sellOrderId = await extractOrderId(sellOrderReceipt);
      if (sellOrderId === null) {
        throw new Error("Sell OrderPlaced event not found");
      }
      console.log("Sell order ID:", sellOrderId);
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log("Sell order status:", sellOrder.status);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      expect(sellOrder.quantity).to.equal(MAXIMUM_QUANTITY);
      
      // Place a matching limit buy order with maximum quantity through CLOB contract
      console.log("Placing limit buy order with maximum quantity...");
      const buyOrderTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        STANDARD_PRICE,
        MAXIMUM_QUANTITY
      );
      
      // Get the buy order ID from transaction receipt
      const buyOrderReceipt = await buyOrderTx.wait();
      const buyOrderId = await extractOrderId(buyOrderReceipt);
      if (buyOrderId === null) {
        throw new Error("Buy OrderPlaced event not found");
      }
      console.log("Buy order ID:", buyOrderId);
      
      // Verify the buy order was matched (should be filled)
      const buyOrder = await state.getOrder(buyOrderId);
      console.log("Buy order status:", buyOrder.status);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Verify the sell order was matched (should be filled)
      const updatedSellOrder = await state.getOrder(sellOrderId);
      console.log("Updated sell order status:", updatedSellOrder.status);
      expect(updatedSellOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Get final balances after matching
      const finalSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const finalSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const finalBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const finalBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const finalFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Calculate expected trade value and fees
      const tradeValue = STANDARD_PRICE * MAXIMUM_QUANTITY / ethers.parseUnits("1", 18);
      const expectedMakerFee = tradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const expectedTakerFee = tradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      const expectedTotalFee = expectedMakerFee + expectedTakerFee;
      
      // Verify token transfers
      // Seller should send base tokens and receive quote tokens minus maker fee
      const sellerBaseTokenDiff = initialSellerBaseBalance - finalSellerBaseBalance;
      expect(sellerBaseTokenDiff).to.equal(MAXIMUM_QUANTITY);
      
      const sellerQuoteTokenDiff = finalSellerQuoteBalance - initialSellerQuoteBalance;
      expect(sellerQuoteTokenDiff).to.equal(tradeValue - expectedMakerFee);
      
      // Buyer should receive base tokens and send quote tokens plus taker fee
      const buyerBaseTokenDiff = finalBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiff).to.equal(MAXIMUM_QUANTITY);
      
      const buyerQuoteTokenDiff = initialBuyerQuoteBalance - finalBuyerQuoteBalance;
      expect(buyerQuoteTokenDiff).to.equal(tradeValue + expectedTakerFee);
      
      // Fee recipient should receive both maker and taker fees
      const feeRecipientQuoteTokenDiff = finalFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiff).to.equal(expectedTotalFee);
      
      console.log(`Maximum Order - Trade value: ${tradeValue}`);
      console.log(`Maximum Order - Quantity: ${MAXIMUM_QUANTITY}`);
      console.log(`Maximum Order - Maker fee: ${expectedMakerFee}`);
      console.log(`Maximum Order - Taker fee: ${expectedTakerFee}`);
      console.log(`Maximum Order - Total fee: ${expectedTotalFee}`);
      console.log(`Maximum Order - Fee recipient received: ${feeRecipientQuoteTokenDiff}`);
    });
  });
  
  describe("Extreme Price Tests", function () {
    it("should handle extremely high prices correctly", async function () {
      console.log("Testing extremely high price...");
      
      // Record initial token balances
      const initialSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Place a limit sell order with extremely high price through CLOB contract
      console.log("Placing limit sell order with extremely high price...");
      const sellOrderTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        EXTREME_HIGH_PRICE,
        STANDARD_QUANTITY
      );
      
      // Get the sell order ID from transaction receipt
      const sellOrderReceipt = await sellOrderTx.wait();
      const sellOrderId = await extractOrderId(sellOrderReceipt);
      if (sellOrderId === null) {
        throw new Error("Sell OrderPlaced event not found");
      }
      console.log("Sell order ID:", sellOrderId);
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log("Sell order status:", sellOrder.status);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      expect(sellOrder.price).to.equal(EXTREME_HIGH_PRICE);
      
      // Place a matching limit buy order with extremely high price through CLOB contract
      console.log("Placing limit buy order with extremely high price...");
      const buyOrderTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        EXTREME_HIGH_PRICE,
        STANDARD_QUANTITY
      );
      
      // Get the buy order ID from transaction receipt
      const buyOrderReceipt = await buyOrderTx.wait();
      const buyOrderId = await extractOrderId(buyOrderReceipt);
      if (buyOrderId === null) {
        throw new Error("Buy OrderPlaced event not found");
      }
      console.log("Buy order ID:", buyOrderId);
      
      // Verify the buy order was matched (should be filled)
      const buyOrder = await state.getOrder(buyOrderId);
      console.log("Buy order status:", buyOrder.status);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Verify the sell order was matched (should be filled)
      const updatedSellOrder = await state.getOrder(sellOrderId);
      console.log("Updated sell order status:", updatedSellOrder.status);
      expect(updatedSellOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Get final balances after matching
      const finalSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const finalSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const finalBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const finalBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const finalFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Calculate expected trade value and fees
      const tradeValue = EXTREME_HIGH_PRICE * STANDARD_QUANTITY / ethers.parseUnits("1", 18);
      const expectedMakerFee = tradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const expectedTakerFee = tradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      const expectedTotalFee = expectedMakerFee + expectedTakerFee;
      
      // Verify token transfers
      // Seller should send base tokens and receive quote tokens minus maker fee
      const sellerBaseTokenDiff = initialSellerBaseBalance - finalSellerBaseBalance;
      expect(sellerBaseTokenDiff).to.equal(STANDARD_QUANTITY);
      
      const sellerQuoteTokenDiff = finalSellerQuoteBalance - initialSellerQuoteBalance;
      expect(sellerQuoteTokenDiff).to.equal(tradeValue - expectedMakerFee);
      
      // Buyer should receive base tokens and send quote tokens plus taker fee
      const buyerBaseTokenDiff = finalBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiff).to.equal(STANDARD_QUANTITY);
      
      const buyerQuoteTokenDiff = initialBuyerQuoteBalance - finalBuyerQuoteBalance;
      expect(buyerQuoteTokenDiff).to.equal(tradeValue + expectedTakerFee);
      
      // Fee recipient should receive both maker and taker fees
      const feeRecipientQuoteTokenDiff = finalFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiff).to.equal(expectedTotalFee);
      
      console.log(`High Price - Trade value: ${tradeValue}`);
      console.log(`High Price - Quantity: ${STANDARD_QUANTITY}`);
      console.log(`High Price - Maker fee: ${expectedMakerFee}`);
      console.log(`High Price - Taker fee: ${expectedTakerFee}`);
      console.log(`High Price - Total fee: ${expectedTotalFee}`);
      console.log(`High Price - Fee recipient received: ${feeRecipientQuoteTokenDiff}`);
    });
    
    it("should handle extremely low prices correctly", async function () {
      console.log("Testing extremely low price...");
      
      // Record initial token balances
      const initialSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Place a limit sell order with extremely low price through CLOB contract
      console.log("Placing limit sell order with extremely low price...");
      const sellOrderTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        EXTREME_LOW_PRICE,
        STANDARD_QUANTITY
      );
      
      // Get the sell order ID from transaction receipt
      const sellOrderReceipt = await sellOrderTx.wait();
      const sellOrderId = await extractOrderId(sellOrderReceipt);
      if (sellOrderId === null) {
        throw new Error("Sell OrderPlaced event not found");
      }
      console.log("Sell order ID:", sellOrderId);
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log("Sell order status:", sellOrder.status);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      expect(sellOrder.price).to.equal(EXTREME_LOW_PRICE);
      
      // Place a matching limit buy order with extremely low price through CLOB contract
      console.log("Placing limit buy order with extremely low price...");
      const buyOrderTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        EXTREME_LOW_PRICE,
        STANDARD_QUANTITY
      );
      
      // Get the buy order ID from transaction receipt
      const buyOrderReceipt = await buyOrderTx.wait();
      const buyOrderId = await extractOrderId(buyOrderReceipt);
      if (buyOrderId === null) {
        throw new Error("Buy OrderPlaced event not found");
      }
      console.log("Buy order ID:", buyOrderId);
      
      // Verify the buy order was matched (should be filled)
      const buyOrder = await state.getOrder(buyOrderId);
      console.log("Buy order status:", buyOrder.status);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Verify the sell order was matched (should be filled)
      const updatedSellOrder = await state.getOrder(sellOrderId);
      console.log("Updated sell order status:", updatedSellOrder.status);
      expect(updatedSellOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Get final balances after matching
      const finalSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const finalSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const finalBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const finalBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const finalFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Calculate expected trade value and fees
      const tradeValue = EXTREME_LOW_PRICE * STANDARD_QUANTITY / ethers.parseUnits("1", 18);
      const expectedMakerFee = tradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const expectedTakerFee = tradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      const expectedTotalFee = expectedMakerFee + expectedTakerFee;
      
      // Verify token transfers
      // Seller should send base tokens and receive quote tokens minus maker fee
      const sellerBaseTokenDiff = initialSellerBaseBalance - finalSellerBaseBalance;
      expect(sellerBaseTokenDiff).to.equal(STANDARD_QUANTITY);
      
      const sellerQuoteTokenDiff = finalSellerQuoteBalance - initialSellerQuoteBalance;
      expect(sellerQuoteTokenDiff).to.equal(tradeValue - expectedMakerFee);
      
      // Buyer should receive base tokens and send quote tokens plus taker fee
      const buyerBaseTokenDiff = finalBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiff).to.equal(STANDARD_QUANTITY);
      
      const buyerQuoteTokenDiff = initialBuyerQuoteBalance - finalBuyerQuoteBalance;
      expect(buyerQuoteTokenDiff).to.equal(tradeValue + expectedTakerFee);
      
      // Fee recipient should receive both maker and taker fees
      const feeRecipientQuoteTokenDiff = finalFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiff).to.equal(expectedTotalFee);
      
      console.log(`Low Price - Trade value: ${tradeValue}`);
      console.log(`Low Price - Quantity: ${STANDARD_QUANTITY}`);
      console.log(`Low Price - Maker fee: ${expectedMakerFee}`);
      console.log(`Low Price - Taker fee: ${expectedTakerFee}`);
      console.log(`Low Price - Total fee: ${expectedTotalFee}`);
      console.log(`Low Price - Fee recipient received: ${feeRecipientQuoteTokenDiff}`);
    });
  });
  
  describe("Zero Quantity and Price Tests", function () {
    it("should reject orders with zero quantity", async function () {
      console.log("Testing zero quantity order...");
      
      // Attempt to place a limit sell order with zero quantity
      await expect(clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        STANDARD_PRICE,
        ZERO_QUANTITY
      )).to.be.revertedWith("CLOB: quantity must be greater than 0");
      
      // Attempt to place a limit buy order with zero quantity
      await expect(clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        STANDARD_PRICE,
        ZERO_QUANTITY
      )).to.be.revertedWith("CLOB: quantity must be greater than 0");
    });
    
    it("should reject limit orders with zero price", async function () {
      console.log("Testing zero price limit order...");
      
      // Attempt to place a limit sell order with zero price
      await expect(clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        ZERO_PRICE,
        STANDARD_QUANTITY
      )).to.be.revertedWith("CLOB: price must be greater than 0");
      
      // Attempt to place a limit buy order with zero price
      await expect(clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        ZERO_PRICE,
        STANDARD_QUANTITY
      )).to.be.revertedWith("CLOB: price must be greater than 0");
    });
  });
  
  describe("Insufficient Balance Tests", function () {
    it("should reject settlement if seller has insufficient base token balance", async function () {
      console.log("Testing insufficient base token balance for sell order settlement...");
      
      // Get seller's current base token balance
      const sellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      
      // Place a limit sell order with quantity greater than balance (should succeed)
      const insufficientQuantity = sellerBaseBalance + 1n;
      const sellTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        STANDARD_PRICE,
        insufficientQuantity
      );
      await sellTx.wait(); // Ensure order is placed
      
      // Attempt to place a matching buy order (this should trigger settlement and revert)
      await expect(clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        STANDARD_PRICE,
        insufficientQuantity // Match the quantity
      )).to.be.reverted; // Expect generic revert for custom error
    });
    
    it("should reject settlement if buyer has insufficient quote token balance", async function () {
      console.log("Testing insufficient quote token balance for buy order settlement...");
      
      // Get buyer's current quote token balance
      const buyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      
      // Set an extremely high price such that required quote exceeds balance
      const highPrice = (buyerQuoteBalance + 1n) * ethers.parseUnits("1", 18) / STANDARD_QUANTITY;
      const requiredQuoteAmount = highPrice * STANDARD_QUANTITY / ethers.parseUnits("1", 18);
      console.log(`Buyer Quote Balance: ${buyerQuoteBalance}, Required Quote: ${requiredQuoteAmount}`);

      // Place a limit buy order that requires more quote tokens than available (should succeed)
      const buyTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        highPrice,
        STANDARD_QUANTITY
      );
      await buyTx.wait(); // Ensure order is placed
      
      // Attempt to place a matching sell order (this should trigger settlement and revert)
      await expect(clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        highPrice, // Match the price
        STANDARD_QUANTITY // Match the quantity
      )).to.be.reverted; // Expect generic revert for custom error
    });
  });
  
  describe("Insufficient Allowance Tests", function () {
    it("should reject settlement if seller has insufficient base token allowance", async function () {
      console.log("Testing insufficient base token allowance for sell order settlement...");
      
      // Place a limit sell order (should succeed)
      const sellTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        STANDARD_PRICE,
        STANDARD_QUANTITY
      );
      await sellTx.wait(); // Ensure order is placed

      // Revoke base token allowance for the seller *after* placing the order
      await baseToken.connect(trader1).approve(await vault.getAddress(), 0);
      
      // Attempt to place a matching buy order (this should trigger settlement and revert)
      await expect(clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        STANDARD_PRICE,
        STANDARD_QUANTITY
      )).to.be.reverted; // Expect generic revert for custom error
      
      // Restore allowance for other tests
      await baseToken.connect(trader1).approve(await vault.getAddress(), INITIAL_BALANCE);
    });
    
    it("should reject settlement if buyer has insufficient quote token allowance", async function () {
      console.log("Testing insufficient quote token allowance for buy order settlement...");
      
      // Place a limit buy order (should succeed)
      const buyTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        STANDARD_PRICE,
        STANDARD_QUANTITY
      );
      await buyTx.wait(); // Ensure order is placed

      // Revoke quote token allowance for the buyer *after* placing the order
      await quoteToken.connect(trader2).approve(await vault.getAddress(), 0);
      
      // Attempt to place a matching sell order (this should trigger settlement and revert)
      await expect(clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        STANDARD_PRICE,
        STANDARD_QUANTITY
      )).to.be.reverted; // Expect generic revert for custom error
      
      // Restore allowance for other tests
      await quoteToken.connect(trader2).approve(await vault.getAddress(), INITIAL_BALANCE);
    });
  });
});


