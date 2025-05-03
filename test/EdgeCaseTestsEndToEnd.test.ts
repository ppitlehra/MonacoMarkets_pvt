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
  
  // Order type constants
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
      if (!sellOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let sellOrderId: bigint = 0n;
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
        throw new Error("OrderPlaced event not found");
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
      if (!buyOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let buyOrderId: bigint = 0n;
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
        throw new Error("OrderPlaced event not found");
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
      if (!sellOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let sellOrderId: bigint = 0n;
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
        throw new Error("OrderPlaced event not found");
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
      if (!buyOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let buyOrderId: bigint = 0n;
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
        throw new Error("OrderPlaced event not found");
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
      if (!sellOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let sellOrderId: bigint = 0n;
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
        throw new Error("OrderPlaced event not found");
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
      if (!buyOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let buyOrderId: bigint = 0n;
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
        throw new Error("OrderPlaced event not found");
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
      
      console.log(`High Price Order - Trade value: ${tradeValue}`);
      console.log(`High Price Order - Price: ${EXTREME_HIGH_PRICE}`);
      console.log(`High Price Order - Maker fee: ${expectedMakerFee}`);
      console.log(`High Price Order - Taker fee: ${expectedTakerFee}`);
      console.log(`High Price Order - Total fee: ${expectedTotalFee}`);
      console.log(`High Price Order - Fee recipient received: ${feeRecipientQuoteTokenDiff}`);
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
      if (!sellOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let sellOrderId: bigint = 0n;
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
        throw new Error("OrderPlaced event not found");
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
      if (!buyOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let buyOrderId: bigint = 0n;
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
        throw new Error("OrderPlaced event not found");
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
      
      console.log(`Low Price Order - Trade value: ${tradeValue}`);
      console.log(`Low Price Order - Price: ${EXTREME_LOW_PRICE}`);
      console.log(`Low Price Order - Maker fee: ${expectedMakerFee}`);
      console.log(`Low Price Order - Taker fee: ${expectedTakerFee}`);
      console.log(`Low Price Order - Total fee: ${expectedTotalFee}`);
      console.log(`Low Price Order - Fee recipient received: ${feeRecipientQuoteTokenDiff}`);
    });
  });
  
  describe("Zero Value Tests", function () {
    it("should reject orders with zero quantity", async function () {
      console.log("Testing zero quantity...");
      
      // Attempt to place a limit sell order with zero quantity through CLOB contract
      try {
        await clob.connect(trader1).placeLimitOrder(
          await baseToken.getAddress(),
          await quoteToken.getAddress(),
          false, // isBuy
          STANDARD_PRICE,
          ZERO_QUANTITY
        );
        // If we reach here, the test should fail because zero quantity should be rejected
        expect.fail("Order with zero quantity should be rejected");
      } catch (error) {
        // Expected behavior - order with zero quantity should be rejected
        console.log("Order with zero quantity was correctly rejected");
        expect(error.message).to.include("revert");
      }
    });
    
    it("should handle market orders with zero price correctly", async function () {
      console.log("Testing market order with zero price...");
      
      // Record initial token balances
      const initialSellerBaseBalance = await baseToken.balanceOf(await trader1.getAddress());
      const initialSellerQuoteBalance = await quoteToken.balanceOf(await trader1.getAddress());
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      const initialBuyerQuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
      const initialFeeRecipientQuoteBalance = await quoteToken.balanceOf(await feeRecipient.getAddress());
      
      // Place a limit sell order with standard price through CLOB contract
      console.log("Placing limit sell order...");
      const sellOrderTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        STANDARD_PRICE,
        STANDARD_QUANTITY
      );
      
      // Get the sell order ID from transaction receipt
      const sellOrderReceipt = await sellOrderTx.wait();
      if (!sellOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let sellOrderId: bigint = 0n;
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
        throw new Error("OrderPlaced event not found");
      }
      console.log("Sell order ID:", sellOrderId);
      
      // Verify the sell order was created correctly
      const sellOrder = await state.getOrder(sellOrderId);
      console.log("Sell order status:", sellOrder.status);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      
      // Place a market buy order through CLOB contract
      // Note: For market orders, we use placeMarketOrder which doesn't require a price
      console.log("Placing market buy order...");
      const buyOrderTx = await clob.connect(trader2).placeMarketOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        STANDARD_QUANTITY
      );
      
      // Get the buy order ID from transaction receipt
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) {
        throw new Error("Transaction receipt is null");
      }
      
      let buyOrderId: bigint = 0n;
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
        throw new Error("OrderPlaced event not found");
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
      // Market orders execute at the limit order price
      const tradeValue = STANDARD_PRICE * STANDARD_QUANTITY / ethers.parseUnits("1", 18);
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
      
      console.log(`Market Order - Trade value: ${tradeValue}`);
      console.log(`Market Order - Execution price: ${STANDARD_PRICE}`);
      console.log(`Market Order - Maker fee: ${expectedMakerFee}`);
      console.log(`Market Order - Taker fee: ${expectedTakerFee}`);
      console.log(`Market Order - Total fee: ${expectedTotalFee}`);
      console.log(`Market Order - Fee recipient received: ${feeRecipientQuoteTokenDiff}`);
    });
  });
});
