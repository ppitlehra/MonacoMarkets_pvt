import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Book, CLOB, State, Vault, MockToken } from "../typechain-types";

describe("Market Buy Order Tests", function () {
  // Constants for testing
  const ORDER_PRICE = ethers.parseUnits("100", 18);
  const ORDER_QUANTITY = ethers.parseUnits("1", 18);
  const INITIAL_BALANCE = ethers.parseUnits("1000", 18);
  const MAX_APPROVAL = ethers.parseUnits("100000000000000", 18); // Extremely large approval amount
  const MAKER_FEE_RATE = 50; // 0.5%
  const TAKER_FEE_RATE = 100; // 1.0%
  
  // Order types
  const LIMIT_ORDER = 0;
  const MARKET_ORDER = 1;
  
  // Order statuses
  const ORDER_STATUS_OPEN = 0;
  const ORDER_STATUS_PARTIALLY_FILLED = 1;
  const ORDER_STATUS_FILLED = 2;
  const ORDER_STATUS_CANCELED = 3;
  
  // Contracts
  let clob: CLOB;
  let book: Book;
  let state: State;
  let vault: Vault;
  let baseToken: MockToken;
  let quoteToken: MockToken;
  
  // Signers
  let owner: Signer;
  let trader1: Signer;
  let trader2: Signer;
  let feeRecipient: Signer;
  
  beforeEach(async function () {
    // Get signers
    [owner, trader1, trader2, feeRecipient] = await ethers.getSigners();
    
    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    baseToken = (await MockToken.deploy("Base Token", "BASE", 18)) as unknown as MockToken;
    quoteToken = (await MockToken.deploy("Quote Token", "QUOTE", 18)) as unknown as MockToken;
    
    // Deploy state contract
    const State = await ethers.getContractFactory("State");
    state = (await State.deploy(await owner.getAddress())) as unknown as State;
    
    // Deploy book contract
    const Book = await ethers.getContractFactory("Book");
    book = (await Book.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    )) as unknown as Book;
    
    // Deploy vault contract with fee rates
    const Vault = await ethers.getContractFactory("Vault");
    vault = (await Vault.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await feeRecipient.getAddress(),
      MAKER_FEE_RATE,
      TAKER_FEE_RATE
    )) as unknown as Vault;
    
    // Deploy CLOB contract with correct constructor argument order
    const CLOB = await ethers.getContractFactory("CLOB");
    clob = (await CLOB.deploy(
      await owner.getAddress(),
      await state.getAddress(),
      await book.getAddress(),
      await vault.getAddress()
    )) as unknown as CLOB;
    
    // Set up permissions
    await state.connect(owner).addAdmin(await clob.getAddress());
    await state.connect(owner).addAdmin(await book.getAddress());
    
    await book.connect(owner).setCLOB(await clob.getAddress());
    await book.connect(owner).setVault(await vault.getAddress());
    
    await vault.connect(owner).setCLOB(await clob.getAddress());
    await vault.connect(owner).setBook(await clob.getAddress());
    
    // Add supported trading pair
    await clob.connect(owner).addSupportedPair(
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    );
    
    // Mint tokens to traders
    await baseToken.mint(await trader1.getAddress(), MAX_APPROVAL);
    await baseToken.mint(await trader2.getAddress(), MAX_APPROVAL);
    await quoteToken.mint(await trader1.getAddress(), MAX_APPROVAL);
    await quoteToken.mint(await trader2.getAddress(), MAX_APPROVAL);
    
    // Approve tokens for vault
    await baseToken.connect(trader1).approve(await vault.getAddress(), MAX_APPROVAL);
    await baseToken.connect(trader2).approve(await vault.getAddress(), MAX_APPROVAL);
    await quoteToken.connect(trader1).approve(await vault.getAddress(), MAX_APPROVAL);
    await quoteToken.connect(trader2).approve(await vault.getAddress(), MAX_APPROVAL);
  });
  
  it("should allow a trader to create a market buy order", async function () {
    // Place a limit sell order first to provide liquidity
    await clob.connect(trader1).placeLimitOrder(
      await baseToken.getAddress(),
      await quoteToken.getAddress(),
      false, // isBuy
      ORDER_PRICE,
      ORDER_QUANTITY
    );
    
    // Get initial balances before market order
    const initialBuyer2BaseBalance = await baseToken.balanceOf(await trader2.getAddress());
    const initialBuyer2QuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
    
    // Place a market buy order
    const marketBuyTx = await clob.connect(trader2).placeMarketOrder(
      await baseToken.getAddress(),
      await quoteToken.getAddress(),
      true, // isBuy
      ORDER_QUANTITY
    );
    
    // Wait for transaction to be mined
    await marketBuyTx.wait();
    
    // Get final balances after market order
    const finalBuyer2BaseBalance = await baseToken.balanceOf(await trader2.getAddress());
    const finalBuyer2QuoteBalance = await quoteToken.balanceOf(await trader2.getAddress());
    
    // Verify order statuses
    const sellOrderId = 1n;
    const buyOrderId = 2n;
    
    // Get the orders
    const sellOrder = await state.getOrder(sellOrderId);
    const buyOrder = await state.getOrder(buyOrderId);
    
    console.log(`Market Buy Order Test - Buy Order ID: ${buyOrderId}`);
    console.log(`Market Buy Order Test - Buy Order Status: ${buyOrder.status}`);
    console.log(`Market Buy Order Test - Buy Order Filled Quantity: ${buyOrder.filledQuantity}`);
    console.log(`Market Buy Order Test - Buy Order Total Quantity: ${buyOrder.quantity}`);
    console.log(`Market Buy Order Test - Sell Order Status: ${sellOrder.status}`);
    
    // Check order statuses
    expect(sellOrder.status).to.equal(ORDER_STATUS_FILLED);
    expect(buyOrder.status).to.equal(ORDER_STATUS_FILLED);
    
    // Verify filled quantities
    expect(sellOrder.filledQuantity).to.equal(ORDER_QUANTITY);
    expect(buyOrder.filledQuantity).to.equal(ORDER_QUANTITY);
    
    // Verify token transfers
    // Buyer should receive base tokens and spend quote tokens
    const baseTokenDiff = finalBuyer2BaseBalance - initialBuyer2BaseBalance;
    console.log(`Market Buy Order Test - Base Token Difference: ${baseTokenDiff}`);
    expect(baseTokenDiff).to.equal(ORDER_QUANTITY);
    
    const quoteTokenDiff = initialBuyer2QuoteBalance - finalBuyer2QuoteBalance;
    console.log(`Market Buy Order Test - Quote Token Difference: ${quoteTokenDiff}`);
    expect(quoteTokenDiff).to.be.gt(0n);
  });
});
