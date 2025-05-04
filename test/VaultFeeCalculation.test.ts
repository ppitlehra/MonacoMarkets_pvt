import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { parseUnits, parseEther } from "ethers";
import { Book, CLOB, State, Vault, MockToken } from "../typechain-types";

describe("Vault Fee Calculation Tests", function () {
  // Contract instances
  let vault: Vault;
  let state: State;
  let book: Book;
  let clob: CLOB;
  let baseToken: MockToken;
  let quoteToken: MockToken;

  // Signers
  let owner: Signer;
  let trader1: Signer; // Maker
  let trader2: Signer; // Taker
  let feeRecipient: Signer;

  // Addresses
  let ownerAddress: string;
  let trader1Address: string;
  let trader2Address: string;
  let feeRecipientAddress: string;

  // Constants
  const BASE_TOKEN_DECIMALS = 18;
  const QUOTE_TOKEN_DECIMALS = 6;
  const INITIAL_MINT_AMOUNT_BASE = parseEther("10000"); // 10,000 BASE
  const INITIAL_MINT_AMOUNT_QUOTE = parseUnits("1000000", QUOTE_TOKEN_DECIMALS); // 1,000,000 QUOTE
  const DEFAULT_MAKER_FEE_RATE = 10; // 0.1% in basis points
  const DEFAULT_TAKER_FEE_RATE = 30; // 0.3% in basis points

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

    // Deploy vault contract with updated constructor parameters
    const Vault = await ethers.getContractFactory("Vault", owner);
    vault = (await Vault.deploy(
      ownerAddress,
      await state.getAddress(),
      feeRecipientAddress,
      DEFAULT_MAKER_FEE_RATE,
      DEFAULT_TAKER_FEE_RATE
    )) as unknown as Vault;

    // Deploy book contract
    const Book = await ethers.getContractFactory("Book", owner);
    book = (await Book.deploy(
      ownerAddress,
      await state.getAddress(),
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    )) as unknown as Book;

    // Deploy CLOB contract
    const CLOB = await ethers.getContractFactory("CLOB", owner);
    clob = (await CLOB.deploy(
      ownerAddress,
      await state.getAddress(),
      await book.getAddress(),
      await vault.getAddress()
    )) as unknown as CLOB;

    // Set up contract relationships
    await vault.connect(owner).setBook(await clob.getAddress()); // Authorize CLOB as the book
    await book.connect(owner).setVault(await vault.getAddress());
    await state.connect(owner).addAdmin(await clob.getAddress());
    await state.connect(owner).addAdmin(await book.getAddress());
    await vault.connect(owner).setCLOB(await clob.getAddress());
    await book.connect(owner).setCLOB(await clob.getAddress()); // Authorize CLOB in Book
    await clob.connect(owner).addSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress());

    // Approve tokens for Vault (using MaxUint256 for simplicity)
    await baseToken.connect(trader1).approve(await vault.getAddress(), ethers.MaxUint256);
    await quoteToken.connect(trader1).approve(await vault.getAddress(), ethers.MaxUint256);
    await baseToken.connect(trader2).approve(await vault.getAddress(), ethers.MaxUint256);
    await quoteToken.connect(trader2).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  describe("Fee Rate Configuration", function () {
    it("Should set default fee rates correctly", async function () {
      const [makerFeeRate, takerFeeRate] = await vault.getFeeRates();
      expect(makerFeeRate).to.equal(DEFAULT_MAKER_FEE_RATE);
      expect(takerFeeRate).to.equal(DEFAULT_TAKER_FEE_RATE);
    });

    it("Should allow admin to update fee rates", async function () {
      const newTakerFeeRate = 50; // 0.5%
      const newMakerFeeRate = 20; // 0.2%
      await vault.connect(owner).setFeeRates(newMakerFeeRate, newTakerFeeRate);
      const [makerFeeRate, takerFeeRate] = await vault.getFeeRates();
      expect(makerFeeRate).to.equal(newMakerFeeRate);
      expect(takerFeeRate).to.equal(newTakerFeeRate);
    });

    it("Should not allow non-admin to update fee rates", async function () {
      const newTakerFeeRate = 50;
      const newMakerFeeRate = 20;
      await expect(
        vault.connect(feeRecipient).setFeeRates(newMakerFeeRate, newTakerFeeRate)
      ).to.be.revertedWith("Vault: caller is not the owner");
    });
  });

  // Helper function to get order ID from OrderPlaced event
  async function getOrderIdFromTx(tx: any): Promise<bigint> {
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction receipt is null");
    const event = receipt.logs.find(
      (log: any) => log.topics && log.topics[0] === ethers.id("OrderPlaced(uint256,address,bool,uint256,uint256)")
    );
    if (!event) throw new Error("OrderPlaced event not found");
    const parsedLog = clob.interface.parseLog({ topics: event.topics as string[], data: event.data });
    if (!parsedLog) throw new Error("Failed to parse event log");
    return parsedLog.args[0]; // Assuming orderId is the first argument
  }

  // Helper function to place orders and get IDs - UPDATED to use placeLimitOrder
  async function placeOrders(makerSigner: Signer, takerSigner: Signer, makerPrice: bigint, makerQuantity: bigint, takerQuantity: bigint, isTakerBuy: boolean): Promise<{ makerOrderId: bigint, takerOrderId: bigint, settlementQuantity: bigint, settlementPrice: bigint }> {
    const makerIsBuy = !isTakerBuy;

    // Place Maker Order (Limit)
    const placeMakerTx = await clob.connect(makerSigner).placeLimitOrder(
      await baseToken.getAddress(),
      await quoteToken.getAddress(),
      makerIsBuy,
      makerPrice,
      makerQuantity
    );
    const makerOrderId = await getOrderIdFromTx(placeMakerTx);

    // Place Taker Order (Limit, matching maker's price)
    const placeTakerTx = await clob.connect(takerSigner).placeLimitOrder(
      await baseToken.getAddress(),
      await quoteToken.getAddress(),
      isTakerBuy,
      makerPrice, // Taker matches maker's price
      takerQuantity
    );
    const takerOrderId = await getOrderIdFromTx(placeTakerTx);

    // Determine settlement details
    const settlementQuantity = makerQuantity < takerQuantity ? makerQuantity : takerQuantity;
    const settlementPrice = makerPrice;

    return { makerOrderId, takerOrderId, settlementQuantity, settlementPrice };
  }

  describe("Fee Calculation", function () {
    it("Should calculate fees correctly with default rates", async function () {
      const makerPrice = parseUnits("100", QUOTE_TOKEN_DECIMALS);
      const makerQuantity = parseUnits("10", BASE_TOKEN_DECIMALS);
      const takerQuantity = parseUnits("10", BASE_TOKEN_DECIMALS);

      const { makerOrderId, takerOrderId, settlementQuantity, settlementPrice } = await placeOrders(trader1, trader2, makerPrice, makerQuantity, takerQuantity, true);

      const settlement = {
        takerOrderId: takerOrderId,
        makerOrderId: makerOrderId,
        price: settlementPrice,
        quantity: settlementQuantity,
        processed: false
      };

      const quoteAmount = (BigInt(settlement.quantity) * BigInt(settlement.price)) / BigInt(10**BASE_TOKEN_DECIMALS);
      const expectedTakerFee = (quoteAmount * BigInt(DEFAULT_TAKER_FEE_RATE)) / BigInt(10000);
      const expectedMakerFee = (quoteAmount * BigInt(DEFAULT_MAKER_FEE_RATE)) / BigInt(10000);

      const [makerFee, takerFee] = await vault.calculateFees(settlement);

      expect(makerFee).to.equal(expectedMakerFee);
      expect(takerFee).to.equal(expectedTakerFee);
    });

    it("Should calculate fees correctly with custom rates", async function () {
      const customTakerFeeRate = 50; // 0.5%
      const customMakerFeeRate = 25; // 0.25%
      await vault.connect(owner).setFeeRates(customMakerFeeRate, customTakerFeeRate);

      const makerPrice = parseUnits("100", QUOTE_TOKEN_DECIMALS);
      const makerQuantity = parseUnits("10", BASE_TOKEN_DECIMALS);
      const takerQuantity = parseUnits("10", BASE_TOKEN_DECIMALS);

      const { makerOrderId, takerOrderId, settlementQuantity, settlementPrice } = await placeOrders(trader1, trader2, makerPrice, makerQuantity, takerQuantity, true);

      const settlement = {
        takerOrderId: takerOrderId,
        makerOrderId: makerOrderId,
        price: settlementPrice,
        quantity: settlementQuantity,
        processed: false
      };

      const quoteAmount = (BigInt(settlement.quantity) * BigInt(settlement.price)) / BigInt(10**BASE_TOKEN_DECIMALS);
      const expectedTakerFee = (quoteAmount * BigInt(customTakerFeeRate)) / BigInt(10000);
      const expectedMakerFee = (quoteAmount * BigInt(customMakerFeeRate)) / BigInt(10000);

      const [makerFee, takerFee] = await vault.calculateFees(settlement);

      expect(makerFee).to.equal(expectedMakerFee);
      expect(takerFee).to.equal(expectedTakerFee);
    });

    it("Should calculate fees correctly for small orders", async function () {
        const makerPrice = parseUnits("0.01", QUOTE_TOKEN_DECIMALS);
        const makerQuantity = parseUnits("0.1", BASE_TOKEN_DECIMALS);
        const takerQuantity = parseUnits("0.1", BASE_TOKEN_DECIMALS);

        const { makerOrderId, takerOrderId, settlementQuantity, settlementPrice } = await placeOrders(trader1, trader2, makerPrice, makerQuantity, takerQuantity, true);

        const settlement = {
            takerOrderId: takerOrderId,
            makerOrderId: makerOrderId,
            price: settlementPrice,
            quantity: settlementQuantity,
            processed: false
        };

        const quoteAmount = (BigInt(settlement.quantity) * BigInt(settlement.price)) / BigInt(10**BASE_TOKEN_DECIMALS);
        const expectedTakerFee = (quoteAmount * BigInt(DEFAULT_TAKER_FEE_RATE)) / BigInt(10000);
        const expectedMakerFee = (quoteAmount * BigInt(DEFAULT_MAKER_FEE_RATE)) / BigInt(10000);

        const [makerFee, takerFee] = await vault.calculateFees(settlement);

        expect(makerFee).to.equal(expectedMakerFee);
        expect(takerFee).to.equal(expectedTakerFee);
    });

    it("Should calculate fees correctly for large orders", async function () {
        const makerPrice = parseUnits("10000", QUOTE_TOKEN_DECIMALS);
        const makerQuantity = parseUnits("90", BASE_TOKEN_DECIMALS);
        const takerQuantity = parseUnits("90", BASE_TOKEN_DECIMALS);

        const { makerOrderId, takerOrderId, settlementQuantity, settlementPrice } = await placeOrders(trader1, trader2, makerPrice, makerQuantity, takerQuantity, true);

        const settlement = {
            takerOrderId: takerOrderId,
            makerOrderId: makerOrderId,
            price: settlementPrice,
            quantity: settlementQuantity,
            processed: false
        };

        const quoteAmount = (BigInt(settlement.quantity) * BigInt(settlement.price)) / BigInt(10**BASE_TOKEN_DECIMALS);
        const expectedTakerFee = (quoteAmount * BigInt(DEFAULT_TAKER_FEE_RATE)) / BigInt(10000);
        const expectedMakerFee = (quoteAmount * BigInt(DEFAULT_MAKER_FEE_RATE)) / BigInt(10000);

        const [makerFee, takerFee] = await vault.calculateFees(settlement);

        expect(makerFee).to.equal(expectedMakerFee);
        expect(takerFee).to.equal(expectedTakerFee);
    });

    it("Should handle zero fee rates correctly", async function () {
      await vault.connect(owner).setFeeRates(0, 0);

      const makerPrice = parseUnits("100", QUOTE_TOKEN_DECIMALS);
      const makerQuantity = parseUnits("10", BASE_TOKEN_DECIMALS);
      const takerQuantity = parseUnits("10", BASE_TOKEN_DECIMALS);

      const { makerOrderId, takerOrderId, settlementQuantity, settlementPrice } = await placeOrders(trader1, trader2, makerPrice, makerQuantity, takerQuantity, true);

      const settlement = {
        takerOrderId: takerOrderId,
        makerOrderId: makerOrderId,
        price: settlementPrice,
        quantity: settlementQuantity,
        processed: false
      };

      const [makerFee, takerFee] = await vault.calculateFees(settlement);

      expect(makerFee).to.equal(0);
      expect(takerFee).to.equal(0);
    });
  });
});

