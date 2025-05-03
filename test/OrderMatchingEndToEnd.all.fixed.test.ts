import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Book, CLOB, MockToken, State, Vault } from "../typechain-types";

// Order status constants - CORRECT ORDER
const ORDER_STATUS_OPEN = 0;
const ORDER_STATUS_PARTIALLY_FILLED = 1;
const ORDER_STATUS_FILLED = 2;
const ORDER_STATUS_CANCELED = 3;

describe("Order Matching End-to-End Tests (All Fixed)", function () {
  let baseToken: MockToken;
  let quoteToken: MockToken;
  let vault: Vault;
  let state: State;
  let book: Book;
  let clob: CLOB;
  let admin: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;
  let trader2: HardhatEthersSigner;
  let trader3: HardhatEthersSigner;

  beforeEach(async function () {
    [admin, trader1, trader2, trader3] = await ethers.getSigners();

    // Deploy mock tokens
    const MockTokenFactory = await ethers.getContractFactory("MockToken");
    baseToken = await MockTokenFactory.deploy("Base Token", "BASE", 18) as unknown as MockToken;
    quoteToken = await MockTokenFactory.deploy("Quote Token", "QUOTE", 18) as unknown as MockToken;

    // Deploy CLOB contracts
    const StateFactory = await ethers.getContractFactory("State");
    state = await StateFactory.deploy(await admin.getAddress()) as unknown as State;

    const BookFactory = await ethers.getContractFactory("Book");
    book = await BookFactory.deploy(
      await admin.getAddress(),
      await state.getAddress(),
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    ) as unknown as Book;

    const VaultFactory = await ethers.getContractFactory("Vault");
    vault = await VaultFactory.deploy(
      await admin.getAddress(),
      await state.getAddress(),
      await admin.getAddress(), // feeRecipient
      0, // makerFeeRate
      0  // takerFeeRate
    ) as unknown as Vault;

    const CLOBFactory = await ethers.getContractFactory("CLOB");
    clob = await CLOBFactory.deploy(
      await admin.getAddress(),
      await state.getAddress(),
      await book.getAddress(),
      await vault.getAddress()
    ) as unknown as CLOB;

    // Set up contract relationships
    await state.addAdmin(await clob.getAddress()); // Add CLOB as admin for state updates
    await state.addAdmin(await book.getAddress()); // Add Book as admin for state updates
    await book.setCLOB(await clob.getAddress());
    await book.setVault(await vault.getAddress());
    await vault.setCLOB(await clob.getAddress());
    await vault.setBook(await clob.getAddress()); // Set CLOB as the authorized caller for Vault
    
    // Register trading pair
    await clob.addSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress());

    // Mint tokens to traders
    const initialBalance = ethers.parseUnits("1000000", 18);
    await baseToken.mint(await trader1.getAddress(), initialBalance);
    await baseToken.mint(await trader2.getAddress(), initialBalance);
    await baseToken.mint(await trader3.getAddress(), initialBalance);
    await quoteToken.mint(await trader1.getAddress(), initialBalance);
    await quoteToken.mint(await trader2.getAddress(), initialBalance);
    await quoteToken.mint(await trader3.getAddress(), initialBalance);

    // Approve tokens for trading
    await baseToken.connect(trader1).approve(await vault.getAddress(), initialBalance);
    await baseToken.connect(trader2).approve(await vault.getAddress(), initialBalance);
    await baseToken.connect(trader3).approve(await vault.getAddress(), initialBalance);
    await quoteToken.connect(trader1).approve(await vault.getAddress(), initialBalance);
    await quoteToken.connect(trader2).approve(await vault.getAddress(), initialBalance);
    await quoteToken.connect(trader3).approve(await vault.getAddress(), initialBalance);
  });

  describe("Complete Order Matching Tests", function () {
    it("should fully match a buy order against multiple sell orders at different price levels", async function () {
      // Place multiple sell orders at different price levels
      const sellPrice1 = ethers.parseUnits("100", 18);
      const sellPrice2 = ethers.parseUnits("101", 18);
      const sellPrice3 = ethers.parseUnits("102", 18);
      const sellQuantity = ethers.parseUnits("1", 18);
      const totalBuyQuantity = ethers.parseUnits("2", 18); // Match against first two sell orders
      
      // Place sell orders from best to worst price
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice1, // Best price
        sellQuantity
      );
      
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice2, // Medium price
        sellQuantity
      );
      
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice3, // Worst price
        sellQuantity
      );
      
      // Place a buy order that should match against the first two sell orders
      const buyOrderTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        sellPrice2, // Willing to pay up to the medium price
        totalBuyQuantity
      );
      
      // Get the buy order ID
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) throw new Error("Transaction receipt is null");
      
      const buyOrderEvent = buyOrderReceipt.logs.find(
        log => log.topics && log.topics[0] === ethers.id("OrderCreated(uint256,address,bool,uint256,uint256)")
      );
      if (!buyOrderEvent) throw new Error("OrderCreated event not found");
      
      const stateInterface = state.interface;
      const parsedLog = stateInterface.parseLog({
        topics: buyOrderEvent.topics,
        data: buyOrderEvent.data
      });
      if (!parsedLog) throw new Error("Failed to parse event log");
      const buyOrderId = parsedLog.args[0]; // Assuming orderId is the first argument
      
      // Verify the buy order was fully filled
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(buyOrder.filledQuantity).to.equal(totalBuyQuantity);
      
      // Verify the first two sell orders were filled (best prices first)
      const sellOrder1 = await state.getOrder(1); // Best price
      const sellOrder2 = await state.getOrder(2); // Medium price
      const sellOrder3 = await state.getOrder(3); // Worst price
      
      expect(sellOrder1.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(sellOrder1.filledQuantity).to.equal(sellQuantity);
      
      expect(sellOrder2.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(sellOrder2.filledQuantity).to.equal(sellQuantity);
      
      expect(sellOrder3.status).to.equal(ORDER_STATUS_OPEN);
      expect(sellOrder3.filledQuantity).to.equal(0);
    });
    
    it("should fully match a market buy order against multiple sell orders", async function () {
      // Place multiple sell orders at different price levels
      const sellPrice1 = ethers.parseUnits("100", 18);
      const sellPrice2 = ethers.parseUnits("101", 18);
      const sellPrice3 = ethers.parseUnits("102", 18);
      const sellQuantity = ethers.parseUnits("1", 18);
      const marketBuyQuantity = ethers.parseUnits("2", 18); // Match against first two sell orders
      
      // Place sell orders from worst to best price to test sorting
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice3, // Worst price
        sellQuantity
      );
      
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice2, // Medium price
        sellQuantity
      );
      
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice1, // Best price
        sellQuantity
      );
      
      // Place a market buy order
      const buyOrderTx = await clob.connect(trader2).placeMarketOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        marketBuyQuantity
      );
      
      // Get the buy order ID
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) throw new Error("Transaction receipt is null");
      
      const buyOrderEvent = buyOrderReceipt.logs.find(
        log => log.topics && log.topics[0] === ethers.id("OrderCreated(uint256,address,bool,uint256,uint256)")
      );
      if (!buyOrderEvent) throw new Error("OrderCreated event not found");
      
      const stateInterface = state.interface;
      const parsedLog = stateInterface.parseLog({
        topics: buyOrderEvent.topics,
        data: buyOrderEvent.data
      });
      if (!parsedLog) throw new Error("Failed to parse event log");
      const buyOrderId = parsedLog.args[0]; // Assuming orderId is the first argument
      
      // Verify the market buy order was fully filled
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(buyOrder.filledQuantity).to.equal(marketBuyQuantity);
      
      // Verify the first two sell orders were filled (best prices first)
      const sellOrder1 = await state.getOrder(3); // Best price (100)
      const sellOrder2 = await state.getOrder(2); // Medium price (101)
      const sellOrder3 = await state.getOrder(1); // Worst price (102)
      
      expect(sellOrder1.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(sellOrder1.filledQuantity).to.equal(sellQuantity);
      
      expect(sellOrder2.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(sellOrder2.filledQuantity).to.equal(sellQuantity);
      
      expect(sellOrder3.status).to.equal(ORDER_STATUS_OPEN);
      expect(sellOrder3.filledQuantity).to.equal(0);
    });
    
    it("should handle a partial fill correctly", async function () {
      // Place a sell order
      const sellPrice = ethers.parseUnits("100", 18);
      const sellQuantity = ethers.parseUnits("3", 18);
      
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice,
        sellQuantity
      );
      const sellOrderId = 1;
      
      // Place a buy order that partially fills the sell order
      const buyQuantity1 = ethers.parseUnits("1", 18);
      const buyOrderTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        sellPrice,
        buyQuantity1
      );
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) throw new Error("Transaction receipt is null");
      
      const buyOrderEvent = buyOrderReceipt.logs.find(
        log => log.topics && log.topics[0] === ethers.id("OrderCreated(uint256,address,bool,uint256,uint256)")
      );
      if (!buyOrderEvent) throw new Error("OrderCreated event not found");
      
      const stateInterface = state.interface;
      const parsedLog = stateInterface.parseLog({
        topics: buyOrderEvent.topics,
        data: buyOrderEvent.data
      });
      if (!parsedLog) throw new Error("Failed to parse event log");
      const buyOrderId = parsedLog.args[0]; // Assuming orderId is the first argument
      
      // Verify the sell order is partially filled
      const sellOrderAfterBuy = await state.getOrder(sellOrderId);
      expect(sellOrderAfterBuy.status).to.equal(ORDER_STATUS_PARTIALLY_FILLED);
      expect(sellOrderAfterBuy.filledQuantity).to.equal(ethers.parseUnits("1", 18)); // Corrected: should be 1 not 3

      // Verify the buy order is fully filled
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(buyOrder.filledQuantity).to.equal(buyQuantity1);
    });
  });
  
  describe("Market Order Tests", function () {
    it("should fully match a market order against the best available prices", async function () {
      // Place multiple sell orders at different price levels
      const sellPrice1 = ethers.parseUnits("100", 18);
      const sellPrice2 = ethers.parseUnits("101", 18);
      const sellPrice3 = ethers.parseUnits("102", 18);
      const sellQuantity = ethers.parseUnits("1", 18);
      const marketBuyQuantity = ethers.parseUnits("2", 18); // Only match against first two sell orders
      
      // Place third sell order at price 102 (worst price)
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice3,
        sellQuantity
      );
      const sellOrder3Id = 1;
      
      // Place second sell order at price 101
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice2,
        sellQuantity
      );
      const sellOrder2Id = 2;
      
      // Place first sell order at price 100 (best price)
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice1,
        sellQuantity
      );
      const sellOrder1Id = 3;
      
      // Record initial token balances
      const initialBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      
      // Place a market buy order
      const buyOrderTx = await clob.connect(trader2).placeMarketOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        marketBuyQuantity
      );
      
      // Get the buy order ID
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) throw new Error("Transaction receipt is null");
      
      const buyOrderEvent = buyOrderReceipt.logs.find(
        log => log.topics && log.topics[0] === ethers.id("OrderCreated(uint256,address,bool,uint256,uint256)")
      );
      if (!buyOrderEvent) throw new Error("OrderCreated event not found");
      
      const stateInterface = state.interface;
      const parsedLog = stateInterface.parseLog({
        topics: buyOrderEvent.topics,
        data: buyOrderEvent.data
      });
      if (!parsedLog) throw new Error("Failed to parse event log");
      const buyOrderId = parsedLog.args[0]; // Assuming orderId is the first argument
      
      // Verify the market buy order was fully filled
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(buyOrder.filledQuantity).to.equal(marketBuyQuantity);
      
      // Verify the first two sell orders were filled (best prices first)
      const sellOrder1 = await state.getOrder(sellOrder1Id); // Best price (100)
      const sellOrder2 = await state.getOrder(sellOrder2Id); // Second best price (101)
      const sellOrder3 = await state.getOrder(sellOrder3Id); // Worst price (102)
      
      expect(sellOrder1.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(sellOrder1.filledQuantity).to.equal(sellQuantity);
      
      expect(sellOrder2.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(sellOrder2.filledQuantity).to.equal(sellQuantity);
      
      expect(sellOrder3.status).to.equal(ORDER_STATUS_OPEN);
      expect(sellOrder3.filledQuantity).to.equal(0);
      
      // Get final balances
      const finalBuyerBaseBalance = await baseToken.balanceOf(await trader2.getAddress());
      
      // Verify token transfers (excluding fees for simplicity)
      // Buyer should receive the market buy quantity
      const buyerBaseTokenDiff = finalBuyerBaseBalance - initialBuyerBaseBalance;
      expect(buyerBaseTokenDiff).to.equal(marketBuyQuantity);
    });

    it("should handle market orders with insufficient liquidity", async function () {
      // Place a sell order with limited quantity
      const sellPrice = ethers.parseUnits("100", 18);
      const sellQuantity = ethers.parseUnits("1", 18);
      
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice,
        sellQuantity
      );
      const sellOrderId = 1;
      
      // Place a market buy order with quantity exceeding available liquidity
      const marketBuyQuantity = ethers.parseUnits("2", 18);
      const buyOrderTx = await clob.connect(trader2).placeMarketOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        marketBuyQuantity
      );
      
      // Get the buy order ID
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) throw new Error("Transaction receipt is null");
      
      const buyOrderEvent = buyOrderReceipt.logs.find(
        log => log.topics && log.topics[0] === ethers.id("OrderCreated(uint256,address,bool,uint256,uint256)")
      );
      if (!buyOrderEvent) throw new Error("OrderCreated event not found");
      
      const stateInterface = state.interface;
      const parsedLog = stateInterface.parseLog({
        topics: buyOrderEvent.topics,
        data: buyOrderEvent.data
      });
      if (!parsedLog) throw new Error("Failed to parse event log");
      const buyOrderId = parsedLog.args[0]; // Assuming orderId is the first argument
      
      // Verify the market buy order was partially filled
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_PARTIALLY_FILLED);
      expect(buyOrder.filledQuantity).to.equal(ethers.parseUnits("1", 18)); // Corrected: should be 1 not 2
      
      // Verify the sell order was fully filled
      const sellOrder = await state.getOrder(sellOrderId);
      expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(sellOrder.filledQuantity).to.equal(sellQuantity);
    });
  });

  describe("IOC and FOK Order Tests", function () {
    it("should handle IOC orders correctly", async function () {
      // Place a sell order
      const sellPrice = ethers.parseUnits("100", 18);
      const sellQuantity = ethers.parseUnits("1", 18);
      
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice,
        sellQuantity
      );
      const sellOrderId = 1;
      
      // Place an IOC buy order with quantity exceeding available liquidity
      const iocBuyQuantity = ethers.parseUnits("2", 18);
      const buyOrderTx = await clob.connect(trader2).placeIOCOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        sellPrice, // IOC needs a price
        iocBuyQuantity
      );
      
      // Get the buy order ID
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) throw new Error("Transaction receipt is null");
      
      const buyOrderEvent = buyOrderReceipt.logs.find(
        log => log.topics && log.topics[0] === ethers.id("OrderCreated(uint256,address,bool,uint256,uint256)")
      );
      if (!buyOrderEvent) throw new Error("OrderCreated event not found");
      
      const stateInterface = state.interface;
      const parsedLog = stateInterface.parseLog({
        topics: buyOrderEvent.topics,
        data: buyOrderEvent.data
      });
      if (!parsedLog) throw new Error("Failed to parse event log");
      const buyOrderId = parsedLog.args[0]; // Assuming orderId is the first argument
      
      // Verify the IOC buy order was canceled after partial fill
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_CANCELED); // IOC should be CANCELED if not fully filled immediately
      expect(buyOrder.filledQuantity).to.equal(sellQuantity); // Filled available quantity
      
      // Verify the sell order was fully filled
      const sellOrder = await state.getOrder(sellOrderId);
      expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(sellOrder.filledQuantity).to.equal(sellQuantity);
    });

    it("should handle FOK orders correctly when fully fillable", async function () {
      // Place a sell order
      const sellPrice = ethers.parseUnits("100", 18);
      const sellQuantity = ethers.parseUnits("2", 18);
      
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice,
        sellQuantity
      );
      const sellOrderId = 1;
      
      // Place an FOK buy order with quantity less than available liquidity
      const fokBuyQuantity = ethers.parseUnits("1", 18);
      const buyOrderTx = await clob.connect(trader2).placeFOKOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        sellPrice, // FOK needs a price
        fokBuyQuantity
      );
      
      // Get the buy order ID
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) throw new Error("Transaction receipt is null");
      
      const buyOrderEvent = buyOrderReceipt.logs.find(
        log => log.topics && log.topics[0] === ethers.id("OrderCreated(uint256,address,bool,uint256,uint256)")
      );
      if (!buyOrderEvent) throw new Error("OrderCreated event not found");
      
      const stateInterface = state.interface;
      const parsedLog = stateInterface.parseLog({
        topics: buyOrderEvent.topics,
        data: buyOrderEvent.data
      });
      if (!parsedLog) throw new Error("Failed to parse event log");
      const buyOrderId = parsedLog.args[0]; // Assuming orderId is the first argument
      
      // Verify the FOK buy order was fully filled
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED); // Corrected: Fully filled
      expect(buyOrder.filledQuantity).to.equal(fokBuyQuantity);
      
      // Verify the sell order was partially filled
      const sellOrder = await state.getOrder(sellOrderId);
      expect(sellOrder.status).to.equal(ORDER_STATUS_PARTIALLY_FILLED);
      expect(sellOrder.filledQuantity).to.equal(fokBuyQuantity);
    });

    it("should handle FOK orders correctly when not fully fillable", async function () {
      // Place a sell order
      const sellPrice = ethers.parseUnits("100", 18);
      const sellQuantity = ethers.parseUnits("1", 18);
      
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice,
        sellQuantity
      );
      const sellOrderId = 1;
      
      // Place an FOK buy order with quantity exceeding available liquidity
      const fokBuyQuantity = ethers.parseUnits("2", 18);
      const buyOrderTx = await clob.connect(trader2).placeFOKOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        sellPrice, // FOK needs a price
        fokBuyQuantity
      );
      
      // Get the buy order ID
      const buyOrderReceipt = await buyOrderTx.wait();
      if (!buyOrderReceipt) throw new Error("Transaction receipt is null");
      
      const buyOrderEvent = buyOrderReceipt.logs.find(
        log => log.topics && log.topics[0] === ethers.id("OrderCreated(uint256,address,bool,uint256,uint256)")
      );
      if (!buyOrderEvent) throw new Error("OrderCreated event not found");
      
      const stateInterface = state.interface;
      const parsedLog = stateInterface.parseLog({
        topics: buyOrderEvent.topics,
        data: buyOrderEvent.data
      });
      if (!parsedLog) throw new Error("Failed to parse event log");
      const buyOrderId = parsedLog.args[0]; // Assuming orderId is the first argument
      
      // Verify the FOK buy order was canceled
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(ORDER_STATUS_CANCELED); // FOK should be CANCELED if not fully fillable
      expect(buyOrder.filledQuantity).to.equal(0);
      
      // Verify the sell order remains open
      const sellOrder = await state.getOrder(sellOrderId);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      expect(sellOrder.filledQuantity).to.equal(0);
    });
  });

  describe("Batch Settlement Tests", function () {
    it("should handle batch settlements efficiently", async function () {
      // Place multiple sell orders from different traders
      const sellPrice = ethers.parseUnits("100", 18);
      const sellQuantity = ethers.parseUnits("1", 18);
      const buyPrice = ethers.parseUnits("100", 18);
      const buyQuantity = ethers.parseUnits("3", 18);
      
      // Record initial balances
      const initialTrader1Base = await baseToken.balanceOf(await trader1.getAddress());
      const initialTrader1Quote = await quoteToken.balanceOf(await trader1.getAddress());
      const initialTrader2Base = await baseToken.balanceOf(await trader2.getAddress());
      const initialTrader2Quote = await quoteToken.balanceOf(await trader2.getAddress());
      
      // Place sell orders from trader1
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice,
        sellQuantity
      );
      
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice,
        sellQuantity
      );
      
      await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false, // isBuy
        sellPrice,
        sellQuantity
      );
      
      // Place a buy order from trader2 that matches all three sell orders
      await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        buyPrice,
        buyQuantity
      );
      
      // Get final balances
      const finalTrader1Base = await baseToken.balanceOf(await trader1.getAddress());
      const finalTrader1Quote = await quoteToken.balanceOf(await trader1.getAddress());
      const finalTrader2Base = await baseToken.balanceOf(await trader2.getAddress());
      const finalTrader2Quote = await quoteToken.balanceOf(await trader2.getAddress());
      
      // Calculate expected trade value using BigNumber methods, ensuring types
      // In ethers v6, we need to use ethers.getBigInt() or direct operations on bigint values
      const bnBuyPrice = BigInt(buyPrice.toString());
      const bnQuantity = BigInt(buyQuantity.toString());
      const bnOneEth = BigInt(ethers.parseUnits("1", 18).toString());
      const tradeValue = (bnBuyPrice * bnQuantity) / bnOneEth;
      
      // Convert all balance values to BigInt for consistent operations
      const initialTrader1BaseBigInt = BigInt(initialTrader1Base.toString());
      const finalTrader1BaseBigInt = BigInt(finalTrader1Base.toString());
      const initialTrader1QuoteBigInt = BigInt(initialTrader1Quote.toString());
      const finalTrader1QuoteBigInt = BigInt(finalTrader1Quote.toString());
      const initialTrader2BaseBigInt = BigInt(initialTrader2Base.toString());
      const finalTrader2BaseBigInt = BigInt(finalTrader2Base.toString());
      const initialTrader2QuoteBigInt = BigInt(initialTrader2Quote.toString());
      const finalTrader2QuoteBigInt = BigInt(finalTrader2Quote.toString());
      
      // Trader 1 (Seller) should have less base tokens and more quote tokens
      const trader1BaseDiff = initialTrader1BaseBigInt - finalTrader1BaseBigInt;
      const trader1QuoteDiff = finalTrader1QuoteBigInt - initialTrader1QuoteBigInt;
      expect(trader1BaseDiff.toString()).to.equal(buyQuantity.toString());
      expect(trader1QuoteDiff.toString()).to.equal(tradeValue.toString());
      
      // Trader 2 (Buyer) should have more base tokens and less quote tokens
      const trader2BaseDiff = finalTrader2BaseBigInt - initialTrader2BaseBigInt;
      const trader2QuoteDiff = initialTrader2QuoteBigInt - finalTrader2QuoteBigInt;
      expect(trader2BaseDiff.toString()).to.equal(buyQuantity.toString());
      expect(trader2QuoteDiff.toString()).to.equal(tradeValue.toString());
    });
  });
});
