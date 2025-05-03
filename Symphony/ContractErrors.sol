// ContractErrors.sol

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

abstract contract ContractErrors {
    error NotOwnerError();
    error ApprovalFailedError(address token, address spender);
    error RevokeApprovalFailedError(address token, address spender);
    error AmountLessThanMinRequiredError(uint256 finalTokenAmount, uint256 minTotalAmountOut);
    error TransferFailedError(address token, address recipient, uint256 amount);
    error TransferFromFailedError(address from, address to, uint256 amount);
}
