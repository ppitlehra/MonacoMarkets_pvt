/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Book, CLOB, State, Vault, MockERC20 } from "../typechain-types";

// Helper function to parse units
const parseUnits = (amount: string | number, decimals: number) => ethers.parseUnits(amount.toString(), decimals);

describe("Decimal Handling Tests", function () {
  let owner: Signer;
  let trader1: Signer; // Buyer
  let trader2: Signer; // Seller
  let clob: CLOB;
  let book: Book;
  let state: State;
  let vault: Vault;
  let token6Decimals: MockERC20; // e.g., USDC
  let token18Decimals: MockERC20; // e.g., WETH

  // Deploy contracts and set up trading environment
  async function deployAndSetup(baseDecimals: number, quoteDecimals: number) {
    [owner, trader1, trader2] = await ethers.getSigners();
    const ownerAddress = await owner.getAddress();

    // Deploy Mock ERC20 Tokens with specified decimals
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const baseToken = (await MockERC20.deploy("Base Token", "BASE", baseDecimals, ownerAddress)) as unknown as MockERC20;
    const quoteToken = (await MockERC20.deploy("Quote Token", "QUOTE", quoteDecimals, ownerAddress)) as unknown as MockERC20;
    const baseTokenAddress = await baseToken.getAddress();
    const quoteTokenAddress = await quoteToken.getAddress();

    // Assign based on decimals for clarity in tests
    if (baseDecimals === 18) {
        token18Decimals = baseToken;
        token6Decimals = quoteToken;
    } else {
        token18Decimals = quoteToken;
        token6Decimals = baseToken;
    }

    // Deploy Core Contracts
    const State = await ethers.getContractFactory("State");
    state = (await State.deploy(ownerAddress)) as unknown as State;
    const stateAddress = await state.getAddress();

    const makerFeeRate = 10; // 10 bps = 0.1%
    const takerFeeRate = 20; // 20 bps = 0.2%
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
    
    // Fund generously to avoid balance issues
    await baseToken.connect(owner).mint(trader1Address, parseUnits("1000000", baseDecimals));
    await quoteToken.connect(owner).mint(trader1Address, parseUnits("1000000", quoteDecimals));
    await baseToken.connect(owner).mint(trader2Address, parseUnits("1000000", baseDecimals));
    await quoteToken.connect(owner).mint(trader2Address, parseUnits("1000000", quoteDecimals));

    // Approve vault to spend tokens
    const vaultAddress2 = await vault.getAddress();
    await baseToken.connect(trader1).approve(vaultAddress2, ethers.MaxUint256);
    await quoteToken.connect(trader1).approve(vaultAddress2, ethers.MaxUint256);
    await baseToken.connect(trader2).approve(vaultAddress2, ethers.MaxUint256);
    await quoteToken.connect(trader2).approve(vaultAddress2, ethers.MaxUint256);
  }

  // Helper to place a limit order and return its ID
  async function placeLimitOrder(trader: Signer, baseAddr: string, quoteAddr: string, isBuy: boolean, price: bigint, quantity: bigint): Promise<bigint> {
    const tx = await clob.connect(trader).placeLimitOrder(baseAddr, quoteAddr, isBuy, price, quantity);
    const receipt = await tx.wait();
    if (!receipt || !receipt.logs) {
      throw new Error("Transaction receipt is null or missing logs");
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

  describe("Trade 18-decimal (Base) vs 6-decimal (Quote)", function() {
    beforeEach(async () => await deployAndSetup(18, 6));

    it("Should handle settlement precision correctly", async function () {
      const baseAddr = await token18Decimals.getAddress();
      const quoteAddr = await token6Decimals.getAddress();
      const trader1Addr = await trader1.getAddress();
      const trader2Addr = await trader2.getAddress();

      const price = parseUnits("1500", 6); // Price in quote tokens (6 decimals)
      const quantity = parseUnits("1", 18); // Quantity in base tokens (18 decimals)
      
      const initialTrader1Base = await token18Decimals.balanceOf(trader1Addr);
      const initialTrader1Quote = await token6Decimals.balanceOf(trader1Addr);
      const initialTrader2Base = await token18Decimals.balanceOf(trader2Addr);
      const initialTrader2Quote = await token6Decimals.balanceOf(trader2Addr);

      // Trader 2 (Seller) places limit sell order for 1 BASE @ 1500 QUOTE
      const makerOrderId = await placeLimitOrder(trader2, baseAddr, quoteAddr, false, price, quantity);

      // Trader 1 (Buyer) places matching limit buy order
      const tx = await clob.connect(trader1).placeLimitOrder(baseAddr, quoteAddr, true, price, quantity);
      await tx.wait();

      // Expected amounts (Fees: Maker 0.1%, Taker 0.2%)
      const expectedQuoteAmount = BigInt(1500 * 10**6); // 1500 USDC
      const expectedBaseAmount = BigInt(1 * 10**18); // 1 WETH
      const makerFee = expectedQuoteAmount * 10n / 10000n; // 1.5 USDC
      const takerFee = expectedQuoteAmount * 20n / 10000n; // 3 USDC

      // Verify Trader 1 (Buyer) balances
      // Received: 1 BASE
      // Sent: 1500 QUOTE + 3 QUOTE (Taker Fee to recipient)
      expect(await token18Decimals.balanceOf(trader1Addr)).to.equal(initialTrader1Base + expectedBaseAmount);
      expect(await token6Decimals.balanceOf(trader1Addr)).to.equal(initialTrader1Quote - expectedQuoteAmount - takerFee); // CORRECTED: Buyer pays QuoteAmount + TakerFee

      // Verify Trader 2 (Seller) balances
      // Sent: 1 BASE
      // Received: 1500 QUOTE - 1.5 QUOTE (Maker Fee)
      expect(await token18Decimals.balanceOf(trader2Addr)).to.equal(initialTrader2Base - expectedBaseAmount);
      expect(await token6Decimals.balanceOf(trader2Addr)).to.equal(initialTrader2Quote + expectedQuoteAmount - makerFee);
    });
  });

  describe("Trade 6-decimal (Base) vs 18-decimal (Quote)", function() {
    beforeEach(async () => await deployAndSetup(6, 18));

    it("Should handle settlement precision correctly (reversed decimals)", async function () {
      const baseAddr = await token6Decimals.getAddress();
      const quoteAddr = await token18Decimals.getAddress();
      const trader1Addr = await trader1.getAddress();
      const trader2Addr = await trader2.getAddress();

      // Price needs to be scaled appropriately for 18-decimal quote
      // Let's say 1 BASE (6 dec) = 0.0001 QUOTE (18 dec)
      const price = parseUnits("0.0001", 18); // Price in quote tokens (18 decimals)
      const quantity = parseUnits("100", 6); // Quantity in base tokens (6 decimals)
      
      const initialTrader1Base = await token6Decimals.balanceOf(trader1Addr);
      const initialTrader1Quote = await token18Decimals.balanceOf(trader1Addr);
      const initialTrader2Base = await token6Decimals.balanceOf(trader2Addr);
      const initialTrader2Quote = await token18Decimals.balanceOf(trader2Addr);

      // Trader 2 (Seller) places limit sell order for 100 BASE @ 0.0001 QUOTE
      const makerOrderId = await placeLimitOrder(trader2, baseAddr, quoteAddr, false, price, quantity);

      // Trader 1 (Buyer) places matching limit buy order
      const tx = await clob.connect(trader1).placeLimitOrder(baseAddr, quoteAddr, true, price, quantity);
      await tx.wait();

      // Expected amounts (Fees: Maker 0.1%, Taker 0.2%)
      // Total Quote Value = Quantity * Price = 100 * 0.0001 = 0.01 QUOTE (18 dec)
      const expectedQuoteAmount = quantity * price / BigInt(10**6); // Adjust for base decimals
      const expectedBaseAmount = quantity;
      const makerFee = expectedQuoteAmount * 10n / 10000n;
      const takerFee = expectedQuoteAmount * 20n / 10000n;

      // Verify Trader 1 (Buyer) balances
      // Received: 100 BASE
      // Sent: 0.01 QUOTE + Taker Fee (to recipient)
      expect(await token6Decimals.balanceOf(trader1Addr)).to.equal(initialTrader1Base + expectedBaseAmount);
      expect(await token18Decimals.balanceOf(trader1Addr)).to.equal(initialTrader1Quote - expectedQuoteAmount - takerFee); // CORRECTED: Buyer pays QuoteAmount + TakerFee

      // Verify Trader 2 (Seller) balances
      // Sent: 100 BASE
      // Received: 0.01 QUOTE - Maker Fee
      expect(await token6Decimals.balanceOf(trader2Addr)).to.equal(initialTrader2Base - expectedBaseAmount);
      expect(await token18Decimals.balanceOf(trader2Addr)).to.equal(initialTrader2Quote + expectedQuoteAmount - makerFee);
    });
  });

  describe("Small Trade Amount & Fee Precision", function() {
    beforeEach(async () => await deployAndSetup(18, 6)); // Base=18, Quote=6

    it("Should calculate fees correctly even for very small trade values", async function () {
      const baseAddr = await token18Decimals.getAddress();
      const quoteAddr = await token6Decimals.getAddress();
      const trader1Addr = await trader1.getAddress();
      const trader2Addr = await trader2.getAddress();
      const ownerAddr = await owner.getAddress();

      // Price: 1 BASE = 0.01 QUOTE (6 dec)
      const price = parseUnits("0.01", 6);
      // Quantity: 0.000001 BASE (18 dec) - very small
      const quantity = parseUnits("0.000001", 18);
      
      const initialTrader1Quote = await token6Decimals.balanceOf(trader1Addr);
      const initialTrader2Quote = await token6Decimals.balanceOf(trader2Addr);
      const initialFeeRecipientQuote = await token6Decimals.balanceOf(ownerAddr);

      // Trader 2 (Seller) places limit sell order
      const makerOrderId = await placeLimitOrder(trader2, baseAddr, quoteAddr, false, price, quantity);

      // Trader 1 (Buyer) places matching limit buy order
      const tx = await clob.connect(trader1).placeLimitOrder(baseAddr, quoteAddr, true, price, quantity);
      await tx.wait();

      // Expected amounts
      // Total Quote Value = Quantity * Price = 0.000001 * 0.01 = 0.00000001 QUOTE (6 dec)
      // This value is less than 1 unit of the 6-decimal token (10^-6)
      // Vault calculates quoteAmount = quantity * price / 10**base_decimals
      // quoteAmount = (10**12) * (10**4) / 10**18 = 10**16 / 10**18 = 0.01 units of quote token (6 dec)
      // CORRECTED: Due to integer division in mulDiv, the result is 0
      const expectedQuoteAmount = 0n; // Corrected expectation
      
      // Fees (Maker 0.1%, Taker 0.2%)
      const makerFee = 0n; // Corrected expectation
      const takerFee = 0n; // Corrected expectation

      // Verify Trader 1 (Buyer) balance change
      // Sent: 100 units QUOTE + 0 QUOTE (Taker Fee)
      expect(await token6Decimals.balanceOf(trader1Addr)).to.equal(initialTrader1Quote - expectedQuoteAmount - takerFee);

      // Verify Trader 2 (Seller) balance change
      // Received: 100 units QUOTE - 0 QUOTE (Maker Fee)
      expect(await token6Decimals.balanceOf(trader2Addr)).to.equal(initialTrader2Quote + expectedQuoteAmount - makerFee);

      // Verify Fee Recipient balance change (should be 0)
      expect(await token6Decimals.balanceOf(ownerAddr)).to.equal(initialFeeRecipientQuote + makerFee + takerFee);
      expect(makerFee + takerFee).to.equal(0, "Total fees should be 0 due to rounding");
    });

    it("Should handle trades where fees are non-zero but small", async function () {
        const baseAddr = await token18Decimals.getAddress();
        const quoteAddr = await token6Decimals.getAddress();
        const trader1Addr = await trader1.getAddress();
        const trader2Addr = await trader2.getAddress();
        const ownerAddr = await owner.getAddress();
  
        // Price: 1 BASE = 1 QUOTE (6 dec)
        const price = parseUnits("1", 6);
        // Quantity: 0.01 BASE (18 dec)
        const quantity = parseUnits("0.01", 18);
        
        const initialTrader1Quote = await token6Decimals.balanceOf(trader1Addr);
        const initialTrader2Quote = await token6Decimals.balanceOf(trader2Addr);
        const initialFeeRecipientQuote = await token6Decimals.balanceOf(ownerAddr);
  
        // Trader 2 (Seller) places limit sell order
        const makerOrderId = await placeLimitOrder(trader2, baseAddr, quoteAddr, false, price, quantity);
  
        // Trader 1 (Buyer) places matching limit buy order
        const tx = await clob.connect(trader1).placeLimitOrder(baseAddr, quoteAddr, true, price, quantity);
        await tx.wait();
  
        // Expected amounts
        // Total Quote Value = 0.01 * 1 = 0.01 QUOTE (6 dec)
        const expectedQuoteAmount = quantity * price / BigInt(10**18); // 10000 units (10000 * 10^-6)
        
        // Fees (Maker 0.1%, Taker 0.2%)
        const makerFee = expectedQuoteAmount * 10n / 10000n; // 10000 * 0.001 = 10 units
        const takerFee = expectedQuoteAmount * 20n / 10000n; // 10000 * 0.002 = 20 units
  
        // Verify Trader 1 (Buyer) balance change
        // Sent: 10000 units QUOTE + 20 units QUOTE (Taker Fee to recipient)
        expect(await token6Decimals.balanceOf(trader1Addr)).to.equal(initialTrader1Quote - expectedQuoteAmount - takerFee); // CORRECTED: Buyer pays QuoteAmount + TakerFee
  
        // Verify Trader 2 (Seller) balance change
        // Received: 10000 units QUOTE - 10 units QUOTE (Maker Fee)
        expect(await token6Decimals.balanceOf(trader2Addr)).to.equal(initialTrader2Quote + expectedQuoteAmount - makerFee);
  
        // Verify Fee Recipient balance change
        expect(await token6Decimals.balanceOf(ownerAddr)).to.equal(initialFeeRecipientQuote + makerFee + takerFee);
        expect(makerFee + takerFee).to.equal(30, "Total fees should be 30 units");
      });
  });

  // TODO: Add tests for potential rounding errors in settlement amounts if needed

});
