/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Book, CLOB, State, Vault, MockToken } from "../typechain-types";

describe("CLOB Contract Tests", function () {
  let clob: CLOB;
  let book: Book;
  let state: State;
  let vault: Vault;
  let baseToken: MockToken;
  let quoteToken: MockToken;
  let owner: Signer;
  let trader1: Signer;
  let trader2: Signer;
  let feeRecipient: Signer;
  let ownerAddress: string;
  let trader1Address: string;
  let trader2Address: string;
  let feeRecipientAddress: string;

  const BASE_TOKEN_DECIMALS = 18;
  const QUOTE_TOKEN_DECIMALS = 6;
  const INITIAL_MINT_AMOUNT = ethers.parseEther("1000000");
  const MAKER_FEE_RATE = 10; // 0.1% in basis points
  const TAKER_FEE_RATE = 20; // 0.2% in basis points

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
    await baseToken.mint(trader1Address, INITIAL_MINT_AMOUNT);
    await baseToken.mint(trader2Address, INITIAL_MINT_AMOUNT);
    await quoteToken.mint(trader1Address, INITIAL_MINT_AMOUNT);
    await quoteToken.mint(trader2Address, INITIAL_MINT_AMOUNT);

    // Deploy state contract with owner as admin
    const State = await ethers.getContractFactory("State", owner);
    state = (await State.deploy(ownerAddress)) as unknown as State;

    // Deploy vault contract with updated constructor parameters
    const Vault = await ethers.getContractFactory("Vault", owner);
    vault = (await Vault.deploy(
      ownerAddress, 
      await state.getAddress(), 
      feeRecipientAddress,
      MAKER_FEE_RATE,
      TAKER_FEE_RATE
    )) as unknown as Vault;

    // Deploy book contract with correct constructor arguments
    const Book = await ethers.getContractFactory("Book", owner);
    book = (await Book.deploy(
      ownerAddress, 
      await state.getAddress(), 
      await baseToken.getAddress(), 
      await quoteToken.getAddress()
    )) as unknown as Book;

    // Set vault in book
    await book.connect(owner).setVault(await vault.getAddress());

    // Set book address in vault
    await vault.connect(owner).setBook(await book.getAddress());

    // Deploy CLOB contract with updated constructor parameters
    const CLOB = await ethers.getContractFactory("CLOB", owner);
    clob = (await CLOB.deploy(
      ownerAddress,
      await state.getAddress(),
      await book.getAddress(),
      await vault.getAddress()
    )) as unknown as CLOB;

    // Add CLOB as admin in state
    await state.connect(owner).addAdmin(await clob.getAddress());
    
    // Set CLOB address in vault
    await vault.connect(owner).setCLOB(await clob.getAddress());
    
    // Set CLOB as the vault in book to authorize it to call matchOrders
    // This is a workaround for testing since Book only allows admin or vault to call matchOrders
    await book.connect(owner).setCLOB(await clob.getAddress());

    // Add supported trading pair
    await clob.connect(owner).addSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress());
    
    // Approve tokens for trading (for CLOB contract)
    await baseToken.connect(trader1).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
    await quoteToken.connect(trader1).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
    await baseToken.connect(trader2).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
    await quoteToken.connect(trader2).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await clob.admin()).to.equal(ownerAddress);
    });

    it("Should set the right components", async function () {
      expect(await clob.book()).to.equal(await book.getAddress());
      expect(await clob.state()).to.equal(await state.getAddress());
      expect(await clob.vault()).to.equal(await vault.getAddress());
    });

    it("Should support the added trading pair", async function () {
      expect(await clob.isSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress())).to.be.true;
    });
  });

  describe("Order Placement", function () {

    it("Should place a limit buy order", async function () {
      const price = ethers.parseUnits("100", QUOTE_TOKEN_DECIMALS);
      const quantity = ethers.parseUnits("10", BASE_TOKEN_DECIMALS);
      
      // Place the order using the updated placeLimitOrder function
      const tx = await clob.connect(trader1).placeLimitOrder(
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        price,
        quantity
      );
      
      // Wait for the transaction to be mined
      const receipt = await tx.wait();
      if (!receipt) {
        throw new Error("Transaction receipt is null");
      }
      
      // Find the OrderPlaced event from the CLOB contract
      const clobInterface = clob.interface;
      const clobAddress = await clob.getAddress();
      let orderPlacedLog = receipt.logs.find(log => log.address === clobAddress && log.fragment && log.fragment.name === "OrderPlaced");
      
      expect(orderPlacedLog, "OrderPlaced event not found").to.exist;

      // Parse the event log to get the orderId
      const parsedLog = clobInterface.parseLog(orderPlacedLog!);
      const orderId = (parsedLog as any).args.orderId;

      expect(orderId).to.be.gt(0); // Check if orderId is valid
      
      // Verify the order exists in the State contract
      const order = await state.getOrder(orderId);
      expect(order, `Order with ID ${orderId} should exist`).to.not.be.null;
      
      // Verify the order details
      expect(order!.trader).to.equal(trader1Address);
      expect(order!.baseToken).to.equal(await baseToken.getAddress());
      expect(order!.quoteToken).to.equal(await quoteToken.getAddress());
      expect(order!.price).to.equal(price);
      expect(order!.quantity).to.equal(quantity);
      expect(order!.isBuy).to.be.true;
      expect(order!.orderType).to.equal(0); // LIMIT
      expect(order!.status).to.equal(0); // OPEN
    });

    it("Should reject orders for unsupported trading pairs", async function () {
      const price = ethers.parseUnits("100", QUOTE_TOKEN_DECIMALS);
      const quantity = ethers.parseUnits("10", BASE_TOKEN_DECIMALS);
      
      // Deploy another token
      const MockToken = await ethers.getContractFactory("MockToken", owner);
      const anotherToken = await MockToken.deploy("Another Token", "ANOTHER", 18);
      
      await expect(clob.connect(trader1).placeLimitOrder(
        await anotherToken.getAddress(),
        await quoteToken.getAddress(),
        true, // isBuy
        price,
        quantity
      )).to.be.revertedWith("CLOB: unsupported trading pair");
    });
  });

  describe("Symphony Integration", function () {
    it("Should set Symphony adapter and enable integration", async function () {
      await clob.connect(owner).setSymphonyAdapter(trader1Address); // Use trader1 as dummy adapter address
      await clob.connect(owner).setSymphonyIntegrationEnabled(true);
      
      // Verify the state was set correctly
      expect(await clob.symphonyAdapter()).to.equal(trader1Address);
      expect(await clob.symphonyIntegrationEnabled()).to.be.true;
    });
  });
});

