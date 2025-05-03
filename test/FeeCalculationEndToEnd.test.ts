import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Book, CLOB, State, Vault, MockToken } from "../typechain-types";

describe("Fee Calculation End-to-End Tests", function () {
  // Constants for testing
  const ORDER_PRICE = ethers.parseUnits("100", 18);
  const ORDER_QUANTITY = ethers.parseUnits("1", 18);
  const INITIAL_BALANCE = ethers.parseUnits("1000000", 18);
  
  // Order status constants
  const ORDER_STATUS_OPEN = 0;
  const ORDER_STATUS_FILLED = 2;
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
  let owner: Signer;
  let trader1: Signer;
  let trader2: Signer;
  let feeRecipient: Signer;
  
  beforeEach(async function () {
    // Get signers
    [owner, trader1, trader2, feeRecipient] = await ethers.getSigners();
    
    // Deploy mock tokens with 18 decimals
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
    
    // Set CLOB as the book in Vault (critical for authorization)
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
  
  describe("Basic Fee Calculation Tests", function () {
    it("should calculate and collect fees correctly for a simple limit order match", async function () {
      // Record initial token balances for all parties
      const initialSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      console.log("Placing limit sell order through CLOB contract...");
      // Place a limit sell order (maker)
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        ORDER_PRICE,
        ORDER_QUANTITY
      );
      
      // Get the sell order ID
      const sellOrderId = 1n;
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log("Sell order status:", sellOrder.status);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      
      console.log("Placing limit buy order through CLOB contract...");
      // Place a matching limit buy order (taker)
      await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        ORDER_PRICE,
        ORDER_QUANTITY
      );
      
      // Get the buy order ID
      const buyOrderId = 2n;
      
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
      const tradeValue = ORDER_PRICE * ORDER_QUANTITY / ethers.parseUnits("1", 18);
      const expectedMakerFee = tradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const expectedTakerFee = tradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      const expectedTotalFee = expectedMakerFee + expectedTakerFee;
      
      // Verify token transfers
      // Seller should send base tokens and receive quote tokens minus maker fee
      const sellerBaseTokenDiff = initialSellerBaseBalance - finalSellerBaseBalance;
      expect(sellerBaseTokenDiff).to.equal(ORDER_QUANTITY);
      
      const sellerQuoteTokenDiff = finalSellerQuoteBalance - initialSellerQuoteBalance;
      expect(sellerQuoteTokenDiff).to.equal(tradeValue - expectedMakerFee);
      
      // Buyer should receive base tokens and send quote tokens plus taker fee
      const buyerBaseTokenDiff = finalBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiff).to.equal(ORDER_QUANTITY);
      
      const buyerQuoteTokenDiff = initialBuyerQuoteBalance - finalBuyerQuoteBalance;
      expect(buyerQuoteTokenDiff).to.equal(tradeValue + expectedTakerFee);
      
      // Fee recipient should receive both maker and taker fees
      const feeRecipientQuoteTokenDiff = finalFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiff).to.equal(expectedTotalFee);
      
      // Log fee calculations for debugging
      console.log(`Trade value: ${tradeValue}`);
      console.log(`Maker fee (${DEFAULT_MAKER_FEE_RATE} bp): ${expectedMakerFee}`);
      console.log(`Taker fee (${DEFAULT_TAKER_FEE_RATE} bp): ${expectedTakerFee}`);
      console.log(`Total fee: ${expectedTotalFee}`);
      console.log(`Fee recipient received: ${feeRecipientQuoteTokenDiff}`);
    });
  });

  describe("Custom Fee Rate Tests", function () {
    it("should calculate and collect fees correctly with custom fee rates", async function () {
      // Set custom fee rates
      const customMakerFeeRate = 30; // 0.3%
      const customTakerFeeRate = 50; // 0.5%
      
      // Update fee rates in Vault
      await vault.connect(owner).setFeeRates(customMakerFeeRate, customTakerFeeRate);
      
      // Record initial token balances for all parties
      const initialSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      console.log("Placing limit sell order with custom fee rates...");
      // Place a limit sell order (maker)
      const sellOrderTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        ORDER_PRICE,
        ORDER_QUANTITY
      );
      
      // Get the sell order ID from transaction receipt
      const sellOrderReceipt = await sellOrderTx.wait();
      if (!sellOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let sellOrderId = 0n;
      for (const log of sellOrderReceipt.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'OrderPlaced') {
            sellOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore parsing errors */ }
      }
      
      if (sellOrderId === 0n) {
        throw new Error("Could not find OrderPlaced event");
      }
      console.log("Sell order ID:", sellOrderId);
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log("Sell order status:", sellOrder.status);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      
      console.log("Placing limit buy order with custom fee rates...");
      // Place a matching limit buy order (taker)
      const buyOrderTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        ORDER_PRICE,
        ORDER_QUANTITY
      );
      
      // Get the buy order ID from transaction receipt
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let buyOrderId = 0n;
      for (const log of buyOrderReceipt.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'OrderPlaced') {
            buyOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore parsing errors */ }
      }
      
      if (buyOrderId === 0n) {
        throw new Error("Could not find OrderPlaced event");
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
      const tradeValue = ORDER_PRICE * ORDER_QUANTITY / ethers.parseUnits("1", 18);
      const expectedMakerFee = tradeValue * BigInt(customMakerFeeRate) / 10000n;
      const expectedTakerFee = tradeValue * BigInt(customTakerFeeRate) / 10000n;
      const expectedTotalFee = expectedMakerFee + expectedTakerFee;
      
      // Verify token transfers
      // Seller should send base tokens and receive quote tokens minus maker fee
      const sellerBaseTokenDiff = initialSellerBaseBalance - finalSellerBaseBalance;
      expect(sellerBaseTokenDiff).to.equal(ORDER_QUANTITY);
      
      const sellerQuoteTokenDiff = finalSellerQuoteBalance - initialSellerQuoteBalance;
      expect(sellerQuoteTokenDiff).to.equal(tradeValue - expectedMakerFee);
      
      // Buyer should receive base tokens and send quote tokens plus taker fee
      const buyerBaseTokenDiff = finalBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiff).to.equal(ORDER_QUANTITY);
      
      const buyerQuoteTokenDiff = initialBuyerQuoteBalance - finalBuyerQuoteBalance;
      expect(buyerQuoteTokenDiff).to.equal(tradeValue + expectedTakerFee);
      
      // Fee recipient should receive both maker and taker fees
      const feeRecipientQuoteTokenDiff = finalFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiff).to.equal(expectedTotalFee);
      
      // Log fee calculations for debugging
      console.log(`Trade value: ${tradeValue}`);
      console.log(`Custom maker fee (${customMakerFeeRate} bp): ${expectedMakerFee}`);
      console.log(`Custom taker fee (${customTakerFeeRate} bp): ${expectedTakerFee}`);
      console.log(`Total fee: ${expectedTotalFee}`);
      console.log(`Fee recipient received: ${feeRecipientQuoteTokenDiff}`);
      
      // Reset fee rates to default for other tests
      await vault.connect(owner).setFeeRates(DEFAULT_MAKER_FEE_RATE, DEFAULT_TAKER_FEE_RATE);
    });
  });

  describe("Zero Fee Rate Tests", function () {
    it("should handle zero fee rates correctly", async function () {
      // Set zero fee rates
      const zeroFeeRate = 0; // 0%
      
      // Update fee rates in Vault
      await vault.connect(owner).setFeeRates(zeroFeeRate, zeroFeeRate);
      
      // Record initial token balances for all parties
      const initialSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      console.log("Placing limit sell order with zero fee rates...");
      // Place a limit sell order (maker)
      const sellOrderTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        ORDER_PRICE,
        ORDER_QUANTITY
      );
      
      // Get the sell order ID from transaction receipt
      const sellOrderReceipt = await sellOrderTx.wait();
      if (!sellOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let sellOrderId = 0n;
      for (const log of sellOrderReceipt.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'OrderPlaced') {
            sellOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore parsing errors */ }
      }
      
      if (sellOrderId === 0n) {
        throw new Error("Could not find OrderPlaced event");
      }
      console.log("Sell order ID:", sellOrderId);
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log("Sell order status:", sellOrder.status);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      
      console.log("Placing limit buy order with zero fee rates...");
      // Place a matching limit buy order (taker)
      const buyOrderTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        ORDER_PRICE,
        ORDER_QUANTITY
      );
      
      // Get the buy order ID from transaction receipt
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let buyOrderId = 0n;
      for (const log of buyOrderReceipt.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'OrderPlaced') {
            buyOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore parsing errors */ }
      }
      
      if (buyOrderId === 0n) {
        throw new Error("Could not find OrderPlaced event");
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
      const tradeValue = ORDER_PRICE * ORDER_QUANTITY / ethers.parseUnits("1", 18);
      const expectedMakerFee = tradeValue * BigInt(zeroFeeRate) / 10000n;
      const expectedTakerFee = tradeValue * BigInt(zeroFeeRate) / 10000n;
      const expectedTotalFee = expectedMakerFee + expectedTakerFee;
      
      // Verify token transfers
      // Seller should send base tokens and receive quote tokens minus maker fee (which is 0)
      const sellerBaseTokenDiff = initialSellerBaseBalance - finalSellerBaseBalance;
      expect(sellerBaseTokenDiff).to.equal(ORDER_QUANTITY);
      
      const sellerQuoteTokenDiff = finalSellerQuoteBalance - initialSellerQuoteBalance;
      expect(sellerQuoteTokenDiff).to.equal(tradeValue - expectedMakerFee);
      
      // Buyer should receive base tokens and send quote tokens plus taker fee (which is 0)
      const buyerBaseTokenDiff = finalBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiff).to.equal(ORDER_QUANTITY);
      
      const buyerQuoteTokenDiff = initialBuyerQuoteBalance - finalBuyerQuoteBalance;
      expect(buyerQuoteTokenDiff).to.equal(tradeValue + expectedTakerFee);
      
      // Fee recipient should receive both maker and taker fees (which are 0)
      const feeRecipientQuoteTokenDiff = finalFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiff).to.equal(expectedTotalFee);
      
      // Log fee calculations for debugging
      console.log(`Trade value: ${tradeValue}`);
      console.log(`Zero maker fee (${zeroFeeRate} bp): ${expectedMakerFee}`);
      console.log(`Zero taker fee (${zeroFeeRate} bp): ${expectedTakerFee}`);
      console.log(`Total fee: ${expectedTotalFee}`);
      console.log(`Fee recipient received: ${feeRecipientQuoteTokenDiff}`);
      
      // Reset fee rates to default for other tests
      await vault.connect(owner).setFeeRates(DEFAULT_MAKER_FEE_RATE, DEFAULT_TAKER_FEE_RATE);
    });
  });

  describe("Partial Fill Fee Calculation Tests", function () {
    it("should calculate and collect fees correctly for partial fills", async function () {
      // Record initial token balances for all parties
      const initialSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      console.log("Placing large limit sell order...");
      // Place a large limit sell order (maker)
      const largeOrderQuantity = ORDER_QUANTITY * 2n;
      const sellOrderTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        ORDER_PRICE,
        largeOrderQuantity
      );
      
      // Get the sell order ID from transaction receipt
      const sellOrderReceipt = await sellOrderTx.wait();
      if (!sellOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let sellOrderId = 0n;
      for (const log of sellOrderReceipt.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'OrderPlaced') {
            sellOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore parsing errors */ }
      }
      
      if (sellOrderId === 0n) {
        throw new Error("Could not find OrderPlaced event");
      }
      console.log("Sell order ID:", sellOrderId);
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log("Sell order status:", sellOrder.status);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      expect(sellOrder.quantity).to.equal(largeOrderQuantity);
      
      console.log("Placing smaller buy order for partial fill...");
      // Place a smaller buy order (taker) to partially fill the sell order
      const buyOrderTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        ORDER_PRICE,
        ORDER_QUANTITY
      );
      
      // Get the buy order ID from transaction receipt
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let buyOrderId = 0n;
      for (const log of buyOrderReceipt.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'OrderPlaced') {
            buyOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore parsing errors */ }
      }
      
      if (buyOrderId === 0n) {
        throw new Error("Could not find OrderPlaced event");
      }
      console.log("Buy order ID:", buyOrderId);
      
      // Verify the buy order was matched (should be filled)
      const buyOrder = await state.getOrder(buyOrderId);
      console.log("Buy order status:", buyOrder.status);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
      
      // Verify the sell order was partially matched
      const partiallyFilledSellOrder = await state.getOrder(sellOrderId);
      console.log("Partially filled sell order status:", partiallyFilledSellOrder.status);
      expect(partiallyFilledSellOrder.status).to.equal(ORDER_STATUS_PARTIALLY_FILLED);
      expect(partiallyFilledSellOrder.filledQuantity).to.equal(ORDER_QUANTITY);
      
      // Get intermediate balances after first partial fill
      const intermediateSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const intermediateSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const intermediateBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const intermediateBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const intermediateFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Calculate expected trade value and fees for first partial fill
      const partialTradeValue = ORDER_PRICE * ORDER_QUANTITY / ethers.parseUnits("1", 18);
      const expectedPartialMakerFee = partialTradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const expectedPartialTakerFee = partialTradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      const expectedPartialTotalFee = expectedPartialMakerFee + expectedPartialTakerFee;
      
      // Verify token transfers for first partial fill
      // Seller should send base tokens and receive quote tokens minus maker fee
      const sellerBaseTokenDiff1 = initialSellerBaseBalance - intermediateSellerBaseBalance;
      expect(sellerBaseTokenDiff1).to.equal(ORDER_QUANTITY);
      
      const sellerQuoteTokenDiff1 = intermediateSellerQuoteBalance - initialSellerQuoteBalance;
      expect(sellerQuoteTokenDiff1).to.equal(partialTradeValue - expectedPartialMakerFee);
      
      // Buyer should receive base tokens and send quote tokens plus taker fee
      const buyerBaseTokenDiff1 = intermediateBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiff1).to.equal(ORDER_QUANTITY);
      
      const buyerQuoteTokenDiff1 = initialBuyerQuoteBalance - intermediateBuyerQuoteBalance;
      expect(buyerQuoteTokenDiff1).to.equal(partialTradeValue + expectedPartialTakerFee);
      
      // Fee recipient should receive both maker and taker fees
      const feeRecipientQuoteTokenDiff1 = intermediateFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiff1).to.equal(expectedPartialTotalFee);
      
      console.log("Placing second buy order to complete fill...");
      // Place another buy order to complete the fill
      const buyOrderTx2 = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        ORDER_PRICE,
        ORDER_QUANTITY
      );
      
      // Get the second buy order ID from transaction receipt
      const buyOrderReceipt2 = await buyOrderTx2.wait();
      if (!buyOrderReceipt2) {
        throw new Error("Transaction receipt is null");
      }
      
      let buyOrderId2 = 0n;
      for (const log of buyOrderReceipt2.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'OrderPlaced') {
            buyOrderId2 = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore parsing errors */ }
      }
      
      if (buyOrderId2 === 0n) {
        throw new Error("Could not find OrderPlaced event");
      }
      console.log("Second buy order ID:", buyOrderId2);
      
      // Verify the second buy order was matched (should be filled)
      const buyOrder2 = await state.getOrder(buyOrderId2);
      console.log("Second buy order status:", buyOrder2.status);
      expect(buyOrder2.status).to.equal(ORDER_STATUS_FILLED);
      
      // Verify the sell order is now completely filled
      const completedSellOrder = await state.getOrder(sellOrderId);
      console.log("Completed sell order status:", completedSellOrder.status);
      expect(completedSellOrder.status).to.equal(ORDER_STATUS_FILLED);
      expect(completedSellOrder.filledQuantity).to.equal(largeOrderQuantity);
      
      // Get final balances after second partial fill
      const finalSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const finalSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const finalBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const finalBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const finalFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Calculate expected total trade value and fees
      const totalTradeValue = ORDER_PRICE * largeOrderQuantity / ethers.parseUnits("1", 18);
      const expectedTotalMakerFee = totalTradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const expectedTotalTakerFee = totalTradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      const expectedTotalFee = expectedTotalMakerFee + expectedTotalTakerFee;
      
      // Verify total token transfers
      // Seller should send all base tokens and receive quote tokens minus maker fee
      const sellerBaseTokenDiffTotal = initialSellerBaseBalance - finalSellerBaseBalance;
      expect(sellerBaseTokenDiffTotal).to.equal(largeOrderQuantity);
      
      const sellerQuoteTokenDiffTotal = finalSellerQuoteBalance - initialSellerQuoteBalance;
      expect(sellerQuoteTokenDiffTotal).to.equal(totalTradeValue - expectedTotalMakerFee);
      
      // Buyer should receive all base tokens and send quote tokens plus taker fee
      const buyerBaseTokenDiffTotal = finalBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiffTotal).to.equal(largeOrderQuantity);
      
      const buyerQuoteTokenDiffTotal = initialBuyerQuoteBalance - finalBuyerQuoteBalance;
      expect(buyerQuoteTokenDiffTotal).to.equal(totalTradeValue + expectedTotalTakerFee);
      
      // Fee recipient should receive both maker and taker fees
      const feeRecipientQuoteTokenDiffTotal = finalFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiffTotal).to.equal(expectedTotalFee);
      
      // Log fee calculations for debugging
      console.log(`Partial Fill - First trade value: ${partialTradeValue}`);
      console.log(`Partial Fill - First maker fee: ${expectedPartialMakerFee}`);
      console.log(`Partial Fill - First taker fee: ${expectedPartialTakerFee}`);
      console.log(`Partial Fill - First total fee: ${expectedPartialTotalFee}`);
      console.log(`Partial Fill - Total trade value: ${totalTradeValue}`);
      console.log(`Partial Fill - Total maker fee: ${expectedTotalMakerFee}`);
      console.log(`Partial Fill - Total taker fee: ${expectedTotalTakerFee}`);
      console.log(`Partial Fill - Total fee: ${expectedTotalFee}`);
      console.log(`Partial Fill - Fee recipient received: ${feeRecipientQuoteTokenDiffTotal}`);
    });
  });

  describe("Price Improvement Fee Calculation Tests", function () {
    it("should calculate and collect fees correctly with price improvement", async function () {
      // Record initial token balances for all parties
      const initialSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      console.log("Placing limit sell order for price improvement test...");
      // Place a limit sell order (maker)
      const sellOrderTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        ORDER_PRICE,
        ORDER_QUANTITY
      );
      
      // Get the sell order ID from transaction receipt
      const sellOrderReceipt = await sellOrderTx.wait();
      if (!sellOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let sellOrderId = 0n;
      for (const log of sellOrderReceipt.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'OrderPlaced') {
            sellOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore parsing errors */ }
      }
      
      if (sellOrderId === 0n) {
        throw new Error("Could not find OrderPlaced event");
      }
      console.log("Sell order ID:", sellOrderId);
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log("Sell order status:", sellOrder.status);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      
      console.log("Placing buy order with improved price...");
      // Place a buy order with improved price (taker)
      const improvedPrice = ORDER_PRICE * 110n / 100n; // 10% higher price
      const buyOrderTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        improvedPrice,
        ORDER_QUANTITY
      );
      
      // Get the buy order ID from transaction receipt
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let buyOrderId = 0n;
      for (const log of buyOrderReceipt.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'OrderPlaced') {
            buyOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore parsing errors */ }
      }
      
      if (buyOrderId === 0n) {
        throw new Error("Could not find OrderPlaced event");
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
      // Important: The contract actually executes at the original price (sell order price), not the improved price
      const actualTradeValue = ORDER_PRICE * ORDER_QUANTITY / ethers.parseUnits("1", 18);
      const actualMakerFee = actualTradeValue * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const actualTakerFee = actualTradeValue * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      const actualTotalFee = actualMakerFee + actualTakerFee;
      
      // Verify token transfers
      // Seller should send base tokens and receive quote tokens minus maker fee
      const sellerBaseTokenDiff = initialSellerBaseBalance - finalSellerBaseBalance;
      expect(sellerBaseTokenDiff).to.equal(ORDER_QUANTITY);
      
      const sellerQuoteTokenDiff = finalSellerQuoteBalance - initialSellerQuoteBalance;
      expect(sellerQuoteTokenDiff).to.equal(actualTradeValue - actualMakerFee);
      
      // Buyer should receive base tokens and send quote tokens plus taker fee
      const buyerBaseTokenDiff = finalBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiff).to.equal(ORDER_QUANTITY);
      
      const buyerQuoteTokenDiff = initialBuyerQuoteBalance - finalBuyerQuoteBalance;
      expect(buyerQuoteTokenDiff).to.equal(actualTradeValue + actualTakerFee);
      
      // Fee recipient should receive both maker and taker fees
      const feeRecipientQuoteTokenDiff = finalFeeRecipientQuoteBalance - initialFeeRecipientQuoteBalance;
      expect(feeRecipientQuoteTokenDiff).to.equal(actualTotalFee);
      
      // Log fee calculations for debugging
      console.log(`Price Improvement - Original price: ${ORDER_PRICE}`);
      console.log(`Price Improvement - Improved price: ${improvedPrice}`);
      console.log(`Price Improvement - Trade value: ${actualTradeValue}`);
      console.log(`Price Improvement - Maker fee (${DEFAULT_MAKER_FEE_RATE} bp): ${actualMakerFee}`);
      console.log(`Price Improvement - Taker fee (${DEFAULT_TAKER_FEE_RATE} bp): ${actualTakerFee}`);
      console.log(`Price Improvement - Total fee: ${actualTotalFee}`);
      console.log(`Price Improvement - Fee recipient received: ${feeRecipientQuoteTokenDiff}`);
    });
  });

  describe("Different Token Decimals Tests", function () {
    it("should calculate and collect fees correctly with different token decimals", async function () {
      // Deploy tokens with different decimals
      const TokenFactory = await ethers.getContractFactory("MockToken");
      const token6Decimals = await TokenFactory.deploy("USDC Token", "USDC", 6);
      const token8Decimals = await TokenFactory.deploy("WBTC Token", "WBTC", 8);
      
      // Add supported trading pair for 6-decimal token
      await clob.connect(owner).addSupportedPair(
        await token6Decimals.getAddress(),
        await quoteToken.getAddress()
      );
      
      // Add supported trading pair for 8-decimal token
      await clob.connect(owner).addSupportedPair(
        await token8Decimals.getAddress(),
        await quoteToken.getAddress()
      );
      
      // Mint tokens to traders
      const initialBalance6Decimals = ethers.parseUnits("1000000", 6);
      const initialBalance8Decimals = ethers.parseUnits("1000000", 8);
      
      await token6Decimals.mint(await trader1.getAddress(), initialBalance6Decimals);
      await token6Decimals.mint(await trader2.getAddress(), initialBalance6Decimals);
      await token8Decimals.mint(await trader1.getAddress(), initialBalance8Decimals);
      await token8Decimals.mint(await trader2.getAddress(), initialBalance8Decimals);
      
      // Approve tokens for trading - cast to MockToken to access approve method
      await (token6Decimals as unknown as MockToken).connect(trader1).approve(await vault.getAddress(), initialBalance6Decimals);
      await (token6Decimals as unknown as MockToken).connect(trader2).approve(await vault.getAddress(), initialBalance6Decimals);
      await (token8Decimals as unknown as MockToken).connect(trader1).approve(await vault.getAddress(), initialBalance8Decimals);
      await (token8Decimals as unknown as MockToken).connect(trader2).approve(await vault.getAddress(), initialBalance8Decimals);
      
      // Test with 6-decimal token
      console.log("Testing with 6-decimal token (USDC-like)...");
      
      // Define order parameters for 6-decimal token
      const orderPrice6Decimals = ethers.parseUnits("100", 18);
      const orderQuantity6Decimals = ethers.parseUnits("1", 6); // 1 USDC
      
      // Record initial token balances for 6-decimal token test
      const initialSellerToken6Balance = await token6Decimals.balanceOf(await trader1.getAddress());
      const initialSellerQuoteBalance6 = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerToken6Balance = await token6Decimals.balanceOf(await trader2.getAddress());
      const initialBuyerQuoteBalance6 = await quoteToken.balanceOf(await trader2.getAddress());
      const initialFeeRecipientQuoteBalance6 = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Place a limit sell order with 6-decimal token
      const sellOrderTx6 = await clob.connect(trader1).placeLimitOrder(
        await token6Decimals.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        orderPrice6Decimals,
        orderQuantity6Decimals
      );
      
      // Get the sell order ID from transaction receipt
      const sellOrderReceipt6 = await sellOrderTx6.wait();
      if (!sellOrderReceipt6) {
        throw new Error("Transaction receipt is null");
      }
      
      let sellOrderId6 = 0n;
      for (const log of sellOrderReceipt6.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'OrderPlaced') {
            sellOrderId6 = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore parsing errors */ }
      }
      
      if (sellOrderId6 === 0n) {
        throw new Error("Could not find OrderPlaced event");
      }
      console.log("6-decimal token sell order ID:", sellOrderId6);
      
      // Verify the sell order was created correctly
      const sellOrder6 = await state.getOrder(sellOrderId6);
      console.log("6-decimal token sell order status:", sellOrder6.status);
      expect(sellOrder6.status).to.equal(ORDER_STATUS_OPEN);
      
      // Place a matching limit buy order with 6-decimal token
      const buyOrderTx6 = await clob.connect(trader2).placeLimitOrder(
        await token6Decimals.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        orderPrice6Decimals,
        orderQuantity6Decimals
      );
      
      // Get the buy order ID from transaction receipt
      const buyOrderReceipt6 = await buyOrderTx6.wait();
      if (!buyOrderReceipt6) {
        throw new Error("Transaction receipt is null");
      }
      
      let buyOrderId6 = 0n;
      for (const log of buyOrderReceipt6.logs) {
        try {
          const parsedLog = clob.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'OrderPlaced') {
            buyOrderId6 = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore parsing errors */ }
      }
      
      if (buyOrderId6 === 0n) {
        throw new Error("Could not find OrderPlaced event");
      }
      console.log("6-decimal token buy order ID:", buyOrderId6);
      
      // Verify the buy order was matched (should be filled)
      const buyOrder6 = await state.getOrder(buyOrderId6);
      console.log("6-decimal token buy order status:", buyOrder6.status);
      expect(buyOrder6.status).to.equal(ORDER_STATUS_FILLED);
      
      // Verify the sell order was matched (should be filled)
      const updatedSellOrder6 = await state.getOrder(sellOrderId6);
      console.log("Updated 6-decimal token sell order status:", updatedSellOrder6.status);
      expect(updatedSellOrder6.status).to.equal(ORDER_STATUS_FILLED);
      
      // Get final balances after matching
      const finalSellerToken6Balance = await token6Decimals.balanceOf(await trader1.getAddress());
      const finalSellerQuoteBalance6 = await quoteToken.balanceOf(await trader1.getAddress());
      const finalBuyerToken6Balance = await token6Decimals.balanceOf(await trader2.getAddress());
      const finalBuyerQuoteBalance6 = await quoteToken.balanceOf(await trader2.getAddress());
      const finalFeeRecipientQuoteBalance6 = await quoteToken.balanceOf(await feeRecipient.getAddress());
            // Calculate expected trade value and fees for 6-decimal token
      // The contract now correctly uses baseDecimals in the denominator
      const tradeValue6 = orderPrice6Decimals * orderQuantity6Decimals / BigInt(10**6);
      const expectedMakerFee6 = tradeValue6 * BigInt(DEFAULT_MAKER_FEE_RATE) / 10000n;
      const expectedTakerFee6 = tradeValue6 * BigInt(DEFAULT_TAKER_FEE_RATE) / 10000n;
      const expectedTotalFee6 = expectedMakerFee6 + expectedTakerFee6;
      
      // Verify token transfers for 6-decimal token
      // Seller should send base tokens and receive quote tokens minus maker fee
      const sellerToken6Diff = initialSellerToken6Balance - finalSellerToken6Balance;
      expect(sellerToken6Diff).to.equal(orderQuantity6Decimals);
      
      const sellerQuoteToken6Diff = finalSellerQuoteBalance6 - initialSellerQuoteBalance6;
      expect(sellerQuoteToken6Diff).to.equal(tradeValue6 - expectedMakerFee6);
      
      // Buyer should receive base tokens and send quote tokens plus taker fee
      const buyerToken6Diff = finalBuyerToken6Balance - initialBuyerToken6Balance;
      expect(buyerToken6Diff).to.equal(orderQuantity6Decimals);
      
      const buyerQuoteToken6Diff = initialBuyerQuoteBalance6 - finalBuyerQuoteBalance6;
      expect(buyerQuoteToken6Diff).to.equal(tradeValue6 + expectedTakerFee6);
      
      // Fee recipient should receive both maker and taker fees
      const feeRecipientQuoteToken6Diff = finalFeeRecipientQuoteBalance6 - initialFeeRecipientQuoteBalance6;
      expect(feeRecipientQuoteToken6Diff).to.equal(expectedTotalFee6);
      
      // Log fee calculations for debugging
      console.log(`6-decimal token - Trade value: ${tradeValue6}`);
      console.log(`6-decimal token - Maker fee (${DEFAULT_MAKER_FEE_RATE} bp): ${expectedMakerFee6}`);
      console.log(`6-decimal token - Taker fee (${DEFAULT_TAKER_FEE_RATE} bp): ${expectedTakerFee6}`);
      console.log(`6-decimal token - Total fee: ${expectedTotalFee6}`);
      console.log(`6-decimal token - Fee recipient received: ${feeRecipientQuoteToken6Diff}`);
    });
  });
});
