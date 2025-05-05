// SPDX-License-Identifier: UNLICENSED
// Copyright © 2025 Prajwal Pitlehra
// This file is proprietary and confidential.
// Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockERC20Fail is ERC20, Ownable {
    mapping(address => bool) private _failTransferFrom;
    mapping(address => bool) private _failTransfer;
    bool public globalFailTransfer = false;

    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_, address initialOwner) ERC20(name, symbol) Ownable(initialOwner) {
        _decimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    function setFailTransferFrom(address account, bool fail) public onlyOwner {
        _failTransferFrom[account] = fail;
    }

    function setFailTransfer(address account, bool fail) public onlyOwner {
        _failTransfer[account] = fail;
    }

    function setGlobalFailTransfer(bool fail) public onlyOwner {
        globalFailTransfer = fail;
    }


    // Override transferFrom to check _failTransferFrom
    // Note: This requires careful consideration of how Vault.sol calls transferFrom
    // If Vault calls transferFrom on behalf of the user, we need to check the user's address
    // If Vault calls transferFrom on itself (after receiving tokens), we check the Vault's address
    // For simplicity, let's assume we check the 'sender' (the one whose allowance is being spent)
    function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(sender, spender, amount);

        // Simulate failure *after* allowance is spent but *before* transfer
        if (globalFailTransfer || _failTransferFrom[sender]) {
            revert("MockERC20Fail: Simulated transferFrom failure during transfer");
        }

        // Call the original ERC20 _transfer logic
        _transfer(sender, recipient, amount);
        return true;
    }
}

