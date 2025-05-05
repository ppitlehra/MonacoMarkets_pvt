/**
 * Copyright © 2025 Prajwal Pitlehra
 * This file is proprietary and confidential.
 * Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
 */

import { expect } from "chai";
import { ethers } from "hardhat";

describe("Minimal Ethers Test", function () {
  it("should import ethers and perform a basic check", async function () {
    // Simple check to ensure ethers is imported and usable
    expect(ethers).to.not.be.undefined;
    const signer = (await ethers.getSigners())[0];
    expect(signer).to.not.be.undefined;
    console.log("Minimal test: ethers imported successfully.");
  });
});

