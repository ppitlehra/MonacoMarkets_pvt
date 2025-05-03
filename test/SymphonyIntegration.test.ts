import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, TransactionReceipt, EventLog } from "ethers"; // Import EventLog
import { Book, CLOB, State, Vault, MockERC20, SymphonyAdapter, MockSymphony } from "../typechain-types";

// Helper function to parse units
const parseBase = (amount: string | number) => ethers.parseUnits(amount.toString(), 18);
const parseQuote = (amount: string | number) => ethers.parseUnits(amount.toString(), 6);

// Define constants used in calculations
const FEE_DENOMINATOR = 10000n;

describe("Symphony Integration Tests", function () {
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
  let buyer: Signer; // User initiating the swap via MockSymphony
  let seller: Signer; // User providing liquidity directly on CLOB
  let feeRecipient: Signer; // Recipient for CLOB fees
  let symphonyFeeRecipientSigner: Signer; // Recipient for Symphony fees

  // Addresses
  let ownerAddress: string;
  let buyerAddress: string;
  let sellerAddress: string;
  let feeRecipientAddress: string;
  let symphonyFeeRecipientAddress: string; // Address for Symphony fees
  let bookAddress: string;
  let stateAddress: string;
  let vaultAddress: string;
  let symphonyAdapterAddress: string;
  let mockSymphonyAddress: string;

  // Constants
  const BASE_TOKEN_DECIMALS = 18;
  const QUOTE_TOKEN_DECIMALS = 6;
  const CLOB_MAKER_FEE_RATE = 50; // 0.5%
  const CLOB_TAKER_FEE_RATE = 100; // 1.0%
  const SYMPHONY_FEE_RATE_BPS = 300; // 3% (Basis points) - Used for MockSymphony fee calc

  // Test values
  const ORDER_QUANTITY = parseBase("10"); // 10 base tokens
  const ORDER_PRICE = parseQuote("100"); // 100 quote tokens per base token

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
    [owner, buyer, seller, feeRecipient, symphonyFeeRecipientSigner] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    buyerAddress = await buyer.getAddress();
    sellerAddress = await seller.getAddress();
    feeRecipientAddress = await feeRecipient.getAddress();
    symphonyFeeRecipientAddress = await symphonyFeeRecipientSigner.getAddress();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20", owner);
    baseToken = (await MockERC20.deploy("Base Token", "BASE", BASE_TOKEN_DECIMALS, ownerAddress)) as unknown as MockERC20;
    quoteToken = (await MockERC20.deploy("Quote Token", "QUOTE", QUOTE_TOKEN_DECIMALS, ownerAddress)) as unknown as MockERC20;
    const baseTokenAddress = await baseToken.getAddress();
    const quoteTokenAddress = await quoteToken.getAddress();

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
    vault = (await Vault.deploy(ownerAddress, stateAddress, feeRecipientAddress, CLOB_MAKER_FEE_RATE, CLOB_TAKER_FEE_RATE)) as unknown as Vault;
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

    // Fund users
    // Buyer needs QUOTE token to initiate swap via MockSymphony
    const quoteAmountForSwap = (ORDER_QUANTITY * ORDER_PRICE) / (10n ** BigInt(BASE_TOKEN_DECIMALS));
    const estimatedClobTakerFee = (quoteAmountForSwap * BigInt(CLOB_TAKER_FEE_RATE)) / 10000n;
    await quoteToken.mint(buyerAddress, quoteAmountForSwap + estimatedClobTakerFee + parseQuote("1")); // Add buffer

    // Seller needs BASE token to provide liquidity directly on CLOB
    await baseToken.mint(sellerAddress, ORDER_QUANTITY);
    // Seller also needs QUOTE token approval for Vault if their order is maker (for fees)
    await quoteToken.mint(sellerAddress, parseQuote("10")); // Small amount for fees

    // Approve Vault for Seller (Direct CLOB interaction)
    await baseToken.connect(seller).approve(vaultAddress, ethers.MaxUint256);
    await quoteToken.connect(seller).approve(vaultAddress, ethers.MaxUint256);

    // Approve MockSymphony for Buyer (User -> Symphony interaction)
    await quoteToken.connect(buyer).approve(mockSymphonyAddress, ethers.MaxUint256);
  });

  describe("Symphony End-to-End Flow (Synchronous)", function() {
    it("Should execute swap via adapter, settle on CLOB, apply Symphony fees, and update user balances", async function() {
      const baseTokenAddress = await baseToken.getAddress();
      const quoteTokenAddress = await quoteToken.getAddress();

      // --- Initial Balances --- (Using BigInt)
      const initialBuyerBase = await baseToken.balanceOf(buyerAddress);
      const initialBuyerQuote = await quoteToken.balanceOf(buyerAddress);
      const initialSellerBase = await baseToken.balanceOf(sellerAddress);
      const initialSellerQuote = await quoteToken.balanceOf(sellerAddress);
      const initialSymphonyFeeRecipientQuote = await quoteToken.balanceOf(symphonyFeeRecipientAddress);
      const initialClobFeeRecipientQuote = await quoteToken.balanceOf(feeRecipientAddress);
      const initialMockSymphonyQuote = await quoteToken.balanceOf(mockSymphonyAddress);

      console.log(`Initial Buyer: ${ethers.formatUnits(initialBuyerBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(initialBuyerQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`Initial Seller: ${ethers.formatUnits(initialSellerBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(initialSellerQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);

      // --- Step 1: Seller places limit sell order directly on CLOB ---
      const sellPrice = ORDER_PRICE;
      const sellQuantity = ORDER_QUANTITY;
      const sellTx = await clob.connect(seller).placeLimitOrder(
          baseTokenAddress, quoteTokenAddress, false, sellPrice, sellQuantity
      );
      const sellReceipt = await sellTx.wait();
      const sellerOrderId = await extractOrderId(sellReceipt, sellerAddress);
      expect(sellerOrderId).to.not.be.null;
      console.log(`Seller placed direct limit order (SELL ${ethers.formatUnits(sellQuantity, BASE_TOKEN_DECIMALS)} BASE @ ${ethers.formatUnits(sellPrice, QUOTE_TOKEN_DECIMALS)} QUOTE). Order ID: ${sellerOrderId}`);

      // Verify seller order is OPEN
      const sellerOrder = await state.getOrder(sellerOrderId!);
      expect(sellerOrder.status).to.equal(0); // 0 = OPEN

      // --- Step 2: Buyer initiates swap via MockSymphony ---
      // Buyer wants to buy 10 BASE using QUOTE (tokenIn = QUOTE, tokenOut = BASE)
      const amountInQuote = (ORDER_QUANTITY * ORDER_PRICE) / (10n ** BigInt(BASE_TOKEN_DECIMALS)); // Amount of QUOTE needed for the base quantity
      const minAmountOutBase = ORDER_QUANTITY * 99n / 100n; // Allow 1% slippage for base output (though market order should fill fully)

      console.log(`Buyer executing swap via MockSymphony: Input ${ethers.formatUnits(amountInQuote, QUOTE_TOKEN_DECIMALS)} QUOTE for BASE`);

      const swapTx = await mockSymphony.connect(buyer).executeSwap(
          quoteTokenAddress, // tokenIn
          baseTokenAddress,  // tokenOut
          amountInQuote,     // amountIn (quote)
          minAmountOutBase
      );
      const swapReceipt = await swapTx.wait();

      // --- Step 3: Verify Events and Final State --- 
      // 3a. Check SwapExecuted event from MockSymphony
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
                          eventAmountOutNet = parsedLog.args.amountOutNet; // Net BASE sent to buyer
                          eventSymphonyFee = parsedLog.args.symphonyFee; // Symphony fee in BASE
                          expect(parsedLog.args.user).to.equal(buyerAddress);
                          expect(parsedLog.args.tokenIn).to.equal(quoteTokenAddress);
                          expect(parsedLog.args.tokenOut).to.equal(baseTokenAddress);
                          expect(parsedLog.args.amountIn).to.equal(amountInQuote);
                          console.log(`SwapExecuted Event: Net Out ${ethers.formatUnits(eventAmountOutNet, BASE_TOKEN_DECIMALS)} BASE, Fee ${ethers.formatUnits(eventSymphonyFee, BASE_TOKEN_DECIMALS)} BASE`);
                          break;
                      }
                  }
              } catch(e) {/* ignore */} 
          }
      }
      expect(swapEventFound, "SwapExecuted event not found").to.be.true;

      // 3b. Calculate expected fees
      const grossBaseAmount = ORDER_QUANTITY; // Amount received by adapter from CLOB
      const expectedSymphonyFeeBase = (grossBaseAmount * BigInt(SYMPHONY_FEE_RATE_BPS)) / FEE_DENOMINATOR;
      const expectedNetBaseToBuyer = grossBaseAmount - expectedSymphonyFeeBase;

      const quoteAmountForFees = (ORDER_QUANTITY * ORDER_PRICE) / (10n ** BigInt(BASE_TOKEN_DECIMALS));
      const expectedClobMakerFeeQuote = (quoteAmountForFees * BigInt(CLOB_MAKER_FEE_RATE)) / 10000n;
      const expectedClobTakerFeeQuote = (quoteAmountForFees * BigInt(CLOB_TAKER_FEE_RATE)) / 10000n;
      const expectedSellerQuoteReceived = quoteAmountForFees - expectedClobMakerFeeQuote;

      expect(eventSymphonyFee).to.equal(expectedSymphonyFeeBase, "Symphony fee mismatch in event");
      expect(eventAmountOutNet).to.equal(expectedNetBaseToBuyer, "Net amount out mismatch in event");

      // 3c. Check final balances
      const finalBuyerBase = await baseToken.balanceOf(buyerAddress);
      const finalBuyerQuote = await quoteToken.balanceOf(buyerAddress);
      const finalSellerBase = await baseToken.balanceOf(sellerAddress);
      const finalSellerQuote = await quoteToken.balanceOf(sellerAddress);
      const finalSymphonyFeeRecipientBase = await baseToken.balanceOf(symphonyFeeRecipientAddress); // Symphony fee is in BASE
      const finalClobFeeRecipientQuote = await quoteToken.balanceOf(feeRecipientAddress);
      const finalMockSymphonyBase = await baseToken.balanceOf(mockSymphonyAddress); // Should be 0
      const finalMockSymphonyQuote = await quoteToken.balanceOf(mockSymphonyAddress); // Should be 0

      console.log(`Final Buyer: ${ethers.formatUnits(finalBuyerBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(finalBuyerQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`Final Seller: ${ethers.formatUnits(finalSellerBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(finalSellerQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`Final Symphony Fee Recipient: ${ethers.formatUnits(finalSymphonyFeeRecipientBase, BASE_TOKEN_DECIMALS)} BASE`);
      console.log(`Final CLOB Fee Recipient: ${ethers.formatUnits(finalClobFeeRecipientQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);
      console.log(`Final MockSymphony: ${ethers.formatUnits(finalMockSymphonyBase, BASE_TOKEN_DECIMALS)} BASE, ${ethers.formatUnits(finalMockSymphonyQuote, QUOTE_TOKEN_DECIMALS)} QUOTE`);

      // Buyer checks
      expect(finalBuyerBase).to.equal(initialBuyerBase + expectedNetBaseToBuyer, "Buyer final BASE balance mismatch");
      expect(finalBuyerQuote).to.equal(initialBuyerQuote - amountInQuote - expectedClobTakerFeeQuote, "Buyer final QUOTE balance mismatch");

      // Seller checks
      expect(finalSellerBase).to.equal(initialSellerBase - ORDER_QUANTITY, "Seller final BASE balance mismatch");
      expect(finalSellerQuote).to.equal(initialSellerQuote + expectedSellerQuoteReceived, "Seller final QUOTE balance mismatch");

      // Fee recipient checks
      expect(finalSymphonyFeeRecipientBase).to.equal(expectedSymphonyFeeBase, "Symphony fee recipient BASE balance mismatch");
      expect(finalClobFeeRecipientQuote).to.equal(expectedClobMakerFeeQuote + expectedClobTakerFeeQuote, "CLOB fee recipient QUOTE balance mismatch");

      // MockSymphony should have zero balance of these tokens
      expect(finalMockSymphonyBase).to.equal(0, "MockSymphony should have 0 BASE");
      expect(finalMockSymphonyQuote).to.equal(0, "MockSymphony should have 0 QUOTE");

      // 3d. Check seller order status
      const finalSellerOrder = await state.getOrder(sellerOrderId!);
      expect(finalSellerOrder.status).to.equal(2); // 2 = FILLED
    });

    // Add more tests for edge cases, different order types, partial fills etc.
  });

  /* // Commented out: Old test for executeSwapViaAdapter (now integrated into executeSwap)
  describe("Symphony Synchronous Swap Flow (executeSwapViaCLOB)", function() {
    // ... old tests ...
  });
  */
});

      // Add more tests here as implementation progresses...
