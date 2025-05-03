// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockToken
 * @dev Implementation of the ERC20 token for testing purposes
 */
contract MockToken is ERC20 {
    uint8 private _decimals;

    /**
     * @dev Constructor that gives the msg.sender all of the initial supply.
     * @param name The name of the token
     * @param symbol The symbol of the token
     * @param decimals_ The number of decimals for the token
     */
    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     *
     * @param account The address to mint tokens to
     * @param amount The amount of tokens to mint
     */
    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }

    /**
     * @dev Destroys `amount` tokens from `account`, reducing the
     * total supply.
     *
     * @param account The address to burn tokens from
     * @param amount The amount of tokens to burn
     */
    function burn(address account, uint256 amount) public {
        _burn(account, amount);
    }
}
