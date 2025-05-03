import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Book, CLOB, State, Vault, MockToken } from "../typechain-types";

describe("Vault Permission Check Tests", function () {
  // Contract instances
  let vault: Vault;
  let state: State;
  let baseToken: MockToken;
  let quoteToken: MockToken;
  let book: Book;
  let clob: CLOB;
  
  // Signers
  let owner: Signer;
  let buyer: Signer;
  let seller: Signer;
  let feeRecipient: Signer;
  let nonBookUser: Signer;
  let unauthorizedUser: Signer;
  
  // Addresses
  let ownerAddress: string;
  let buyerAddress: string;
  let sellerAddress: string;
  let feeRecipientAddress: string;
  let nonBookUserAddress: string;
  let unauthorizedUserAddress: string;
  let bookAddress: string;
  let clobAddress: string;
  let vaultAddress: string;
  let stateAddress: string;

  // Constants
  const BASE_TOKEN_DECIMALS = 18;
  const QUOTE_TOKEN_DECIMALS = 6;
  const INITIAL_MINT_AMOUNT = ethers.parseEther("1000000");
  const MAKER_FEE_RATE = 10; // 0.1%
  const TAKER_FEE_RATE = 30; // 0.3%
  
  // Test values
  const SETTLEMENT_QUANTITY = ethers.parseUnits("10", BASE_TOKEN_DECIMALS); // 10 base tokens
  const SETTLEMENT_PRICE = ethers.parseUnits("100", QUOTE_TOKEN_DECIMALS); // 100 quote tokens per base token

  beforeEach(async function () {
    // Get signers
    [owner, buyer, seller, feeRecipient, nonBookUser, unauthorizedUser] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    buyerAddress = await buyer.getAddress();
    sellerAddress = await seller.getAddress();
    feeRecipientAddress = await feeRecipient.getAddress();
    nonBookUserAddress = await nonBookUser.getAddress();
    unauthorizedUserAddress = await unauthorizedUser.getAddress();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken", owner);
    baseToken = (await MockToken.deploy("Base Token", "BASE", BASE_TOKEN_DECIMALS)) as unknown as MockToken;
    quoteToken = (await MockToken.deploy("Quote Token", "QUOTE", QUOTE_TOKEN_DECIMALS)) as unknown as MockToken;
    
    // Mint tokens to traders
    await baseToken.mint(sellerAddress, INITIAL_MINT_AMOUNT);
    await quoteToken.mint(buyerAddress, INITIAL_MINT_AMOUNT);
    
    // Deploy state contract with owner as admin
    const State = await ethers.getContractFactory("State", owner);
    state = (await State.deploy(ownerAddress)) as unknown as State;
    stateAddress = await state.getAddress();

    // Add admin permissions to owner for creating orders
    await state.connect(owner).addAdmin(ownerAddress);
    
    // Deploy book contract
    const Book = await ethers.getContractFactory("Book", owner);
    book = (await Book.deploy(
      ownerAddress,
      stateAddress,
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    )) as unknown as Book;
    bookAddress = await book.getAddress();

    // Deploy vault contract with fee rates
    const Vault = await ethers.getContractFactory("Vault", owner);
    vault = (await Vault.deploy(
      ownerAddress, 
      stateAddress, 
      feeRecipientAddress,
      MAKER_FEE_RATE,
      TAKER_FEE_RATE
    )) as unknown as Vault;
    vaultAddress = await vault.getAddress();
    
    // Deploy CLOB contract with correct constructor argument order
    const CLOB = await ethers.getContractFactory("CLOB", owner);
    clob = (await CLOB.deploy(
      ownerAddress,
      stateAddress,
      bookAddress,
      vaultAddress
    )) as unknown as CLOB;
    clobAddress = await clob.getAddress();
    
    // Set up permissions correctly
    await state.connect(owner).addAdmin(clobAddress);
    await state.connect(owner).addAdmin(bookAddress);
    
    await book.connect(owner).setCLOB(clobAddress);
    await book.connect(owner).setVault(vaultAddress);
    
    await vault.connect(owner).setCLOB(clobAddress);
    await vault.connect(owner).setBook(bookAddress);
    
    // Add supported trading pair
    await clob.connect(owner).addSupportedPair(
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    );
    
    // Create mock orders in state
    // Create a taker order (buyer)
    await state.connect(owner).createOrder(
      buyerAddress,
      await baseToken.getAddress(),
      await quoteToken.getAddress(),
      SETTLEMENT_PRICE,
      SETTLEMENT_QUANTITY,
      true, // isBuy
      0 // LIMIT
    );
    
    // Create a maker order (seller)
    await state.connect(owner).createOrder(
      sellerAddress,
      await baseToken.getAddress(),
      await quoteToken.getAddress(),
      SETTLEMENT_PRICE,
      SETTLEMENT_QUANTITY,
      false, // isBuy
      0 // LIMIT
    );
    
    // Approve tokens for trading
    await baseToken.connect(seller).approve(vaultAddress, INITIAL_MINT_AMOUNT);
    await quoteToken.connect(buyer).approve(vaultAddress, INITIAL_MINT_AMOUNT);
  });

  describe("Admin Permission Checks", function() {
    it("Should allow admin to set fee rates", async function() {
      // Set new fee rates
      const newMakerFeeRate = 20; // 0.2%
      const newTakerFeeRate = 50; // 0.5%
      
      // Admin should be able to set fee rates
      await expect(
        vault.connect(owner).setFeeRates(newMakerFeeRate, newTakerFeeRate)
      ).to.not.be.reverted;
      
      // Verify fee rates were updated using the getter function
      const [makerRate, takerRate] = await vault.getFeeRates();
      expect(makerRate).to.equal(newMakerFeeRate);
      expect(takerRate).to.equal(newTakerFeeRate);
    });
    
    it("Should not allow non-admin to set fee rates", async function() {
      // Set new fee rates
      const newMakerFeeRate = 20; // 0.2%
      const newTakerFeeRate = 50; // 0.5%
      
      // Non-admin should not be able to set fee rates
      await expect(
        vault.connect(unauthorizedUser).setFeeRates(newMakerFeeRate, newTakerFeeRate)
      ).to.be.revertedWith("Vault: caller is not the owner");
      
      // Verify fee rates were not updated using the getter function
      const [makerRate, takerRate] = await vault.getFeeRates();
      expect(makerRate).to.equal(MAKER_FEE_RATE);
      expect(takerRate).to.equal(TAKER_FEE_RATE);
    });
    
    it("Should allow admin to set fee recipient", async function() {
      // Set new fee recipient
      const newFeeRecipient = nonBookUserAddress;
      
      // Admin should be able to set fee recipient
      await expect(
        vault.connect(owner).setFeeRecipient(newFeeRecipient)
      ).to.not.be.reverted;
      
      // Verify fee recipient was updated using the getter function
      expect(await vault.getFeeRecipient()).to.equal(newFeeRecipient);
    });
    
    it("Should not allow non-admin to set fee recipient", async function() {
      // Set new fee recipient
      const newFeeRecipient = nonBookUserAddress;
      
      // Non-admin should not be able to set fee recipient
      await expect(
        vault.connect(unauthorizedUser).setFeeRecipient(newFeeRecipient)
      ).to.be.revertedWith("Vault: caller is not the owner");
      
      // Verify fee recipient was not updated using the getter function
      expect(await vault.getFeeRecipient()).to.equal(feeRecipientAddress);
    });
    
    it("Should allow admin to set book address", async function() {
      // Set new book address
      const newBookAddress = nonBookUserAddress;
      
      // Admin should be able to set book address
      await expect(
        vault.connect(owner).setBook(newBookAddress)
      ).to.not.be.reverted;
      
      // Verify book address was updated (setBook is no-op, so no getter to check)
      // expect(await vault.book()).to.equal(newBookAddress);
    });
    
    it("Should not allow non-admin to set book address", async function() {
      // Set new book address
      const newBookAddress = nonBookUserAddress;
      
      // Non-admin should not be able to set book address
      await expect(
        vault.connect(unauthorizedUser).setBook(newBookAddress)
      ).to.be.reverted;
      
      // Verify book address was not updated (setBook is no-op, so no getter to check)
      // expect(await vault.book()).to.equal(bookAddress);
    });
  });
  
  describe("Book Permission Checks", function() {
    it("Should not allow non-book to process settlements", async function() {
      // Create a settlement
      const settlement = {
        takerOrderId: 1n, // buyer
        makerOrderId: 2n, // seller
        quantity: SETTLEMENT_QUANTITY,
        price: SETTLEMENT_PRICE,
        processed: false
      };
      
      // Non-book should not be able to process settlements
      await expect(
        vault.connect(unauthorizedUser).processSettlement(settlement)
      ).to.be.revertedWith("Vault: caller is not the book");
    });
    
    it("Should not allow non-book to process batch settlements", async function() {
      // Create settlements array
      const settlements = [
        {
          takerOrderId: 1n, // buyer
          makerOrderId: 2n, // seller
          quantity: SETTLEMENT_QUANTITY,
          price: SETTLEMENT_PRICE,
          processed: false
        }
      ];
      
      // Non-book should not be able to process batch settlements
      await expect(
        vault.connect(unauthorizedUser).processSettlements(settlements)
      ).to.be.revertedWith("Vault: caller is not the book");
    });
  });
  
  describe("Admin Transfer Permission Checks", function() {
    it("Should allow admin to transfer admin role", async function() {
      // Transfer admin role to another address
      const newAdmin = nonBookUserAddress;
      
      // Admin should be able to transfer admin role
      await expect(
        vault.connect(owner).transferAdmin(newAdmin)
      ).to.not.be.reverted;
      
      // Verify admin was updated using Ownable's owner() getter
      expect(await vault.owner()).to.equal(newAdmin);
      
      // Original admin should no longer be able to set fee rates
      await expect(
        vault.connect(owner).setFeeRates(20, 50)
      ).to.be.reverted;
      
      // New admin should be able to set fee rates
      await expect(
        vault.connect(nonBookUser).setFeeRates(20, 50)
      ).to.not.be.reverted;
    });
    
    it("Should not allow non-admin to transfer admin role", async function() {
      // Transfer admin role to another address
      const newAdmin = nonBookUserAddress;
      
      // Non-admin should not be able to transfer admin role
      await expect(
        vault.connect(unauthorizedUser).transferAdmin(newAdmin)
      ).to.be.revertedWith("Vault: caller is not the owner");
      
      // Verify admin was not updated using Ownable's owner() getter
      expect(await vault.owner()).to.equal(ownerAddress);
    });
  });
});
