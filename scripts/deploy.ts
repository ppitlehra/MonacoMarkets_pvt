import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  console.log("Deploying contracts with the account:", deployerAddress);
  console.log("Account balance:", (await ethers.provider.getBalance(deployerAddress)).toString());

  // --- Deploy Mock Tokens (Replace with actual testnet tokens if available/needed) ---
  console.log("\nDeploying Mock ERC20 tokens...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  // Deploying with standard 18 decimals for base, 6 for quote as example
  const baseToken = await MockERC20.deploy("Test Base", "TBASE", 18, deployerAddress);
  await baseToken.waitForDeployment();
  const baseTokenAddress = await baseToken.getAddress();
  console.log("Mock Base Token deployed to:", baseTokenAddress);

  const quoteToken = await MockERC20.deploy("Test Quote", "TQUOTE", 6, deployerAddress);
  await quoteToken.waitForDeployment();
  const quoteTokenAddress = await quoteToken.getAddress();
  console.log("Mock Quote Token deployed to:", quoteTokenAddress);

  // --- Deploy Core Contracts ---
  console.log("\nDeploying core CLOB contracts...");

  // 1. State
  const State = await ethers.getContractFactory("State");
  const state = await State.deploy(deployerAddress);
  await state.waitForDeployment();
  const stateAddress = await state.getAddress();
  console.log("State contract deployed to:", stateAddress);

  // 2. Vault (Using example fee rates)
  const makerFeeRate = 10; // 0.1%
  const takerFeeRate = 20; // 0.2%
  const feeRecipient = deployerAddress; // Example: deployer receives fees
  const Vault = await ethers.getContractFactory("Vault");
  const vault = await Vault.deploy(deployerAddress, stateAddress, feeRecipient, makerFeeRate, takerFeeRate);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("Vault contract deployed to:", vaultAddress);

  // 3. Book
  const Book = await ethers.getContractFactory("Book");
  const book = await Book.deploy(deployerAddress, stateAddress, baseTokenAddress, quoteTokenAddress);
  await book.waitForDeployment();
  const bookAddress = await book.getAddress();
  console.log("Book contract deployed to:", bookAddress);

  // 4. CLOB
  const CLOB = await ethers.getContractFactory("CLOB");
  const clob = await CLOB.deploy(deployerAddress, stateAddress, bookAddress, vaultAddress);
  await clob.waitForDeployment();
  const clobAddress = await clob.getAddress();
  console.log("CLOB contract deployed to:", clobAddress);

  // --- Set Dependencies ---
  console.log("\nSetting contract dependencies...");

  // Set addresses in Book
  let tx = await book.connect(deployer).setVault(vaultAddress);
  await tx.wait();
  console.log("Vault address set in Book");
  tx = await book.connect(deployer).setCLOB(clobAddress);
  await tx.wait();
  console.log("CLOB address set in Book");

  // Set addresses in Vault
  tx = await vault.connect(deployer).setBook(bookAddress);
  await tx.wait();
  console.log("Book address set in Vault");
  tx = await vault.connect(deployer).setCLOB(clobAddress);
  await tx.wait();
  console.log("CLOB address set in Vault");

  // Add CLOB and Book as admins in State
  tx = await state.connect(deployer).addAdmin(clobAddress);
  await tx.wait();
  console.log("CLOB added as admin in State");
  tx = await state.connect(deployer).addAdmin(bookAddress);
  await tx.wait();
  console.log("Book added as admin in State");

  // Add trading pair in CLOB
  tx = await clob.connect(deployer).addSupportedPair(baseTokenAddress, quoteTokenAddress);
  await tx.wait();
  console.log(`Trading pair ${await baseToken.symbol()}/${await quoteToken.symbol()} added to CLOB`);

  console.log("\nDeployment and setup complete!");
  console.log("Deployed Contract Addresses:");
  console.log(`  Base Token: ${baseTokenAddress}`);
  console.log(`  Quote Token: ${quoteTokenAddress}`);
  console.log(`  State: ${stateAddress}`);
  console.log(`  Vault: ${vaultAddress}`);
  console.log(`  Book: ${bookAddress}`);
  console.log(`  CLOB: ${clobAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

