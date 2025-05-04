// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/ISymphonyAdapter.sol";
import "../interfaces/ICLOB.sol";
import "../interfaces/IBook.sol";
import "hardhat/console.sol"; // Add console.log for debugging

// Interface for ERC20 decimals function
interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/**
 * @title MockSymphony
 * @dev Mock contract for testing Symphony integration with the synchronous flow
 */
contract MockSymphony {
    using SafeERC20 for IERC20;

    ISymphonyAdapter public immutable symphonyAdapter;
    address public immutable clobAddress; // Store CLOB address
    address public symphonyFeeRecipient; // Added to receive Symphony fees
    uint256 public symphonyFeeRate = 300; // Example: 3% Symphony fee (bps)
    uint256 private constant FEE_DENOMINATOR = 10000;

    // Add variables to track token transfers for testing
    uint256 public lastReceivedTokenInAmount;
    mapping(address => uint256) public tokenBalances; // Can remove if not needed for sync flow tests

    // Track seller base token transfers specifically // Can remove if not needed for sync flow tests
    mapping(address => mapping(address => uint256)) public sellerBaseTransfers;

    // event OrderPlaced(address indexed trader, address baseToken, address quoteToken, uint256 price, uint256 quantity, bool isBuy); // Keep if needed for tests
    // event OrderFilled(uint256 indexed orderId, uint256 filledQuantity); // Likely remove
    event TokenTransfer(address token, address from, address to, uint256 amount, string reason);
    event BalanceCheck(address token, address holder, uint256 balance, string checkpoint);
    // event SellerBaseTokenTransfer(address seller, address baseToken, uint256 amount); // Likely remove
    event SwapExecuted(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutNet, uint256 symphonyFee);

    constructor(address _symphonyAdapter, address _clobAddress, address _symphonyFeeRecipient) {
        symphonyAdapter = ISymphonyAdapter(_symphonyAdapter);
        clobAddress = _clobAddress; // Store CLOB address
        symphonyFeeRecipient = _symphonyFeeRecipient;
    }

    // --- Admin functions (Optional, for setting fee rate etc) ---
    function setSymphonyFeeRecipient(address _newRecipient) external { // Basic auth needed in reality
        require(_newRecipient != address(0));
        symphonyFeeRecipient = _newRecipient;
    }

    function setSymphonyFeeRate(uint256 _newRateBps) external { // Basic auth needed in reality
        require(_newRateBps <= FEE_DENOMINATOR); // Max 100%
        symphonyFeeRate = _newRateBps;
    }

    /**
     * @notice Simulates a user initiating a swap via Symphony, which uses the adapter's synchronous executeSwapViaCLOB.
     * @dev Pulls tokens from the user (msg.sender), transfers tokens to adapter, calls adapter, handles fees, and sends net output to user.
     * @param tokenIn The address of the input token.
     * @param tokenOut The address of the output token.
     * @param amountIn The amount of input token to swap.
     * @param minAmountOut Minimum amount of output token expected (for slippage protection - basic version).
     * @return amountOutNet The net amount of output tokens sent to the user after Symphony fees.
     */
    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut // Basic slippage protection
    ) external returns (uint256 amountOutNet) {
        address user = msg.sender;
        address adapterAddress = address(symphonyAdapter);
        console.log("MockSymphony.executeSwap: User", user);
        console.log("  -> Swapping Amount:", amountIn);
        console.log("  -> Token In:", tokenIn);
        console.log("  -> Token Out:", tokenOut);

        // 1. Pull tokenIn from user (msg.sender) to this contract (MockSymphony)
        IERC20 tokenInContract = IERC20(tokenIn);
        uint256 initialUserBalance = tokenInContract.balanceOf(user);
        console.log("MockSymphony.executeSwap: Initial User Balance (%s): %s", tokenIn, initialUserBalance);
        require(initialUserBalance >= amountIn, "MockSymphony: User has insufficient tokenIn balance");

        tokenInContract.safeTransferFrom(user, address(this), amountIn);
        emit TokenTransfer(tokenIn, user, address(this), amountIn, "User deposit for swap");
        console.log("MockSymphony.executeSwap: Pulled %s of %s from user %s", amountIn, tokenIn, user);

        // --- Determine direction --- 
        bool isBuy;
        require(clobAddress != address(0), "MockSymphony: CLOB address not set");

        if (ICLOB(clobAddress).isSupportedPair(tokenIn, tokenOut)) {
            isBuy = false; // Selling base (tokenIn)
            // REMOVED: Fee pulling logic for selling base
        } else if (ICLOB(clobAddress).isSupportedPair(tokenOut, tokenIn)) {
            isBuy = true; // Buying base (tokenOut) with quote (tokenIn)
            // REMOVED: Fee pulling logic for buying base (was incorrect anyway)
        } else {
            revert("MockSymphony: Unsupported token pair");
        }

        // 2. Transfer tokenIn to SymphonyAdapter
        // User is expected to have transferred the QUOTE fee directly to the adapter if selling BASE
        tokenInContract.safeTransfer(adapterAddress, amountIn);
        console.log("MockSymphony.executeSwap: Transferred %s of %s to adapter %s", amountIn, tokenIn, adapterAddress);
        emit TokenTransfer(tokenIn, address(this), adapterAddress, amountIn, "Transfer input to adapter");
        
        // 3. Call the adapter's synchronous executeSwapViaCLOB function
        console.log("MockSymphony.executeSwap: Calling adapter.executeSwapViaCLOB...");
        uint256 amountOutNetAdapter; // Amount adapter received from CLOB (NET of CLOB fees)
        try symphonyAdapter.executeSwapViaCLOB(tokenIn, tokenOut, amountIn) returns (uint256 result) {
            amountOutNetAdapter = result;
            console.log("MockSymphony.executeSwap: Adapter call succeeded. Net amountOut received by adapter: %s", amountOutNetAdapter);
        } catch Error(string memory reason) {
            console.log("MockSymphony.executeSwap: adapter.executeSwapViaCLOB failed with reason: %s", reason);
            revert(string(abi.encodePacked("MockSymphony: adapter executeSwapViaCLOB failed: ", reason)));
        } catch (bytes memory lowLevelData) {
            console.log("MockSymphony.executeSwap: adapter.executeSwapViaCLOB failed with low-level data");
            revert("MockSymphony: adapter executeSwapViaCLOB failed (low-level)");
        }

        // Basic Slippage Check
        require(amountOutNetAdapter >= minAmountOut, "MockSymphony: Slippage check failed");

        // 4. Adapter transfers amountOutNetAdapter to this contract (MockSymphony) as part of its execution
        IERC20 tokenOutContract = IERC20(tokenOut);
        uint256 mockSymphonyOutBalance = tokenOutContract.balanceOf(address(this));
        console.log("MockSymphony.executeSwap: Current tokenOut balance: %s (Expected increase by %s)", mockSymphonyOutBalance, amountOutNetAdapter);
        require(mockSymphonyOutBalance >= amountOutNetAdapter, "MockSymphony: Did not receive expected tokenOut balance");

        // 5. Calculate Symphony Fee based on amountOutNetAdapter (amount received by MockSymphony)
        uint256 symphonyFee = 0;
        if (symphonyFeeRate > 0 && amountOutNetAdapter > 0) {
            symphonyFee = (amountOutNetAdapter * symphonyFeeRate) / FEE_DENOMINATOR;
        }
        console.log("MockSymphony.executeSwap: Calculated Symphony Fee (%s): %s", tokenOut, symphonyFee);

        // 6. Calculate Net Amount for User
        amountOutNet = amountOutNetAdapter - symphonyFee;
        console.log("MockSymphony.executeSwap: Net Amount Out for User (%s): %s", tokenOut, amountOutNet);

        // 7. Transfer Net Amount to User
        if (amountOutNet > 0) {
            tokenOutContract.safeTransfer(user, amountOutNet);
            emit TokenTransfer(tokenOut, address(this), user, amountOutNet, "Net swap output to user");
            console.log("MockSymphony.executeSwap: Transferred %s net %s to user %s", amountOutNet, tokenOut, user);
        }

        // 8. Transfer Symphony Fee to Fee Recipient
        if (symphonyFee > 0) {
            require(symphonyFeeRecipient != address(0), "MockSymphony: Fee recipient not set");
            tokenOutContract.safeTransfer(symphonyFeeRecipient, symphonyFee);
            emit TokenTransfer(tokenOut, address(this), symphonyFeeRecipient, symphonyFee, "Symphony fee transfer");
            console.log("MockSymphony.executeSwap: Transferred %s fee %s to recipient %s", symphonyFee, tokenOut, symphonyFeeRecipient);
        }

        emit SwapExecuted(user, tokenIn, tokenOut, amountIn, amountOutNet, symphonyFee);
        return amountOutNet;
    }

}

