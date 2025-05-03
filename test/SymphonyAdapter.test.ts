import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("SymphonyAdapter Contract Tests", function () {
  let clob: Contract;
  let book: Contract;
  let state: Contract;
  let vault: Contract;
  let symphonyAdapter: Contract;
  let baseToken: Contract;
  let quoteToken: Contract;
  let owner: Signer;
  let trader1: Signer;
  let trader2: Signer;
  let symphonyOperator: Signer;
  let feeRecipient: Signer;
  let ownerAddress: string;
  let trader1Address: string;
  let trader2Address: string;
  let symphonyOperatorAddress: string;
  let feeRecipientAddress: string;

  const BASE_TOKEN_DECIMALS = 18;
  const QUOTE_TOKEN_DECIMALS = 6;
  const INITIAL_MINT_AMOUNT = ethers.parseEther("1000000");
  const MAKER_FEE_RATE = 50; // 0.5%
  const TAKER_FEE_RATE = 100; // 1.0%

  beforeEach(async function () {
    // Get signers
    [owner, trader1, trader2, symphonyOperator, feeRecipient] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    trader1Address = await trader1.getAddress();
    trader2Address = await trader2.getAddress();
    symphonyOperatorAddress = await symphonyOperator.getAddress();
    feeRecipientAddress = await feeRecipient.getAddress();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken", owner);
    baseToken = await MockToken.deploy("Base Token", "BASE", BASE_TOKEN_DECIMALS);
    quoteToken = await MockToken.deploy("Quote Token", "QUOTE", QUOTE_TOKEN_DECIMALS);

    // Mint tokens to traders
    await baseToken.mint(trader1Address, INITIAL_MINT_AMOUNT);
    await baseToken.mint(trader2Address, INITIAL_MINT_AMOUNT);
    await quoteToken.mint(trader1Address, INITIAL_MINT_AMOUNT);
    await quoteToken.mint(trader2Address, INITIAL_MINT_AMOUNT);

    // Deploy state contract with owner as admin
    const State = await ethers.getContractFactory("State", owner);
    state = await State.deploy(ownerAddress);

    // Deploy book contract
    const Book = await ethers.getContractFactory("Book", owner);
    book = await Book.deploy(
      ownerAddress, 
      await state.getAddress(), 
      await baseToken.getAddress(), 
      await quoteToken.getAddress()
    );

    // Add book as admin in state
    await state.connect(owner).addAdmin(await book.getAddress());

    // Deploy vault contract with fee rates
    const Vault = await ethers.getContractFactory("Vault", owner);
    vault = await Vault.deploy(
      ownerAddress, 
      await state.getAddress(), 
      feeRecipientAddress,
      MAKER_FEE_RATE,
      TAKER_FEE_RATE
    );

    // Set book address in vault
    await vault.connect(owner).setBook(await book.getAddress());
    
    // Set vault address in book
    await book.connect(owner).setVault(await vault.getAddress());

    // Deploy CLOB contract with correct constructor argument order
    const CLOB = await ethers.getContractFactory("CLOB", owner);
    clob = await CLOB.deploy(
      ownerAddress,
      await state.getAddress(),
      await book.getAddress(),
      await vault.getAddress()
    );

    // Add CLOB as admin in state
    await state.connect(owner).addAdmin(await clob.getAddress());
    
    // Set CLOB in vault
    await vault.connect(owner).setCLOB(await clob.getAddress());

    // Deploy SymphonyAdapter with correct constructor arguments
    const SymphonyAdapter = await ethers.getContractFactory("SymphonyAdapter", owner);
    symphonyAdapter = await SymphonyAdapter.deploy(
      ownerAddress,
      await clob.getAddress()
    );

    // Add SymphonyAdapter as admin in state
    await state.connect(owner).addAdmin(await symphonyAdapter.getAddress());

    // Set SymphonyAdapter in CLOB
    await clob.connect(owner).setSymphonyAdapter(await symphonyAdapter.getAddress());
    await clob.connect(owner).setSymphonyIntegrationEnabled(true);
    
    // Set CLOB in book
    await book.connect(owner).setCLOB(await clob.getAddress());

    // Set Symphony operator in SymphonyAdapter
    await symphonyAdapter.connect(owner).setSymphonyOperator(symphonyOperatorAddress);

    // Add supported trading pair
    await clob.connect(owner).addSupportedPair(await baseToken.getAddress(), await quoteToken.getAddress());

    // Approve tokens for trading
    await baseToken.connect(trader1).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
    await quoteToken.connect(trader1).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
    await baseToken.connect(trader2).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
    await quoteToken.connect(trader2).approve(await vault.getAddress(), INITIAL_MINT_AMOUNT);
    
    // Approve tokens for SymphonyAdapter
    await baseToken.connect(trader1).approve(await symphonyAdapter.getAddress(), INITIAL_MINT_AMOUNT);
    await quoteToken.connect(trader1).approve(await symphonyAdapter.getAddress(), INITIAL_MINT_AMOUNT);
    await baseToken.connect(trader2).approve(await symphonyAdapter.getAddress(), INITIAL_MINT_AMOUNT);
    await quoteToken.connect(trader2).approve(await symphonyAdapter.getAddress(), INITIAL_MINT_AMOUNT);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await symphonyAdapter.admin()).to.equal(ownerAddress);
    });

    it("Should set the right CLOB address", async function () {
      expect(await symphonyAdapter.clob()).to.equal(await clob.getAddress());
    });
  });

  describe("Configuration", function () {
    it("Should set the Symphony operator", async function () {
      expect(await symphonyAdapter.symphonyOperator()).to.equal(symphonyOperatorAddress);
    });

    it("Should not allow non-admin to set Symphony operator", async function () {
      await expect(symphonyAdapter.connect(trader1).setSymphonyOperator(symphonyOperatorAddress))
        .to.be.revertedWith("SymphonyAdapter: caller is not admin");
    });
  });

  // Describe block for Order Relay tests related to the *old* async flow
  describe("Order Relay (Obsolete Async Flow)", function() {
    /* // Test removed as it relates to the obsolete relaySymphonyOrder async flow
    it("Should relay a Symphony order", async function() {
      // ... test logic ...
    });
    */

    /* // Test removed as it relates to the obsolete relaySymphonyOrder async flow
    it("Should not allow non-Symphony operator to relay orders", async function () {
      // ... test logic ...
    });
    */

    /* // Test removed as it relates to the obsolete getSymphonyNonce async flow helper
    it("Should track Symphony nonces", async function () {
     // ... test logic ...
    });
    */
  });

  // TODO: Add tests for the new synchronous executeSwapViaCLOB flow if needed
  // (e.g., testing permissions, specific revert conditions, edge cases)
  // Note: The main end-to-end flow is tested in SymphonyIntegration.test.ts

});
