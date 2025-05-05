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

describe("Precision and Rounding End-to-End Tests", function () {
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
  let book6_18: Book; // Book for token6/token18 pair
  let book8_18: Book; // Book for token8/token18 pair
  
  // Tokens with different decimals
  let token6: MockToken;  // 6 decimals (like USDC)
  let token8: MockToken;  // 8 decimals (like WBTC)
  let token18: MockToken; // 18 decimals (like most ERC20s)
  
  // Signers
  let owner: SignerWithAddress;
  let trader1: SignerWithAddress;
  let trader2: SignerWithAddress;
  let feeRecipient: SignerWithAddress;

  // Helper to place a limit order and return its ID
  async function placeLimitOrder(trader: Signer, baseAddr: string, quoteAddr: string, isBuy: boolean, price: bigint, quantity: bigint): Promise<bigint> {
    const tx = await clob.connect(trader).placeLimitOrder(baseAddr, quoteAddr, isBuy, price, quantity);
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
    [owner, trader1, trader2, feeRecipient] = await ethers.getSigners();
    
    // Deploy mock tokens with different decimals
    const TokenFactory = await ethers.getContractFactory("MockToken");
    token6 = (await TokenFactory.deploy("USDC Mock", "USDC", 6)) as unknown as MockToken;
    token8 = (await TokenFactory.deploy("WBTC Mock", "WBTC", 8)) as unknown as MockToken;
    token18 = (await TokenFactory.deploy("ETH Mock", "ETH", 18)) as unknown as MockToken;
    
    // Deploy State contract
    const StateFactory = await ethers.getContractFactory("State");
    state = (await StateFactory.deploy(await owner.getAddress())) as unknown as State;
    
    // Deploy Book contract for token6/token18 pair
    const BookFactory = await ethers.getContractFactory("Book");
    book6_18 = (await BookFactory.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await token6.getAddress(),
      await token18.getAddress()
    )) as unknown as Book;
    
    // Deploy Book contract for token8/token18 pair
    book8_18 = (await BookFactory.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await token8.getAddress(),
      await token18.getAddress()
    )) as unknown as Book;
    
    // Deploy Vault contract
    const VaultFactory = await ethers.getContractFactory("Vault");
    vault = (await VaultFactory.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await feeRecipient.getAddress(),
      DEFAULT_MAKER_FEE_RATE,
      DEFAULT_TAKER_FEE_RATE
    )) as unknown as Vault;
    
    // Deploy CLOB contract
    const CLOBFactory = await ethers.getContractFactory("CLOB");
    clob = (await CLOBFactory.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await book6_18.getAddress(), // Initially set to book6_18, will be updated for each test
      await vault.getAddress()
    )) as unknown as CLOB;
    
    // Set up proper contract relationships for end-to-end testing
    await vault.connect(owner).setBook(await clob.getAddress());
    await book6_18.connect(owner).setVault(await vault.getAddress());
    await book8_18.connect(owner).setVault(await vault.getAddress());
    await vault.connect(owner).setCLOB(await clob.getAddress());
    await state.connect(owner).addAdmin(await clob.getAddress());
    await state.connect(owner).addAdmin(await book6_18.getAddress());
    await state.connect(owner).addAdmin(await book8_18.getAddress());
    await book6_18.connect(owner).setCLOB(await clob.getAddress());
    await book8_18.connect(owner).setCLOB(await clob.getAddress());
    
    // Add supported trading pairs
    await clob.connect(owner).addSupportedPair(
      await token6.getAddress(),
      await token18.getAddress()
    );
    
    await clob.connect(owner).addSupportedPair(
      await token8.getAddress(),
      await token18.getAddress()
    );
    
    // Mint tokens to traders
    await token6.mint(await trader1.getAddress(), ethers.parseUnits("1000000", 6));
    await token6.mint(await trader2.getAddress(), ethers.parseUnits("1000000", 6));
    await token8.mint(await trader1.getAddress(), ethers.parseUnits("1000000", 8));
    await token8.mint(await trader2.getAddress(), ethers.parseUnits("1000000", 8));
    await token18.mint(await trader1.getAddress(), ethers.parseUnits("1000000", 18));
    await token18.mint(await trader2.getAddress(), ethers.parseUnits("1000000", 18));
    
    // Approve tokens for trading
    await token6.connect(trader1).approve(await vault.getAddress(), ethers.parseUnits("1000000", 6));
    await token6.connect(trader2).approve(await vault.getAddress(), ethers.parseUnits("1000000", 6));
    await token8.connect(trader1).approve(await vault.getAddress(), ethers.parseUnits("1000000", 8));
    await token8.connect(trader2).approve(await vault.getAddress(), ethers.parseUnits("1000000", 8));
    await token18.connect(trader1).approve(await vault.getAddress(), ethers.parseUnits("1000000", 18));
    await token18.connect(trader2).approve(await vault.getAddress(), ethers.parseUnits("1000000", 18));
  });
  
  describe("Different Token Decimal Tests", function () {
    it("should handle trading between tokens with 6 and 18 decimals", async function () {
      console.log("Testing trading between tokens with 6 and 18 decimals...");
      
      // Update CLOB to use the book6_18 for this test
      await clob.connect(owner).setBook(await book6_18.getAddress());
      await vault.connect(owner).setBook(await clob.getAddress());
      
      const baseAddr = await token6.getAddress();
      const quoteAddr = await token18.getAddress();

      // Create a sell order for token6/token18 pair
      const sellPrice = ethers.parseUnits("0.0005", 18); // 0.0005 ETH per USDC
      const sellQuantity = ethers.parseUnits("1000", 6); // 1000 USDC
      
      // Record initial balances
      const initialSeller6Balance = await token6.balanceOf(await trader1.getAddress());
      const initialSeller18Balance = await token18.balanceOf(await trader1.getAddress());
      const initialBuyer6Balance = await token6.balanceOf(await trader2.getAddress());
      const initialBuyer18Balance = await token18.balanceOf(await trader2.getAddress());
      const initialFeeRecipient18Balance = await token18.balanceOf(await feeRecipient.getAddress());
      
      console.log(`Initial seller token6 (USDC) balance: ${initialSeller6Balance}`);
      console.log(`Initial seller token18 (ETH) balance: ${initialSeller18Balance}`);
      console.log(`Initial buyer token6 (USDC) balance: ${initialBuyer6Balance}`);
      console.log(`Initial buyer token18 (ETH) balance: ${initialBuyer18Balance}`);
      
      // Place a limit sell order through CLOB contract
      console.log(`Placing limit sell order for ${sellQuantity} token6 (USDC) at price ${sellPrice} token18 (ETH)...`);
      const sellOrderId = await placeLimitOrder(trader1, baseAddr, quoteAddr, false, sellPrice, sellQuantity);
      console.log(`Sell order ID: ${sellOrderId}`);
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log(`Sell order status: ${sellOrder.status}`);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      expect(sellOrder.price).to.equal(sellPrice);
      expect(sellOrder.quantity).to.equal(sellQuantity);
      
      // Calculate the expected trade value in token18 (ETH)
      const expectedTradeValue = sellPrice * sellQuantity / ethers.parseUnits("1", 6);
      console.log(`Expected trade value: ${expectedTradeValue} token18 (ETH)`);
      
      // Place a limit buy order through CLOB contract
      console.log(`Placing limit buy order for ${sellQuantity} token6 (USDC) at price ${sellPrice} token18 (ETH)...`);
      const buyOrderId = await placeLimitOrder(trader2, baseAddr, quoteAddr, true, sellPrice, sellQuantity);
      console.log(`Buy order ID: ${buyOrderId}`);
      
      // Verify the buy order was matched (should be filled)
      const buyOrder = await state.getOrder(buyOrderId);
      console.log(`Buy order status: ${buyOrder.status}`);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Verify the sell order was matched (should be filled)
      const updatedSellOrder = await state.getOrder(sellOrderId);
      console.log(`Updated sell order status: ${updatedSellOrder.status}`);
      expect(updatedSellOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Calculate fees
      const makerFee = expectedTradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const takerFee = expectedTradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      
      console.log(`Maker fee: ${makerFee} token18 (ETH)`);
      console.log(`Taker fee: ${takerFee} token18 (ETH)`);
      
      // Get final balances
      const finalSeller6Balance = await token6.balanceOf(await trader1.getAddress());
      const finalSeller18Balance = await token18.balanceOf(await trader1.getAddress());
      const finalBuyer6Balance = await token6.balanceOf(await trader2.getAddress());
      const finalBuyer18Balance = await token18.balanceOf(await trader2.getAddress());
      const finalFeeRecipient18Balance = await token18.balanceOf(await feeRecipient.getAddress());
      
      console.log(`Final seller token6 (USDC) balance: ${finalSeller6Balance}`);
      console.log(`Final seller token18 (ETH) balance: ${finalSeller18Balance}`);
      console.log(`Final buyer token6 (USDC) balance: ${finalBuyer6Balance}`);
      console.log(`Final buyer token18 (ETH) balance: ${finalBuyer18Balance}`);
      
      // Verify token transfers
      const seller6Diff = initialSeller6Balance - finalSeller6Balance;
      expect(seller6Diff).to.equal(sellQuantity);
      
      const seller18Diff = finalSeller18Balance - initialSeller18Balance;
      console.log(`Seller token18 (ETH) balance difference: ${seller18Diff}`);
      expect(seller18Diff).to.be.closeTo(expectedTradeValue - makerFee, 1); // Allow 1 wei difference for rounding
      
      const buyer6Diff = finalBuyer6Balance - initialBuyer6Balance;
      expect(buyer6Diff).to.equal(sellQuantity);
      
      const buyer18Diff = initialBuyer18Balance - finalBuyer18Balance;
      console.log(`Buyer token18 (ETH) balance difference: ${buyer18Diff}`);
      expect(buyer18Diff).to.be.closeTo(expectedTradeValue + takerFee, 1); // Allow 1 wei difference for rounding
      
      const feeRecipient18Diff = finalFeeRecipient18Balance - initialFeeRecipient18Balance;
      console.log(`Fee recipient token18 (ETH) balance difference: ${feeRecipient18Diff}`);
      expect(feeRecipient18Diff).to.be.closeTo(makerFee + takerFee, 1); // Allow 1 wei difference for rounding
      
      console.log("Token6 (USDC) and token18 (ETH) trading test completed successfully");
    });
    
    it("should handle trading between tokens with 8 and 18 decimals", async function () {
      console.log("Testing trading between tokens with 8 and 18 decimals...");
      
      // Update CLOB to use the book8_18 for this test
      await clob.connect(owner).setBook(await book8_18.getAddress());
      await vault.connect(owner).setBook(await clob.getAddress());

      const baseAddr = await token8.getAddress();
      const quoteAddr = await token18.getAddress();
      
      // Create a sell order for token8/token18 pair
      const sellPrice = ethers.parseUnits("15", 18); // 15 ETH per WBTC
      const sellQuantity = ethers.parseUnits("0.5", 8); // 0.5 WBTC
      
      // Record initial balances
      const initialSeller8Balance = await token8.balanceOf(await trader1.getAddress());
      const initialSeller18Balance = await token18.balanceOf(await trader1.getAddress());
      const initialBuyer8Balance = await token8.balanceOf(await trader2.getAddress());
      const initialBuyer18Balance = await token18.balanceOf(await trader2.getAddress());
      const initialFeeRecipient18Balance = await token18.balanceOf(await feeRecipient.getAddress());
      
      console.log(`Initial seller token8 (WBTC) balance: ${initialSeller8Balance}`);
      console.log(`Initial seller token18 (ETH) balance: ${initialSeller18Balance}`);
      console.log(`Initial buyer token8 (WBTC) balance: ${initialBuyer8Balance}`);
      console.log(`Initial buyer token18 (ETH) balance: ${initialBuyer18Balance}`);
      
      // Place a limit sell order through CLOB contract
      console.log(`Placing limit sell order for ${sellQuantity} token8 (WBTC) at price ${sellPrice} token18 (ETH)...`);
      const sellOrderId = await placeLimitOrder(trader1, baseAddr, quoteAddr, false, sellPrice, sellQuantity);
      console.log(`Sell order ID: ${sellOrderId}`);
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log(`Sell order status: ${sellOrder.status}`);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      expect(sellOrder.price).to.equal(sellPrice);
      expect(sellOrder.quantity).to.equal(sellQuantity);
      
      // Calculate the expected trade value in token18 (ETH)
      const expectedTradeValue = sellPrice * sellQuantity / ethers.parseUnits("1", 8);
      console.log(`Expected trade value: ${expectedTradeValue} token18 (ETH)`);
      
      // Place a limit buy order through CLOB contract
      console.log(`Placing limit buy order for ${sellQuantity} token8 (WBTC) at price ${sellPrice} token18 (ETH)...`);
      const buyOrderId = await placeLimitOrder(trader2, baseAddr, quoteAddr, true, sellPrice, sellQuantity);
      console.log(`Buy order ID: ${buyOrderId}`);
      
      // Verify the buy order was matched (should be filled)
      const buyOrder = await state.getOrder(buyOrderId);
      console.log(`Buy order status: ${buyOrder.status}`);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Verify the sell order was matched (should be filled)
      const updatedSellOrder = await state.getOrder(sellOrderId);
      console.log(`Updated sell order status: ${updatedSellOrder.status}`);
      expect(updatedSellOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Calculate fees
      const makerFee = expectedTradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const takerFee = expectedTradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      
      console.log(`Maker fee: ${makerFee} token18 (ETH)`);
      console.log(`Taker fee: ${takerFee} token18 (ETH)`);
      
      // Get final balances
      const finalSeller8Balance = await token8.balanceOf(await trader1.getAddress());
      const finalSeller18Balance = await token18.balanceOf(await trader1.getAddress());
      const finalBuyer8Balance = await token8.balanceOf(await trader2.getAddress());
      const finalBuyer18Balance = await token18.balanceOf(await trader2.getAddress());
      const finalFeeRecipient18Balance = await token18.balanceOf(await feeRecipient.getAddress());
      
      console.log(`Final seller token8 (WBTC) balance: ${finalSeller8Balance}`);
      console.log(`Final seller token18 (ETH) balance: ${finalSeller18Balance}`);
      console.log(`Final buyer token8 (WBTC) balance: ${finalBuyer8Balance}`);
      console.log(`Final buyer token18 (ETH) balance: ${finalBuyer18Balance}`);
      
      // Verify token transfers
      const seller8Diff = initialSeller8Balance - finalSeller8Balance;
      expect(seller8Diff).to.equal(sellQuantity);
      
      const seller18Diff = finalSeller18Balance - initialSeller18Balance;
      console.log(`Seller token18 (ETH) balance difference: ${seller18Diff}`);
      expect(seller18Diff).to.be.closeTo(expectedTradeValue - makerFee, 1);
      
      const buyer8Diff = finalBuyer8Balance - initialBuyer8Balance;
      expect(buyer8Diff).to.equal(sellQuantity);
      
      const buyer18Diff = initialBuyer18Balance - finalBuyer18Balance;
      console.log(`Buyer token18 (ETH) balance difference: ${buyer18Diff}`);
      expect(buyer18Diff).to.be.closeTo(expectedTradeValue + takerFee, 1);
      
      const feeRecipient18Diff = finalFeeRecipient18Balance - initialFeeRecipient18Balance;
      console.log(`Fee recipient token18 (ETH) balance difference: ${feeRecipient18Diff}`);
      expect(feeRecipient18Diff).to.be.closeTo(makerFee + takerFee, 1);
      
      console.log("Token8 (WBTC) and token18 (ETH) trading test completed successfully");
    });
  });

  describe("Precision Edge Cases", function () {
    it("should handle trades with very small quantities", async function () {
      console.log("Testing trades with very small quantities...");
      
      // Use token6/token18 pair
      await clob.connect(owner).setBook(await book6_18.getAddress());
      await vault.connect(owner).setBook(await clob.getAddress());

      const baseAddr = await token6.getAddress();
      const quoteAddr = await token18.getAddress();

      // Price: 0.0005 ETH per USDC
      const price = ethers.parseUnits("0.0005", 18);
      // Quantity: 1 smallest unit of USDC (10^-6)
      const quantity = 1n; 
      
      // Record initial balances
      const initialSeller6Balance = await token6.balanceOf(await trader1.getAddress());
      const initialSeller18Balance = await token18.balanceOf(await trader1.getAddress());
      const initialBuyer6Balance = await token6.balanceOf(await trader2.getAddress());
      const initialBuyer18Balance = await token18.balanceOf(await trader2.getAddress());
      const initialFeeRecipient18Balance = await token18.balanceOf(await feeRecipient.getAddress());

      // Place limit sell order
      const sellOrderId = await placeLimitOrder(trader1, baseAddr, quoteAddr, false, price, quantity);

      // Calculate expected trade value (should be very small, potentially 0 after rounding)
      const expectedTradeValue = price * quantity / ethers.parseUnits("1", 6);
      console.log(`Expected trade value (wei): ${expectedTradeValue}`);

      // Place matching limit buy order
      const buyOrderId = await placeLimitOrder(trader2, baseAddr, quoteAddr, true, price, quantity);

      // Verify order statuses
      const sellOrder = await state.getOrder(sellOrderId);
      const buyOrder = await state.getOrder(buyOrderId);
      expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);

      // Calculate fees (likely 0)
      const makerFee = expectedTradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const takerFee = expectedTradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      console.log(`Maker fee (wei): ${makerFee}`);
      console.log(`Taker fee (wei): ${takerFee}`);

      // Get final balances
      const finalSeller6Balance = await token6.balanceOf(await trader1.getAddress());
      const finalSeller18Balance = await token18.balanceOf(await trader1.getAddress());
      const finalBuyer6Balance = await token6.balanceOf(await trader2.getAddress());
      const finalBuyer18Balance = await token18.balanceOf(await trader2.getAddress());
      const finalFeeRecipient18Balance = await token18.balanceOf(await feeRecipient.getAddress());

      // Verify token transfers
      const seller6Diff = initialSeller6Balance - finalSeller6Balance;
      expect(seller6Diff).to.equal(quantity);

      const seller18Diff = finalSeller18Balance - initialSeller18Balance;
      expect(seller18Diff).to.equal(expectedTradeValue - makerFee);

      const buyer6Diff = finalBuyer6Balance - initialBuyer6Balance;
      expect(buyer6Diff).to.equal(quantity);

      const buyer18Diff = initialBuyer18Balance - finalBuyer18Balance;
      expect(buyer18Diff).to.equal(expectedTradeValue + takerFee);

      const feeRecipient18Diff = finalFeeRecipient18Balance - initialFeeRecipient18Balance;
      expect(feeRecipient18Diff).to.equal(makerFee + takerFee);

      console.log("Small quantity trade test completed successfully");
    });

    it("should handle trades with very low prices", async function () {
      console.log("Testing trades with very low prices...");
      
      // Use token6/token18 pair
      await clob.connect(owner).setBook(await book6_18.getAddress());
      await vault.connect(owner).setBook(await clob.getAddress());

      const baseAddr = await token6.getAddress();
      const quoteAddr = await token18.getAddress();

      // Price: 1 wei (10^-18) ETH per USDC
      const price = 1n; 
      // Quantity: 1000 USDC (1000 * 10^6)
      const quantity = ethers.parseUnits("1000", 6);
      
      // Record initial balances
      const initialSeller6Balance = await token6.balanceOf(await trader1.getAddress());
      const initialSeller18Balance = await token18.balanceOf(await trader1.getAddress());
      const initialBuyer6Balance = await token6.balanceOf(await trader2.getAddress());
      const initialBuyer18Balance = await token18.balanceOf(await trader2.getAddress());
      const initialFeeRecipient18Balance = await token18.balanceOf(await feeRecipient.getAddress());

      // Place limit sell order
      const sellOrderId = await placeLimitOrder(trader1, baseAddr, quoteAddr, false, price, quantity);

      // Calculate expected trade value (should be small)
      const expectedTradeValue = price * quantity / ethers.parseUnits("1", 6);
      console.log(`Expected trade value (wei): ${expectedTradeValue}`);

      // Place matching limit buy order
      const buyOrderId = await placeLimitOrder(trader2, baseAddr, quoteAddr, true, price, quantity);

      // Verify order statuses
      const sellOrder = await state.getOrder(sellOrderId);
      const buyOrder = await state.getOrder(buyOrderId);
      expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);

      // Calculate fees (likely 0)
      const makerFee = expectedTradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const takerFee = expectedTradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      console.log(`Maker fee (wei): ${makerFee}`);
      console.log(`Taker fee (wei): ${takerFee}`);

      // Get final balances
      const finalSeller6Balance = await token6.balanceOf(await trader1.getAddress());
      const finalSeller18Balance = await token18.balanceOf(await trader1.getAddress());
      const finalBuyer6Balance = await token6.balanceOf(await trader2.getAddress());
      const finalBuyer18Balance = await token18.balanceOf(await trader2.getAddress());
      const finalFeeRecipient18Balance = await token18.balanceOf(await feeRecipient.getAddress());

      // Verify token transfers
      const seller6Diff = initialSeller6Balance - finalSeller6Balance;
      expect(seller6Diff).to.equal(quantity);

      const seller18Diff = finalSeller18Balance - initialSeller18Balance;
      expect(seller18Diff).to.equal(expectedTradeValue - makerFee);

      const buyer6Diff = finalBuyer6Balance - initialBuyer6Balance;
      expect(buyer6Diff).to.equal(quantity);

      const buyer18Diff = initialBuyer18Balance - finalBuyer18Balance;
      expect(buyer18Diff).to.equal(expectedTradeValue + takerFee);

      const feeRecipient18Diff = finalFeeRecipient18Balance - initialFeeRecipient18Balance;
      expect(feeRecipient18Diff).to.equal(makerFee + takerFee);

      console.log("Low price trade test completed successfully");
    });
  });
});

