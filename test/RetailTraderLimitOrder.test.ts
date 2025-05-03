import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("Retail Trader Limit Order Tests", function () {
  // Contract instances
  let clob: Contract;
  let book: Contract;
  let state: Contract;
  let vault: Contract;
  let baseToken: Contract;
  let quoteToken: Contract;
  
  // Signers
  let owner: Signer;
  let retailTrader: Signer;
  let otherTrader: Signer;
  let thirdTrader: Signer;
  let feeRecipient: Signer;
  
  // Addresses
  let ownerAddress: string;
  let retailTraderAddress: string;
  let otherTraderAddress: string;
  let thirdTraderAddress: string;
  let feeRecipientAddress: string;

  // Constants
  const BASE_TOKEN_DECIMALS = 18;
  const QUOTE_TOKEN_DECIMALS = 6;
  const INITIAL_MINT_AMOUNT = ethers.parseEther("1000000");
  
  // Order types
  const ORDER_TYPE_LIMIT = 0;
  const ORDER_TYPE_MARKET = 1;
  const ORDER_TYPE_IOC = 2;
  const ORDER_TYPE_FOK = 3;
  
  // Order statuses
  const ORDER_STATUS_OPEN = 0;
  const ORDER_STATUS_FILLED = 1;
  const ORDER_STATUS_CANCELED = 2;
  const ORDER_STATUS_PARTIALLY_FILLED = 3;

  beforeEach(async function () {
    // Get signers
    [owner, retailTrader, otherTrader, thirdTrader, feeRecipient] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    retailTraderAddress = await retailTrader.getAddress();
    otherTraderAddress = await otherTrader.getAddress();
    thirdTraderAddress = await thirdTrader.getAddress();
    feeRecipientAddress = await feeRecipient.getAddress();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken", owner);
    baseToken = await MockToken.deploy("Base Token", "BASE", BASE_TOKEN_DECIMALS);
    quoteToken = await MockToken.deploy("Quote Token", "QUOTE", QUOTE_TOKEN_DECIMALS);
    
    // Mint tokens to traders
    await baseToken.mint(retailTraderAddress, INITIAL_MINT_AMOUNT);
    await baseToken.mint(otherTraderAddress, INITIAL_MINT_AMOUNT);
    await baseToken.mint(thirdTraderAddress, INITIAL_MINT_AMOUNT);
    await quoteToken.mint(retailTraderAddress, INITIAL_MINT_AMOUNT);
    await quoteToken.mint(otherTraderAddress, INITIAL_MINT_AMOUNT);
    await quoteToken.mint(thirdTraderAddress, INITIAL_MINT_AMOUNT);

    // Deploy state contract with owner as admin
    const State = await ethers.getContractFactory("State", owner);
    state = await State.deploy(ownerAddress);

    // Deploy vault contract
    const Vault = await ethers.getContractFactory("Vault", owner);
    vault = await Vault.deploy(
      ownerAddress, 
      await state.getAddress(), 
      feeRecipientAddress,
      50, // makerFeeRate
      100 // takerFeeRate
    );

    // Deploy book contract with correct constructor arguments
    const Book = await ethers.getContractFactory("Book", owner);
    book = await Book.deploy(
      ownerAddress, 
      await state.getAddress(), 
      await baseToken.getAddress(), 
      await quoteToken.getAddress()
    );

    // Set vault in book
    await book.connect(owner).setVault(await vault.getAddress());

    // Set book address in vault
    await vault.connect(owner).setBook(await book.getAddress());

    // Deploy CLOB contract
    const CLOB = await ethers.getContractFactory("CLOB", owner);
    clob = await CLOB.deploy(
      ownerAddress,
      await state.getAddress(),
      await book.getAddress(),
      await vault.getAddress()
    );

    // Add CLOB as admin in state
    await state.connect(owner).addAdmin(await clob.getAddress());
    
    // Set CLOB as the vault in book to authorize it to call matchOrders
    // This is a workaround for testing since Book only allows admin or vault to call matchOrders
    await book.connect(owner).setVault(await clob.getAddress());

    // Add supported trading pair
    await clob.connect(owner).addSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress());
    
    // Approve tokens for trading - now that all contracts are deployed
    await baseToken.connect(retailTrader).approve(await clob.getAddress(), INITIAL_MINT_AMOUNT);
    await quoteToken.connect(retailTrader).approve(await clob.getAddress(), INITIAL_MINT_AMOUNT);
    await baseToken.connect(otherTrader).approve(await clob.getAddress(), INITIAL_MINT_AMOUNT);
    await quoteToken.connect(otherTrader).approve(await clob.getAddress(), INITIAL_MINT_AMOUNT);
    await baseToken.connect(thirdTrader).approve(await clob.getAddress(), INITIAL_MINT_AMOUNT);
    await quoteToken.connect(thirdTrader).approve(await clob.getAddress(), INITIAL_MINT_AMOUNT);
  });

  describe("Limit Order Placement", function () {
    it("Should place a limit buy order and verify it sits on the book", async function () {
      // Define order parameters
      const buyPrice = ethers.parseUnits("100", QUOTE_TOKEN_DECIMALS);
      const buyQuantity = ethers.parseUnits("10", BASE_TOKEN_DECIMALS);
      
      // Place a limit buy order
      const buyTx = await clob.connect(retailTrader).placeOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        buyPrice,
        buyQuantity,
        true, // isBuy
        ORDER_TYPE_LIMIT
      );
      
      // Get the order ID from the event
      const buyReceipt = await buyTx.wait();
      const buyOrderEvent = buyReceipt.logs.find(
        log => log.fragment && log.fragment.name === 'OrderPlaced'
      );
      const buyOrderId = buyOrderEvent.args[0];
      
      // Verify the order exists in the state contract
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.trader).to.equal(retailTraderAddress);
      expect(buyOrder.baseToken).to.equal(await baseToken.getAddress());
      expect(buyOrder.quoteToken).to.equal(await quoteToken.getAddress());
      expect(buyOrder.price).to.equal(buyPrice);
      expect(buyOrder.quantity).to.equal(buyQuantity);
      expect(buyOrder.isBuy).to.be.true;
      expect(buyOrder.orderType).to.equal(ORDER_TYPE_LIMIT);
      expect(buyOrder.status).to.equal(ORDER_STATUS_OPEN);
      
      // Verify the order is on the book
      const bestBidPrice = await book.getBestBidPrice();
      expect(bestBidPrice).to.equal(buyPrice);
      
      // Verify the quantity at the price level
      const quantityAtBidPrice = await book.getQuantityAtPrice(buyPrice, true);
      expect(quantityAtBidPrice).to.equal(buyQuantity);
    });
    
    it("Should place a limit sell order and verify it sits on the book", async function () {
      // Define order parameters
      const sellPrice = ethers.parseUnits("110", QUOTE_TOKEN_DECIMALS);
      const sellQuantity = ethers.parseUnits("5", BASE_TOKEN_DECIMALS);
      
      // Place a limit sell order
      const sellTx = await clob.connect(retailTrader).placeOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        sellPrice,
        sellQuantity,
        false, // isBuy
        ORDER_TYPE_LIMIT
      );
      
      // Get the order ID from the event
      const sellReceipt = await sellTx.wait();
      const sellOrderEvent = sellReceipt.logs.find(
        log => log.fragment && log.fragment.name === 'OrderPlaced'
      );
      const sellOrderId = sellOrderEvent.args[0];
      
      // Verify the order exists in the state contract
      const sellOrder = await state.getOrder(sellOrderId);
      expect(sellOrder.trader).to.equal(retailTraderAddress);
      expect(sellOrder.baseToken).to.equal(await baseToken.getAddress());
      expect(sellOrder.quoteToken).to.equal(await quoteToken.getAddress());
      expect(sellOrder.price).to.equal(sellPrice);
      expect(sellOrder.quantity).to.equal(sellQuantity);
      expect(sellOrder.isBuy).to.be.false;
      expect(sellOrder.orderType).to.equal(ORDER_TYPE_LIMIT);
      expect(sellOrder.status).to.equal(ORDER_STATUS_OPEN);
      
      // Verify the order is on the book
      const bestAskPrice = await book.getBestAskPrice();
      expect(bestAskPrice).to.equal(sellPrice);
      
      // Verify the quantity at the price level
      const quantityAtAskPrice = await book.getQuantityAtPrice(sellPrice, false);
      expect(quantityAtAskPrice).to.equal(sellQuantity);
    });
  });
  
  describe("Multiple Price Levels", function() {
    it("Should maintain correct order book structure with multiple buy orders at different prices", async function() {
      // Place orders at different price levels
      const prices = [
        ethers.parseUnits("98", QUOTE_TOKEN_DECIMALS),
        ethers.parseUnits("99", QUOTE_TOKEN_DECIMALS),
        ethers.parseUnits("100", QUOTE_TOKEN_DECIMALS)
      ];
      
      const quantities = [
        ethers.parseUnits("5", BASE_TOKEN_DECIMALS),
        ethers.parseUnits("10", BASE_TOKEN_DECIMALS),
        ethers.parseUnits("15", BASE_TOKEN_DECIMALS)
      ];
      
      // Place buy orders at different price levels
      for (let i = 0; i < prices.length; i++) {
        await clob.connect(retailTrader).placeOrder(
          await baseToken.getAddress(),
          await quoteToken.getAddress(),
          prices[i],
          quantities[i],
          true, // isBuy
          ORDER_TYPE_LIMIT
        );
      }
      
      // Verify best bid price (should be the highest price)
      const bestBidPrice = await book.getBestBidPrice();
      expect(bestBidPrice).to.equal(prices[2]); // 100 is the highest price
      
      // Verify quantities at each price level
      for (let i = 0; i < prices.length; i++) {
        const quantityAtPrice = await book.getQuantityAtPrice(prices[i], true);
        expect(quantityAtPrice).to.equal(quantities[i]);
      }
    });

    it("Should maintain correct order book structure with multiple sell orders at different prices", async function() {
      // Place orders at different price levels
      const prices = [
        ethers.parseUnits("110", QUOTE_TOKEN_DECIMALS),
        ethers.parseUnits("105", QUOTE_TOKEN_DECIMALS),
        ethers.parseUnits("103", QUOTE_TOKEN_DECIMALS)
      ];
      
      const quantities = [
        ethers.parseUnits("5", BASE_TOKEN_DECIMALS),
        ethers.parseUnits("10", BASE_TOKEN_DECIMALS),
        ethers.parseUnits("15", BASE_TOKEN_DECIMALS)
      ];
      
      // Place sell orders at different price levels
      for (let i = 0; i < prices.length; i++) {
        await clob.connect(retailTrader).placeOrder(
          await baseToken.getAddress(),
          await quoteToken.getAddress(),
          prices[i],
          quantities[i],
          false, // isBuy
          ORDER_TYPE_LIMIT
        );
      }
      
      // Verify best ask price (should be the lowest price)
      const bestAskPrice = await book.getBestAskPrice();
      expect(bestAskPrice).to.equal(prices[2]); // 103 is the lowest price
      
      // Verify quantities at each price level
      for (let i = 0; i < prices.length; i++) {
        const quantityAtPrice = await book.getQuantityAtPrice(prices[i], false);
        expect(quantityAtPrice).to.equal(quantities[i]);
      }
    });
  });

  describe("Multiple Orders at Same Price Level", function() {
    it("Should aggregate quantities correctly for multiple orders at the same price level", async function() {
      // Define order parameters
      const buyPrice = ethers.parseUnits("100", QUOTE_TOKEN_DECIMALS);
      const buyQuantity1 = ethers.parseUnits("10", BASE_TOKEN_DECIMALS);
      const buyQuantity2 = ethers.parseUnits("15", BASE_TOKEN_DECIMALS);
      const buyQuantity3 = ethers.parseUnits("5", BASE_TOKEN_DECIMALS);
      
      // Calculate total quantity (using BigInt for safe addition)
      const totalQuantity = BigInt(buyQuantity1) + BigInt(buyQuantity2) + BigInt(buyQuantity3);
      
      // Place multiple buy orders at the same price level from different traders
      await clob.connect(retailTrader).placeOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        buyPrice,
        buyQuantity1,
        true, // isBuy
        ORDER_TYPE_LIMIT
      );
      
      await clob.connect(otherTrader).placeOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        buyPrice,
        buyQuantity2,
        true, // isBuy
        ORDER_TYPE_LIMIT
      );
      
      await clob.connect(thirdTrader).placeOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        buyPrice,
        buyQuantity3,
        true, // isBuy
        ORDER_TYPE_LIMIT
      );
      
      // Verify the best bid price
      const bestBidPrice = await book.getBestBidPrice();
      expect(bestBidPrice).to.equal(buyPrice);
      
      // Verify the total quantity at the price level
      const quantityAtBidPrice = await book.getQuantityAtPrice(buyPrice, true);
      expect(BigInt(quantityAtBidPrice)).to.equal(totalQuantity);
    });
  });
});
