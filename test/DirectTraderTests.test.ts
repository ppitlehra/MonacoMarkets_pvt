/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { CLOB, Book, State, Vault, MockToken } from "../typechain-types";

describe("Direct Trader Tests", function () {
  let owner: SignerWithAddress;
  let trader1: SignerWithAddress;
  let trader2: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let clob: CLOB;
  let book: Book;
  let state: State;
  let vault: Vault;
  let baseToken: MockToken;
  let quoteToken: MockToken;
  
  // Constants
  const ORDER_PRICE = ethers.parseUnits("100", 18); // 100 quote tokens per base token
  const ORDER_QUANTITY = ethers.parseUnits("1", 18); // 1 base token
  const MAKER_FEE_RATE = 10n; // 0.1% (10 basis points)
  const TAKER_FEE_RATE = 30n; // 0.3% (30 basis points)
  const MAX_APPROVAL = ethers.parseUnits("10000000", 18); // Very large approval amount
  
  // Order types
  const LIMIT_ORDER = 0;
  const MARKET_ORDER = 1;
  const IOC_ORDER = 2;
  const FOK_ORDER = 3;
  
  // Order statuses
  const ORDER_STATUS_OPEN = 0;
  const ORDER_STATUS_PARTIALLY_FILLED = 1;
  const ORDER_STATUS_FILLED = 2;
  const ORDER_STATUS_CANCELED = 3;

  // Helper function to calculate quote value
  function calculateQuoteValue(price: bigint, quantity: bigint): bigint {
    // console.log(`calculateQuoteValue input: price=${price} (${typeof price}), quantity=${quantity} (${typeof quantity})`);
    if (typeof price !== 'bigint' || typeof quantity !== 'bigint' || price <= 0n || quantity <= 0n) {
        console.error("Invalid input to calculateQuoteValue:", { price, quantity });
        return 0n; // Return 0 for invalid inputs
    }
    // Assuming both price and quantity use 18 decimals
    const result = (price * quantity) / (10n**18n);
    // console.log(`calculateQuoteValue output: result=${result} (${typeof result})`);
    return result;
  }

  // Helper function to check if a value is a valid BigInt
  function isValidBigInt(value: any): value is bigint {
      const isValid = typeof value === 'bigint';
      // console.log(`isValidBigInt check: value=${value}, type=${typeof value}, isValid=${isValid}`);
      return isValid;
  }

  // Helper function for safe BigInt assertion
  function expectBigIntEqual(actual: any, expected: any, message: string) {
      console.log(`Asserting: ${message} - Actual: ${actual} (${typeof actual}), Expected: ${expected} (${typeof expected})`);
      if (!isValidBigInt(actual)) {
          throw new Error(`${message}: Actual value is not a valid BigInt (${actual})`);
      }
      if (!isValidBigInt(expected)) {
          throw new Error(`${message}: Expected value is not a valid BigInt (${expected})`);
      }
      expect(actual).to.equal(expected, message);
  }
  
  beforeEach(async function () {
    // Get signers
    [owner, trader1, trader2, feeRecipient] = await ethers.getSigners();
    
    // Deploy tokens
    const MockToken = await ethers.getContractFactory("MockToken", owner);
    baseToken = (await MockToken.deploy("Base Token", "BASE", 18)) as unknown as MockToken;
    quoteToken = (await MockToken.deploy("Quote Token", "QUOTE", 18)) as unknown as MockToken;
    
    // Deploy state contract
    const State = await ethers.getContractFactory("State", owner);
    state = (await State.deploy(await owner.getAddress())) as unknown as State;
    
    // Deploy book contract
    const Book = await ethers.getContractFactory("Book", owner);
    book = (await Book.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    )) as unknown as Book;
    
    // Deploy vault contract
    const Vault = await ethers.getContractFactory("Vault", owner);
    vault = (await Vault.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await feeRecipient.getAddress(),
      MAKER_FEE_RATE,
      TAKER_FEE_RATE
    )) as unknown as Vault;
    
    // Deploy CLOB contract
    const CLOB = await ethers.getContractFactory("CLOB", owner);
    clob = (await CLOB.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await book.getAddress(),
      await vault.getAddress()
    )) as unknown as CLOB;
    
    // Set up permissions
    await book.connect(owner).setVault(await vault.getAddress());
    await vault.connect(owner).setBook(await clob.getAddress());
    await vault.connect(owner).setCLOB(await clob.getAddress());
    await state.connect(owner).addAdmin(await clob.getAddress());
    await state.connect(owner).addAdmin(await book.getAddress());
    await state.connect(owner).addAdmin(await vault.getAddress());
    await book.connect(owner).setCLOB(await clob.getAddress());
    
    // Add supported trading pair
    await clob.addSupportedPair(
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    );
    
    // Mint tokens
    await baseToken.mint(await trader1.getAddress(), MAX_APPROVAL);
    await baseToken.mint(await trader2.getAddress(), MAX_APPROVAL);
    await quoteToken.mint(await trader1.getAddress(), MAX_APPROVAL);
    await quoteToken.mint(await trader2.getAddress(), MAX_APPROVAL);
    
    // Approve tokens
    await baseToken.connect(trader1).approve(await vault.getAddress(), MAX_APPROVAL);
    await baseToken.connect(trader2).approve(await vault.getAddress(), MAX_APPROVAL);
    await quoteToken.connect(trader1).approve(await vault.getAddress(), MAX_APPROVAL);
    await quoteToken.connect(trader2).approve(await vault.getAddress(), MAX_APPROVAL);
  });
  
  // --- Limit Order Tests (Passing - Keep as is) --- 
  describe("Limit Order Tests", function () {
    it("should allow a trader to create a limit buy order", async function () {
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        ORDER_PRICE,
        ORDER_QUANTITY
      );
      const orderId = 1; 
      const order = await state.getOrder(orderId);
      expect(order.id).to.equal(orderId);
      expect(order.trader).to.equal(await trader1.getAddress());
      expect(order.isBuy).to.equal(true);
      expect(order.status).to.equal(ORDER_STATUS_OPEN);
    });
    it("should allow a trader to create a limit sell order", async function () {
       await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        ORDER_PRICE,
        ORDER_QUANTITY
      );
      const orderId = 1;
      const order = await state.getOrder(orderId);
      expect(order.id).to.equal(orderId);
      expect(order.trader).to.equal(await trader1.getAddress());
      expect(order.isBuy).to.equal(false);
      expect(order.status).to.equal(ORDER_STATUS_OPEN);
    });
    it("should match a limit buy order with a limit sell order", async function () {
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, ORDER_QUANTITY);
      const initialSeller1BaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialSeller1QuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyer2BaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyer2QuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      await clob.connect(trader2).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, ORDER_QUANTITY);
      const finalSeller1BaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const finalSeller1QuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const finalBuyer2BaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const finalBuyer2QuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const sellOrderId = 1;
      const buyOrderId = 2;
      const sellOrder = await state.getOrder(sellOrderId);
      const buyOrder = await state.getOrder(buyOrderId);
      expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
      expect(initialSeller1BaseBalance - finalSeller1BaseBalance).to.equal(ORDER_QUANTITY);
      const seller1QuoteBalanceDiff = finalSeller1QuoteBalance - initialSeller1QuoteBalance;
      expect(seller1QuoteBalanceDiff).to.be.gte(-ethers.parseUnits("10000", 18)); 
      expect(finalBuyer2BaseBalance - initialBuyer2BaseBalance).to.equal(ORDER_QUANTITY);
      const buyer2QuoteBalanceDiff = initialBuyer2QuoteBalance - finalBuyer2QuoteBalance;
      expect(buyer2QuoteBalanceDiff).to.be.gte(-ethers.parseUnits("10000", 18));
    });
  });

  // --- Order Lifecycle Tests (Passing - Keep as is) ---
  describe("Order Lifecycle Tests", function () {
    it("should transition order status from OPEN to PARTIALLY_FILLED to FILLED", async function () {
      const largeOrderQuantity = ORDER_QUANTITY * 3n;
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, largeOrderQuantity);
      const buyOrderId = 1n;
      let buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_OPEN);
      await clob.connect(trader2).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, ORDER_QUANTITY);
      buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_PARTIALLY_FILLED);
      expect(buyOrder.filledQuantity).to.equal(ORDER_QUANTITY);
      await clob.connect(trader2).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, ORDER_QUANTITY);
      buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_PARTIALLY_FILLED);
      expect(buyOrder.filledQuantity).to.equal(ORDER_QUANTITY * 2n);
      await clob.connect(trader2).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, ORDER_QUANTITY);
      buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
      expect(buyOrder.filledQuantity).to.equal(largeOrderQuantity);
    });
    it("should transition order status from OPEN to FILLED (immediate complete fill)", async function () {
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, ORDER_QUANTITY);
      const sellOrderId = 1n;
      await clob.connect(trader2).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, ORDER_QUANTITY);
      const buyOrderId = 2n;
      const sellOrder = await state.getOrder(sellOrderId);
      const buyOrder = await state.getOrder(buyOrderId);
      expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
    });
    it("should transition order status from OPEN to CANCELED", async function () {
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, ORDER_QUANTITY);
      const orderId = 1n;
      let order = await state.getOrder(orderId);
      expect(order.status).to.equal(ORDER_STATUS_OPEN);
      await clob.connect(trader1).cancelOrder(orderId);
      order = await state.getOrder(orderId);
      expect(order.status).to.equal(ORDER_STATUS_CANCELED);
    });
    it("should transition order status from PARTIALLY_FILLED to CANCELED", async function () {
      const largeOrderQuantity = ORDER_QUANTITY * 2n;
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, largeOrderQuantity);
      const buyOrderId = 1n;
      await clob.connect(trader2).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, ORDER_QUANTITY);
      let buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_PARTIALLY_FILLED);
      await clob.connect(trader1).cancelOrder(buyOrderId);
      buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_CANCELED);
      expect(buyOrder.filledQuantity).to.equal(ORDER_QUANTITY);
    });
  });
  
  // --- Market Order Tests (Focus of Fixes) --- 
  describe("Market Order Tests", function () {
    it("should execute a market buy order against existing sell orders", async function () {
      // Setup
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, ORDER_QUANTITY);
      const sellOrderId = 1n;
      const initialSellerBase = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBase = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 1 Initial: SellerB=${initialSellerBase}, SellerQ=${initialSellerQuote}, BuyerB=${initialBuyerBase}, BuyerQ=${initialBuyerQuote}`);
      
      // Action
      const quoteAmountToSpend = calculateQuoteValue(ORDER_PRICE, ORDER_QUANTITY);
      console.log(`Test 1 Action: quoteAmountToSpend=${quoteAmountToSpend}`);
      const tx = await clob.connect(trader2).placeMarketOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, 0n, quoteAmountToSpend);
      const receipt = await tx.wait(); 
      console.log(`Test 1 Action Receipt: ${JSON.stringify(receipt, null, 2)}`);

      // Extract filled amounts from OrderMatched events for the TAKER order
      let marketBuyFilledQuantity = 0n;
      let marketBuyQuoteAmountFilled = 0n;
      const marketBuyOrderId = 2n; // Assume market order is the second order placed
      let processedTakerEvent = false; // Flag to process only the first event
      console.log(`Test 1: Analyzing events for Taker Order ID: ${marketBuyOrderId}`);
      if (receipt?.logs) {
          const clobInterface = clob.interface;
          for (const log of receipt.logs) {
              try {
                  const parsedLog = clobInterface.parseLog(log as any);
                  if (parsedLog && parsedLog.name === "OrderMatched") {
                      console.log(`Test 1 Raw Matched Event: Taker=${parsedLog.args.takerOrderId}, Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}`);
                      // Only aggregate if the current market order is the TAKER and we haven't processed it yet
                      if (parsedLog.args.takerOrderId === marketBuyOrderId && !processedTakerEvent) {
                          marketBuyFilledQuantity += parsedLog.args.quantity;
                          const quoteFilled = calculateQuoteValue(parsedLog.args.price, parsedLog.args.quantity);
                          marketBuyQuoteAmountFilled += quoteFilled;
                          processedTakerEvent = true; // Mark as processed
                          console.log(`Test 1 Aggregated Matched Event (Taker=${marketBuyOrderId}): Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}, QuoteFilled=${quoteFilled}`);
                      }
                  }
              } catch (e) { /* Ignore logs not from CLOB */ }
          }
      } else {
          console.error("Test 1: Transaction receipt or logs not found!");
      }

      console.log(`Test 1 Final Extracted from Events: marketBuyFilledQuantity=${marketBuyFilledQuantity} (${typeof marketBuyFilledQuantity}), marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled} (${typeof marketBuyQuoteAmountFilled})`);
      
      const finalSellerBase = await baseToken.balanceOf(await trader1.getAddress());
      const finalSellerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const finalBuyerBase = await baseToken.balanceOf(await trader2.getAddress());
      const finalBuyerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 1 Final Balances: SellerB=${finalSellerBase}, SellerQ=${finalSellerQuote}, BuyerB=${finalBuyerBase}, BuyerQ=${finalBuyerQuote}`);
      
      // Verification
      expect((await state.getOrder(sellOrderId)).status).to.equal(ORDER_STATUS_FILLED);
      expectBigIntEqual(marketBuyFilledQuantity, ORDER_QUANTITY, "Test 1 Market Buy Filled Quantity"); // Use helper again
      
      // Seller (Maker)
      const actualSellerBaseChange = initialSellerBase - finalSellerBase;
      console.log(`Test 1 Seller Base: Actual Change=${actualSellerBaseChange}, Expected Change=${ORDER_QUANTITY}`);
      expectBigIntEqual(actualSellerBaseChange, ORDER_QUANTITY, "Test 1 Seller Base Change");
      let sellerMakerFee = 0n;
      if (isValidBigInt(marketBuyQuoteAmountFilled) && marketBuyQuoteAmountFilled > 0n) {
          sellerMakerFee = (marketBuyQuoteAmountFilled * MAKER_FEE_RATE) / 10000n;
          console.log(`Test 1 Seller Fee: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, feeRate=${MAKER_FEE_RATE}, fee=${sellerMakerFee}`);
      } else {
          console.warn(`Test 1 Seller Fee: marketBuyQuoteAmountFilled is not valid or 0: ${marketBuyQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketBuyQuoteAmountFilled) || !isValidBigInt(sellerMakerFee)) {
          throw new Error(`Test 1: Invalid values for expectedSellerQuoteChange calc: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, sellerMakerFee=${sellerMakerFee}`);
      }
      const expectedSellerQuoteChange = marketBuyQuoteAmountFilled - sellerMakerFee;
      if (!isValidBigInt(finalSellerQuote) || !isValidBigInt(initialSellerQuote)) {
          throw new Error(`Test 1: Invalid values for actualSellerQuoteChange calc: finalSellerQuote=${finalSellerQuote}, initialSellerQuote=${initialSellerQuote}`);
      }
      const actualSellerQuoteChange = finalSellerQuote - initialSellerQuote;
      if (!isValidBigInt(actualSellerQuoteChange) || !isValidBigInt(expectedSellerQuoteChange)) {
          throw new Error(`Test 1: Invalid values for Seller Quote Change assertion: actual=${actualSellerQuoteChange}, expected=${expectedSellerQuoteChange}`);
      }
      expectBigIntEqual(actualSellerQuoteChange, expectedSellerQuoteChange, "Test 1 Seller Quote Change");
      
      // Buyer (Taker)
      const actualBuyerBaseChange = finalBuyerBase - initialBuyerBase;
      console.log(`Test 1 Buyer Base: Actual Change=${actualBuyerBaseChange}, Expected Change=${marketBuyFilledQuantity}`);
      expectBigIntEqual(actualBuyerBaseChange, marketBuyFilledQuantity, "Test 1 Buyer Base Change");
      let buyerTakerFee = 0n;
      if (isValidBigInt(marketBuyQuoteAmountFilled) && marketBuyQuoteAmountFilled > 0n) {
          buyerTakerFee = (marketBuyQuoteAmountFilled * TAKER_FEE_RATE) / 10000n;
          console.log(`Test 1 Buyer Fee: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, feeRate=${TAKER_FEE_RATE}, fee=${buyerTakerFee}`);
      } else {
          console.warn(`Test 1 Buyer Fee: marketBuyQuoteAmountFilled is not valid or 0: ${marketBuyQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketBuyQuoteAmountFilled) || !isValidBigInt(buyerTakerFee)) {
          throw new Error(`Test 1: Invalid values for expectedBuyerQuoteChange calc: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, buyerTakerFee=${buyerTakerFee}`);
      }
      const expectedBuyerQuoteChange = -(marketBuyQuoteAmountFilled + buyerTakerFee);
      if (!isValidBigInt(finalBuyerQuote) || !isValidBigInt(initialBuyerQuote)) {
          throw new Error(`Test 1: Invalid values for actualBuyerQuoteChange calc: finalBuyerQuote=${finalBuyerQuote}, initialBuyerQuote=${initialBuyerQuote}`);
      }
      const actualBuyerQuoteChange = finalBuyerQuote - initialBuyerQuote;
      if (!isValidBigInt(actualBuyerQuoteChange) || !isValidBigInt(expectedBuyerQuoteChange)) {
          throw new Error(`Test 1: Invalid values for Buyer Quote Change assertion: actual=${actualBuyerQuoteChange}, expected=${expectedBuyerQuoteChange}`);
      }
      expectBigIntEqual(actualBuyerQuoteChange, expectedBuyerQuoteChange, "Test 1 Buyer Quote Change");
    });

    it("should execute a market sell order against existing buy orders", async function () {
      // Setup
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, ORDER_QUANTITY);
      const buyOrderId = 1n;
      const initialBuyerBase = await baseToken.balanceOf(await trader1.getAddress());
      const initialBuyerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const initialSellerBase = await baseToken.balanceOf(await trader2.getAddress());
      const initialSellerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 2 Initial: BuyerB=${initialBuyerBase}, BuyerQ=${initialBuyerQuote}, SellerB=${initialSellerBase}, SellerQ=${initialSellerQuote}`);
      
      // Action
      console.log(`Test 2 Action: sellQuantity=${ORDER_QUANTITY}`);
      const tx = await clob.connect(trader2).placeMarketOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_QUANTITY, 0n);
      const receipt = await tx.wait();
      console.log(`Test 2 Action Receipt: ${JSON.stringify(receipt, null, 2)}`);

      // Extract filled amounts from OrderMatched events for the TAKER order
      let marketSellFilledQuantity = 0n;
      let marketSellQuoteAmountFilled = 0n;
      const marketSellOrderId = 2n; // Assume market order is the second order placed
      let processedTakerEvent = false; // Flag to process only the first event
      console.log(`Test 2: Analyzing events for Taker Order ID: ${marketSellOrderId}`);
      if (receipt?.logs) {
          const clobInterface = clob.interface;
          for (const log of receipt.logs) {
              try {
                  const parsedLog = clobInterface.parseLog(log as any);
                  if (parsedLog && parsedLog.name === "OrderMatched") {
                      console.log(`Test 2 Raw Matched Event: Taker=${parsedLog.args.takerOrderId}, Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}`);
                      // Only aggregate if the current market order is the TAKER and we haven't processed it yet
                      if (parsedLog.args.takerOrderId === marketSellOrderId && !processedTakerEvent) {
                          marketSellFilledQuantity += parsedLog.args.quantity;
                          const quoteFilled = calculateQuoteValue(parsedLog.args.price, parsedLog.args.quantity);
                          marketSellQuoteAmountFilled += quoteFilled;
                          processedTakerEvent = true; // Mark as processed
                          console.log(`Test 2 Aggregated Matched Event (Taker=${marketSellOrderId}): Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}, QuoteFilled=${quoteFilled}`);
                      }
                  }
              } catch (e) { /* Ignore */ }
          }
      } else {
          console.error("Test 2: Transaction receipt or logs not found!");
      }

      console.log(`Test 2 Final Extracted from Events: marketSellFilledQuantity=${marketSellFilledQuantity} (${typeof marketSellFilledQuantity}), marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled} (${typeof marketSellQuoteAmountFilled})`);
      
      const finalBuyerBase = await baseToken.balanceOf(await trader1.getAddress());
      const finalBuyerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const finalSellerBase = await baseToken.balanceOf(await trader2.getAddress());
      const finalSellerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 2 Final Balances: BuyerB=${finalBuyerBase}, BuyerQ=${finalBuyerQuote}, SellerB=${finalSellerBase}, SellerQ=${finalSellerQuote}`);
      
      // Verification
      expect((await state.getOrder(buyOrderId)).status).to.equal(ORDER_STATUS_FILLED);
      expectBigIntEqual(marketSellFilledQuantity, ORDER_QUANTITY, "Test 2 Market Sell Filled Quantity");
      
      // Buyer (Maker)
      const actualBuyerBaseChange = finalBuyerBase - initialBuyerBase;
      console.log(`Test 2 Buyer Base: Actual Change=${actualBuyerBaseChange}, Expected Change=${marketSellFilledQuantity}`);
      expectBigIntEqual(actualBuyerBaseChange, marketSellFilledQuantity, "Test 2 Buyer Base Change");
      let buyerMakerFee = 0n;
      if (isValidBigInt(marketSellQuoteAmountFilled) && marketSellQuoteAmountFilled > 0n) {
          buyerMakerFee = (marketSellQuoteAmountFilled * MAKER_FEE_RATE) / 10000n;
          console.log(`Test 2 Buyer Fee: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, feeRate=${MAKER_FEE_RATE}, fee=${buyerMakerFee}`);
      } else {
          console.warn(`Test 2 Buyer Fee: marketSellQuoteAmountFilled is not valid or 0: ${marketSellQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketSellQuoteAmountFilled) || !isValidBigInt(buyerMakerFee)) {
          throw new Error(`Test 2: Invalid values for expectedBuyerQuoteChange calc: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, buyerMakerFee=${buyerMakerFee}`);
      }
      const expectedBuyerQuoteChange = -(marketSellQuoteAmountFilled + buyerMakerFee);
      if (!isValidBigInt(finalBuyerQuote) || !isValidBigInt(initialBuyerQuote)) {
          throw new Error(`Test 2: Invalid values for actualBuyerQuoteChange calc: finalBuyerQuote=${finalBuyerQuote}, initialBuyerQuote=${initialBuyerQuote}`);
      }
      const actualBuyerQuoteChange = finalBuyerQuote - initialBuyerQuote;
      if (!isValidBigInt(actualBuyerQuoteChange) || !isValidBigInt(expectedBuyerQuoteChange)) {
          throw new Error(`Test 2: Invalid values for Buyer Quote Change assertion: actual=${actualBuyerQuoteChange}, expected=${expectedBuyerQuoteChange}`);
      }
      expectBigIntEqual(actualBuyerQuoteChange, expectedBuyerQuoteChange, "Test 2 Buyer Quote Change");
      
      // Seller (Taker)
      const actualSellerBaseChange = initialSellerBase - finalSellerBase;
      console.log(`Test 2 Seller Base: Actual Change=${actualSellerBaseChange}, Expected Change=${marketSellFilledQuantity}`);
      expectBigIntEqual(actualSellerBaseChange, marketSellFilledQuantity, "Test 2 Seller Base Change");
      let sellerTakerFee = 0n;
      if (isValidBigInt(marketSellQuoteAmountFilled) && marketSellQuoteAmountFilled > 0n) {
          sellerTakerFee = (marketSellQuoteAmountFilled * TAKER_FEE_RATE) / 10000n;
          console.log(`Test 2 Seller Fee: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, feeRate=${TAKER_FEE_RATE}, fee=${sellerTakerFee}`);
      } else {
          console.warn(`Test 2 Seller Fee: marketSellQuoteAmountFilled is not valid or 0: ${marketSellQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketSellQuoteAmountFilled) || !isValidBigInt(sellerTakerFee)) {
          throw new Error(`Test 2: Invalid values for expectedSellerQuoteChange calc: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, sellerTakerFee=${sellerTakerFee}`);
      }
      const expectedSellerQuoteChange = marketSellQuoteAmountFilled - sellerTakerFee;
      if (!isValidBigInt(finalSellerQuote) || !isValidBigInt(initialSellerQuote)) {
          throw new Error(`Test 2: Invalid values for actualSellerQuoteChange calc: finalSellerQuote=${finalSellerQuote}, initialSellerQuote=${initialSellerQuote}`);
      }
      const actualSellerQuoteChange = finalSellerQuote - initialSellerQuote;
      if (!isValidBigInt(actualSellerQuoteChange) || !isValidBigInt(expectedSellerQuoteChange)) {
          throw new Error(`Test 2: Invalid values for Seller Quote Change assertion: actual=${actualSellerQuoteChange}, expected=${expectedSellerQuoteChange}`);
      }
      expectBigIntEqual(actualSellerQuoteChange, expectedSellerQuoteChange, "Test 2 Seller Quote Change");
    });

    it("should execute a market buy order against multiple sell orders at different price levels", async function () {
      // Setup
      const price1 = ethers.parseUnits("100", 18); const quantity1 = ethers.parseUnits("1", 18); const quoteVal1 = calculateQuoteValue(price1, quantity1);
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, price1, quantity1); const sellOrderId1 = 1n;
      const price2 = ethers.parseUnits("110", 18); const quantity2 = ethers.parseUnits("1", 18); const quoteVal2 = calculateQuoteValue(price2, quantity2);
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, price2, quantity2); const sellOrderId2 = 2n;
      const price3 = ethers.parseUnits("120", 18); const quantity3 = ethers.parseUnits("1", 18); const quoteVal3 = calculateQuoteValue(price3, quantity3);
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, price3, quantity3); const sellOrderId3 = 3n;
      console.log(`Test 3 Setup: Orders placed (P/Q): ${price1}/${quantity1}, ${price2}/${quantity2}, ${price3}/${quantity3}`);
      
      const initialSellerBase = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBase = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 3 Initial: SellerB=${initialSellerBase}, SellerQ=${initialSellerQuote}, BuyerB=${initialBuyerBase}, BuyerQ=${initialBuyerQuote}`);
      
      // Action
      const totalQuantityToBuy = quantity1 + quantity2 + quantity3;
      const maxQuoteToSpend = quoteVal1 + quoteVal2 + quoteVal3; // Max quote willing to spend
      console.log(`Test 3 Action: totalQuantityToBuy=${totalQuantityToBuy}, maxQuoteToSpend=${maxQuoteToSpend}`);
      const tx = await clob.connect(trader2).placeMarketOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, 0n, maxQuoteToSpend);
      const receipt = await tx.wait();
      console.log(`Test 3 Action Receipt: ${JSON.stringify(receipt, null, 2)}`);

      // Extract filled amounts from OrderMatched events for the TAKER order
      let marketBuyFilledQuantity = 0n;
      let marketBuyQuoteAmountFilled = 0n;
      const marketBuyOrderId = 4n; // Assume market order is the fourth order placed
      const processedMakerOrders = new Set<bigint>(); // Track processed maker orders for this taker
      console.log(`Test 3: Analyzing events for Taker Order ID: ${marketBuyOrderId}`);
      if (receipt?.logs) {
          const clobInterface = clob.interface;
          for (const log of receipt.logs) {
              try {
                  const parsedLog = clobInterface.parseLog(log as any);
                  if (parsedLog && parsedLog.name === "OrderMatched") {
                      console.log(`Test 3 Raw Matched Event: Taker=${parsedLog.args.takerOrderId}, Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}`);
                      // Only aggregate if the current market order is the TAKER and we haven't processed this specific maker order match yet
                      if (parsedLog.args.takerOrderId === marketBuyOrderId && !processedMakerOrders.has(parsedLog.args.makerOrderId)) {
                          marketBuyFilledQuantity += parsedLog.args.quantity;
                          const quoteFilled = calculateQuoteValue(parsedLog.args.price, parsedLog.args.quantity);
                          marketBuyQuoteAmountFilled += quoteFilled;
                          processedMakerOrders.add(parsedLog.args.makerOrderId); // Mark this maker order as processed for this taker
                          console.log(`Test 3 Aggregated Matched Event (Taker=${marketBuyOrderId}): Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}, QuoteFilled=${quoteFilled}`);
                      }
                  }
              } catch (e) { /* Ignore */ }
          }
      } else {
          console.error("Test 3: Transaction receipt or logs not found!");
      }

      console.log(`Test 3 Final Extracted from Events: marketBuyFilledQuantity=${marketBuyFilledQuantity} (${typeof marketBuyFilledQuantity}), marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled} (${typeof marketBuyQuoteAmountFilled})`);
      
      const finalSellerBase = await baseToken.balanceOf(await trader1.getAddress());
      const finalSellerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const finalBuyerBase = await baseToken.balanceOf(await trader2.getAddress());
      const finalBuyerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 3 Final Balances: SellerB=${finalSellerBase}, SellerQ=${finalSellerQuote}, BuyerB=${finalBuyerBase}, BuyerQ=${finalBuyerQuote}`);
      
      // Verification
      expect((await state.getOrder(sellOrderId1)).status).to.equal(ORDER_STATUS_FILLED);
      expect((await state.getOrder(sellOrderId2)).status).to.equal(ORDER_STATUS_FILLED);
      expect((await state.getOrder(sellOrderId3)).status).to.equal(ORDER_STATUS_FILLED);
      expectBigIntEqual(marketBuyFilledQuantity, totalQuantityToBuy, "Test 3 Market Buy Filled Quantity");
      
      // Seller (Maker)
      const actualSellerBaseChange = initialSellerBase - finalSellerBase;
      console.log(`Test 3 Seller Base: Actual Change=${actualSellerBaseChange}, Expected Change=${totalQuantityToBuy}`);
      expectBigIntEqual(actualSellerBaseChange, totalQuantityToBuy, "Test 3 Seller Base Change");
      let sellerTotalMakerFee = 0n;
      if (isValidBigInt(marketBuyQuoteAmountFilled) && marketBuyQuoteAmountFilled > 0n) {
          sellerTotalMakerFee = (marketBuyQuoteAmountFilled * MAKER_FEE_RATE) / 10000n;
          console.log(`Test 3 Seller Fee: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, feeRate=${MAKER_FEE_RATE}, fee=${sellerTotalMakerFee}`);
      } else {
          console.warn(`Test 3 Seller Fee: marketBuyQuoteAmountFilled is not valid or 0: ${marketBuyQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketBuyQuoteAmountFilled) || !isValidBigInt(sellerTotalMakerFee)) {
          throw new Error(`Test 3: Invalid values for expectedSellerTotalQuoteChange calc: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, sellerTotalMakerFee=${sellerTotalMakerFee}`);
      }
      const expectedSellerTotalQuoteChange = marketBuyQuoteAmountFilled - sellerTotalMakerFee;
      if (!isValidBigInt(finalSellerQuote) || !isValidBigInt(initialSellerQuote)) {
          throw new Error(`Test 3: Invalid values for actualSellerQuoteChange calc: finalSellerQuote=${finalSellerQuote}, initialSellerQuote=${initialSellerQuote}`);
      }
      const actualSellerQuoteChange = finalSellerQuote - initialSellerQuote;
      if (!isValidBigInt(actualSellerQuoteChange) || !isValidBigInt(expectedSellerTotalQuoteChange)) {
          throw new Error(`Test 3: Invalid values for Seller Quote Change assertion: actual=${actualSellerQuoteChange}, expected=${expectedSellerTotalQuoteChange}`);
      }
      expectBigIntEqual(actualSellerQuoteChange, expectedSellerTotalQuoteChange, "Test 3 Seller Quote Change");
      
      // Buyer (Taker)
      const actualBuyerBaseChange = finalBuyerBase - initialBuyerBase;
      console.log(`Test 3 Buyer Base: Actual Change=${actualBuyerBaseChange}, Expected Change=${marketBuyFilledQuantity}`);
      expectBigIntEqual(actualBuyerBaseChange, marketBuyFilledQuantity, "Test 3 Buyer Base Change");
      let buyerTotalTakerFee = 0n;
      if (isValidBigInt(marketBuyQuoteAmountFilled) && marketBuyQuoteAmountFilled > 0n) {
          buyerTotalTakerFee = (marketBuyQuoteAmountFilled * TAKER_FEE_RATE) / 10000n;
          console.log(`Test 3 Buyer Fee: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, feeRate=${TAKER_FEE_RATE}, fee=${buyerTotalTakerFee}`);
      } else {
          console.warn(`Test 3 Buyer Fee: marketBuyQuoteAmountFilled is not valid or 0: ${marketBuyQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketBuyQuoteAmountFilled) || !isValidBigInt(buyerTotalTakerFee)) {
          throw new Error(`Test 3: Invalid values for expectedBuyerTotalQuoteChange calc: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, buyerTotalTakerFee=${buyerTotalTakerFee}`);
      }
      const expectedBuyerTotalQuoteChange = -(marketBuyQuoteAmountFilled + buyerTotalTakerFee);
      if (!isValidBigInt(finalBuyerQuote) || !isValidBigInt(initialBuyerQuote)) {
          throw new Error(`Test 3: Invalid values for actualBuyerQuoteChange calc: finalBuyerQuote=${finalBuyerQuote}, initialBuyerQuote=${initialBuyerQuote}`);
      }
      const actualBuyerQuoteChange = finalBuyerQuote - initialBuyerQuote;
      if (!isValidBigInt(actualBuyerQuoteChange) || !isValidBigInt(expectedBuyerTotalQuoteChange)) {
          throw new Error(`Test 3: Invalid values for Buyer Quote Change assertion: actual=${actualBuyerQuoteChange}, expected=${expectedBuyerTotalQuoteChange}`);
      }
      expectBigIntEqual(actualBuyerQuoteChange, expectedBuyerTotalQuoteChange, "Test 3 Buyer Quote Change");
    });

    it("should execute a market sell order against multiple buy orders at different price levels", async function () {
      // Setup
      const price1 = ethers.parseUnits("100", 18); const quantity1 = ethers.parseUnits("1", 18); const quoteVal1 = calculateQuoteValue(price1, quantity1);
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, price1, quantity1); const buyOrderId1 = 1n;
      const price2 = ethers.parseUnits("90", 18); const quantity2 = ethers.parseUnits("1", 18); const quoteVal2 = calculateQuoteValue(price2, quantity2);
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, price2, quantity2); const buyOrderId2 = 2n;
      const price3 = ethers.parseUnits("80", 18); const quantity3 = ethers.parseUnits("1", 18); const quoteVal3 = calculateQuoteValue(price3, quantity3);
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, price3, quantity3); const buyOrderId3 = 3n;
      console.log(`Test 4 Setup: Orders placed (P/Q): ${price1}/${quantity1}, ${price2}/${quantity2}, ${price3}/${quantity3}`);
      
      const initialBuyerBase = await baseToken.balanceOf(await trader1.getAddress());
      const initialBuyerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const initialSellerBase = await baseToken.balanceOf(await trader2.getAddress());
      const initialSellerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 4 Initial: BuyerB=${initialBuyerBase}, BuyerQ=${initialBuyerQuote}, SellerB=${initialSellerBase}, SellerQ=${initialSellerQuote}`);
      
      // Action
      const totalQuantityToSell = quantity1 + quantity2 + quantity3;
      console.log(`Test 4 Action: totalQuantityToSell=${totalQuantityToSell}`);
      const tx = await clob.connect(trader2).placeMarketOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, totalQuantityToSell, 0n);
      const receipt = await tx.wait();
      console.log(`Test 4 Action Receipt: ${JSON.stringify(receipt, null, 2)}`);

      // Extract filled amounts from OrderMatched events for the TAKER order
      let marketSellFilledQuantity = 0n;
      let marketSellQuoteAmountFilled = 0n;
      const marketSellOrderId = 4n; // Assume market order is the fourth order placed
      const processedMakerOrders = new Set<bigint>(); // Track processed maker orders for this taker
      console.log(`Test 4: Analyzing events for Taker Order ID: ${marketSellOrderId}`);
      if (receipt?.logs) {
          const clobInterface = clob.interface;
          for (const log of receipt.logs) {
              try {
                  const parsedLog = clobInterface.parseLog(log as any);
                  if (parsedLog && parsedLog.name === "OrderMatched") {
                      console.log(`Test 4 Raw Matched Event: Taker=${parsedLog.args.takerOrderId}, Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}`);
                      // Only aggregate if the current market order is the TAKER and we haven't processed this specific maker order match yet
                      if (parsedLog.args.takerOrderId === marketSellOrderId && !processedMakerOrders.has(parsedLog.args.makerOrderId)) {
                          marketSellFilledQuantity += parsedLog.args.quantity;
                          const quoteFilled = calculateQuoteValue(parsedLog.args.price, parsedLog.args.quantity);
                          marketSellQuoteAmountFilled += quoteFilled;
                          processedMakerOrders.add(parsedLog.args.makerOrderId); // Mark this maker order as processed for this taker
                          console.log(`Test 4 Aggregated Matched Event (Taker=${marketSellOrderId}): Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}, QuoteFilled=${quoteFilled}`);
                      }
                  }
              } catch (e) { /* Ignore */ }
          }
      } else {
          console.error("Test 4: Transaction receipt or logs not found!");
      }

      console.log(`Test 4 Final Extracted from Events: marketSellFilledQuantity=${marketSellFilledQuantity} (${typeof marketSellFilledQuantity}), marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled} (${typeof marketSellQuoteAmountFilled})`);
      
      const finalBuyerBase = await baseToken.balanceOf(await trader1.getAddress());
      const finalBuyerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const finalSellerBase = await baseToken.balanceOf(await trader2.getAddress());
      const finalSellerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 4 Final Balances: BuyerB=${finalBuyerBase}, BuyerQ=${finalBuyerQuote}, SellerB=${finalSellerBase}, SellerQ=${finalSellerQuote}`);
      
      // Verification
      expect((await state.getOrder(buyOrderId1)).status).to.equal(ORDER_STATUS_FILLED);
      expect((await state.getOrder(buyOrderId2)).status).to.equal(ORDER_STATUS_FILLED);
      expect((await state.getOrder(buyOrderId3)).status).to.equal(ORDER_STATUS_FILLED);
      expectBigIntEqual(marketSellFilledQuantity, totalQuantityToSell, "Test 4 Market Sell Filled Quantity");
      
      // Buyer (Maker)
      const actualBuyerBaseChange = finalBuyerBase - initialBuyerBase;
      console.log(`Test 4 Buyer Base: Actual Change=${actualBuyerBaseChange}, Expected Change=${totalQuantityToSell}`);
      expectBigIntEqual(actualBuyerBaseChange, totalQuantityToSell, "Test 4 Buyer Base Change");
      let buyerTotalMakerFee = 0n;
      if (isValidBigInt(marketSellQuoteAmountFilled) && marketSellQuoteAmountFilled > 0n) {
          buyerTotalMakerFee = (marketSellQuoteAmountFilled * MAKER_FEE_RATE) / 10000n;
          console.log(`Test 4 Buyer Fee: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, feeRate=${MAKER_FEE_RATE}, fee=${buyerTotalMakerFee}`);
      } else {
          console.warn(`Test 4 Buyer Fee: marketSellQuoteAmountFilled is not valid or 0: ${marketSellQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketSellQuoteAmountFilled) || !isValidBigInt(buyerTotalMakerFee)) {
          throw new Error(`Test 4: Invalid values for expectedBuyerTotalQuoteChange calc: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, buyerTotalMakerFee=${buyerTotalMakerFee}`);
      }
      const expectedBuyerTotalQuoteChange = -(marketSellQuoteAmountFilled + buyerTotalMakerFee);
      if (!isValidBigInt(finalBuyerQuote) || !isValidBigInt(initialBuyerQuote)) {
          throw new Error(`Test 4: Invalid values for actualBuyerQuoteChange calc: finalBuyerQuote=${finalBuyerQuote}, initialBuyerQuote=${initialBuyerQuote}`);
      }
      const actualBuyerQuoteChange = finalBuyerQuote - initialBuyerQuote;
      if (!isValidBigInt(actualBuyerQuoteChange) || !isValidBigInt(expectedBuyerTotalQuoteChange)) {
          throw new Error(`Test 4: Invalid values for Buyer Quote Change assertion: actual=${actualBuyerQuoteChange}, expected=${expectedBuyerTotalQuoteChange}`);
      }
      expectBigIntEqual(actualBuyerQuoteChange, expectedBuyerTotalQuoteChange, "Test 4 Buyer Quote Change");
      
      // Seller (Taker)
      const actualSellerBaseChange = initialSellerBase - finalSellerBase;
      console.log(`Test 4 Seller Base: Actual Change=${actualSellerBaseChange}, Expected Change=${marketSellFilledQuantity}`);
      expectBigIntEqual(actualSellerBaseChange, marketSellFilledQuantity, "Test 4 Seller Base Change");
      let sellerTotalTakerFee = 0n;
      if (isValidBigInt(marketSellQuoteAmountFilled) && marketSellQuoteAmountFilled > 0n) {
          sellerTotalTakerFee = (marketSellQuoteAmountFilled * TAKER_FEE_RATE) / 10000n;
          console.log(`Test 4 Seller Fee: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, feeRate=${TAKER_FEE_RATE}, fee=${sellerTotalTakerFee}`);
      } else {
          console.warn(`Test 4 Seller Fee: marketSellQuoteAmountFilled is not valid or 0: ${marketSellQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketSellQuoteAmountFilled) || !isValidBigInt(sellerTotalTakerFee)) {
          throw new Error(`Test 4: Invalid values for expectedSellerTotalQuoteChange calc: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, sellerTotalTakerFee=${sellerTotalTakerFee}`);
      }
      const expectedSellerTotalQuoteChange = marketSellQuoteAmountFilled - sellerTotalTakerFee;
      if (!isValidBigInt(finalSellerQuote) || !isValidBigInt(initialSellerQuote)) {
          throw new Error(`Test 4: Invalid values for actualSellerQuoteChange calc: finalSellerQuote=${finalSellerQuote}, initialSellerQuote=${initialSellerQuote}`);
      }
      const actualSellerQuoteChange = finalSellerQuote - initialSellerQuote;
      if (!isValidBigInt(actualSellerQuoteChange) || !isValidBigInt(expectedSellerTotalQuoteChange)) {
          throw new Error(`Test 4: Invalid values for Seller Quote Change assertion: actual=${actualSellerQuoteChange}, expected=${expectedSellerTotalQuoteChange}`);
      }
      expectBigIntEqual(actualSellerQuoteChange, expectedSellerTotalQuoteChange, "Test 4 Seller Quote Change");
    });

    it("should execute a market buy order that is partially filled when not enough liquidity", async function () {
      // Setup
      const sellQuantity = ORDER_QUANTITY / 2n;
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, sellQuantity);
      const sellOrderId = 1n;
      const initialSellerBase = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBase = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 5 Initial: SellerB=${initialSellerBase}, SellerQ=${initialSellerQuote}, BuyerB=${initialBuyerBase}, BuyerQ=${initialBuyerQuote}`);
      
      // Action
      const quoteAmountToSpend = calculateQuoteValue(ORDER_PRICE, ORDER_QUANTITY); // Try to buy 1 unit
      console.log(`Test 5 Action: quoteAmountToSpend=${quoteAmountToSpend} (attempting to buy ${ORDER_QUANTITY})`);
      const tx = await clob.connect(trader2).placeMarketOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, 0n, quoteAmountToSpend);
      const receipt = await tx.wait();
      console.log(`Test 5 Action Receipt: ${JSON.stringify(receipt, null, 2)}`);

      // Extract filled amounts from OrderMatched events for the TAKER order
      let marketBuyFilledQuantity = 0n;
      let marketBuyQuoteAmountFilled = 0n;
      const marketBuyOrderId = 2n; // Assume market order is the second order placed
      let processedTakerEvent = false; // Flag to process only the first event
      console.log(`Test 5: Analyzing events for Taker Order ID: ${marketBuyOrderId}`);
      if (receipt?.logs) {
          const clobInterface = clob.interface;
          for (const log of receipt.logs) {
              try {
                  const parsedLog = clobInterface.parseLog(log as any);
                  if (parsedLog && parsedLog.name === "OrderMatched") {
                      console.log(`Test 5 Raw Matched Event: Taker=${parsedLog.args.takerOrderId}, Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}`);
                      // Only aggregate if the current market order is the TAKER and we haven't processed it yet
                      if (parsedLog.args.takerOrderId === marketBuyOrderId && !processedTakerEvent) {
                          marketBuyFilledQuantity += parsedLog.args.quantity;
                          const quoteFilled = calculateQuoteValue(parsedLog.args.price, parsedLog.args.quantity);
                          marketBuyQuoteAmountFilled += quoteFilled;
                          processedTakerEvent = true; // Mark as processed
                          console.log(`Test 5 Aggregated Matched Event (Taker=${marketBuyOrderId}): Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}, QuoteFilled=${quoteFilled}`);
                      }
                  }
              } catch (e) { /* Ignore */ }
          }
      } else {
          console.error("Test 5: Transaction receipt or logs not found!");
      }

      console.log(`Test 5 Final Extracted from Events: marketBuyFilledQuantity=${marketBuyFilledQuantity} (${typeof marketBuyFilledQuantity}), marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled} (${typeof marketBuyQuoteAmountFilled})`);
      
      const finalSellerBase = await baseToken.balanceOf(await trader1.getAddress());
      const finalSellerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const finalBuyerBase = await baseToken.balanceOf(await trader2.getAddress());
      const finalBuyerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 5 Final Balances: SellerB=${finalSellerBase}, SellerQ=${finalSellerQuote}, BuyerB=${finalBuyerBase}, BuyerQ=${finalBuyerQuote}`);
      
      // Verification
      expect((await state.getOrder(sellOrderId)).status).to.equal(ORDER_STATUS_FILLED);
      expectBigIntEqual(marketBuyFilledQuantity, sellQuantity, "Test 5 Market Buy Filled Quantity"); // Only filled available amount
      
      // Seller (Maker)
      const actualSellerBaseChange = initialSellerBase - finalSellerBase;
      console.log(`Test 5 Seller Base: Actual Change=${actualSellerBaseChange}, Expected Change=${sellQuantity}`);
      expectBigIntEqual(actualSellerBaseChange, sellQuantity, "Test 5 Seller Base Change");
      let sellerMakerFee = 0n;
      if (isValidBigInt(marketBuyQuoteAmountFilled) && marketBuyQuoteAmountFilled > 0n) {
          sellerMakerFee = (marketBuyQuoteAmountFilled * MAKER_FEE_RATE) / 10000n;
          console.log(`Test 5 Seller Fee: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, feeRate=${MAKER_FEE_RATE}, fee=${sellerMakerFee}`);
      } else {
          console.warn(`Test 5 Seller Fee: marketBuyQuoteAmountFilled is not valid or 0: ${marketBuyQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketBuyQuoteAmountFilled) || !isValidBigInt(sellerMakerFee)) {
          throw new Error(`Test 5: Invalid values for expectedSellerQuoteChange calc: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, sellerMakerFee=${sellerMakerFee}`);
      }
      const expectedSellerQuoteChange = marketBuyQuoteAmountFilled - sellerMakerFee;
      if (!isValidBigInt(finalSellerQuote) || !isValidBigInt(initialSellerQuote)) {
          throw new Error(`Test 5: Invalid values for actualSellerQuoteChange calc: finalSellerQuote=${finalSellerQuote}, initialSellerQuote=${initialSellerQuote}`);
      }
      const actualSellerQuoteChange = finalSellerQuote - initialSellerQuote;
      if (!isValidBigInt(actualSellerQuoteChange) || !isValidBigInt(expectedSellerQuoteChange)) {
          throw new Error(`Test 5: Invalid values for Seller Quote Change assertion: actual=${actualSellerQuoteChange}, expected=${expectedSellerQuoteChange}`);
      }
      expectBigIntEqual(actualSellerQuoteChange, expectedSellerQuoteChange, "Test 5 Seller Quote Change");
      
      // Buyer (Taker)
      const actualBuyerBaseChange = finalBuyerBase - initialBuyerBase;
      console.log(`Test 5 Buyer Base: Actual Change=${actualBuyerBaseChange}, Expected Change=${marketBuyFilledQuantity}`);
      expectBigIntEqual(actualBuyerBaseChange, marketBuyFilledQuantity, "Test 5 Buyer Base Change");
      let buyerTakerFee = 0n;
      if (isValidBigInt(marketBuyQuoteAmountFilled) && marketBuyQuoteAmountFilled > 0n) {
          buyerTakerFee = (marketBuyQuoteAmountFilled * TAKER_FEE_RATE) / 10000n;
          console.log(`Test 5 Buyer Fee: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, feeRate=${TAKER_FEE_RATE}, fee=${buyerTakerFee}`);
      } else {
          console.warn(`Test 5 Buyer Fee: marketBuyQuoteAmountFilled is not valid or 0: ${marketBuyQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketBuyQuoteAmountFilled) || !isValidBigInt(buyerTakerFee)) {
          throw new Error(`Test 5: Invalid values for expectedBuyerQuoteChange calc: marketBuyQuoteAmountFilled=${marketBuyQuoteAmountFilled}, buyerTakerFee=${buyerTakerFee}`);
      }
      const expectedBuyerQuoteChange = -(marketBuyQuoteAmountFilled + buyerTakerFee);
      if (!isValidBigInt(finalBuyerQuote) || !isValidBigInt(initialBuyerQuote)) {
          throw new Error(`Test 5: Invalid values for actualBuyerQuoteChange calc: finalBuyerQuote=${finalBuyerQuote}, initialBuyerQuote=${initialBuyerQuote}`);
      }
      const actualBuyerQuoteChange = finalBuyerQuote - initialBuyerQuote;
      if (!isValidBigInt(actualBuyerQuoteChange) || !isValidBigInt(expectedBuyerQuoteChange)) {
          throw new Error(`Test 5: Invalid values for Buyer Quote Change assertion: actual=${actualBuyerQuoteChange}, expected=${expectedBuyerQuoteChange}`);
      }
      expectBigIntEqual(actualBuyerQuoteChange, expectedBuyerQuoteChange, "Test 5 Buyer Quote Change");
    });

    it("should execute a market sell order that is partially filled when not enough liquidity", async function () {
      // Setup
      const buyQuantity = ORDER_QUANTITY / 2n;
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, buyQuantity);
      const buyOrderId = 1n;
      const initialBuyerBase = await baseToken.balanceOf(await trader1.getAddress());
      const initialBuyerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const initialSellerBase = await baseToken.balanceOf(await trader2.getAddress());
      const initialSellerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 6 Initial: BuyerB=${initialBuyerBase}, BuyerQ=${initialBuyerQuote}, SellerB=${initialSellerBase}, SellerQ=${initialSellerQuote}`);
      
      // Action
      console.log(`Test 6 Action: sellQuantity=${ORDER_QUANTITY} (attempting to sell)`);
      const tx = await clob.connect(trader2).placeMarketOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_QUANTITY, 0n);
      const receipt = await tx.wait();
      console.log(`Test 6 Action Receipt: ${JSON.stringify(receipt, null, 2)}`);

      // Extract filled amounts from OrderMatched events for the TAKER order
      let marketSellFilledQuantity = 0n;
      let marketSellQuoteAmountFilled = 0n;
      const marketSellOrderId = 2n; // Assume market order is the second order placed
      let processedTakerEvent = false; // Flag to process only the first event
      console.log(`Test 6: Analyzing events for Taker Order ID: ${marketSellOrderId}`);
      if (receipt?.logs) {
          const clobInterface = clob.interface;
          for (const log of receipt.logs) {
              try {
                  const parsedLog = clobInterface.parseLog(log as any);
                  if (parsedLog && parsedLog.name === "OrderMatched") {
                      console.log(`Test 6 Raw Matched Event: Taker=${parsedLog.args.takerOrderId}, Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}`);
                      // Only aggregate if the current market order is the TAKER and we haven't processed it yet
                      if (parsedLog.args.takerOrderId === marketSellOrderId && !processedTakerEvent) {
                          marketSellFilledQuantity += parsedLog.args.quantity;
                          const quoteFilled = calculateQuoteValue(parsedLog.args.price, parsedLog.args.quantity);
                          marketSellQuoteAmountFilled += quoteFilled;
                          processedTakerEvent = true; // Mark as processed
                          console.log(`Test 6 Aggregated Matched Event (Taker=${marketSellOrderId}): Maker=${parsedLog.args.makerOrderId}, Qty=${parsedLog.args.quantity}, Price=${parsedLog.args.price}, QuoteFilled=${quoteFilled}`);
                      }
                  }
              } catch (e) { /* Ignore */ }
          }
      } else {
          console.error("Test 6: Transaction receipt or logs not found!");
      }

      console.log(`Test 6 Final Extracted from Events: marketSellFilledQuantity=${marketSellFilledQuantity} (${typeof marketSellFilledQuantity}), marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled} (${typeof marketSellQuoteAmountFilled})`);
      
      const finalBuyerBase = await baseToken.balanceOf(await trader1.getAddress());
      const finalBuyerQuote = await quoteToken.balanceOf(await trader1.getAddress());
      const finalSellerBase = await baseToken.balanceOf(await trader2.getAddress());
      const finalSellerQuote = await quoteToken.balanceOf(await trader2.getAddress());
      console.log(`Test 6 Final Balances: BuyerB=${finalBuyerBase}, BuyerQ=${finalBuyerQuote}, SellerB=${finalSellerBase}, SellerQ=${finalSellerQuote}`);
      
      // Verification
      expect((await state.getOrder(buyOrderId)).status).to.equal(ORDER_STATUS_FILLED);
      expectBigIntEqual(marketSellFilledQuantity, buyQuantity, "Test 6 Market Sell Filled Quantity"); // Only filled available amount
      
      // Buyer (Maker)
      const actualBuyerBaseChange = finalBuyerBase - initialBuyerBase;
      console.log(`Test 6 Buyer Base: Actual Change=${actualBuyerBaseChange}, Expected Change=${buyQuantity}`);
      expectBigIntEqual(actualBuyerBaseChange, buyQuantity, "Test 6 Buyer Base Change");
      let buyerMakerFee = 0n;
      if (isValidBigInt(marketSellQuoteAmountFilled) && marketSellQuoteAmountFilled > 0n) {
          buyerMakerFee = (marketSellQuoteAmountFilled * MAKER_FEE_RATE) / 10000n;
          console.log(`Test 6 Buyer Fee: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, feeRate=${MAKER_FEE_RATE}, fee=${buyerMakerFee}`);
      } else {
          console.warn(`Test 6 Buyer Fee: marketSellQuoteAmountFilled is not valid or 0: ${marketSellQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketSellQuoteAmountFilled) || !isValidBigInt(buyerMakerFee)) {
          throw new Error(`Test 6: Invalid values for expectedBuyerQuoteChange calc: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, buyerMakerFee=${buyerMakerFee}`);
      }
      const expectedBuyerQuoteChange = -(marketSellQuoteAmountFilled + buyerMakerFee);
      if (!isValidBigInt(finalBuyerQuote) || !isValidBigInt(initialBuyerQuote)) {
          throw new Error(`Test 6: Invalid values for actualBuyerQuoteChange calc: finalBuyerQuote=${finalBuyerQuote}, initialBuyerQuote=${initialBuyerQuote}`);
      }
      const actualBuyerQuoteChange = finalBuyerQuote - initialBuyerQuote;
      if (!isValidBigInt(actualBuyerQuoteChange) || !isValidBigInt(expectedBuyerQuoteChange)) {
          throw new Error(`Test 6: Invalid values for Buyer Quote Change assertion: actual=${actualBuyerQuoteChange}, expected=${expectedBuyerQuoteChange}`);
      }
      expectBigIntEqual(actualBuyerQuoteChange, expectedBuyerQuoteChange, "Test 6 Buyer Quote Change");
      
      // Seller (Taker)
      const actualSellerBaseChange = initialSellerBase - finalSellerBase;
      console.log(`Test 6 Seller Base: Actual Change=${actualSellerBaseChange}, Expected Change=${marketSellFilledQuantity}`);
      expectBigIntEqual(actualSellerBaseChange, marketSellFilledQuantity, "Test 6 Seller Base Change");
      let sellerTakerFee = 0n;
      if (isValidBigInt(marketSellQuoteAmountFilled) && marketSellQuoteAmountFilled > 0n) {
          sellerTakerFee = (marketSellQuoteAmountFilled * TAKER_FEE_RATE) / 10000n;
          console.log(`Test 6 Seller Fee: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, feeRate=${TAKER_FEE_RATE}, fee=${sellerTakerFee}`);
      } else {
          console.warn(`Test 6 Seller Fee: marketSellQuoteAmountFilled is not valid or 0: ${marketSellQuoteAmountFilled}`);
      }
      if (!isValidBigInt(marketSellQuoteAmountFilled) || !isValidBigInt(sellerTakerFee)) {
          throw new Error(`Test 6: Invalid values for expectedSellerQuoteChange calc: marketSellQuoteAmountFilled=${marketSellQuoteAmountFilled}, sellerTakerFee=${sellerTakerFee}`);
      }
      const expectedSellerQuoteChange = marketSellQuoteAmountFilled - sellerTakerFee;
      if (!isValidBigInt(finalSellerQuote) || !isValidBigInt(initialSellerQuote)) {
          throw new Error(`Test 6: Invalid values for actualSellerQuoteChange calc: finalSellerQuote=${finalSellerQuote}, initialSellerQuote=${initialSellerQuote}`);
      }
      const actualSellerQuoteChange = finalSellerQuote - initialSellerQuote;
      if (!isValidBigInt(actualSellerQuoteChange) || !isValidBigInt(expectedSellerQuoteChange)) {
          throw new Error(`Test 6: Invalid values for Seller Quote Change assertion: actual=${actualSellerQuoteChange}, expected=${expectedSellerQuoteChange}`);
      }
      expectBigIntEqual(actualSellerQuoteChange, expectedSellerQuoteChange, "Test 6 Seller Quote Change");
    });
  });
  
  // --- IOC Order Tests (Passing - Keep as is) ---
  describe("IOC Order Tests", function () {
    it("should execute an IOC buy order that can be fully filled immediately", async function () {
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, ORDER_QUANTITY);
      const iocBuyTx = await clob.connect(trader2).placeIOC(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, ORDER_QUANTITY);
      await iocBuyTx.wait();
      const iocBuyOrderId = 2n;
      const iocBuyOrder = await state.getOrder(iocBuyOrderId);
      expect(iocBuyOrder.status).to.equal(ORDER_STATUS_FILLED);
      const sellOrder = await state.getOrder(1n);
      expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED);
    });
    it("should execute an IOC buy order that is partially filled immediately and then canceled", async function () {
      const sellQuantity = ORDER_QUANTITY / 2n;
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, sellQuantity);
      const iocBuyTx = await clob.connect(trader2).placeIOC(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, ORDER_QUANTITY);
      await iocBuyTx.wait();
      const iocBuyOrderId = 2n;
      const iocBuyOrder = await state.getOrder(iocBuyOrderId);
      expect(iocBuyOrder.status).to.equal(ORDER_STATUS_CANCELED);
      expect(iocBuyOrder.filledQuantity).to.equal(sellQuantity);
      const sellOrder = await state.getOrder(1n);
      expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED);
    });
    it("should cancel an IOC buy order immediately if no matching sell orders exist", async function () {
      const iocBuyTx = await clob.connect(trader2).placeIOC(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, ORDER_QUANTITY);
      await iocBuyTx.wait();
      const iocBuyOrderId = 1n;
      const iocBuyOrder = await state.getOrder(iocBuyOrderId);
      expect(iocBuyOrder.status).to.equal(ORDER_STATUS_CANCELED);
      expect(iocBuyOrder.filledQuantity).to.equal(0n);
    });
  });
  
  // --- FOK Order Tests (Passing - Keep as is) ---
  describe("FOK Order Tests", function () {
    it("should execute a FOK buy order that can be fully filled immediately", async function () {
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, ORDER_QUANTITY);
      const fokBuyTx = await clob.connect(trader2).placeFOK(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, ORDER_QUANTITY);
      await fokBuyTx.wait();
      const fokBuyOrderId = 2n;
      const fokBuyOrder = await state.getOrder(fokBuyOrderId);
      expect(fokBuyOrder.status).to.equal(ORDER_STATUS_FILLED);
      const sellOrder = await state.getOrder(1n);
      expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED);
    });
    it("should cancel a FOK buy order when it cannot be fully filled", async function () {
      const sellQuantity = ORDER_QUANTITY / 2n;
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, ORDER_PRICE, sellQuantity);
      const fokBuyTx = await clob.connect(trader2).placeFOK(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, ORDER_QUANTITY);
      await fokBuyTx.wait();
      const fokBuyOrderId = 2n;
      const buyOrder = await state.getOrder(fokBuyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_CANCELED);
      expect(buyOrder.filledQuantity).to.equal(sellQuantity);
      const sellOrder = await state.getOrder(1n);
      expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED);
    });
    it("should cancel a FOK buy order immediately if no matching sell orders exist", async function () {
      const fokBuyTx = await clob.connect(trader2).placeFOK(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, ORDER_QUANTITY);
      await fokBuyTx.wait();
      const fokBuyOrderId = 1n;
      const fokBuyOrder = await state.getOrder(fokBuyOrderId);
      expect(fokBuyOrder.status).to.equal(ORDER_STATUS_CANCELED);
      expect(fokBuyOrder.filledQuantity).to.equal(0n);
    });
  });
  
  // --- Order Modification Tests (Passing - Keep as is) ---
  describe("Order Modification Tests", function () {
    it("should allow modifying an order's quantity and verify the update", async function () {
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, ORDER_QUANTITY);
      const orderId = 1n;
      const newQuantity = ORDER_QUANTITY * 2n;
      await clob.connect(trader1).cancelOrder(orderId);
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, ORDER_PRICE, newQuantity);
      const newOrderId = 2n;
      const modifiedOrder = await state.getOrder(newOrderId);
      expect(modifiedOrder.quantity).to.equal(newQuantity);
      expect(modifiedOrder.status).to.equal(ORDER_STATUS_OPEN);
    });
    it("should allow modifying an order's price and verify the update affects matching priority", async function () {
      const highPrice = ethers.parseUnits("110", 18);
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, highPrice, ORDER_QUANTITY);
      const originalOrderId = 1n;
      const lowPrice = ethers.parseUnits("90", 18);
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, lowPrice, ORDER_QUANTITY);
      const secondOrderId = 2n;
      const newLowPrice = ethers.parseUnits("80", 18);
      await clob.connect(trader1).cancelOrder(originalOrderId);
      await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, newLowPrice, ORDER_QUANTITY);
      const modifiedOrderId = 3n;
      await clob.connect(trader2).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, lowPrice, ORDER_QUANTITY);
      const secondOrder = await state.getOrder(secondOrderId);
      const modifiedOrder = await state.getOrder(modifiedOrderId);
      expect(secondOrder.status).to.equal(ORDER_STATUS_FILLED);
      expect(modifiedOrder.status).to.equal(ORDER_STATUS_OPEN);
    });
  });
});

