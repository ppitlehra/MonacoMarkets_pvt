/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, TransactionReceipt, EventLog } from "ethers"; // Import EventLog
import { Book, CLOB, State, Vault, MockERC20, SymphonyAdapter, MockSymphony } from "../typechain-types";

// Helper function to parse units
const parseBase = (amount: string | number) => ethers.parseUnits(amount.toString(), 18);
const parseQuote = (amount: string | number) => ethers.parseUnits(amount.toString(), 6);

// Define constants used in calculations
const FEE_DENOMINATOR = 10000n;

describe("Symphony Full End-to-End Tests", function () {
  // Contract instances
  let vault: Vault;
  let state: State;
  let book: Book;
  let clob: CLOB;
  let symphonyAdapter: SymphonyAdapter;
  let baseToken: MockERC20;
  let quoteToken: MockERC20;
  let mockSymphony: MockSymphony;

  // Signers
  let owner: Signer;
  let user: Signer; // Generic user initiating swap via MockSymphony
  let maker: Signer; // Generic liquidity provider on CLOB
  let clobFeeRecipient: Signer; // Recipient for CLOB fees
  let symphonyFeeRecipientSigner: Signer; // Recipient for Symphony fees

  // Addresses
  let ownerAddress: string;
  let userAddress: string;
  let makerAddress: string;
  let clobFeeRecipientAddress: string;
  let symphonyFeeRecipientAddress: string;
  let bookAddress: string;
  let stateAddress: string;
  let vaultAddress: string;
  let symphonyAdapterAddress: string;
  let mockSymphonyAddress: string;
  let baseTokenAddress: string;
  let quoteTokenAddress: string;

  // Constants
  const BASE_TOKEN_DECIMALS = 18;
  const QUOTE_TOKEN_DECIMALS = 6;
  const CLOB_MAKER_FEE_RATE = 50; // 0.5%
  const CLOB_TAKER_FEE_RATE = 100; // 1.0%
  const SYMPHONY_FEE_RATE_BPS = 300; // 3% (Basis points) - Used for MockSymphony fee calc

  // Helper to extract order ID from receipt logs
  async function extractOrderId(receipt: TransactionReceipt | null, expectedTrader?: string) {
    if (!receipt || !receipt.logs) return null;
    const stateInterface = state.interface;
    for (const log of receipt.logs) {
        try {
            // Check if log address matches state address
            if (log.address.toLowerCase() === stateAddress.toLowerCase()) {
                const parsedLog = stateInterface.parseLog(log as unknown as { topics: Array<string>, data: string });
                if (parsedLog && parsedLog.name === "OrderCreated") {
                    // Optionally check if the trader matches
                    if (!expectedTrader || parsedLog.args.trader.toLowerCase() === expectedTrader.toLowerCase()) {
                        return parsedLog.args.orderId;
                    }
                }
            }
        } catch (e) { /* Ignore logs not parseable by state interface or wrong address */ }
    }
    return null;
  }

  beforeEach(async function () {
    // Get signers
    [owner, user, maker, clobFeeRecipient, symphonyFeeRecipientSigner] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    userAddress = await user.getAddress();
    makerAddress = await maker.getAddress();
    clobFeeRecipientAddress = await clobFeeRecipient.getAddress();
    symphonyFeeRecipientAddress = await symphonyFeeRecipientSigner.getAddress();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20", owner);
    baseToken = (await MockERC20.deploy("Base Token", "BASE", BASE_TOKEN_DECIMALS, ownerAddress)) as unknown as MockERC20;
    quoteToken = (await MockERC20.deploy("Quote Token", "QUOTE", QUOTE_TOKEN_DECIMALS, ownerAddress)) as unknown as MockERC20;
    baseTokenAddress = await baseToken.getAddress();
    quoteTokenAddress = await quoteToken.getAddress();

    // Deploy state contract
    const State = await ethers.getContractFactory("State", owner);
    state = (await State.deploy(ownerAddress)) as unknown as State;
    stateAddress = await state.getAddress();

    // Deploy book contract
    const Book = await ethers.getContractFactory("Book", owner);
    book = (await Book.deploy(ownerAddress, stateAddress, baseTokenAddress, quoteTokenAddress)) as unknown as Book;
    bookAddress = await book.getAddress();

    // Deploy vault contract with CLOB fee rates
    const Vault = await ethers.getContractFactory("Vault", owner);
    vault = (await Vault.deploy(ownerAddress, stateAddress, clobFeeRecipientAddress, CLOB_MAKER_FEE_RATE, CLOB_TAKER_FEE_RATE)) as unknown as Vault;
    vaultAddress = await vault.getAddress();

    // Deploy CLOB contract
    const CLOB = await ethers.getContractFactory("CLOB", owner);
    clob = (await CLOB.deploy(ownerAddress, stateAddress, bookAddress, vaultAddress)) as unknown as CLOB;
    const clobAddressStr = await clob.getAddress();

    // Deploy SymphonyAdapter contract
    const SymphonyAdapter = await ethers.getContractFactory("SymphonyAdapter", owner);
    symphonyAdapter = (await SymphonyAdapter.deploy(ownerAddress, clobAddressStr)) as unknown as SymphonyAdapter;
    symphonyAdapterAddress = await symphonyAdapter.getAddress();

    // Deploy MockSymphony contract
    const MockSymphony = await ethers.getContractFactory("MockSymphony", owner);
    mockSymphony = (await MockSymphony.deploy(symphonyAdapterAddress, clobAddressStr, symphonyFeeRecipientAddress)) as unknown as MockSymphony;
    mockSymphonyAddress = await mockSymphony.getAddress();
    await mockSymphony.setSymphonyFeeRate(SYMPHONY_FEE_RATE_BPS); // Set fee rate

    // Set up permissions
    await state.connect(owner).addAdmin(clobAddressStr);
    await state.connect(owner).addAdmin(bookAddress);
    await state.connect(owner).addAdmin(vaultAddress);
    await state.connect(owner).addAdmin(symphonyAdapterAddress);

    await book.connect(owner).setCLOB(clobAddressStr);
    await book.connect(owner).setVault(vaultAddress);

    await vault.connect(owner).setCLOB(clobAddressStr); // Vault needs CLOB only to call getComponents indirectly
    await vault.connect(owner).setBook(clobAddressStr); // CLOB acts as the book for vault permissions

    await clob.connect(owner).addSupportedPair(baseTokenAddress, quoteTokenAddress);

    // Approve Vault from Adapter (required for synchronous flow where adapter pays fees/receives output)
    await symphonyAdapter.connect(owner).approveVault(baseTokenAddress, ethers.MaxUint256);
    await symphonyAdapter.connect(owner).approveVault(quoteTokenAddress, ethers.MaxUint256);
  });

  // --- Test Scenarios Will Be Added Here Incrementally ---

  describe("Scenario 1.1: User Buys Base Token (Full Fill)", function() {
    it("Should execute swap via MockSymphony, fill fully, apply fees, and update balances", async function() {
      // --- Test Values ---
      const orderQuantity = parseBase("10"); // User wants to buy 10 BASE
      const orderPrice = parseQuote("100"); // Price is 100 QUOTE per BASE

      // --- Setup: Maker places SELL order ---
      // Maker needs BASE to sell
      await baseToken.mint(makerAddress, orderQuantity);
      // Maker needs QUOTE approval for potential maker fees
      await quoteToken.mint(makerAddress, parseQuote("10"));
      await baseToken.connect(maker).approve(vaultAddress, ethers.MaxUint256);
      await quoteToken.connect(maker).approve(vaultAddress, ethers.MaxUint256);

      const sellTx = await clob.connect(maker).placeLimitOrder(
          baseTokenAddress, quoteTokenAddress, false, orderPrice, orderQuantity
      );
      const sellReceipt = await sellTx.wait();
      const makerOrderId = await extractOrderId(sellReceipt, makerAddress);
      expect(makerOrderId).to.not.be.null;
      console.log(`SETUP: Maker placed direct limit order (SELL ${ethers.formatUnits(orderQuantity, BASE_TOKEN_DECIMALS)} BASE @ ${ethers.formatUnits(orderPrice, QUOTE_TOKEN_DECIMALS)} QUOTE). Order ID: ${makerOrderId}`);

      // --- Setup: User funds and approvals ---
      // User needs QUOTE to buy BASE (amountIn) + QUOTE for CLOB fees (transferred directly)
      const quoteAmountIn = (orderQuantity * orderPrice) / (10n ** BigInt(BASE_TOKEN_DECIMALS));
      const actualClobMakerFeeQuote = (quoteAmountIn * BigInt(CLOB_MAKER_FEE_RATE)) / FEE_DENOMINATOR; // Keep for CLOB fee recipient check
      const actualClobTakerFeeQuote = (quoteAmountIn * BigInt(CLOB_TAKER_FEE_RATE)) / FEE_DENOMINATOR;
      // const totalFeesQuote = actualClobMakerFeeQuote + actualClobTakerFeeQuote; // No longer needed for transfer

      // Fund user with quoteAmountIn + ONLY TAKER fee + buffer
      const bufferQuote = parseQuote("1");
      await quoteToken.mint(userAddress, quoteAmountIn + actualClobTakerFeeQuote + bufferQuote); // Fund with only taker fee
      // User approves MockSymphony ONLY for quoteAmountIn
      await quoteToken.connect(user).approve(mockSymphonyAddress, quoteAmountIn);
      // User transfers ONLY TAKER CLOB fee directly to adapter
      console.log(`SETUP: User transferring CLOB Taker Fee (${ethers.formatUnits(actualClobTakerFeeQuote, QUOTE_TOKEN_DECIMALS)} QUOTE) directly to adapter ${symphonyAdapterAddress}`);
      await quoteToken.connect(user).transfer(symphonyAdapterAddress, actualClobTakerFeeQuote); // Transfer only taker fee

      // --- Initial Balances ---
      const initialUserBase = await baseToken.balanceOf(userAddress);
      const initialUserQuote = await quoteToken.balanceOf(userAddress);
      const initialMakerBase = await baseToken.balanceOf(makerAddress);
      const initialMakerQuote = await quoteToken.balanceOf(makerAddress);
      const initialSymphonyFeeRecipientBase = await baseToken.balanceOf(symphonyFeeRecipientAddress);
      const initialClobFeeRecipientQuote = await quoteToken.balanceOf(clobFeeRecipientAddress);
      const initialAdapterQuote = await quoteToken.balanceOf(symphonyAdapterAddress);

      console.log(`INITIAL: User: ${ethers.formatUnits(initialUserBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(initialUserQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`INITIAL: Maker: ${ethers.formatUnits(initialMakerBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(initialMakerQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`INITIAL: Adapter: ${ethers.formatUnits(initialAdapterQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);

      // --- Action: User executes swap via MockSymphony ---
      const minAmountOutBase = orderQuantity * 99n / 100n; // Allow 1% slippage
      console.log(`ACTION: User executing swap via MockSymphony: Input ${ethers.formatUnits(quoteAmountIn, QUOTE_TOKEN_DECIMALS)} QUOTE for min ${ethers.formatUnits(minAmountOutBase, BASE_TOKEN_DECIMALS)} BASE`);

      const swapTx = await mockSymphony.connect(user).executeSwap(
          quoteTokenAddress, // tokenIn = QUOTE
          baseTokenAddress,  // tokenOut = BASE
          quoteAmountIn,     // amountIn (quote)
          minAmountOutBase
      );
      const swapReceipt = await swapTx.wait();

      // --- Verification: Events ---
      let swapEventFound = false;
      let eventAmountOutNet = 0n;
      let eventSymphonyFee = 0n;
      const mockSymphonyInterface = mockSymphony.interface;
      if (swapReceipt && swapReceipt.logs) {
          for (const log of swapReceipt.logs) {
              try {
                  if (log.address.toLowerCase() === mockSymphonyAddress.toLowerCase()) {
                      const parsedLog = mockSymphonyInterface.parseLog(log as unknown as { topics: Array<string>, data: string });
                      if (parsedLog && parsedLog.name === "SwapExecuted") {
                          swapEventFound = true;
                          eventAmountOutNet = parsedLog.args.amountOutNet; // Net BASE sent to user
                          eventSymphonyFee = parsedLog.args.symphonyFee; // Symphony fee in BASE
                          expect(parsedLog.args.user).to.equal(userAddress);
                          expect(parsedLog.args.tokenIn).to.equal(quoteTokenAddress);
                          expect(parsedLog.args.tokenOut).to.equal(baseTokenAddress);
                          expect(parsedLog.args.amountIn).to.equal(quoteAmountIn);
                          console.log(`VERIFY: SwapExecuted Event: Net Out ${ethers.formatUnits(eventAmountOutNet, BASE_TOKEN_DECIMALS)} BASE, Fee ${ethers.formatUnits(eventSymphonyFee, BASE_TOKEN_DECIMALS)} BASE`);
                          break;
                      }
                  }
              } catch(e) {/* ignore */} 
          }
      }
      expect(swapEventFound, "SwapExecuted event not found").to.be.true;

      // --- Verification: Fee Calculations ---
      const grossBaseAmount = orderQuantity; // Amount received by adapter from CLOB
      const expectedSymphonyFeeBase = (grossBaseAmount * BigInt(SYMPHONY_FEE_RATE_BPS)) / FEE_DENOMINATOR;
      const expectedNetBaseToUser = grossBaseAmount - expectedSymphonyFeeBase;

      // actualClobMakerFeeQuote and actualClobTakerFeeQuote calculated above
      const expectedMakerQuoteReceived = quoteAmountIn - actualClobMakerFeeQuote;

      expect(eventSymphonyFee).to.equal(expectedSymphonyFeeBase, "Symphony fee mismatch in event");
      expect(eventAmountOutNet).to.equal(expectedNetBaseToUser, "Net amount out mismatch in event");

      // --- Verification: Final Balances ---
      const finalUserBase = await baseToken.balanceOf(userAddress);
      const finalUserQuote = await quoteToken.balanceOf(userAddress);
      const finalMakerBase = await baseToken.balanceOf(makerAddress);
      const finalMakerQuote = await quoteToken.balanceOf(makerAddress);
      const finalSymphonyFeeRecipientBase = await baseToken.balanceOf(symphonyFeeRecipientAddress);
      const finalClobFeeRecipientQuote = await quoteToken.balanceOf(clobFeeRecipientAddress);
      const finalMockSymphonyBase = await baseToken.balanceOf(mockSymphonyAddress);
      const finalMockSymphonyQuote = await quoteToken.balanceOf(mockSymphonyAddress);
      const finalAdapterBase = await baseToken.balanceOf(symphonyAdapterAddress);
      const finalAdapterQuote = await quoteToken.balanceOf(symphonyAdapterAddress);

      console.log(`FINAL: User: ${ethers.formatUnits(finalUserBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(finalUserQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`FINAL: Maker: ${ethers.formatUnits(finalMakerBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(finalMakerQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`FINAL: Symphony Fee Recipient: ${ethers.formatUnits(finalSymphonyFeeRecipientBase, BASE_TOKEN_DECIMALS)} BASE`);
      console.log(`FINAL: CLOB Fee Recipient: ${ethers.formatUnits(finalClobFeeRecipientQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`FINAL: Adapter: ${ethers.formatUnits(finalAdapterBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(finalAdapterQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);

      // User checks
      expect(finalUserBase).to.equal(initialUserBase + expectedNetBaseToUser, "User final BASE balance mismatch");
      // User starts with initial quote, transfers fees directly, approves amountIn to MockSymphony which transfers it to adapter
      const expectedFinalUserQuote = initialUserQuote - actualClobTakerFeeQuote - quoteAmountIn;
      // Add detailed logging before assertion
      console.log(`DEBUG Scenario 1.1: Final User Quote: ${finalUserQuote}`);
      console.log(`DEBUG Scenario 1.1: Expected Final User Quote (Calc): ${expectedFinalUserQuote}`);
      console.log(`DEBUG Scenario 1.1: Expected Final User Quote (Direct): ${initialUserQuote - actualClobTakerFeeQuote - quoteAmountIn}`);
      console.log(`DEBUG Scenario 1.1: Initial User Quote: ${initialUserQuote}`);
      console.log(`DEBUG Scenario 1.1: Taker Fee Quote: ${actualClobTakerFeeQuote}`);
      console.log(`DEBUG Scenario 1.1: Quote Amount In: ${quoteAmountIn}`);
      // Re-calculate directly in assertion to be absolutely sure
      expect(finalUserQuote).to.equal(bufferQuote, "User final QUOTE balance mismatch");

      // Maker checks
      expect(finalMakerBase).to.equal(initialMakerBase - orderQuantity, "Maker final BASE balance mismatch");
      expect(finalMakerQuote).to.equal(initialMakerQuote + expectedMakerQuoteReceived, "Maker final QUOTE balance mismatch");

      // Fee recipient checks
      expect(finalSymphonyFeeRecipientBase).to.equal(initialSymphonyFeeRecipientBase + expectedSymphonyFeeBase, "Symphony fee recipient BASE balance mismatch");
      expect(finalClobFeeRecipientQuote).to.equal(initialClobFeeRecipientQuote + actualClobMakerFeeQuote + actualClobTakerFeeQuote, "CLOB fee recipient QUOTE balance mismatch");

      // MockSymphony/Adapter should have zero balance
      expect(finalMockSymphonyBase).to.equal(0, "MockSymphony should have 0 BASE");
      expect(finalMockSymphonyQuote).to.equal(0, "MockSymphony should have 0 QUOTE");
      expect(finalAdapterBase).to.equal(0, "Adapter should have 0 BASE");
      expect(finalAdapterQuote).to.equal(0, "Adapter should have 0 QUOTE");

      // --- Verification: Order Status ---
      const finalMakerOrder = await state.getOrder(makerOrderId!);
      expect(finalMakerOrder.status).to.equal(2); // 2 = FILLED
    });
  });




  describe("Scenario 1.2: User Sells Base Token (Full Fill)", function() {
    it("Should execute swap via MockSymphony, fill fully, apply fees, and update balances", async function() {
      // --- Test Values ---
      const orderQuantity = parseBase("5"); // User wants to sell 5 BASE
      const orderPrice = parseQuote("105"); // Price is 105 QUOTE per BASE

      // --- Setup: Maker places BUY order ---
      // Maker needs QUOTE to buy
      const quoteRequiredForBuy = (orderQuantity * orderPrice) / (10n ** BigInt(BASE_TOKEN_DECIMALS));
      const estimatedMakerFee = (quoteRequiredForBuy * BigInt(CLOB_MAKER_FEE_RATE)) / FEE_DENOMINATOR;
      await quoteToken.mint(makerAddress, quoteRequiredForBuy + estimatedMakerFee + parseQuote("1"));
      // Maker needs BASE approval for potential maker fees (if fee token changes)
      await baseToken.mint(makerAddress, parseBase("1"));
      await baseToken.connect(maker).approve(vaultAddress, ethers.MaxUint256);
      await quoteToken.connect(maker).approve(vaultAddress, ethers.MaxUint256);

      const buyTx = await clob.connect(maker).placeLimitOrder(
          baseTokenAddress, quoteTokenAddress, true, orderPrice, orderQuantity
      );
      const buyReceipt = await buyTx.wait();
      const makerOrderId = await extractOrderId(buyReceipt, makerAddress);
      expect(makerOrderId).to.not.be.null;
      console.log(`SETUP: Maker placed direct limit order (BUY ${ethers.formatUnits(orderQuantity, BASE_TOKEN_DECIMALS)} BASE @ ${ethers.formatUnits(orderPrice, QUOTE_TOKEN_DECIMALS)} QUOTE). Order ID: ${makerOrderId}`);

      // --- Setup: User funds and approvals ---
      // User needs BASE to sell
      await baseToken.mint(userAddress, orderQuantity);
      // User approves MockSymphony for BASE (amountIn)
      await baseToken.connect(user).approve(mockSymphonyAddress, orderQuantity);

      // User needs QUOTE to pay CLOB taker fee (transferred directly to adapter)
      const grossQuoteAmount = quoteRequiredForBuy; // Gross quote expected from the trade
      const actualClobTakerFeeQuote = (grossQuoteAmount * BigInt(CLOB_TAKER_FEE_RATE)) / FEE_DENOMINATOR;
      const bufferQuote = parseQuote("1");
      await quoteToken.mint(userAddress, actualClobTakerFeeQuote + bufferQuote); // Fund user for fee + buffer
      console.log(`SETUP: User transferring CLOB Taker Fee (${ethers.formatUnits(actualClobTakerFeeQuote, QUOTE_TOKEN_DECIMALS)} QUOTE) directly to adapter ${symphonyAdapterAddress}`);
      await quoteToken.connect(user).transfer(symphonyAdapterAddress, actualClobTakerFeeQuote);

      // --- Initial Balances ---
      const initialUserBase = await baseToken.balanceOf(userAddress);
      const initialUserQuote = await quoteToken.balanceOf(userAddress); // Balance AFTER transferring fee
      const initialMakerBase = await baseToken.balanceOf(makerAddress);
      const initialMakerQuote = await quoteToken.balanceOf(makerAddress);
      const initialSymphonyFeeRecipientQuote = await quoteToken.balanceOf(symphonyFeeRecipientAddress);
      const initialClobFeeRecipientQuote = await quoteToken.balanceOf(clobFeeRecipientAddress);
      const initialAdapterQuote = await quoteToken.balanceOf(symphonyAdapterAddress);

      console.log(`INITIAL: User: ${ethers.formatUnits(initialUserBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(initialUserQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`INITIAL: Maker: ${ethers.formatUnits(initialMakerBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(initialMakerQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`INITIAL: Adapter: ${ethers.formatUnits(initialAdapterQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);

      // --- Action: User executes swap via MockSymphony ---
      const minAmountOutQuote = grossQuoteAmount * 99n / 100n; // Allow 1% slippage on quote output
      console.log(`ACTION: User executing swap via MockSymphony: Input ${ethers.formatUnits(orderQuantity, BASE_TOKEN_DECIMALS)} BASE for min ${ethers.formatUnits(minAmountOutQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);

      const swapTx = await mockSymphony.connect(user).executeSwap(
          baseTokenAddress,  // tokenIn = BASE
          quoteTokenAddress, // tokenOut = QUOTE
          orderQuantity,     // amountIn (base)
          minAmountOutQuote
      );
      const swapReceipt = await swapTx.wait();

      // --- Verification: Events ---
      let swapEventFound = false;
      let eventAmountOutNet = 0n;
      let eventSymphonyFee = 0n;
      const mockSymphonyInterface = mockSymphony.interface;
      if (swapReceipt && swapReceipt.logs) {
          for (const log of swapReceipt.logs) {
              try {
                  if (log.address.toLowerCase() === mockSymphonyAddress.toLowerCase()) {
                      const parsedLog = mockSymphonyInterface.parseLog(log as unknown as { topics: Array<string>, data: string });
                      if (parsedLog && parsedLog.name === "SwapExecuted") {
                          swapEventFound = true;
                          eventAmountOutNet = parsedLog.args.amountOutNet; // Net QUOTE sent to user
                          eventSymphonyFee = parsedLog.args.symphonyFee; // Symphony fee in QUOTE
                          expect(parsedLog.args.user).to.equal(userAddress);
                          expect(parsedLog.args.tokenIn).to.equal(baseTokenAddress);
                          expect(parsedLog.args.tokenOut).to.equal(quoteTokenAddress);
                          expect(parsedLog.args.amountIn).to.equal(orderQuantity);
                          console.log(`VERIFY: SwapExecuted Event: Net Out ${ethers.formatUnits(eventAmountOutNet, QUOTE_TOKEN_DECIMALS)} QUOTE, Fee ${ethers.formatUnits(eventSymphonyFee, QUOTE_TOKEN_DECIMALS)} QUOTE`);
                          break;
                      }
                  }
              } catch(e) {/* ignore */} 
          }
      }
      expect(swapEventFound, "SwapExecuted event not found").to.be.true;

      // --- Verification: Fee Calculations ---
      // Amount adapter received from CLOB (Gross amount, because fee pre-transfer offsets Vault deduction)
      const grossQuoteAmountFromClob = grossQuoteAmount;
      // Symphony fee is calculated on the amount received by MockSymphony from Adapter
      const expectedSymphonyFeeQuote = (grossQuoteAmountFromClob * BigInt(SYMPHONY_FEE_RATE_BPS)) / FEE_DENOMINATOR;
      const expectedNetQuoteToUser = grossQuoteAmountFromClob - expectedSymphonyFeeQuote;

      const actualClobMakerFeeQuote = (grossQuoteAmount * BigInt(CLOB_MAKER_FEE_RATE)) / FEE_DENOMINATOR;
      const expectedMakerBaseReceived = orderQuantity;

      expect(eventSymphonyFee).to.equal(expectedSymphonyFeeQuote, "Symphony fee mismatch in event");
      expect(eventAmountOutNet).to.equal(expectedNetQuoteToUser, "Net amount out mismatch in event");

      // --- Verification: Final Balances ---
      const finalUserBase = await baseToken.balanceOf(userAddress);
      const finalUserQuote = await quoteToken.balanceOf(userAddress);
      const finalMakerBase = await baseToken.balanceOf(makerAddress);
      const finalMakerQuote = await quoteToken.balanceOf(makerAddress);
      const finalSymphonyFeeRecipientQuote = await quoteToken.balanceOf(symphonyFeeRecipientAddress);
      const finalClobFeeRecipientQuote = await quoteToken.balanceOf(clobFeeRecipientAddress);
      const finalMockSymphonyBase = await baseToken.balanceOf(mockSymphonyAddress);
      const finalMockSymphonyQuote = await quoteToken.balanceOf(mockSymphonyAddress);
      const finalAdapterBase = await baseToken.balanceOf(symphonyAdapterAddress);
      const finalAdapterQuote = await quoteToken.balanceOf(symphonyAdapterAddress);

      console.log(`FINAL: User: ${ethers.formatUnits(finalUserBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(finalUserQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`FINAL: Maker: ${ethers.formatUnits(finalMakerBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(finalMakerQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`FINAL: Symphony Fee Recipient: ${ethers.formatUnits(finalSymphonyFeeRecipientQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`FINAL: CLOB Fee Recipient: ${ethers.formatUnits(finalClobFeeRecipientQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`FINAL: Adapter: ${ethers.formatUnits(finalAdapterBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(finalAdapterQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);

      // User checks
      expect(finalUserBase).to.equal(initialUserBase - orderQuantity, "User final BASE balance mismatch");
      // User starts with initial quote (which is AFTER transferring CLOB taker fee), receives net output from MockSymphony
      const expectedFinalUserQuote = initialUserQuote + expectedNetQuoteToUser;
      console.log(`DEBUG Scenario 1.2: Final User Quote: ${finalUserQuote}`);
      console.log(`DEBUG Scenario 1.2: Expected Final User Quote (Calc): ${expectedFinalUserQuote}`);
      console.log(`DEBUG Scenario 1.2: Expected Final User Quote (Direct): ${initialUserQuote + expectedNetQuoteToUser}`);
      console.log(`DEBUG Scenario 1.2: Initial User Quote (after fee transfer): ${initialUserQuote}`);
      console.log(`DEBUG Scenario 1.2: Expected Net Quote to User: ${expectedNetQuoteToUser}`);
      // Re-calculate directly in assertion
      expect(finalUserQuote).to.equal(initialUserQuote + expectedNetQuoteToUser, "User final QUOTE balance mismatch");

      // Maker checks
      expect(finalMakerBase).to.equal(initialMakerBase + expectedMakerBaseReceived, "Maker final BASE balance mismatch");
      expect(finalMakerQuote).to.equal(initialMakerQuote - grossQuoteAmount - actualClobMakerFeeQuote, "Maker final QUOTE balance mismatch");

      // Fee recipient checks
      expect(finalSymphonyFeeRecipientQuote).to.equal(initialSymphonyFeeRecipientQuote + expectedSymphonyFeeQuote, "Symphony fee recipient QUOTE balance mismatch");
      expect(finalClobFeeRecipientQuote).to.equal(initialClobFeeRecipientQuote + actualClobMakerFeeQuote + actualClobTakerFeeQuote, "CLOB fee recipient QUOTE balance mismatch");

      // MockSymphony/Adapter should have zero balance
      expect(finalMockSymphonyBase).to.equal(0, "MockSymphony should have 0 BASE");
      expect(finalMockSymphonyQuote).to.equal(0, "MockSymphony should have 0 QUOTE");
      expect(finalAdapterBase).to.equal(0, "Adapter should have 0 BASE");
      expect(finalAdapterQuote).to.equal(0, "Adapter should have 0 QUOTE");

      // --- Verification: Order Status ---
      const finalMakerOrder = await state.getOrder(makerOrderId!);
      expect(finalMakerOrder.status).to.equal(2); // 2 = FILLED
    });
  });

});

