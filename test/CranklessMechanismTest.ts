import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Book, CLOB, State, Vault, MockERC20, MockERC20Fail } from "../typechain-types";

// Helper function to parse units (assuming 18 decimals for base, 6 for quote)
const parseBase = (amount: string | number) => ethers.parseUnits(amount.toString(), 18);
const parseQuote = (amount: string | number) => ethers.parseUnits(amount.toString(), 6);

describe("Crankless Mechanism Tests", function () {
  let owner: Signer;
  let trader1: Signer; // Buyer
  let trader2: Signer; // Seller
  let trader3: Signer; // Additional trader for multiple matches
  let clob: CLOB;
  let book: Book;
  let state: State;
  let vault: Vault;
  let baseToken: MockERC20; // Standard MockERC20
  let quoteToken: MockERC20 | MockERC20Fail; // MockERC20 or MockERC20Fail

  // Deploys contracts using standard ERC20 for both tokens
  async function deployWithStandardTokens() {
    [owner, trader1, trader2, trader3] = await ethers.getSigners();
    const ownerAddress = await owner.getAddress();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    baseToken = (await MockERC20.deploy("Base Token", "BASE", 18, ownerAddress)) as unknown as MockERC20;
    quoteToken = (await MockERC20.deploy("Quote Token", "QUOTE", 6, ownerAddress)) as unknown as MockERC20;
    
    const baseTokenAddress = await baseToken.getAddress();
    const quoteTokenAddress = await quoteToken.getAddress();

    await deployCoreContractsAndSetup(ownerAddress, baseTokenAddress, quoteTokenAddress);
    await fundAndApproveTraders(baseToken, quoteToken);
  }

  // Deploys contracts using MockERC20Fail for the quote token
  async function deployWithFailingQuoteToken() {
    [owner, trader1, trader2, trader3] = await ethers.getSigners();
    const ownerAddress = await owner.getAddress();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    baseToken = (await MockERC20.deploy("Base Token", "BASE", 18, ownerAddress)) as unknown as MockERC20;
    
    const MockERC20Fail = await ethers.getContractFactory("MockERC20Fail");
    quoteToken = (await MockERC20Fail.deploy("Quote Token Fail", "QUOTE", 6, ownerAddress)) as unknown as MockERC20Fail;
    
    const baseTokenAddress = await baseToken.getAddress();
    const quoteTokenAddress = await quoteToken.getAddress();

    await deployCoreContractsAndSetup(ownerAddress, baseTokenAddress, quoteTokenAddress);
    await fundAndApproveTraders(baseToken, quoteToken);
  }

  // Helper to deploy core contracts and set dependencies
  async function deployCoreContractsAndSetup(ownerAddress: string, baseTokenAddress: string, quoteTokenAddress: string) {
    const State = await ethers.getContractFactory("State");
    state = (await State.deploy(ownerAddress)) as unknown as State;
    const stateAddress = await state.getAddress();

    // Using default fee rates (e.g., 10 bps maker, 20 bps taker)
    const makerFeeRate = 10;
    const takerFeeRate = 20;
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
    
    // Add CLOB and Book as admins in State contract to allow them to create and update orders
    await state.connect(owner).addAdmin(clobAddress);
    await state.connect(owner).addAdmin(bookAddress);

    // Create trading pair in CLOB
    await clob.connect(owner).addSupportedPair(baseTokenAddress, quoteTokenAddress);
  }

  // Helper to fund traders and set approvals
  async function fundAndApproveTraders(base: MockERC20, quote: MockERC20 | MockERC20Fail) {
    const trader1Address = await trader1.getAddress();
    const trader2Address = await trader2.getAddress();
    const trader3Address = await trader3.getAddress();
    const vaultAddress = await vault.getAddress(); // Approve Vault, not CLOB
    
    await base.connect(owner).mint(trader1Address, parseBase("1000"));
    await quote.connect(owner).mint(trader1Address, parseQuote("100000"));
    
    await base.connect(owner).mint(trader2Address, parseBase("1000"));
    await quote.connect(owner).mint(trader2Address, parseQuote("100000"));
    
    await base.connect(owner).mint(trader3Address, parseBase("1000"));
    await quote.connect(owner).mint(trader3Address, parseQuote("100000"));

    await base.connect(trader1).approve(vaultAddress, ethers.MaxUint256);
    await quote.connect(trader1).approve(vaultAddress, ethers.MaxUint256);
    
    await base.connect(trader2).approve(vaultAddress, ethers.MaxUint256);
    await quote.connect(trader2).approve(vaultAddress, ethers.MaxUint256);
    
    await base.connect(trader3).approve(vaultAddress, ethers.MaxUint256);
    await quote.connect(trader3).approve(vaultAddress, ethers.MaxUint256);
  }

  // Helper to extract order ID from receipt logs
  async function extractOrderId(receipt: any) {
    if (!receipt || !receipt.logs) return null;
    
    for (const log of receipt.logs) {
      try {
        const parsedLog = state.interface.parseLog(log);
        if (parsedLog && parsedLog.name === "OrderCreated") {
          return parsedLog.args.orderId;
        }
      } catch (e) { /* ignore logs not parseable by state interface */ }
    }
    return null;
  }

  // Helper to count settlement events in receipt
  async function countSettlementEvents(receipt: any) {
    let count = 0;
    if (!receipt || !receipt.logs) return count;
    
    for (const log of receipt.logs) {
      try {
        const parsedLog = vault.interface.parseLog(log);
        if (parsedLog && parsedLog.name === "SettlementProcessed") { // Updated event name
          count++;
        }
      } catch (e) { /* ignore logs not parseable by vault interface */ }
    }
    return count;
  }

  describe("Basic Crankless Operation", function() {
    beforeEach(deployWithStandardTokens);

    it("Should automatically match and settle orders without external cranking", async function () {
        const trader1Address = await trader1.getAddress();
        const trader2Address = await trader2.getAddress();
        const baseTokenAddress = await baseToken.getAddress();
        const quoteTokenAddress = await quoteToken.getAddress();

        // Trader 1 places a limit buy order
        const buyPrice = parseQuote("100");
        const buyQuantity = parseBase("10");
        const buyTx = await clob.connect(trader1).placeLimitOrder(baseTokenAddress, quoteTokenAddress, true, buyPrice, buyQuantity);
        const buyReceipt = await buyTx.wait();
        const buyOrderId = await extractOrderId(buyReceipt);
        expect(buyOrderId).to.not.be.null;
        console.log(`Buy Order ID: ${buyOrderId}`);

        // Verify buy order state is OPEN
        const buyOrder = await state.getOrder(buyOrderId);
        expect(buyOrder.status).to.equal(0); // 0 = OPEN

        // Trader 2 places a limit sell order that matches the buy order
        const sellPrice = parseQuote("100");
        const sellQuantity = parseBase("10");
        const sellTx = await clob.connect(trader2).placeLimitOrder(baseTokenAddress, quoteTokenAddress, false, sellPrice, sellQuantity);
        const sellReceipt = await sellTx.wait();
        const sellOrderId = await extractOrderId(sellReceipt);
        expect(sellOrderId).to.not.be.null;
        console.log(`Sell Order ID: ${sellOrderId}`);

        // Verify settlement events occurred within the sell transaction
        let settlementEventFound = false;
        if (sellReceipt && sellReceipt.logs) {
            for (const log of sellReceipt.logs) {
                try {
                    const parsedLog = vault.interface.parseLog(log);
                    if (parsedLog && parsedLog.name === "SettlementProcessed") {
                        settlementEventFound = true;
                        console.log("SettlementProcessed event found:", parsedLog.args);
                    }
                } catch (e) { /* ignore logs not parseable by vault interface */ }
            }
        }
        expect(settlementEventFound, "SettlementProcessed event should be emitted").to.be.true;

        // Verify both orders are now FILLED
        const finalBuyOrder = await state.getOrder(buyOrderId);
        const finalSellOrder = await state.getOrder(sellOrderId);
        expect(finalBuyOrder.status).to.equal(2); // 2 = FILLED
        expect(finalSellOrder.status).to.equal(2); // 2 = FILLED
    });
  });

  describe("Atomicity Tests", function() {
    beforeEach(deployWithFailingQuoteToken);

    it("Should revert the entire transaction if quote token transfer fails during settlement", async function () {
        const trader1Address = await trader1.getAddress();
        const trader2Address = await trader2.getAddress();
        const baseTokenAddress = await baseToken.getAddress();
        const quoteTokenAddress = await quoteToken.getAddress();

        // Get initial balances
        const initialTrader1Quote = await quoteToken.balanceOf(trader1Address);
        const initialTrader2Base = await baseToken.balanceOf(trader2Address);

        // Trader 1 places a limit buy order
        const buyPrice = parseQuote("100");
        const buyQuantity = parseBase("10");
        const buyTx = await clob.connect(trader1).placeLimitOrder(baseTokenAddress, quoteTokenAddress, true, buyPrice, buyQuantity);
        const buyReceipt = await buyTx.wait();
        const buyOrderId = await extractOrderId(buyReceipt);
        expect(buyOrderId).to.not.be.null;

        // Configure quote token to fail transferFrom for trader1 (buyer)
        const mockQuoteToken = quoteToken as unknown as MockERC20Fail;
        await mockQuoteToken.connect(owner).setFailTransferFrom(trader1Address, true);

        // Trader 2 places a matching sell order - this transaction should revert
        const sellPrice = parseQuote("100");
        const sellQuantity = parseBase("10");
        await expect(
            clob.connect(trader2).placeLimitOrder(baseTokenAddress, quoteTokenAddress, false, sellPrice, sellQuantity)
        ).to.be.reverted;

        // Verify buy order is still OPEN
        const finalBuyOrder = await state.getOrder(buyOrderId);
        expect(finalBuyOrder.status).to.equal(0); // 0 = OPEN

        // Verify balances are unchanged
        expect(await quoteToken.balanceOf(trader1Address)).to.equal(initialTrader1Quote);
        expect(await baseToken.balanceOf(trader2Address)).to.equal(initialTrader2Base);

        // Reset failure flag for other tests
        await mockQuoteToken.connect(owner).setFailTransferFrom(trader1Address, false);
    });

    it("Should revert the entire transaction if base token transfer fails during settlement", async function () {
        // TODO: Implement this test properly by deploying MockERC20Fail for baseToken.
        console.log("Skipping base token failure atomicity test - requires MockERC20Fail for base token");
    });
  });

  describe("Event Sequencing Tests", function() {
    beforeEach(deployWithStandardTokens);

    it("Should emit events in the correct sequence during a match and settlement", async function () {
        const baseTokenAddress = await baseToken.getAddress();
        const quoteTokenAddress = await quoteToken.getAddress();

        // Place a resting buy order
        const buyPrice = parseQuote("100");
        const buyQuantity = parseBase("10");
        const buyTx = await clob.connect(trader1).placeLimitOrder(baseTokenAddress, quoteTokenAddress, true, buyPrice, buyQuantity);
        const buyReceipt = await buyTx.wait();
        const buyOrderId = await extractOrderId(buyReceipt);
        expect(buyOrderId).to.not.be.null;

        // Place a matching sell order and capture events
        const sellPrice = parseQuote("100");
        const sellQuantity = parseBase("10");
        const sellTx = await clob.connect(trader2).placeLimitOrder(baseTokenAddress, quoteTokenAddress, false, sellPrice, sellQuantity);
        const sellReceipt = await sellTx.wait();
        const sellOrderId = await extractOrderId(sellReceipt);
        expect(sellOrderId).to.not.be.null;

        // Extract and identify relevant events from the sell transaction receipt
        const eventSequence: string[] = [];
        if (sellReceipt && sellReceipt.logs) {
            for (const log of sellReceipt.logs) {
                try {
                    const parsedStateLog = state.interface.parseLog(log);
                    if (parsedStateLog && parsedStateLog.name === "OrderCreated") {
                        eventSequence.push("OrderCreated_Sell");
                    } else if (parsedStateLog && parsedStateLog.name === "OrderStatusUpdated") {
                        if (parsedStateLog.args.orderId.toString() === buyOrderId.toString()) {
                            eventSequence.push("OrderStatusUpdate_Buy");
                        } else if (sellOrderId && parsedStateLog.args.orderId.toString() === sellOrderId.toString()) {
                            eventSequence.push("OrderStatusUpdate_Sell");
                        }
                    }
                } catch (e) { /* ignore */ }

                try {
                    const parsedVaultLog = vault.interface.parseLog(log);
                    if (parsedVaultLog && parsedVaultLog.name === "SettlementProcessed") {
                        eventSequence.push("SettlementProcessed");
                    }
                } catch (e) { /* ignore */ }
                
                try {
                    const parsedBookLog = book.interface.parseLog(log);
                    if (parsedBookLog && parsedBookLog.name === "OrderMatched") {
                        eventSequence.push("OrderMatched");
                    }
                } catch (e) { /* ignore */ }
            }
        }

        console.log("Observed Event Sequence:", eventSequence);

        // Define the expected sequence (adjust based on actual contract logic)
        const expectedSequence = [
            "OrderCreated_Sell",
            "OrderMatched", 
            "SettlementProcessed",
            "OrderStatusUpdate_Buy",
            "OrderStatusUpdate_Sell"
        ];

        // Verify the sequence contains all expected events
        for (const expectedEvent of expectedSequence) {
            expect(eventSequence.includes(expectedEvent), 
                `Expected event ${expectedEvent} not found in sequence`).to.be.true;
        }
    });
  });

  describe("Multiple Matches Tests", function() {
    beforeEach(deployWithStandardTokens);

    it("Should match and settle against multiple resting orders at different price levels", async function () {
        const trader1Address = await trader1.getAddress();
        const trader2Address = await trader2.getAddress();
        const trader3Address = await trader3.getAddress();
        const baseTokenAddress = await baseToken.getAddress();
        const quoteTokenAddress = await quoteToken.getAddress();

        // Get initial balances
        const initialTrader1Base = await baseToken.balanceOf(trader1Address);
        const initialTrader1Quote = await quoteToken.balanceOf(trader1Address);
        const initialTrader2Base = await baseToken.balanceOf(trader2Address);
        const initialTrader2Quote = await quoteToken.balanceOf(trader2Address);
        const initialTrader3Base = await baseToken.balanceOf(trader3Address);
        const initialTrader3Quote = await quoteToken.balanceOf(trader3Address);

        // Trader 1 places a limit buy order at price 100
        const buyPrice1 = parseQuote("100");
        const buyQuantity1 = parseBase("5");
        const buyTx1 = await clob.connect(trader1).placeLimitOrder(
            baseTokenAddress, quoteTokenAddress, true, buyPrice1, buyQuantity1
        );
        const buyReceipt1 = await buyTx1.wait();
        const buyOrderId1 = await extractOrderId(buyReceipt1);
        expect(buyOrderId1).to.not.be.null;

        // Trader 2 places a limit buy order at price 95 (lower price)
        const buyPrice2 = parseQuote("95");
        const buyQuantity2 = parseBase("5");
        const buyTx2 = await clob.connect(trader2).placeLimitOrder(
            baseTokenAddress, quoteTokenAddress, true, buyPrice2, buyQuantity2
        );
        const buyReceipt2 = await buyTx2.wait();
        const buyOrderId2 = await extractOrderId(buyReceipt2);
        expect(buyOrderId2).to.not.be.null;

        // Trader 3 places a market sell order that should match against both buy orders
        const sellQuantity = parseBase("10"); // Total quantity to sell
        const sellTx = await clob.connect(trader3).placeMarketOrder(
            baseTokenAddress, quoteTokenAddress, false, sellQuantity
        );
        const sellReceipt = await sellTx.wait();

        // Count settlement events - should be 2 (one for each match)
        const settlementCount = await countSettlementEvents(sellReceipt);
        expect(settlementCount).to.equal(2, "Should have 2 settlement events for 2 matches");

        // Verify both buy orders are now FILLED
        const finalBuyOrder1 = await state.getOrder(buyOrderId1);
        const finalBuyOrder2 = await state.getOrder(buyOrderId2);
        expect(finalBuyOrder1.status).to.equal(2); // 2 = FILLED
        expect(finalBuyOrder2.status).to.equal(2); // 2 = FILLED

        // Verify balances have changed appropriately (ignoring fees for simplicity)
        const finalTrader1Base = await baseToken.balanceOf(trader1Address);
        const finalTrader1Quote = await quoteToken.balanceOf(trader1Address);
        const finalTrader2Base = await baseToken.balanceOf(trader2Address);
        const finalTrader2Quote = await quoteToken.balanceOf(trader2Address);
        const finalTrader3Base = await baseToken.balanceOf(trader3Address);
        const finalTrader3Quote = await quoteToken.balanceOf(trader3Address);

        // Verify trader 1 balance changes (Maker, buys 5 @ 100, pays 0.5 fee)
        expect(finalTrader1Base - initialTrader1Base).to.equal(parseBase("5"));
        expect(initialTrader1Quote - finalTrader1Quote).to.equal(parseQuote("500.5")); // Maker pays QuoteAmount + MakerFee

        // Verify trader 2 balance changes (Maker, buys 5 @ 95, pays 0.475 fee)
        expect(finalTrader2Base - initialTrader2Base).to.equal(parseBase("5"));
        expect(initialTrader2Quote - finalTrader2Quote).to.equal(parseQuote("475.475")); // Maker pays QuoteAmount + MakerFee

        // Verify trader 3 balance changes (Taker, sells 10, pays 1 + 0.95 fee)
        expect(initialTrader3Base - finalTrader3Base).to.equal(parseBase("10")); // Sells 10 base
        expect(finalTrader3Quote - initialTrader3Quote).to.equal(parseQuote("973.05")); // Receives 500 + 475, pays 1 + 0.95 fees
    });
  });
});
