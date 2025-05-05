/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("State Contract Tests", function () {
  let clob: Contract;
  let book: Contract;
  let state: Contract;
  let vault: Contract;
  let baseToken: Contract;
  let quoteToken: Contract;
  let owner: Signer;
  let trader1: Signer;
  let trader2: Signer;
  let feeRecipient: Signer;
  let ownerAddress: string;
  let trader1Address: string;
  let trader2Address: string;
  let feeRecipientAddress: string;

  const BASE_TOKEN_DECIMALS = 18n;
  const QUOTE_TOKEN_DECIMALS = 6n;
  const INITIAL_MINT_AMOUNT = ethers.parseEther("1000000");
  const MAKER_FEE_RATE = 50; // 0.5%
  const TAKER_FEE_RATE = 100; // 1.0%

  beforeEach(async function () {
    // Get signers
    [owner, trader1, trader2, feeRecipient] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    trader1Address = await trader1.getAddress();
    trader2Address = await trader2.getAddress();
    feeRecipientAddress = await feeRecipient.getAddress();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    baseToken = await MockToken.deploy("Base Token", "BASE", BASE_TOKEN_DECIMALS);
    quoteToken = await MockToken.deploy("Quote Token", "QUOTE", QUOTE_TOKEN_DECIMALS);

    // Deploy state contract with owner as admin
    const State = await ethers.getContractFactory("State");
    state = await State.deploy(ownerAddress);

    // Deploy book contract
    const Book = await ethers.getContractFactory("Book");
    book = await Book.deploy(
      ownerAddress,
      await state.getAddress(),
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    );

    // Add book as admin in state
    await state.connect(owner).addAdmin(await book.getAddress());

    // Deploy vault contract with fee rates
    const Vault = await ethers.getContractFactory("Vault");
    vault = await Vault.deploy(
      ownerAddress,
      await state.getAddress(),
      feeRecipientAddress,
      MAKER_FEE_RATE,
      TAKER_FEE_RATE
    );

    // Set book address in vault
    await vault.connect(owner).setBook(await book.getAddress());

    // Deploy CLOB contract
    const CLOB = await ethers.getContractFactory("CLOB");
    clob = await CLOB.deploy(
      ownerAddress,
      await state.getAddress(),
      await book.getAddress(),
      await vault.getAddress()
    );
    
    // Add CLOB as admin in state
    await state.connect(owner).addAdmin(await clob.getAddress());
    
    // Add supported trading pair
    await clob.connect(owner).addSupportedPair(
      await baseToken.getAddress(),
      await quoteToken.getAddress()
    );
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await state.admin()).to.equal(ownerAddress);
    });
  });

  describe("Order Management", function () {
    it("Should create an order", async function () {
      const tx = await state.connect(owner).createOrder(
        trader1Address,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        ethers.parseUnits("100", Number(QUOTE_TOKEN_DECIMALS)),
        ethers.parseUnits("10", Number(BASE_TOKEN_DECIMALS)),
        true,
        0
      );
      const receipt = await tx.wait();
      const orderId = receipt.logs[0].args[0]; // Get orderId from event
      
      const order = await state.getOrder(orderId);
      expect(order.trader).to.equal(trader1Address);
      expect(order.baseToken).to.equal(await baseToken.getAddress());
      expect(order.quoteToken).to.equal(await quoteToken.getAddress());
      expect(order.price).to.equal(ethers.parseUnits("100", Number(QUOTE_TOKEN_DECIMALS)));
      expect(order.quantity).to.equal(ethers.parseUnits("10", Number(BASE_TOKEN_DECIMALS)));
      expect(order.isBuy).to.be.true;
      expect(order.orderType).to.equal(0n);
      expect(order.status).to.equal(0n);
      expect(order.filledQuantity).to.equal(0n);
    });

    it("Should update order status", async function () {
      const tx = await state.connect(owner).createOrder(
        trader1Address,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        ethers.parseUnits("100", Number(QUOTE_TOKEN_DECIMALS)),
        ethers.parseUnits("10", Number(BASE_TOKEN_DECIMALS)),
        true,
        0
      );
      const receipt = await tx.wait();
      const orderId = receipt.logs[0].args[0]; // Get orderId from event
      
      const filledQuantity = ethers.parseUnits("5", Number(BASE_TOKEN_DECIMALS));
      await state.connect(owner).updateOrderStatus(orderId, 1n, filledQuantity);
      
      const order = await state.getOrder(orderId);
      expect(order.status).to.equal(1n);
      expect(order.filledQuantity).to.equal(filledQuantity);
    });

    it("Should cancel an order", async function () {
      const tx = await state.connect(owner).createOrder(
        trader1Address,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        ethers.parseUnits("100", Number(QUOTE_TOKEN_DECIMALS)),
        ethers.parseUnits("10", Number(BASE_TOKEN_DECIMALS)),
        true,
        0
      );
      const receipt = await tx.wait();
      const orderId = receipt.logs[0].args[0]; // Get orderId from event
      
      await state.connect(owner).cancelOrder(orderId);
      
      const order = await state.getOrder(orderId);
      expect(order.status).to.equal(3n);
    });

    it("Should get trader orders", async function () {
      await state.connect(owner).createOrder(
        trader1Address,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        ethers.parseUnits("100", Number(QUOTE_TOKEN_DECIMALS)),
        ethers.parseUnits("10", Number(BASE_TOKEN_DECIMALS)),
        true,
        0
      );
      
      await state.connect(owner).createOrder(
        trader1Address,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        ethers.parseUnits("101", Number(QUOTE_TOKEN_DECIMALS)),
        ethers.parseUnits("5", Number(BASE_TOKEN_DECIMALS)),
        true,
        0
      );
      
      const traderOrders = await state.getTraderOrders(trader1Address);
      expect(traderOrders.length).to.equal(2);
    });

    it("Should not allow non-admin to create orders", async function () {
      await expect(state.connect(trader1).createOrder(
        trader1Address,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        ethers.parseUnits("100", Number(QUOTE_TOKEN_DECIMALS)),
        ethers.parseUnits("10", Number(BASE_TOKEN_DECIMALS)),
        true,
        0
      )).to.be.revertedWith("State: caller is not an admin");
    });

    it("Should not allow non-admin to update order status", async function () {
      const tx = await state.connect(owner).createOrder(
        trader1Address,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        ethers.parseUnits("100", Number(QUOTE_TOKEN_DECIMALS)),
        ethers.parseUnits("10", Number(BASE_TOKEN_DECIMALS)),
        true,
        0
      );
      const receipt = await tx.wait();
      const orderId = receipt.logs[0].args[0]; // Get orderId from event
      
      await expect(state.connect(trader1).updateOrderStatus(
        orderId,
        1n,
        ethers.parseUnits("5", Number(BASE_TOKEN_DECIMALS))
      )).to.be.revertedWith("State: caller is not an admin");
    });

    it("Should not allow non-admin to cancel orders", async function () {
      const tx = await state.connect(owner).createOrder(
        trader1Address,
        await baseToken.getAddress(),
        await quoteToken.getAddress(),
        ethers.parseUnits("100", Number(QUOTE_TOKEN_DECIMALS)),
        ethers.parseUnits("10", Number(BASE_TOKEN_DECIMALS)),
        true,
        0
      );
      const receipt = await tx.wait();
      const orderId = receipt.logs[0].args[0]; // Get orderId from event
      
      await expect(state.connect(trader1).cancelOrder(orderId))
        .to.be.revertedWith("State: caller is not an admin");
    });
  });
});
