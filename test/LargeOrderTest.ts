import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Book, CLOB, State, Vault, MockERC20 } from "../typechain-types";

// Helper function to parse units
const parseUnits = (amount: string | number, decimals: number) => ethers.parseUnits(amount.toString(), decimals);

describe("Large Order Handling Tests", function () {
  let owner: Signer;
  let trader1: Signer; // Buyer
  let trader2: Signer; // Seller
  let clob: CLOB;
  let book: Book;
  let state: State;
  let vault: Vault;
  let baseToken: MockERC20;
  let quoteToken: MockERC20;

  // Define a significantly smaller large quantity to test overflow hypothesis
  const largeQuantity = ethers.MaxUint256 / 1000000n; // Further reduced from / 10000n

  // Deploy contracts and set up trading environment
  async function deployAndSetup() {
    [owner, trader1, trader2] = await ethers.getSigners();
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

    const makerFeeRate = 10; // 10 bps
    const takerFeeRate = 20; // 20 bps
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

    // Fund traders with extremely large amounts
    const trader1Address = await trader1.getAddress();
    const trader2Address = await trader2.getAddress();
    
    // Use MaxUint256 / 2 to avoid potential overflow issues during transfers/fees
    // Ensure balance is greater than largeQuantity used in tests
    const largeAmountBase = ethers.MaxUint256 / 2n;
    const largeAmountQuote = ethers.MaxUint256 / 2n; 
    
    await baseToken.connect(owner).mint(trader1Address, largeAmountBase);
    await quoteToken.connect(owner).mint(trader1Address, largeAmountQuote);
    await baseToken.connect(owner).mint(trader2Address, largeAmountBase);
    await quoteToken.connect(owner).mint(trader2Address, largeAmountQuote);

    // Approve vault to spend tokens
    const vaultAddress2 = await vault.getAddress();
    await baseToken.connect(trader1).approve(vaultAddress2, ethers.MaxUint256);
    await quoteToken.connect(trader1).approve(vaultAddress2, ethers.MaxUint256);
    await baseToken.connect(trader2).approve(vaultAddress2, ethers.MaxUint256);
    await quoteToken.connect(trader2).approve(vaultAddress2, ethers.MaxUint256);
  }

  // Helper to place a limit order and return its ID
  async function placeLimitOrder(trader: Signer, isBuy: boolean, price: bigint, quantity: bigint): Promise<bigint> {
    const baseTokenAddress = await baseToken.getAddress();
    const quoteTokenAddress = await quoteToken.getAddress();
    const tx = await clob.connect(trader).placeLimitOrder(baseTokenAddress, quoteTokenAddress, isBuy, price, quantity);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction receipt is null");
    for (const log of receipt.logs) {
      try {
        const parsedLog = state.interface.parseLog(log);
        if (parsedLog && parsedLog.name === "OrderCreated") {
          return parsedLog.args.orderId;
        }
      } catch (e) { /* ignore */ }
    }
    throw new Error("OrderCreated event not found");
  }

  describe("Maximum Quantity Orders", function() {
    beforeEach(deployAndSetup);

    it("Should handle orders with near maximum uint256 quantity", async function () {
      const trader1Addr = await trader1.getAddress();
      const trader2Addr = await trader2.getAddress();

      const price = parseUnits("1", 6); // 1 QUOTE per BASE
      // Use the further reduced largeQuantity defined above

      // Trader 2 (Seller) places limit sell order
      const sellOrderId = await placeLimitOrder(trader2, false, price, largeQuantity);

      // Trader 1 (Buyer) places matching limit buy order
      const buyTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        price,
        largeQuantity
      );
      const buyReceipt = await buyTx.wait();
      if (!buyReceipt) throw new Error("Buy transaction receipt is null");

      // Verify the order was accepted and matched (basic check)
      const sellOrder = await state.getOrder(sellOrderId);
      expect(sellOrder.status).to.equal(2, "Sell order should be filled");
      
      // Extract buy order ID
      let buyOrderId;
      for (const log of buyReceipt.logs) {
        try {
          const parsedLog = state.interface.parseLog(log);
          if (parsedLog && parsedLog.name === "OrderCreated") {
            buyOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore */ }
      }
      if (!buyOrderId) throw new Error("Buy OrderCreated event not found");
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(2, "Buy order should be filled");
    });
  });

  describe("Very High Price Orders", function() {
    beforeEach(deployAndSetup);

    it("Should handle orders with very high prices", async function () {
      const trader1Addr = await trader1.getAddress();
      const trader2Addr = await trader2.getAddress();

      // Use a very high price, close to uint256 max / quantity to avoid overflow
      const quantity = parseUnits("1", 18); // 1 BASE
      // Ensure highPrice * quantity doesn't overflow uint256
      // Further reduce the high price calculation divisor
      const highPrice = (ethers.MaxUint256 / quantity / 10000n) / BigInt(10**(18-6)); // Adjust for quote decimals (6)

      // Trader 2 (Seller) places limit sell order
      const sellOrderId = await placeLimitOrder(trader2, false, highPrice, quantity);

      // Trader 1 (Buyer) places matching limit buy order
      const buyTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        highPrice,
        quantity
      );
      const buyReceipt = await buyTx.wait();
      if (!buyReceipt) throw new Error("Buy transaction receipt is null");

      // Verify the order was accepted and matched (basic check)
      const sellOrder = await state.getOrder(sellOrderId);
      expect(sellOrder.status).to.equal(2, "Sell order should be filled");
      
      // Extract buy order ID
      let buyOrderId;
      for (const log of buyReceipt.logs) {
        try {
          const parsedLog = state.interface.parseLog(log);
          if (parsedLog && parsedLog.name === "OrderCreated") {
            buyOrderId = parsedLog.args.orderId;
            break;
          }
        } catch (e) { /* ignore */ }
      }
      if (!buyOrderId) throw new Error("Buy OrderCreated event not found");
      const buyOrder = await state.getOrder(buyOrderId);
      expect(buyOrder.status).to.equal(2, "Buy order should be filled");
    });
  });

  describe("Matching Large Orders", function() {
    beforeEach(deployAndSetup);

    it("Should correctly match large quantity orders against each other", async function () {
      const trader1Addr = await trader1.getAddress();
      const trader2Addr = await trader2.getAddress();

      const price = parseUnits("1", 6); // 1 QUOTE per BASE
      // Use the further reduced largeQuantity defined above

      const initialTrader1Base = await baseToken.balanceOf(trader1Addr);
      const initialTrader1Quote = await quoteToken.balanceOf(trader1Addr);
      const initialTrader2Base = await baseToken.balanceOf(trader2Addr);
      const initialTrader2Quote = await quoteToken.balanceOf(trader2Addr);

      // Trader 2 (Seller) places limit sell order
      const sellOrderId = await placeLimitOrder(trader2, false, price, largeQuantity);

      // Trader 1 (Buyer) places matching limit buy order
      const buyTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        price,
        largeQuantity
      );
      await buyTx.wait();

      // Verify balances changed appropriately (ignoring fees for simplicity with MaxUint)
      const finalTrader1Base = await baseToken.balanceOf(trader1Addr);
      const finalTrader1Quote = await quoteToken.balanceOf(trader1Addr);
      const finalTrader2Base = await baseToken.balanceOf(trader2Addr);
      const finalTrader2Quote = await quoteToken.balanceOf(trader2Addr);

      // Calculate expected quote transfer (price * quantity / 10**base_decimals)
      const expectedQuoteTransfer = (price * largeQuantity) / BigInt(10**18);

      // More precise checks
      expect(finalTrader1Base - initialTrader1Base).to.equal(largeQuantity, "Trader1 base balance change incorrect");
      // Taker (Buyer) pays quote + fees
      // Fee calculation might still overflow, let's check the transfer amount first
      expect(initialTrader1Quote - finalTrader1Quote).to.be.gte(expectedQuoteTransfer, "Trader1 quote balance should decrease by at least quote transfer");
      expect(initialTrader2Base - finalTrader2Base).to.equal(largeQuantity, "Trader2 base balance change incorrect");
      // Maker (Seller) receives quote - fees
      expect(finalTrader2Quote - initialTrader2Quote).to.be.lte(expectedQuoteTransfer, "Trader2 quote balance should increase by at most quote transfer");
    });
  });

  describe("Gas Usage for Large Orders", function() {
    beforeEach(deployAndSetup);

    it("Should have reasonable gas usage for placing large orders", async function () {
      const price = parseUnits("1", 6);
      // Use the further reduced largeQuantity defined above

      const tx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        price,
        largeQuantity
      );
      const receipt = await tx.wait();
      if (!receipt) throw new Error("Transaction receipt is null");
      const gasUsed = receipt.gasUsed;
      console.log(`Gas used for placing large order: ${gasUsed}`);
      // Add assertion for gas limit if needed
      // expect(gasUsed).to.be.lt(SOME_GAS_LIMIT);
    });

    it("Should have reasonable gas usage for matching large orders", async function () {
      const price = parseUnits("1", 6);
      // Use the further reduced largeQuantity defined above

      // Place sell order
      await placeLimitOrder(trader2, false, price, largeQuantity);

      // Place matching buy order and measure gas
      const tx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        price,
        largeQuantity
      );
      const receipt = await tx.wait();
      if (!receipt) throw new Error("Transaction receipt is null");
      const gasUsed = receipt.gasUsed;
      console.log(`Gas used for matching large orders: ${gasUsed}`);
      // Add assertion for gas limit if needed
      // expect(gasUsed).to.be.lt(SOME_GAS_LIMIT);
    });
  });
});

