/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { CLOB, Book, State, Vault, MockToken } from "../typechain-types";

describe("Event Emission Tests (Rebuild)", function () {
  let admin: SignerWithAddress;
  let trader1: SignerWithAddress;
  let trader2: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let baseToken: MockToken;
  let quoteToken: MockToken;
  let state: State;
  let book: Book;
  let vault: Vault;
  let clob: CLOB;

  const INITIAL_BALANCE = ethers.parseUnits("1000", 18);
  const ORDER_PRICE = ethers.parseUnits("100", 18);
  const ORDER_QUANTITY = ethers.parseUnits("1", 18);
  const PARTIAL_FILL_QUANTITY = ethers.parseUnits("0.5", 18);
  
  // Order statuses
  const ORDER_STATUS_OPEN = 0;
  const ORDER_STATUS_PARTIALLY_FILLED = 1;
  const ORDER_STATUS_FILLED = 2;
  const ORDER_STATUS_CANCELED = 3;
  
  // Order types
  const ORDER_TYPE_LIMIT = 0;
  const ORDER_TYPE_MARKET = 1;

  beforeEach(async function () {
    // Get signers
    [admin, trader1, trader2, feeRecipient] = await ethers.getSigners();

    // Deploy mock tokens
    const MockTokenFactory = await ethers.getContractFactory("MockToken");
    baseToken = (await MockTokenFactory.deploy("Base Token", "BASE", 18)) as unknown as MockToken;
    quoteToken = (await MockTokenFactory.deploy("Quote Token", "QUOTE", 18)) as unknown as MockToken;

    // Deploy State contract
    const StateFactory = await ethers.getContractFactory("State");
    state = (await StateFactory.deploy(await admin.getAddress())) as unknown as State;

    // Deploy Book contract
    const BookFactory = await ethers.getContractFactory("Book");
    book = (await BookFactory.deploy(
      await admin.getAddress(),
      await state.getAddress(),
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    )) as unknown as Book;

    // Deploy Vault contract
    const VaultFactory = await ethers.getContractFactory("Vault");
    vault = (await VaultFactory.deploy(
      await admin.getAddress(),
      await state.getAddress(),
      await feeRecipient.getAddress(),
      50, // makerFeeRate
      100 // takerFeeRate
    )) as unknown as Vault;

    // Deploy CLOB contract
    const CLOBFactory = await ethers.getContractFactory("CLOB");
    clob = (await CLOBFactory.deploy(
      await admin.getAddress(),
      await state.getAddress(),
      await book.getAddress(),
      await vault.getAddress()
    )) as unknown as CLOB;

    // Add supported trading pair
    await clob.connect(admin).addSupportedPair(
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    );
    
    // Set up permissions
    await state.addAdmin(await clob.getAddress());
    await state.addAdmin(await book.getAddress());
    await state.addAdmin(await vault.getAddress());
    
    // Set admin permissions first - make sure admin is the owner
    await book.connect(admin).setAdmin(await admin.getAddress());
    
    // Set CLOB address in Book directly using admin account
    await book.connect(admin).setCLOB(await clob.getAddress());
    
    await book.connect(admin).setVault(await vault.getAddress());
    await vault.connect(admin).setBook(await clob.getAddress()); // Vault needs CLOB for settlement processing
    await vault.connect(admin).setCLOB(await clob.getAddress()); // Vault needs CLOB for authorization

    // Mint tokens to traders
    await baseToken.mint(await trader1.getAddress(), INITIAL_BALANCE);
    await baseToken.mint(await trader2.getAddress(), INITIAL_BALANCE);
    await quoteToken.mint(await trader1.getAddress(), INITIAL_BALANCE);
    await quoteToken.mint(await trader2.getAddress(), INITIAL_BALANCE);

    // Approve tokens for trading to vault
    await baseToken.connect(trader1).approve(await vault.getAddress(), INITIAL_BALANCE);
    await baseToken.connect(trader2).approve(await vault.getAddress(), INITIAL_BALANCE);
    await quoteToken.connect(trader1).approve(await vault.getAddress(), INITIAL_BALANCE);
    await quoteToken.connect(trader2).approve(await vault.getAddress(), INITIAL_BALANCE);
    
    // Also approve tokens to CLOB directly (may not be needed depending on final flow)
    await baseToken.connect(trader1).approve(await clob.getAddress(), INITIAL_BALANCE);
    await baseToken.connect(trader2).approve(await clob.getAddress(), INITIAL_BALANCE);
    await quoteToken.connect(trader1).approve(await clob.getAddress(), INITIAL_BALANCE);
    await quoteToken.connect(trader2).approve(await clob.getAddress(), INITIAL_BALANCE);
  });

  // Basic setup test (fixed assertion)
  it("should deploy contracts and set up correctly", async function() {
    expect(clob.target).to.not.be.undefined;
    expect(book.target).to.not.be.undefined;
    expect(vault.target).to.not.be.undefined;
    expect(state.target).to.not.be.undefined;
    console.log("Rebuild test: Basic setup completed.");
  });

  // --- Added First Test Case ---
  it("should emit OrderPlaced event when placing an order", async function () {
    // Place a limit buy order using placeLimitOrder
    const tx = await clob.connect(trader1).placeLimitOrder(
      await baseToken.getAddress(),
      await quoteToken.getAddress(),
      true,                         // isBuy
      ORDER_PRICE,
      ORDER_QUANTITY
    );

    // Wait for transaction to be mined
    const receipt = await tx.wait();
    
    // Find the OrderPlaced event in the logs
    const event = receipt?.logs.find(
      (log) => {
        try {
          const parsedLog = clob.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          return parsedLog?.name === "OrderPlaced";
        } catch (e) {
          return false;
        }
      }
    );

    // Verify the event was emitted
    expect(event).to.not.be.undefined;
    
    // Parse the event data
    const parsedEvent = clob.interface.parseLog({
      topics: event?.topics as string[],
      data: event?.data as string,
    });
    
    // Verify event parameters
    expect(parsedEvent?.args.trader).to.equal(await trader1.getAddress());
    expect(parsedEvent?.args.isBuy).to.equal(true);
    expect(parsedEvent?.args.price).to.equal(ORDER_PRICE);
    expect(parsedEvent?.args.quantity).to.equal(ORDER_QUANTITY);
    // Order ID is generated, just check it exists
    expect(parsedEvent?.args.orderId).to.be.a("bigint"); 
  });

  // --- Added Second Test Case (Refactored with expect().to.emit() and corrected args) ---
  it("should emit OrderCreated event in State contract when placing an order", async function () {
    // Place a limit sell order using placeLimitOrder
    await expect(clob.connect(trader1).placeLimitOrder(
      await baseToken.getAddress(),
      await quoteToken.getAddress(),
      false,                        // isBuy
      ORDER_PRICE,
      ORDER_QUANTITY
    ))
    .to.emit(state, "OrderCreated")
    .withArgs(
      1, // orderId - Assuming it's the first order created in this test context
      await trader1.getAddress(),
      false, // isBuy
      ORDER_PRICE,
      ORDER_QUANTITY
    );
  });

  // --- Added Third Test Case (Refactored with expect().to.emit()) ---
  it("should emit OrderStatusUpdated event when an order is partially filled", async function () {
    // Place a limit sell order
    const tx1 = await clob.connect(trader1).placeLimitOrder(
      await baseToken.getAddress(),
      await quoteToken.getAddress(),
      false, // isBuy
      ORDER_PRICE,
      ORDER_QUANTITY
    );
    const receipt1 = await tx1.wait();
    
    // Extract orderId from the OrderPlaced event (assuming it's the first log)
    const clobInterface = clob.interface;
    let orderId = 0n; // Use bigint for orderId
    for (const log of receipt1?.logs || []) {
        try {
            const parsedLog = clobInterface.parseLog({ topics: log.topics as string[], data: log.data });
            if (parsedLog?.name === "OrderPlaced") {
                orderId = parsedLog.args.orderId;
                break;
            }
        } catch (e) { /* Ignore parsing errors */ }
    }
    expect(orderId).to.be.gt(0); // Ensure orderId was found

    // Place a partially matching limit buy order
    await expect(clob.connect(trader2).placeLimitOrder(
      await baseToken.getAddress(),
      await quoteToken.getAddress(),
      true, // isBuy
      ORDER_PRICE,
      PARTIAL_FILL_QUANTITY // Smaller quantity
    ))
    .to.emit(state, "OrderStatusUpdated")
    .withArgs(
      orderId, // The ID of the original sell order
      ORDER_STATUS_PARTIALLY_FILLED,
      PARTIAL_FILL_QUANTITY
    );
  });

});

