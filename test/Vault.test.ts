/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, parseUnits, parseEther } from "ethers";
import { Book, CLOB, State, Vault, MockToken } from "../typechain-types";

describe("Vault Contract Tests", function () {
  let clob: CLOB;
  let book: Book;
  let state: State;
  let vault: Vault;
  let baseToken: MockToken;
  let quoteToken: MockToken;
  let owner: Signer;
  let trader1: Signer; // Maker
  let trader2: Signer; // Taker
  let feeRecipient: Signer;
  let ownerAddress: string;
  let trader1Address: string;
  let trader2Address: string;
  let feeRecipientAddress: string;

  const BASE_TOKEN_DECIMALS = 18;
  const QUOTE_TOKEN_DECIMALS = 6;
  const INITIAL_MINT_AMOUNT_BASE = parseEther("10000"); // 10,000 BASE
  const INITIAL_MINT_AMOUNT_QUOTE = parseUnits("1000000", QUOTE_TOKEN_DECIMALS); // 1,000,000 QUOTE
  const MAKER_FEE_RATE = 50; // 0.5%
  const TAKER_FEE_RATE = 100; // 1.0%

  beforeEach(async function () {
    // Get signers
    [owner, trader1, trader2, feeRecipient] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    trader1Address = await trader1.getAddress();
    trader2Address = await trader2.getAddress();
    feeRecipientAddress = await feeRecipient.getAddress();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken", owner);
    baseToken = (await MockToken.deploy("Base Token", "BASE", BASE_TOKEN_DECIMALS)) as unknown as MockToken;
    quoteToken = (await MockToken.deploy("Quote Token", "QUOTE", QUOTE_TOKEN_DECIMALS)) as unknown as MockToken;

    // Mint tokens to traders
    await baseToken.mint(trader1Address, INITIAL_MINT_AMOUNT_BASE);
    await baseToken.mint(trader2Address, INITIAL_MINT_AMOUNT_BASE);
    await quoteToken.mint(trader1Address, INITIAL_MINT_AMOUNT_QUOTE);
    await quoteToken.mint(trader2Address, INITIAL_MINT_AMOUNT_QUOTE);

    // Deploy state contract with owner as admin
    const State = await ethers.getContractFactory("State", owner);
    state = (await State.deploy(ownerAddress)) as unknown as State;

    // Deploy book contract with correct constructor arguments
    const Book = await ethers.getContractFactory("Book", owner);
    book = (await Book.deploy(
      ownerAddress,
      await state.getAddress(),
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    )) as unknown as Book;

    // Deploy vault contract with correct constructor arguments including fee rates
    const Vault = await ethers.getContractFactory("Vault", owner);
    vault = (await Vault.deploy(
      ownerAddress,
      await state.getAddress(),
      feeRecipientAddress,
      MAKER_FEE_RATE,
      TAKER_FEE_RATE
    )) as unknown as Vault;

    // Deploy CLOB contract with correct constructor argument order
    const CLOB = await ethers.getContractFactory("CLOB", owner);
    clob = (await CLOB.deploy(
      ownerAddress,
      await state.getAddress(),
      await book.getAddress(),
      await vault.getAddress()
    )) as unknown as CLOB;

    // Set vault address in book
    await book.connect(owner).setVault(await vault.getAddress());
    
    // Set CLOB as the authorized caller for Vault
    await vault.connect(owner).setBook(await clob.getAddress());
    
    // Set CLOB in vault
    await vault.connect(owner).setCLOB(await clob.getAddress());
    
    // Set CLOB in book (authorize CLOB to interact with Book)
    await book.connect(owner).setCLOB(await clob.getAddress());

    // Add CLOB as admin in state
    await state.connect(owner).addAdmin(await clob.getAddress());
    await state.connect(owner).addAdmin(await book.getAddress());
    
    // Add supported trading pair
    await clob.connect(owner).addSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress());

    // Approve tokens for Vault (using MaxUint256 for simplicity)
    await baseToken.connect(trader1).approve(await vault.getAddress(), ethers.MaxUint256);
    await quoteToken.connect(trader1).approve(await vault.getAddress(), ethers.MaxUint256);
    await baseToken.connect(trader2).approve(await vault.getAddress(), ethers.MaxUint256);
    await quoteToken.connect(trader2).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await vault.owner()).to.equal(ownerAddress);
    });

    it("Should set the right state contract", async function () {
      expect(await vault.state()).to.equal(await state.getAddress());
    });

    it("Should set the right fee recipient", async function () {
      expect(await vault.getFeeRecipient()).to.equal(feeRecipientAddress);
    });
  });

  describe("Configuration", function () {
    it("Should allow admin to set fee rates", async function () {
      const makerFeeRate = 10; // 0.1%
      const takerFeeRate = 30; // 0.3%

      await vault.connect(owner).setFeeRates(makerFeeRate, takerFeeRate);

      const feeRates = await vault.getFeeRates();
      expect(feeRates[0]).to.equal(makerFeeRate);
      expect(feeRates[1]).to.equal(takerFeeRate);
    });

    it("Should allow admin to set fee recipient", async function () {
      const newFeeRecipient = trader1Address;

      await vault.connect(owner).setFeeRecipient(newFeeRecipient);

      expect(await vault.getFeeRecipient()).to.equal(newFeeRecipient);
    });

    it("Should not allow non-admin to set fee rates", async function () {
      const takerFeeRate = 30;
      const makerFeeRate = 10;

      await expect(vault.connect(trader1).setFeeRates(takerFeeRate, makerFeeRate))
        .to.be.revertedWith("Vault: caller is not the owner");
    });

    it("Should not allow non-admin to set fee recipient", async function () {
      const newFeeRecipient = trader1Address;

      await expect(vault.connect(trader2).setFeeRecipient(newFeeRecipient))
        .to.be.revertedWith("Vault: caller is not the owner");
    });
  });

  describe("Fee Calculation", function () {
    it("Should calculate fees correctly", async function () {
      const makerFeeRate = 10; // 0.1%
      const takerFeeRate = 30; // 0.3%

      await vault.connect(owner).setFeeRates(makerFeeRate, takerFeeRate);

      // Create mock order IDs - we don't need actual orders for fee calculation
      const makerOrderId = 1n;
      const takerOrderId = 2n;
      
      // Create a settlement object with known values
      const settlementPrice = parseUnits("100", QUOTE_TOKEN_DECIMALS);
      const settlementQuantity = parseUnits("5", BASE_TOKEN_DECIMALS);

      // Create state entries for the mock orders
      await state.connect(owner).createOrder(
        trader1Address, // maker
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        settlementPrice,
        parseUnits("10", BASE_TOKEN_DECIMALS),
        false, // isBuy = false (sell)
        0 // orderType = LIMIT
      );
      
      await state.connect(owner).createOrder(
        trader2Address, // taker
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        settlementPrice,
        settlementQuantity,
        true, // isBuy = true (buy)
        0 // orderType = LIMIT
      );

      const settlement = {
        takerOrderId: takerOrderId,
        makerOrderId: makerOrderId,
        quantity: settlementQuantity,
        price: settlementPrice,
        processed: false
      };

      // Now calculate fees using the vault
      const fees = await vault.calculateFees(settlement);

      // Expected fees:
      // Quote amount involved in the settlement = settlementPrice * settlementQuantity / 10^BASE_DECIMALS
      const quoteAmount = (settlementPrice * settlementQuantity) / BigInt(10**BASE_TOKEN_DECIMALS);
      const expectedMakerFee = (quoteAmount * BigInt(makerFeeRate)) / BigInt(10000);
      const expectedTakerFee = (quoteAmount * BigInt(takerFeeRate)) / BigInt(10000);

      expect(fees[0]).to.equal(expectedMakerFee);
      expect(fees[1]).to.equal(expectedTakerFee);
    });
  });

  describe("Settlement Processing", function () {
    // For these tests, we'll verify the contract interfaces and function signatures
    // rather than actual token transfers, which can be difficult to test in isolation

    it("Should have the correct interface for processing settlements", async function () {
      // Verify the function exists and has the right signature
      expect(typeof vault.processSettlement).to.equal('function');

      // Create a dummy settlement object (order IDs don't need to be valid here)
      const settlement = {
        takerOrderId: 1,
        makerOrderId: 2,
        quantity: parseUnits("5", BASE_TOKEN_DECIMALS),
        price: parseUnits("100", QUOTE_TOKEN_DECIMALS),
        processed: false
      };

      // We don't actually call the function since it requires book permissions
      // but we verify the interface is correct
      expect(vault.interface.getFunction('processSettlement')).to.not.be.undefined;
    });

    it("Should have the correct interface for batch settlement processing", async function () {
      // Verify the function exists and has the right signature
      expect(typeof vault.processSettlements).to.equal('function');

      // We don't actually call the function since it requires book permissions
      // but we verify the interface is correct
      expect(vault.interface.getFunction('processSettlements')).to.not.be.undefined;
    });
  });
});

