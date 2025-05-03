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

describe("Order Book Depth Benchmark Tests", function () {
  let owner: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;
  let trader2: HardhatEthersSigner;
  let feeRecipient: HardhatEthersSigner;
  let traders: HardhatEthersSigner[] = [];

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
    await state.connect(owner).addAdmin(vaultAddress);

    // Set Book address in Vault
    await vault.connect(owner).setBook(clobAddress); // Set CLOB as the authorized caller for Vault

    // Set CLOB address in Book (for authorization)
    await book.connect(owner).setCLOB(clobAddress);

    // Set CLOB address in Vault (for authorization)
    await vault.connect(owner).setCLOB(clobAddress);

    return { state, vault, book, clob };
  }

  async function fundAndApproveTraders(numTraders: number) {
    const vaultAddress = await vault.getAddress();
    traders = (await ethers.getSigners()).slice(1, numTraders + 1); // Use signers 1 to numTraders

    for (const trader of traders) {
      await baseToken.connect(owner).mint(trader.address, parseBase(10000));
      await quoteToken.connect(owner).mint(trader.address, parseQuote(1000000));
      await baseToken.connect(trader).approve(vaultAddress, ethers.MaxUint256);
      await quoteToken.connect(trader).approve(vaultAddress, ethers.MaxUint256);
    }
    // Also fund the main trader1 who will place the sweeping order
    trader1 = traders[0]; // Use the first trader for the sweep
    await baseToken.connect(owner).mint(trader1.address, parseBase(10000));
    await quoteToken.connect(owner).mint(trader1.address, parseQuote(10000000)); // More quote for sweeping
    await baseToken.connect(trader1).approve(vaultAddress, ethers.MaxUint256);
    await quoteToken.connect(trader1).approve(vaultAddress, ethers.MaxUint256);
  }

  // Helper to populate the book with sell orders
  async function populateSellBook(numOrders: number, startPrice: number, priceIncrement: number, quantityPerOrder: number) {
    for (let i = 0; i < numOrders; i++) {
      const price = parseQuote(startPrice + i * priceIncrement);
      const quantity = parseBase(quantityPerOrder);
      const trader = traders[i % traders.length]; // Cycle through available traders
      await clob.connect(trader).placeLimitOrder(await baseToken.getAddress(), await quoteToken.getAddress(), false, price, quantity); // Fixed
    }
  }

  beforeEach(async function () {
    [owner, , , feeRecipient] = await ethers.getSigners(); // trader1, trader2 assigned in fundAndApprove

    // Deploy mock ERC20 tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    baseToken = (await MockERC20Factory.deploy("Base Token", "BASE", baseDecimals, owner.address)) as unknown as MockERC20;
    await baseToken.waitForDeployment();
    quoteToken = (await MockERC20Factory.deploy("Quote Token", "QUOTE", quoteDecimals, owner.address)) as unknown as MockERC20;
    await quoteToken.waitForDeployment();

    // Deploy core contracts
    await deployCoreContractsAndSetup();
    // Funding happens in the test cases based on required number of traders
  });

  // --- Test Cases for Different Depths ---

  const depthsToTest = [10, 50, 100]; // Number of resting orders

  for (const depth of depthsToTest) {
    it(`Depth ${depth}: Market Buy Sweep`, async function () {
      const numTradersNeeded = Math.min(depth, 15); // Use up to 15 signers for placing orders
      await fundAndApproveTraders(numTradersNeeded);
      // Add the pair *after* contracts are deployed and traders funded
      await clob.connect(owner).addSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress()); // Added

      const startPrice = 100;
      const priceIncrement = 1;
      const quantityPerOrder = 1;
      await populateSellBook(depth, startPrice, priceIncrement, quantityPerOrder);

      const sweepQuantity = parseBase(depth * quantityPerOrder); // Buy enough to clear all orders

      console.time(`Market Buy Sweep Depth ${depth}`);
      const tx = await clob.connect(trader1).placeMarketOrder(await baseToken.getAddress(), await quoteToken.getAddress(), true, sweepQuantity); // Fixed
      const receipt = await tx.wait();
      console.timeEnd(`Market Buy Sweep Depth ${depth}`);

      // Basic check: the sweeping order should be filled
      // Order ID will be depth + 1 (since populateSellBook creates 'depth' orders)
      const sweepOrderId = depth + 1;
      const sweepOrder = await state.getOrder(sweepOrderId);
      // It might be partially filled if self-trade prevention kicks in, or fully filled
      expect(sweepOrder.status).to.be.oneOf([BigInt(ORDER_STATUS_FILLED), BigInt(ORDER_STATUS_PARTIALLY_FILLED)]);
      console.log(`Gas used for Depth ${depth}: ${receipt?.gasUsed.toString()}`);
    });
  }

});

