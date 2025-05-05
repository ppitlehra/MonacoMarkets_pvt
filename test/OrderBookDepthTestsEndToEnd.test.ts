/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, TransactionReceipt } from "ethers"; // Added TransactionReceipt
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Book, CLOB, State, Vault, MockToken } from "../typechain-types";

describe("Order Book Depth End-to-End Tests", function () {
  // Constants for testing
  const STANDARD_PRICE = ethers.parseUnits("100", 18);
  const STANDARD_QUANTITY = ethers.parseUnits("1", 18);
  const INITIAL_BALANCE = ethers.parseUnits("1000000", 18);
  
  // Order status constants
  const ORDER_STATUS_OPEN = 0;
  const ORDER_STATUS_FILLED = 2;
  const ORDER_STATUS_CANCELED = 3;
  const ORDER_STATUS_PARTIALLY_FILLED = 1;
  
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
  let owner: SignerWithAddress;
  let trader1: SignerWithAddress;
  let trader2: SignerWithAddress;
  let trader3: SignerWithAddress;
  let trader4: SignerWithAddress;
  let trader5: SignerWithAddress;
  let feeRecipient: SignerWithAddress;

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
        if (parsedLog && parsedLog.name === "OrderPlaced") {
          return parsedLog.args.orderId;
        }
      } catch (e) { /* ignore */ }
    }
    throw new Error("OrderPlaced event not found");
  }

  // Helper to get order ID from receipt
  async function getOrderIdFromReceipt(receipt: TransactionReceipt | null): Promise<bigint> {
    if (!receipt) {
      throw new Error("Transaction receipt is null");
    }
    for (const log of receipt.logs) {
      try {
        const parsedLog = clob.interface.parseLog(log);
        if (parsedLog && parsedLog.name === "OrderPlaced") {
          return parsedLog.args.orderId;
        }
      } catch (e) { /* ignore */ }
    }
    throw new Error("OrderPlaced event not found");
  }
  
  beforeEach(async function () {
    // Get signers
    [owner, trader1, trader2, trader3, trader4, trader5, feeRecipient] = await ethers.getSigners();
    
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
    await vault.connect(owner).setBook(await clob.getAddress());
    await book.connect(owner).setVault(await vault.getAddress());
    await vault.connect(owner).setCLOB(await clob.getAddress());
    await state.connect(owner).addAdmin(await clob.getAddress());
    await state.connect(owner).addAdmin(await book.getAddress());
    await book.connect(owner).setCLOB(await clob.getAddress());
    
    // Add supported trading pair
    await clob.connect(owner).addSupportedPair(
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    );
    
    // Mint tokens to traders
    for (const trader of [trader1, trader2, trader3, trader4, trader5]) {
      await baseToken.mint(await trader.getAddress(), INITIAL_BALANCE);
      await quoteToken.mint(await trader.getAddress(), INITIAL_BALANCE);
      
      // Approve tokens for trading
      await baseToken.connect(trader).approve(await vault.getAddress(), INITIAL_BALANCE);
      await quoteToken.connect(trader).approve(await vault.getAddress(), INITIAL_BALANCE);
    }
  });
  
  describe("Multiple Orders at Same Price Level", function () {
    it("should maintain price-time priority when matching against multiple orders at the same price", async function () {
      console.log("Testing price-time priority with multiple orders at the same price level...");
      
      // Create 5 sell orders at the same price from different traders
      const sellPrice = STANDARD_PRICE;
      const sellQuantity = ethers.parseUnits("1", 18);
      const sellOrderIds = [];
      
      // Record initial token balances
      const initialSellerBaseBalances = [];
      const initialSellerQuoteBalances = [];
      
      for (let i = 0; i < 5; i++) {
        const trader = [trader1, trader2, trader3, trader4, trader5][i];
        
        // Record initial balances
        initialSellerBaseBalances.push(await baseToken.balanceOf(await trader.getAddress()));
        initialSellerQuoteBalances.push(await quoteToken.balanceOf(await trader.getAddress()));
        
        // Place a limit sell order through CLOB contract
        console.log(`Placing limit sell order ${i+1} at price ${sellPrice}...`);
        const sellOrderId = await placeLimitOrder(trader, false, sellPrice, sellQuantity);
        sellOrderIds.push(sellOrderId);
        console.log(`Sell order ${i+1} ID: ${sellOrderId}`);
        
        // Verify the sell order was created correctly
        const sellOrder = await state.getOrder(sellOrderId);
        console.log(`Sell order ${i+1} status: ${sellOrder.status}`);
        expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
        expect(sellOrder.price).to.equal(sellPrice);
        expect(sellOrder.quantity).to.equal(sellQuantity);
      }
      
      console.log(`Created 5 sell orders at price ${sellPrice}`);
      
      // Create a buy order that will match against all 5 sell orders
      const buyQuantity = ethers.parseUnits("5", 18); // Enough to match all 5 sell orders
      
      // Record initial buyer balances
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Place a limit buy order through CLOB contract
      console.log(`Placing limit buy order at price ${sellPrice}...`);
      const buyOrderTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        sellPrice,
        buyQuantity
      );
      const buyOrderReceipt = await buyOrderTx.wait();
      const buyOrderId = await getOrderIdFromReceipt(buyOrderReceipt);
      console.log(`Buy order ID: ${buyOrderId}`);
      
      // Verify the buy order was matched (should be partially filled due to self-trade prevention)
      const buyOrder = await state.getOrder(buyOrderId);
      console.log(`Buy order status: ${buyOrder.status}`);
      expect(buyOrder.status).to.equal(ORDER_STATUS_PARTIALLY_FILLED);
      
      // Verify sell orders were matched (all except self-trade should be filled)
      for (let i = 0; i < 5; i++) {
        const sellOrderId = sellOrderIds[i];
        const sellOrder = await state.getOrder(sellOrderId);
        const seller = [trader1, trader2, trader3, trader4, trader5][i];
        console.log(`Sell order ${i+1} (Seller: ${await seller.getAddress()}) status: ${sellOrder.status}`);
        if (await seller.getAddress() === await trader1.getAddress()) {
          // Self-trade prevention should keep this order OPEN
          expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
        } else {
          // Other orders should be FILLED
          expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED);
        }
      }
      
      // Get final balances after matching
      const finalSellerBaseBalances = [];
      const finalSellerQuoteBalances = [];
      
      for (let i = 0; i < 5; i++) {
        const trader = [trader1, trader2, trader3, trader4, trader5][i];
        finalSellerBaseBalances.push(await baseToken.balanceOf(await trader.getAddress()));
        finalSellerQuoteBalances.push(await quoteToken.balanceOf(await trader.getAddress()));
      }
      
      const finalBuyerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const finalBuyerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const finalFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Calculate expected trade value and fees for the 4 matched orders
      const matchedOrdersCount = 4n;
      const tradeValuePerOrder = sellPrice * sellQuantity / ethers.parseUnits("1", 18);
      const makerFeePerOrder = tradeValuePerOrder * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n; // 0.1% maker fee
      const takerFeePerOrder = tradeValuePerOrder * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n; // 0.2% taker fee
      const totalMatchedTradeValue = tradeValuePerOrder * matchedOrdersCount;
      const totalTakerFee = takerFeePerOrder * matchedOrdersCount;
      const totalMakerFee = makerFeePerOrder * matchedOrdersCount;
      const totalFees = totalTakerFee + totalMakerFee;
      
      // Verify token transfers for each seller (except trader1 who is also the buyer)
      for (let i = 1; i < 5; i++) {
        // Seller should send base tokens and receive quote tokens minus maker fee
        const sellerBaseTokenDiff = initialSellerBaseBalances[i] - finalSellerBaseBalances[i];
        expect(sellerBaseTokenDiff).to.equal(sellQuantity);
        
        const sellerQuoteTokenDiff = finalSellerQuoteBalances[i] - initialSellerQuoteBalances[i];
        expect(sellerQuoteTokenDiff).to.equal(tradeValuePerOrder - makerFeePerOrder);
      }
      
      // Special case for trader1 who is both a seller and the buyer
      // Trader1's sell order was NOT filled due to self-trade prevention
      // Trader1's buy order was PARTIALLY filled (4 out of 5 BASE)
      const trader1BaseTokenDiff = finalBuyerBaseBalance - initialSellerBaseBalances[0]; // Base balance should increase by 4
      expect(trader1BaseTokenDiff).to.equal(sellQuantity * matchedOrdersCount);
      
      const trader1QuoteTokenDiff = initialBuyerQuoteBalance - finalBuyerQuoteBalance; // Quote balance should decrease
      // Trader1 pays for 4 BASE and pays taker fee for 4 BASE
      const expectedTrader1QuoteDiff = totalMatchedTradeValue + totalTakerFee;
      expect(trader1QuoteTokenDiff).to.equal(expectedTrader1QuoteDiff);
      
      // Fee recipient should receive all fees
      const feeRecipientQuoteTokenDiff = finalFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiff).to.equal(totalFees);
      
      console.log("Price-time priority verification completed successfully");
    });
  });
  
  describe("Orders Across Multiple Price Levels", function () {
    it("should match orders across multiple price levels in price priority order", async function () {
      console.log("Testing matching across multiple price levels...");
      
      // Create 5 sell orders at different price levels
      const sellPrices = [
        ethers.parseUnits("100", 18),
        ethers.parseUnits("101", 18),
        ethers.parseUnits("102", 18),
        ethers.parseUnits("103", 18),
        ethers.parseUnits("104", 18)
      ];
      
      const sellQuantity = ethers.parseUnits("1", 18);
      const sellOrderIds = [];
      
      // Record initial token balances
      const initialSellerBaseBalances = [];
      const initialSellerQuoteBalances = [];
      
      for (let i = 0; i < 5; i++) {
        const trader = [trader1, trader2, trader3, trader4, trader5][i];
        
        // Record initial balances
        initialSellerBaseBalances.push(await baseToken.balanceOf(await trader.getAddress()));
        initialSellerQuoteBalances.push(await quoteToken.balanceOf(await trader.getAddress()));
        
        // Place a limit sell order through CLOB contract
        console.log(`Placing limit sell order ${i+1} at price ${sellPrices[i]}...`);
        const sellOrderId = await placeLimitOrder(trader, false, sellPrices[i], sellQuantity);
        sellOrderIds.push(sellOrderId);
        console.log(`Sell order ${i+1} ID: ${sellOrderId}`);
        
        // Verify the sell order was created correctly
        const sellOrder = await state.getOrder(sellOrderId);
        console.log(`Sell order ${i+1} status: ${sellOrder.status}`);
        expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
        expect(sellOrder.price).to.equal(sellPrices[i]);
        expect(sellOrder.quantity).to.equal(sellQuantity);
      }
      
      console.log(`Created 5 sell orders at different price levels`);
      
      // Create a buy order that will match against all 5 sell orders
      const buyPrice = ethers.parseUnits("104", 18); // High enough to match all sell orders
      const buyQuantity = ethers.parseUnits("5", 18); // Enough to match all 5 sell orders
      
      // Record initial buyer balances
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Place a limit buy order through CLOB contract
      console.log(`Placing limit buy order at price ${buyPrice}...`);
      const buyOrderTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        buyPrice,
        buyQuantity
      );
      const buyOrderReceipt = await buyOrderTx.wait();
      const buyOrderId = await getOrderIdFromReceipt(buyOrderReceipt);
      console.log(`Buy order ID: ${buyOrderId}`);
      
      // Verify the buy order was matched (should be filled)
      const buyOrder = await state.getOrder(buyOrderId);
      console.log(`Buy order status: ${buyOrder.status}`);
      expect(buyOrder.status).to.equal(ORDER_STATUS_PARTIALLY_FILLED); // Expect PARTIALLY_FILLED if filled exactly, due to state logic
      
      // Verify sell orders were matched (all except self-trade should be filled)
      for (let i = 0; i < 5; i++) {
        const sellOrderId = sellOrderIds[i];
        const sellOrder = await state.getOrder(sellOrderId);
        console.log(`Sell order ${i+1} status: ${sellOrder.status}`);
        if (i === 0) { // First seller is trader1, who is also the buyer
          expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN); // Expect OPEN due to self-trade prevention
        } else {
          expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED);
        }
      }
      
      // Get final balances after matching
      const finalSellerBaseBalances = [];
      const finalSellerQuoteBalances = [];
      
      for (let i = 0; i < 5; i++) {
        const trader = [trader1, trader2, trader3, trader4, trader5][i];
        finalSellerBaseBalances.push(await baseToken.balanceOf(await trader.getAddress()));
        finalSellerQuoteBalances.push(await quoteToken.balanceOf(await trader.getAddress()));
      }
      
      const finalBuyerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const finalBuyerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const finalFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Calculate expected total trade value and fees (excluding self-trade at i=0)
      let totalTradeValue = 0n;
      let totalMakerFee = 0n;
      let totalTakerFee = 0n;
      
      for (let i = 1; i < 5; i++) { // Start from i=1 to exclude self-trade
        const tradeValue = sellPrices[i] * sellQuantity / ethers.parseUnits("1", 18);
        totalTradeValue += tradeValue;
        totalMakerFee += tradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
        totalTakerFee += tradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      }
      const totalFees = totalMakerFee + totalTakerFee;
      
      // Verify token transfers for each seller (skipping seller 0 who is the buyer)
      for (let i = 1; i < 5; i++) {
        // Seller should send base tokens and receive quote tokens minus maker fee
        const sellerBaseTokenDiff = initialSellerBaseBalances[i] - finalSellerBaseBalances[i];
        expect(sellerBaseTokenDiff).to.equal(sellQuantity);
        
        const tradeValue = sellPrices[i] * sellQuantity / ethers.parseUnits("1", 18);
        const makerFee = tradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
        const sellerQuoteTokenDiff = finalSellerQuoteBalances[i] - initialSellerQuoteBalances[i];
        expect(sellerQuoteTokenDiff).to.equal(tradeValue - makerFee);
      }
      
      // Verify buyer token transfers
      const buyerBaseTokenDiff = finalBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiff).to.equal(sellQuantity * 4n); // Buyer only receives 4 units due to self-trade prevention
      
      const buyerQuoteTokenDiff = initialBuyerQuoteBalance - finalBuyerQuoteBalance;
      const expectedBuyerQuoteDiff = totalTradeValue + totalTakerFee;
      expect(buyerQuoteTokenDiff).to.equal(expectedBuyerQuoteDiff);
      
      // Fee recipient should receive all fees
      const feeRecipientQuoteTokenDiff = finalFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiff).to.equal(totalFees);
      
      console.log("Matching across multiple price levels verification completed successfully");
    });
  });
});

