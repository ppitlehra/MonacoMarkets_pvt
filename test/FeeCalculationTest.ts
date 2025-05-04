import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, TransactionReceipt } from "ethers"; // Added TransactionReceipt
import { Book, CLOB, State, Vault, MockERC20 } from "../typechain-types";

// Helper function to parse units
const parseUnits = (amount: string | number, decimals: number) => ethers.parseUnits(amount.toString(), decimals);

describe("Fee Calculation Tests", function () {
  let owner: Signer;
  let trader1: Signer; // Buyer
  let trader2: Signer; // Seller
  let clob: CLOB;
  let book: Book;
  let state: State;
  let vault: Vault;
  let baseToken: MockERC20;
  let quoteToken: MockERC20;

  // Deploy contracts and set up trading environment
  async function deployAndSetup(makerFeeRate: number, takerFeeRate: number) {
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
    
    await baseToken.connect(owner).mint(trader1Address, parseUnits("10000", 18));
    await quoteToken.connect(owner).mint(trader1Address, parseUnits("1000000", 6));
    await baseToken.connect(owner).mint(trader2Address, parseUnits("10000", 18));
    await quoteToken.connect(owner).mint(trader2Address, parseUnits("1000000", 6));

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
    if (!receipt) {
      throw new Error("Transaction receipt is null");
    }
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

  // Helper to place a market order and return the receipt - UPDATED SIGNATURE
  async function placeMarketOrder(trader: Signer, isBuy: boolean, quantity: bigint, quoteAmount: bigint): Promise<TransactionReceipt | null> {
    const baseTokenAddress = await baseToken.getAddress();
    const quoteTokenAddress = await quoteToken.getAddress();
    // Ensure correct arguments based on buy/sell
    const finalQuantity = isBuy ? 0n : quantity;
    const finalQuoteAmount = isBuy ? quoteAmount : 0n;
    const tx = await clob.connect(trader).placeMarketOrder(baseTokenAddress, quoteTokenAddress, isBuy, finalQuantity, finalQuoteAmount);
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error("Transaction receipt is null");
    }
    return receipt;
  }

  // Helper to get fee events from a transaction receipt
  async function getFeeEvents(receipt: TransactionReceipt | null): Promise<any[]> { // Updated type
    const feeEvents = [];
    if (!receipt) {
      throw new Error("Transaction receipt is null");
    }
    for (const log of receipt.logs) {
      try {
        const parsedLog = vault.interface.parseLog(log);
        if (parsedLog && parsedLog.name === "FeeCollected") {
          feeEvents.push(parsedLog);
        }
      } catch (e) { /* ignore */ }
    }
    return feeEvents;
  }

  describe("Standard Fee Calculation", function() {
    beforeEach(async () => await deployAndSetup(10, 20)); // 10 bps maker, 20 bps taker

    it("Should calculate fees correctly for a standard trade", async function () {
      const trader1Addr = await trader1.getAddress(); // Buyer, Taker
      const trader2Addr = await trader2.getAddress(); // Seller, Maker
      const ownerAddr = await owner.getAddress();

      const price = parseUnits("100", 6); // 100 QUOTE per BASE
      const quantity = parseUnits("10", 18); // 10 BASE
      
      const initialOwnerQuote = await quoteToken.balanceOf(ownerAddr);

      // Trader 2 (Seller) places limit sell order (Maker)
      const sellOrderId = await placeLimitOrder(trader2, false, price, quantity);

      // Trader 1 (Buyer) places matching limit buy order (Taker)
      const buyTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        price,
        quantity
      );
      const buyReceipt = await buyTx.wait();

      // Expected amounts
      const expectedQuoteAmount = BigInt(100 * 10**6 * 10); // 100 QUOTE * 10 BASE = 1000 QUOTE
      const expectedMakerFee = expectedQuoteAmount * 10n / 10000n; // 10 bps = 1 QUOTE
      const expectedTakerFee = expectedQuoteAmount * 20n / 10000n; // 20 bps = 2 QUOTE

      // Verify fee recipient received correct fees
      const finalOwnerQuote = await quoteToken.balanceOf(ownerAddr);
      const totalFees = expectedMakerFee + expectedTakerFee;
      expect(finalOwnerQuote - initialOwnerQuote).to.equal(totalFees);

      // Verify fee events
      const feeEvents = await getFeeEvents(buyReceipt);
      expect(feeEvents.length).to.equal(2, "Should emit two fee events");
      
      // Find maker and taker fee events
      const makerFeeEvent = feeEvents.find(e => e.args.isMaker === true);
      const takerFeeEvent = feeEvents.find(e => e.args.isMaker === false);
      
      expect(makerFeeEvent).to.not.be.undefined;
      expect(takerFeeEvent).to.not.be.undefined;
      
      if (makerFeeEvent && takerFeeEvent) {
        expect(makerFeeEvent.args.amount).to.equal(expectedMakerFee);
        expect(takerFeeEvent.args.amount).to.equal(expectedTakerFee);
        
        // Contract logic: Taker pays BOTH fees
        expect(makerFeeEvent.args.payer).to.equal(trader1Addr); // Taker (Buyer) pays maker fee
        expect(takerFeeEvent.args.payer).to.equal(trader1Addr); // Taker (Buyer) pays taker fee
      }
    });
  });

  describe("Variable Fee Rates", function() {
    it("Should apply updated fee rates correctly", async function () {
      // Start with standard fees
      await deployAndSetup(10, 20); // 10 bps maker, 20 bps taker
      
      const trader1Addr = await trader1.getAddress(); // Buyer, Taker
      const trader2Addr = await trader2.getAddress(); // Seller, Maker
      const ownerAddr = await owner.getAddress();

      // Update fee rates to higher values
      await vault.connect(owner).setFeeRates(50, 100); // 50 bps maker, 100 bps taker
      
      const price = parseUnits("100", 6); // 100 QUOTE per BASE
      const quantity = parseUnits("10", 18); // 10 BASE
      
      const initialOwnerQuote = await quoteToken.balanceOf(ownerAddr);

      // Trader 2 (Seller) places limit sell order (Maker)
      const sellOrderId = await placeLimitOrder(trader2, false, price, quantity);

      // Trader 1 (Buyer) places matching limit buy order (Taker)
      const buyTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        price,
        quantity
      );
      const buyReceipt = await buyTx.wait();

      // Expected amounts with new fee rates
      const expectedQuoteAmount = BigInt(100 * 10**6 * 10); // 100 QUOTE * 10 BASE = 1000 QUOTE
      const expectedMakerFee = expectedQuoteAmount * 50n / 10000n; // 50 bps = 5 QUOTE
      const expectedTakerFee = expectedQuoteAmount * 100n / 10000n; // 100 bps = 10 QUOTE

      // Verify fee recipient received correct fees
      const finalOwnerQuote = await quoteToken.balanceOf(ownerAddr);
      const totalFees = expectedMakerFee + expectedTakerFee;
      expect(finalOwnerQuote - initialOwnerQuote).to.equal(totalFees);

      // Verify fee events
      const feeEvents = await getFeeEvents(buyReceipt);
      expect(feeEvents.length).to.equal(2, "Should emit two fee events");
      
      // Find maker and taker fee events
      const makerFeeEvent = feeEvents.find(e => e.args.isMaker === true);
      const takerFeeEvent = feeEvents.find(e => e.args.isMaker === false);
      
      expect(makerFeeEvent).to.not.be.undefined;
      expect(takerFeeEvent).to.not.be.undefined;
      
      if (makerFeeEvent && takerFeeEvent) {
        expect(makerFeeEvent.args.amount).to.equal(expectedMakerFee);
        expect(takerFeeEvent.args.amount).to.equal(expectedTakerFee);
        // Contract logic: Taker pays BOTH fees
        expect(makerFeeEvent.args.payer).to.equal(trader1Addr); // Taker (Buyer) pays maker fee
        expect(takerFeeEvent.args.payer).to.equal(trader1Addr); // Taker (Buyer) pays taker fee
      }
    });

    it("Should handle zero fee rates correctly", async function () {
      // Deploy with zero fees
      await deployAndSetup(0, 0); // 0 bps maker, 0 bps taker
      
      const trader1Addr = await trader1.getAddress(); // Buyer, Taker
      const trader2Addr = await trader2.getAddress(); // Seller, Maker
      const ownerAddr = await owner.getAddress();

      const price = parseUnits("100", 6); // 100 QUOTE per BASE
      const quantity = parseUnits("10", 18); // 10 BASE
      
      const initialOwnerQuote = await quoteToken.balanceOf(ownerAddr);
      const initialTrader1Quote = await quoteToken.balanceOf(trader1Addr);
      const initialTrader2Quote = await quoteToken.balanceOf(trader2Addr);

      // Trader 2 (Seller) places limit sell order (Maker)
      const sellOrderId = await placeLimitOrder(trader2, false, price, quantity);

      // Trader 1 (Buyer) places matching limit buy order (Taker)
      const buyTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        price,
        quantity
      );
      const buyReceipt = await buyTx.wait();

      // Expected amounts
      const expectedQuoteAmount = BigInt(100 * 10**6 * 10); // 100 QUOTE * 10 BASE = 1000 QUOTE

      // Verify fee recipient received no fees
      const finalOwnerQuote = await quoteToken.balanceOf(ownerAddr);
      expect(finalOwnerQuote).to.equal(initialOwnerQuote);

      // Verify trader balances reflect no fees
      const finalTrader1Quote = await quoteToken.balanceOf(trader1Addr);
      const finalTrader2Quote = await quoteToken.balanceOf(trader2Addr);
      
      // Taker (Buyer) pays quote amount
      expect(initialTrader1Quote - finalTrader1Quote).to.equal(expectedQuoteAmount);
      // Maker (Seller) receives quote amount - balance increases
      expect(finalTrader2Quote - initialTrader2Quote).to.equal(expectedQuoteAmount); // Corrected assertion

      // Verify no fee events
      const feeEvents = await getFeeEvents(buyReceipt);
      expect(feeEvents.length).to.equal(0, "Should not emit fee events");
    });
  });

  describe("Fee Precision Edge Cases", function() {
    beforeEach(async () => await deployAndSetup(10, 20)); // 10 bps maker, 20 bps taker

    it("Should handle very small trade amounts correctly", async function () {
      const trader1Addr = await trader1.getAddress(); // Buyer, Taker
      const trader2Addr = await trader2.getAddress(); // Seller, Maker
      const ownerAddr = await owner.getAddress();

      // Very small trade
      const price = parseUnits("0.000001", 6); // 0.000001 QUOTE per BASE
      const quantity = parseUnits("0.000001", 18); // 0.000001 BASE
      
      const initialOwnerQuote = await quoteToken.balanceOf(ownerAddr);

      // Trader 2 (Seller) places limit sell order (Maker)
      const sellOrderId = await placeLimitOrder(trader2, false, price, quantity);

      // Trader 1 (Buyer) places matching limit buy order (Taker)
      const buyTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        price,
        quantity
      );
      const buyReceipt = await buyTx.wait();

      // Expected amounts
      // Total value = 0.000001 * 0.000001 = 0.000000000001 QUOTE
      // This is below 1 unit in 6 decimals, so should round to 0 or 1 depending on implementation
      const expectedQuoteAmount = (quantity * price) / BigInt(10**18);
      
      // Fees on such small amounts should be 0
      const expectedMakerFee = expectedQuoteAmount * 10n / 10000n;
      const expectedTakerFee = expectedQuoteAmount * 20n / 10000n;

      // Verify fee recipient balance
      const finalOwnerQuote = await quoteToken.balanceOf(ownerAddr);
      const totalFees = expectedMakerFee + expectedTakerFee;
      
      // For extremely small trades, fees might be 0 due to rounding
      expect(finalOwnerQuote - initialOwnerQuote).to.equal(totalFees);
      
      // Check if any fee events were emitted
      const feeEvents = await getFeeEvents(buyReceipt);
      
      // If fees are 0, no events should be emitted
      if (totalFees === 0n) {
        expect(feeEvents.length).to.equal(0, "Should not emit fee events for zero fees");
      } else {
        // If fees are non-zero (due to rounding up), check payer
        const makerFeeEvent = feeEvents.find(e => e.args.isMaker === true);
        const takerFeeEvent = feeEvents.find(e => e.args.isMaker === false);
        if (makerFeeEvent) expect(makerFeeEvent.args.payer).to.equal(trader1Addr);
        if (takerFeeEvent) expect(takerFeeEvent.args.payer).to.equal(trader1Addr);
      }
    });

    it("Should handle large trade amounts without overflow", async function () {
      // Fund traders with large amounts
      const trader1Addr = await trader1.getAddress(); // Buyer, Taker
      const trader2Addr = await trader2.getAddress(); // Seller, Maker
      
      // Mint enough quote tokens for trader1 to cover trade + fees
      await quoteToken.connect(owner).mint(trader1Addr, parseUnits("1100000000", 6)); // 1.1 billion QUOTE
      
      const ownerAddr = await owner.getAddress();
      
      // Large trade
      const price = parseUnits("1000000", 6); // 1,000,000 QUOTE per BASE
      const quantity = parseUnits("1000", 18); // 1,000 BASE
      
      const initialOwnerQuote = await quoteToken.balanceOf(ownerAddr);

      // Trader 2 (Seller) places limit sell order (Maker)
      const sellOrderId = await placeLimitOrder(trader2, false, price, quantity);

      // Trader 1 (Buyer) places matching limit buy order (Taker)
      const buyTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        price,
        quantity
      );
      const buyReceipt = await buyTx.wait();

      // Expected amounts
      // Total value = 1,000,000 * 1,000 = 1,000,000,000 QUOTE
      const expectedQuoteAmount = BigInt(1000000 * 10**6) * BigInt(1000);
      const expectedMakerFee = expectedQuoteAmount * 10n / 10000n; // 10 bps = 1,000,000 QUOTE
      const expectedTakerFee = expectedQuoteAmount * 20n / 10000n; // 20 bps = 2,000,000 QUOTE

      // Verify fee recipient received correct fees
      const finalOwnerQuote = await quoteToken.balanceOf(ownerAddr);
      const totalFees = expectedMakerFee + expectedTakerFee;
      expect(finalOwnerQuote - initialOwnerQuote).to.equal(totalFees);

      // Verify fee events
      const feeEvents = await getFeeEvents(buyReceipt);
      expect(feeEvents.length).to.equal(2, "Should emit two fee events");
      
      // Find maker and taker fee events
      const makerFeeEvent = feeEvents.find(e => e.args.isMaker === true);
      const takerFeeEvent = feeEvents.find(e => e.args.isMaker === false);
      
      expect(makerFeeEvent).to.not.be.undefined;
      expect(takerFeeEvent).to.not.be.undefined;
      
      if (makerFeeEvent && takerFeeEvent) {
        expect(makerFeeEvent.args.amount).to.equal(expectedMakerFee);
        expect(takerFeeEvent.args.amount).to.equal(expectedTakerFee);
        // Contract logic: Taker pays BOTH fees
        expect(makerFeeEvent.args.payer).to.equal(trader1Addr); // Taker (Buyer) pays maker fee
        expect(takerFeeEvent.args.payer).to.equal(trader1Addr); // Taker (Buyer) pays taker fee
      }
    });
  });

  describe("Fee Direction", function() {
    beforeEach(async () => await deployAndSetup(10, 20)); // 10 bps maker, 20 bps taker

    it("Should apply fees correctly when taker is buyer", async function () {
      const trader1Addr = await trader1.getAddress(); // Buyer, Taker
      const trader2Addr = await trader2.getAddress(); // Seller, Maker
      const ownerAddr = await owner.getAddress();

      const price = parseUnits("100", 6); // 100 QUOTE per BASE
      const quantity = parseUnits("10", 18); // 10 BASE
      
      const initialOwnerQuote = await quoteToken.balanceOf(ownerAddr);

      // Trader 2 (Seller) places limit sell order (Maker)
      const sellOrderId = await placeLimitOrder(trader2, false, price, quantity);

      // Trader 1 (Buyer) places matching limit buy order (Taker)
      const buyTx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true,
        price,
        quantity
      );
      const buyReceipt = await buyTx.wait();

      // Expected amounts
      const expectedQuoteAmount = BigInt(100 * 10**6 * 10); // 100 QUOTE * 10 BASE = 1000 QUOTE
      const expectedMakerFee = expectedQuoteAmount * 10n / 10000n; // 10 bps = 1 QUOTE
      const expectedTakerFee = expectedQuoteAmount * 20n / 10000n; // 20 bps = 2 QUOTE

      // Verify fee events
      const feeEvents = await getFeeEvents(buyReceipt);
      expect(feeEvents.length).to.equal(2, "Should emit two fee events");
      
      const makerFeeEvent = feeEvents.find(e => e.args.isMaker === true);
      const takerFeeEvent = feeEvents.find(e => e.args.isMaker === false);
      
      expect(makerFeeEvent).to.not.be.undefined;
      expect(takerFeeEvent).to.not.be.undefined;
      
      if (makerFeeEvent && takerFeeEvent) {
        expect(makerFeeEvent.args.amount).to.equal(expectedMakerFee);
        expect(takerFeeEvent.args.amount).to.equal(expectedTakerFee);
        
        // Contract logic: Taker pays BOTH fees
        expect(makerFeeEvent.args.payer).to.equal(trader1Addr); // Taker (Buyer) pays maker fee
        expect(takerFeeEvent.args.payer).to.equal(trader1Addr); // Taker (Buyer) pays taker fee
      }
    });

    it("Should apply fees correctly when taker is seller", async function () {
      const trader1Addr = await trader1.getAddress(); // Buyer, Maker
      const trader2Addr = await trader2.getAddress(); // Seller, Taker
      const ownerAddr = await owner.getAddress();

      const price = parseUnits("100", 6); // 100 QUOTE per BASE
      const quantity = parseUnits("10", 18); // 10 BASE
      
      const initialOwnerQuote = await quoteToken.balanceOf(ownerAddr);

      // Trader 1 (Buyer) places limit buy order (Maker)
      const buyOrderId = await placeLimitOrder(trader1, true, price, quantity);

      // Trader 2 (Seller) places matching limit sell order (Taker)
      const sellTx = await clob.connect(trader2).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        false,
        price,
        quantity
      );
      const sellReceipt = await sellTx.wait();

      // Expected amounts
      const expectedQuoteAmount = BigInt(100 * 10**6 * 10); // 100 QUOTE * 10 BASE = 1000 QUOTE
      const expectedMakerFee = expectedQuoteAmount * 10n / 10000n; // 10 bps = 1 QUOTE
      const expectedTakerFee = expectedQuoteAmount * 20n / 10000n; // 20 bps = 2 QUOTE

      // Verify fee events
      const feeEvents = await getFeeEvents(sellReceipt);
      expect(feeEvents.length).to.equal(2, "Should emit two fee events");
      
      const makerFeeEvent = feeEvents.find(e => e.args.isMaker === true);
      const takerFeeEvent = feeEvents.find(e => e.args.isMaker === false);
      
      expect(makerFeeEvent).to.not.be.undefined;
      expect(takerFeeEvent).to.not.be.undefined;
      
      if (makerFeeEvent && takerFeeEvent) {
        expect(makerFeeEvent.args.amount).to.equal(expectedMakerFee);
        expect(takerFeeEvent.args.amount).to.equal(expectedTakerFee);
        
        // Contract logic: Maker pays maker fee, Taker pays taker fee when Taker is Seller
        expect(makerFeeEvent.args.payer).to.equal(trader1Addr); // Maker (Buyer) pays maker fee
        expect(takerFeeEvent.args.payer).to.equal(trader2Addr); // Taker (Seller) pays taker fee
      }
    });
  });
});

