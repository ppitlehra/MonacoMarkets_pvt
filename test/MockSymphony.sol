// SPDX-License-Identifier: MIT
// Copyright © 2025 Prajwal Pitlehra
// This file is proprietary and confidential.
// Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
pragma solidity ^0.8.4;

import "../contracts/interfaces/IERC20.sol";
import "../contracts/interfaces/ISymphonyAdapter.sol";
// import "../contracts/interfaces/IOrderInfo.sol"; // Removed, not directly used
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol"; // For debugging

/**
 * @title MockSymphony Contract
 * @dev Mocks the behavior of the Symphony aggregator contract for testing purposes.
 * Specifically, it mimics the synchronous call to an adapter to execute a swap via an external venue (like our CLOB).
 */
contract MockSymphony {
    using SafeERC20 for IERC20;

    ISymphonyAdapter public symphonyAdapter;
    address public owner; // For withdrawing stuck tokens

    event SwapExecutedOnAdapter(
        address indexed adapter,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOutReceived
    );

    constructor(address _adapterAddress) {
        symphonyAdapter = ISymphonyAdapter(_adapterAddress);
        owner = msg.sender; // Set deployer as owner
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "MockSymphony: Caller is not the owner");
        _;
    }

    /**
     * @notice Mimics Symphony calling an adapter to perform a swap.
     * @dev Pulls tokenIn from msg.sender (the operator/tester), approves adapter, calls adapter, returns result.
     * Assumes msg.sender has approved this MockSymphony contract for tokenIn.
     * @param tokenIn Address of the input token.
     * @param tokenOut Address of the output token.
     * @param amountIn Amount of input token to swap.
     * @param feeToken Address of the token used for CLOB fees (e.g., quote token for Taker BUY).
     * @param estimatedFeeAmount Estimated amount of feeToken needed for CLOB fees.
     * @return amountOut The amount of output tokens received from the adapter.
     */
    function executeSwapViaAdapter(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address feeToken, // Added for fee handling
        uint256 estimatedFeeAmount // Added for fee handling
    ) external returns (uint256 amountOut) {
        console.log("MockSymphony: executeSwapViaAdapter called by", msg.sender);
        console.log("MockSymphony: Pulling %s of token %s from sender", amountIn, tokenIn);

        // 1. Pull tokenIn from msg.sender (operator/tester)
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // 2. Pull estimated fee amount (e.g., quote token) from msg.sender
        // Handle case where feeToken is the same as tokenIn
        if (feeToken != tokenIn && estimatedFeeAmount > 0) {
            console.log("MockSymphony: Pulling %s of fee token %s from sender", estimatedFeeAmount, feeToken);
            IERC20(feeToken).safeTransferFrom(msg.sender, address(this), estimatedFeeAmount);
        }
        // If feeToken is the same as tokenIn, the total amount was already pulled if amountIn included fee estimate
        // Test setup needs to ensure msg.sender sends the correct total amountIn or separate fee amount.
        // Let's assume test sends amountIn + estimatedFeeAmount if tokenIn == feeToken.

        // 3. Approve the SymphonyAdapter to spend tokenIn and feeToken from this mock contract
        console.log("MockSymphony: Approving adapter %s for token %s", address(symphonyAdapter), tokenIn);
        IERC20(tokenIn).safeApprove(address(symphonyAdapter), amountIn);
        if (feeToken != tokenIn && estimatedFeeAmount > 0) {
             console.log("MockSymphony: Approving adapter %s for fee token %s", address(symphonyAdapter), feeToken);
            IERC20(feeToken).safeApprove(address(symphonyAdapter), estimatedFeeAmount);
        }
        // If feeToken == tokenIn, the single approval covers both.

        // 4. Call the adapter's synchronous swap function
        console.log("MockSymphony: Calling adapter.executeSwapViaCLOB...");
        amountOut = symphonyAdapter.executeSwapViaCLOB(tokenIn, tokenOut, amountIn);
        console.log("MockSymphony: Adapter returned amountOut: %s", amountOut);

        // 5. Emit an event
        emit SwapExecutedOnAdapter(
            address(symphonyAdapter),
            tokenIn,
            tokenOut,
            amountIn,
            amountOut
        );

        // 6. Optional: Transfer remaining feeToken back to sender if Vault used less than estimated?
        // This adds complexity, maybe skip for mock.

        // 7. Optional: Transfer received amountOut back to sender?
        // Real Symphony handles this after its own fee logic. Mock returns value.
        // If tests need the mock to hold the token, do nothing. If tests need sender to get it, transfer here.
        // Let's keep it simple: Mock returns value, holds the tokenOut.

        return amountOut;
    }

    /**
     * @notice Allows owner to withdraw tokens accidentally sent or received by the mock.
     */
    function withdrawTokens(address _token, address _to, uint256 _amount) external onlyOwner {
        require(_to != address(0), "MockSymphony: Invalid recipient address");
        uint256 balance = IERC20(_token).balanceOf(address(this));
        uint256 amountToWithdraw = _amount == 0 ? balance : _amount; // Withdraw all if amount is 0
        require(balance >= amountToWithdraw, "MockSymphony: Insufficient balance");
        IERC20(_token).safeTransfer(_to, amountToWithdraw);
    }

    // Receive function to accept ETH if needed (unlikely for this mock)
    receive() external payable {}
}

