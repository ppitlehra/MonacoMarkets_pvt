/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Book, CLOB, State, Vault, MockToken } from "../typechain-types";

describe("Vault Error Handling Tests", function () {
  // Contract instances
  let vault: Vault;
  let state: State;
  let baseToken: MockToken;
  let quoteToken: MockToken;
  let invalidToken: MockToken;
  
  // Signers
  let owner: Signer;
  let buyer: Signer;
  let seller: Signer;
  let feeRecipient: Signer;
  let nonBookUser: Signer;
  
  // Addresses
  let ownerAddress: string;
  let buyerAddress: string;
  let sellerAddress: string;
  let feeRecipientAddress: string;
  let nonBookUserAddress: string;
  let bookAddress: string;

  // Constants
  const BASE_TOKEN_DECIMALS = 18;
  const QUOTE_TOKEN_DECIMALS = 6;
  const INITIAL_MINT_AMOUNT = ethers.parseEther("1000000");
  
  // Test values
  const SETTLEMENT_QUANTITY = ethers.parseUnits("10", BASE_TOKEN_DECIMALS); // 10 base tokens
  const SETTLEMENT_PRICE = ethers.parseUnits("100", QUOTE_TOKEN_DECIMALS); // 100 quote tokens per base token
  const TAKER_FEE_RATE = 30; // 0.3%
  const MAKER_FEE_RATE = 10; // 0.1%

  beforeEach(async function () {
    // Get signers
    [owner, buyer, seller, feeRecipient, nonBookUser] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    buyerAddress = await buyer.getAddress();
    sellerAddress = await seller.getAddress();
    feeRecipientAddress = await feeRecipient.getAddress();
    nonBookUserAddress = await nonBookUser.getAddress();
    
    // We'll use owner as the book for simplicity in basic tests
    bookAddress = ownerAddress;

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken", owner);
    baseToken = (await MockToken.deploy("Base Token", "BASE", BASE_TOKEN_DECIMALS)) as unknown as MockToken;
    quoteToken = (await MockToken.deploy("Quote Token", "QUOTE", QUOTE_TOKEN_DECIMALS)) as unknown as MockToken;
    invalidToken = (await MockToken.deploy("Invalid Token", "INVALID", 18)) as unknown as MockToken;
    
    // Mint tokens to traders
    await baseToken.mint(sellerAddress, INITIAL_MINT_AMOUNT);
    await quoteToken.mint(buyerAddress, INITIAL_MINT_AMOUNT);
    
    // Deploy state contract with owner as admin
    const State = await ethers.getContractFactory("State", owner);
    state = (await State.deploy(ownerAddress)) as unknown as State;

    // Deploy vault contract with fee rates
    const Vault = await ethers.getContractFactory("Vault", owner);
    vault = (await Vault.deploy(
      ownerAddress, 
      await state.getAddress(), 
      feeRecipientAddress,
      MAKER_FEE_RATE,
      TAKER_FEE_RATE
    )) as unknown as Vault;
    
    // Set book address in vault (using owner as book for now)
    await vault.connect(owner).setBook(bookAddress);
    
    // Create mock orders in state
    // First, add admin permissions to owner for creating orders
    await state.connect(owner).addAdmin(ownerAddress);
  });

  describe("Insufficient Balance Error Handling", function() {
    it("Should revert when seller has insufficient base token balance", async function() {
      // Create a taker order (buyer)
      await state.connect(owner).createOrder(
        buyerAddress,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        true, // isBuy
        0 // LIMIT
      );
      
      // Create a maker order (seller with insufficient balance)
      await state.connect(owner).createOrder(
        nonBookUserAddress, // This user has no tokens
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        false, // isBuy
        0 // LIMIT
      );
      
      // Approve tokens for trading
      await quoteToken.connect(buyer).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
      
      // Create a settlement
      const settlement = {
        takerOrderId: 1, // buyer
        makerOrderId: 2, // seller with insufficient balance
        quantity: SETTLEMENT_QUANTITY,
        price: SETTLEMENT_PRICE,
        processed: false
      };
      
      // Process the settlement - should revert
      await expect(
        vault.connect(owner).processSettlement(settlement)
      ).to.be.reverted;
    });
    
    it("Should revert when buyer has insufficient quote token balance", async function() {
      // Create a taker order (buyer with insufficient balance)
      await state.connect(owner).createOrder(
        nonBookUserAddress, // This user has no tokens
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        true, // isBuy
        0 // LIMIT
      );
      
      // Create a maker order (seller)
      await state.connect(owner).createOrder(
        sellerAddress,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        false, // isBuy
        0 // LIMIT
      );
      
      // Approve tokens for trading
      await baseToken.connect(seller).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
      
      // Create a settlement
      const settlement = {
        takerOrderId: 1, // buyer with insufficient balance
        makerOrderId: 2, // seller
        quantity: SETTLEMENT_QUANTITY,
        price: SETTLEMENT_PRICE,
        processed: false
      };
      
      // Process the settlement - should revert
      await expect(
        vault.connect(owner).processSettlement(settlement)
      ).to.be.reverted;
    });
  });
  
  describe("Missing Approval Error Handling", function() {
    it("Should revert when seller has not approved token transfers", async function() {
      // Create a taker order (buyer)
      await state.connect(owner).createOrder(
        buyerAddress,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        true, // isBuy
        0 // LIMIT
      );
      
      // Create a maker order (seller without approval)
      await state.connect(owner).createOrder(
        sellerAddress,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        false, // isBuy
        0 // LIMIT
      );
      
      // Only approve buyer tokens, not seller tokens
      await quoteToken.connect(buyer).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
      
      // Create a settlement
      const settlement = {
        takerOrderId: 1, // buyer
        makerOrderId: 2, // seller without approval
        quantity: SETTLEMENT_QUANTITY,
        price: SETTLEMENT_PRICE,
        processed: false
      };
      
      // Process the settlement - should revert
      await expect(
        vault.connect(owner).processSettlement(settlement)
      ).to.be.reverted;
    });
    
    it("Should revert when buyer has not approved token transfers", async function() {
      // Create a taker order (buyer without approval)
      await state.connect(owner).createOrder(
        buyerAddress,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        true, // isBuy
        0 // LIMIT
      );
      
      // Create a maker order (seller)
      await state.connect(owner).createOrder(
        sellerAddress,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        false, // isBuy
        0 // LIMIT
      );
      
      // Only approve seller tokens, not buyer tokens
      await baseToken.connect(seller).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
      
      // Create a settlement
      const settlement = {
        takerOrderId: 1, // buyer without approval
        makerOrderId: 2, // seller
        quantity: SETTLEMENT_QUANTITY,
        price: SETTLEMENT_PRICE,
        processed: false
      };
      
      // Process the settlement - should revert
      await expect(
        vault.connect(owner).processSettlement(settlement)
      ).to.be.reverted;
    });
  });
  
  describe("Invalid Order Error Handling", function() {
    it("Should revert when processing a settlement with non-existent orders", async function() {
      // Create a settlement with non-existent order IDs
      const settlement = {
        takerOrderId: 999, // non-existent
        makerOrderId: 888, // non-existent
        quantity: SETTLEMENT_QUANTITY,
        price: SETTLEMENT_PRICE,
        processed: false
      };
      
      // Process the settlement - should revert
      await expect(
        vault.connect(owner).processSettlement(settlement)
      ).to.be.reverted;
    });
    
    it("Should revert when processing a settlement with mismatched tokens", async function() {
      // Create a taker order (buyer) with base token
      await state.connect(owner).createOrder(
        buyerAddress,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        true, // isBuy
        0 // LIMIT
      );
      
      // Create a maker order (seller) with different base token
      await state.connect(owner).createOrder(
        sellerAddress,
        await invalidToken.getAddress(), // Different token
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        false, // isBuy
        0 // LIMIT
      );
      
      // Approve tokens for trading
      await baseToken.connect(seller).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
      await quoteToken.connect(buyer).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
      
      // Create a settlement
      const settlement = {
        takerOrderId: 1,
        makerOrderId: 2,
        quantity: SETTLEMENT_QUANTITY,
        price: SETTLEMENT_PRICE,
        processed: false
      };
      
      // Process the settlement - should revert due to mismatched tokens
      await expect(
        vault.connect(owner).processSettlement(settlement)
      ).to.be.reverted;
    });
  });
  
  describe("Duplicate Settlement Prevention", function() {
    it("Should revert when processing the same settlement twice", async function() {
      // Create a taker order (buyer)
      await state.connect(owner).createOrder(
        buyerAddress,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        true, // isBuy
        0 // LIMIT
      );
      
      // Create a maker order (seller)
      await state.connect(owner).createOrder(
        sellerAddress,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        SETTLEMENT_PRICE,
        SETTLEMENT_QUANTITY,
        false, // isBuy
        0 // LIMIT
      );
      
      // Calculate required quote amount using BigInt operations instead of BigNumber methods
      const requiredQuoteAmount = BigInt(SETTLEMENT_QUANTITY) * BigInt(SETTLEMENT_PRICE) / BigInt(10**12);
      const takerFee = requiredQuoteAmount * BigInt(TAKER_FEE_RATE) / BigInt(10000);
      const makerFee = requiredQuoteAmount * BigInt(MAKER_FEE_RATE) / BigInt(10000);
      
      // Approve tokens for trading with much higher amounts to ensure sufficient allowance
      // Multiply by 10 to ensure there's plenty of allowance for both attempts
      await baseToken.connect(seller).approve(await vault.getAddress(), BigInt(SETTLEMENT_QUANTITY) * BigInt(10));
      await quoteToken.connect(buyer).approve(await vault.getAddress(), (requiredQuoteAmount + takerFee) * BigInt(10));
      await quoteToken.connect(seller).approve(await vault.getAddress(), makerFee * BigInt(10));
      
      // Create a settlement
      const settlement = {
        takerOrderId: 1,
        makerOrderId: 2,
        quantity: SETTLEMENT_QUANTITY,
        price: SETTLEMENT_PRICE,
        processed: false
      };
      
      // Process the settlement first time - should succeed
      await vault.connect(owner).processSettlement(settlement);
      
      // Create a copy of the settlement with processed set to false again
      const settlementCopy = {
        takerOrderId: 1,
        makerOrderId: 2,
        quantity: SETTLEMENT_QUANTITY,
        price: SETTLEMENT_PRICE,
        processed: false
      };
      
      // Process the same settlement again - should revert with a specific error about duplicate settlement
      await expect(
        vault.connect(owner).processSettlement(settlementCopy)
      ).to.be.revertedWith("Vault: settlement already processed");
    });
  });
});
