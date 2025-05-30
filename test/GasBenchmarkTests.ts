/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Book, CLOB, State, Vault, MockERC20 } from "../typechain-types";
import { parseUnits } from "ethers";

// Constants from State contract
const ORDER_STATUS_OPEN = 0;
const ORDER_STATUS_PARTIALLY_FILLED = 1;
const ORDER_STATUS_FILLED = 2;
const ORDER_STATUS_CANCELLED = 3;

const ORDER_TYPE_LIMIT = 0;
const ORDER_TYPE_MARKET = 1;
const ORDER_TYPE_IOC = 2;
const ORDER_TYPE_FOK = 3;

const SIDE_BUY = 0;
const SIDE_SELL = 1;

describe("Gas Benchmark Tests", function () {
  let owner: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;
  let trader2: HardhatEthersSigner;
  let feeRecipient: HardhatEthersSigner;

  let state: State;
  let vault: Vault;
  let book: Book;
  let clob: CLOB;
  let baseToken: MockERC20;
  let quoteToken: MockERC20;

  const baseDecimals = 6;
  const quoteDecimals = 18;

  const parseBase = (value: string | number) => parseUnits(value.toString(), baseDecimals);
  const parseQuote = (value: string | number) => parseUnits(value.toString(), quoteDecimals);

  async function deployCoreContractsAndSetup() {
    // Deploy State
    const StateFactory = await ethers.getContractFactory("State");
    state = (await StateFactory.deploy(owner.address)) as unknown as State;
    await state.waitForDeployment();
    const stateAddress = await state.getAddress();

    // Deploy Vault
    const VaultFactory = await ethers.getContractFactory("Vault");
    const makerFeeRate = 10; // 10 bps = 0.1%
    const takerFeeRate = 20; // 20 bps = 0.2%
    vault = (await VaultFactory.deploy(owner.address, stateAddress, feeRecipient.address, makerFeeRate, takerFeeRate)) as unknown as Vault;
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();

    // Deploy Book
    const BookFactory = await ethers.getContractFactory("Book");
    book = (await BookFactory.deploy(owner.address, stateAddress, await baseToken.getAddress(), await quoteToken.getAddress())) as unknown as Book;
    await book.waitForDeployment();
    const bookAddress = await book.getAddress();

    // Deploy CLOB
    const CLOBFactory = await ethers.getContractFactory("CLOB");
    clob = (await CLOBFactory.deploy(owner.address, stateAddress, bookAddress, vaultAddress)) as unknown as CLOB;
    await clob.waitForDeployment();
    const clobAddress = await clob.getAddress();

    // Grant admin roles
    await state.connect(owner).addAdmin(clobAddress);
    await state.connect(owner).addAdmin(bookAddress);
    await state.connect(owner).addAdmin(vaultAddress); // Vault needs admin to update order status during settlement

    // Set Book address in Vault
    await vault.connect(owner).setBook(clobAddress);

    // Set CLOB address in Book (for authorization)
    await book.connect(owner).setCLOB(clobAddress);

    // Set CLOB address in Vault (for authorization)
    await vault.connect(owner).setCLOB(clobAddress);

    return { state, vault, book, clob };
  }

  async function fundAndApproveTraders() {
    // Fund traders
    await baseToken.connect(owner).mint(trader1.address, parseBase(10000));
    await quoteToken.connect(owner).mint(trader1.address, parseQuote(1000000));
    await baseToken.connect(owner).mint(trader2.address, parseBase(10000));
    await quoteToken.connect(owner).mint(trader2.address, parseQuote(1000000));

    // Approve Vault
    const vaultAddress = await vault.getAddress();
    await baseToken.connect(trader1).approve(vaultAddress, ethers.MaxUint256);
    await quoteToken.connect(trader1).approve(vaultAddress, ethers.MaxUint256);
    await baseToken.connect(trader2).approve(vaultAddress, ethers.MaxUint256);
    await quoteToken.connect(trader2).approve(vaultAddress, ethers.MaxUint256);
  }

  beforeEach(async function () {
    [owner, trader1, trader2, feeRecipient] = await ethers.getSigners();

    // Deploy mock ERC20 tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    baseToken = (await MockERC20Factory.deploy("Base Token", "BASE", baseDecimals, owner.address)) as unknown as MockERC20;
    await baseToken.waitForDeployment();
    quoteToken = (await MockERC20Factory.deploy("Quote Token", "QUOTE", quoteDecimals, owner.address)) as unknown as MockERC20;
    await quoteToken.waitForDeployment();

    // Deploy core contracts and set up roles/approvals
    await deployCoreContractsAndSetup();
    await fundAndApproveTraders();
    
    // Add trading pair to supported pairs
    await clob.connect(owner).addSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress());
  });

  it("Gas: Place Limit Order (No Match)", async function () {
    const price = parseQuote(100);
    const quantity = parseBase(10);

    await expect(clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, price, quantity))
      .to.emit(clob, "OrderPlaced")
      .withArgs(1, trader1.address, true, price, quantity);

    const order = await state.getOrder(1);
    expect(order.status).to.equal(ORDER_STATUS_OPEN);
  });

  it("Gas: Place Limit Order (Simple Match)", async function () {
    // Place initial sell order
    const sellPrice = parseQuote(100);
    const sellQuantity = parseBase(10);
    await clob.connect(trader2).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, sellPrice, sellQuantity); // Fixed

    // Place matching buy order
    const buyPrice = parseQuote(100);
    const buyQuantity = parseBase(5);
    await expect(clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, buyPrice, buyQuantity)) // Fixed
      .to.emit(book, "OrderMatched"); // Check for match event

    const buyOrder = await state.getOrder(2);
    expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
    const sellOrder = await state.getOrder(1);
    expect(sellOrder.status).to.equal(ORDER_STATUS_PARTIALLY_FILLED);
  });

  it("Gas: Place Market Order (Simple Match)", async function () {
    // Place initial sell order
    const sellPrice = parseQuote(100);
    const sellQuantity = parseBase(10);
    await clob.connect(trader2).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, sellPrice, sellQuantity); // Fixed
    const initialSellOrder = await state.getOrder(1);
    console.log(`GasBenchmarkTests: Initial Sell Order (ID 1) before market buy: Status=${initialSellOrder.status}, Quantity=${initialSellOrder.quantity}, Filled=${initialSellOrder.filledQuantity}`);

    // Place matching market buy order
    const marketBuyBaseQuantity = parseBase(5);
    // Calculate required quote amount based on sell price
    const quoteAmountToSpend = sellPrice * marketBuyBaseQuantity / parseUnits("1", baseDecimals); // 100 * 5 = 500 quote
    console.log(`GasBenchmarkTests: Calculated quoteAmountToSpend: ${quoteAmountToSpend.toString()}`); // Debug log

    await expect(clob.connect(trader1).placeMarketOrder(
      await baseToken.getAddress(), 
      await quoteToken.getAddress(), 
      true, // isBuy
      0, // quantity (base) is 0 for market buy
      quoteAmountToSpend // quoteAmount to spend
    ))
      .to.emit(book, "OrderMatched");

    const marketOrderAfter = await state.getOrder(2);
    const sellOrderAfter = await state.getOrder(1);
    console.log(`GasBenchmarkTests: Market Buy Order (ID 2) after match: Status=${marketOrderAfter.status}, Quantity=${marketOrderAfter.quantity}, Filled=${marketOrderAfter.filledQuantity}`);
    console.log(`GasBenchmarkTests: Sell Order (ID 1) after match: Status=${sellOrderAfter.status}, Quantity=${sellOrderAfter.quantity}, Filled=${sellOrderAfter.filledQuantity}`);

    const marketOrder = await state.getOrder(2);
    console.log(`GasBenchmarkTests: DEBUG - Before assertion - Market Order (ID 2) Status: ${marketOrder.status}`);
    console.log(`GasBenchmarkTests: DEBUG - Before assertion - Sell Order (ID 1) Status: ${sellOrderAfter.status}`);
    expect(marketOrder.status, "Market buy order (ID 2) status should be PARTIALLY_FILLED").to.equal(ORDER_STATUS_PARTIALLY_FILLED);
    const sellOrder = await state.getOrder(1);
    expect(sellOrder.status, "Sell order (ID 1) status should be FILLED").to.equal(ORDER_STATUS_FILLED);
  });

  it("Gas: Cancel Open Order", async function () {
    // Place an order
    const price = parseQuote(100);
    const quantity = parseBase(10);
    await clob.connect(trader1).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, price, quantity); // Fixed
    const orderId = 1;

    // Cancel the order
    await expect(clob.connect(trader1).cancelOrder(orderId))
      .to.emit(clob, "OrderCanceled")
      .withArgs(orderId, trader1.address);

    const order = await state.getOrder(orderId);
    expect(order.status).to.equal(ORDER_STATUS_CANCELLED);
  });

});

