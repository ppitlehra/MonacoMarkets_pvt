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

    /* // Commented out: Related to async relay flow
    /**
     * @dev Places an order through the Symphony adapter
     * @param trader The address of the trader
     * @param baseToken The address of the base token
     * @param quoteToken The address of the quote token
     * @param price The price in quote token
     * @param quantity The quantity in base token
     * @param isBuy True if buy order, false if sell order
     * @param orderType The type of order (LIMIT, MARKET, IOC, FOK)
     * @return The ID of the created order
     * /
    function placeOrder(
        address trader,
        address baseToken,
        address quoteToken,
        uint256 price,
        uint256 quantity,
        bool isBuy,
        uint8 orderType
    ) external returns (uint256) {
        // ... (Implementation of old async flow)
    }
    */

    /* // Commented out: Related to async settlement processing flow
    /**
     * @dev Processes settlements through the Symphony adapter
     * @param settlements Array of settlement details
     * /
    function processSettlements(
        bytes calldata settlements
    ) external {
        // In a real implementation, this would decode the settlements and call the adapter
        // For the mock, we just emit an event
        emit OrderFilled(0, 0);
    }
    */

    /**
     * @notice Simulates a user initiating a swap via Symphony, which uses the adapter's synchronous executeSwapViaCLOB.
     * @dev Pulls tokens from the user (msg.sender), approves adapter, calls adapter, handles fees, and sends net output to user.
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

        // --- Determine direction and potentially pull quote fees if user is selling base --- 
        address baseToken;
        address quoteToken;
        bool isBuy;
        uint256 estimatedQuoteFee = 0;
        uint256 quantity;
        
        // Need CLOB address to check pairs
        // address clobAddress = address(symphonyAdapter.clob()); // REMOVED: Use stored clobAddress
        require(clobAddress != address(0), "MockSymphony: CLOB address not set");

        if (ICLOB(clobAddress).isSupportedPair(tokenIn, tokenOut)) {
            baseToken = tokenIn;
            quoteToken = tokenOut;
            isBuy = false; // Selling base (tokenIn)
            quantity = amountIn;

            // Calculate estimated CLOB taker fee (paid in quote token)
            (address bookAddress,,) = ICLOB(clobAddress).getComponents(); 
            uint256 bestBidPrice = IBook(bookAddress).getBestBidPrice();
            if (bestBidPrice > 0) {
                 uint8 baseDecimals = IERC20Decimals(baseToken).decimals();
                 uint8 quoteDecimals = IERC20Decimals(quoteToken).decimals();
                 uint256 priceDivisor = 10**(uint256(18 + baseDecimals) - quoteDecimals);
                 uint256 estimatedQuoteAmount = Math.mulDiv(quantity, bestBidPrice, priceDivisor);
                 // Use adapter's estimate rate
                 estimatedQuoteFee = (estimatedQuoteAmount * symphonyAdapter.clobTakerFeeRateEstimate()) / FEE_DENOMINATOR; 
            }
            
            // Pull estimated fee (quote token) from user if selling base
            if (estimatedQuoteFee > 0) {
                console.log("MockSymphony.executeSwap: Pulling estimated QUOTE fee %s from user %s", estimatedQuoteFee, user);
                IERC20 quoteTokenContract = IERC20(quoteToken);
                require(quoteTokenContract.balanceOf(user) >= estimatedQuoteFee, "MockSymphony: User insufficient quote for fee");
                quoteTokenContract.safeTransferFrom(user, address(this), estimatedQuoteFee);
                emit TokenTransfer(quoteToken, user, address(this), estimatedQuoteFee, "User deposit for fee");
                // Approve adapter for the quote fee
                quoteTokenContract.approve(address(symphonyAdapter), estimatedQuoteFee);
                emit TokenTransfer(quoteToken, address(this), address(symphonyAdapter), estimatedQuoteFee, "Approval for adapter fee");
            }

        } else if (ICLOB(clobAddress).isSupportedPair(tokenOut, tokenIn)) {
            baseToken = tokenOut;
            quoteToken = tokenIn;
            isBuy = true; // Buying base (tokenOut) with quote (tokenIn)
            // Fee is included in tokenIn (quote), no separate pull needed here
            
            // --- Calculate and pull fee if buying base --- 
            // We still need the fee amount to pull from the user
            (address bookAddress,,) = ICLOB(clobAddress).getComponents();
            uint256 bestAskPrice = IBook(bookAddress).getBestAskPrice();
            estimatedQuoteFee = 0;
            if (bestAskPrice > 0) {
                 // Use adapter's estimate rate on amountIn (quote)
                 estimatedQuoteFee = (amountIn * symphonyAdapter.clobTakerFeeRateEstimate()) / FEE_DENOMINATOR;
            }

            // Pull estimated fee (quote token) from user if buying base
            if (estimatedQuoteFee > 0) {
                console.log("MockSymphony.executeSwap: Pulling estimated QUOTE fee %s from user %s (for BUY)", estimatedQuoteFee, user);
                IERC20 quoteTokenContract = IERC20(quoteToken); // quoteToken == tokenIn
                // User already sent amountIn, check if they have enough *additional* for the fee
                require(quoteTokenContract.balanceOf(user) >= estimatedQuoteFee, "MockSymphony: User insufficient quote for fee");
                quoteTokenContract.safeTransferFrom(user, address(this), estimatedQuoteFee);
                emit TokenTransfer(quoteToken, user, address(this), estimatedQuoteFee, "User deposit for fee (buy)");
                // No need to approve adapter separately for fee, covered by the tokenIn approval below
            }

        } else {
            revert("MockSymphony: Unsupported token pair");
        }

        // 2. Approve SymphonyAdapter to spend tokenIn from this contract's balance
        tokenInContract.approve(address(symphonyAdapter), type(uint256).max);
        console.log("MockSymphony.executeSwap: Approved adapter %s for %s", address(symphonyAdapter), tokenIn);
        emit TokenTransfer(tokenIn, address(this), address(symphonyAdapter), amountIn, "Approval for adapter");
        
        // 3. Call the adapter's synchronous executeSwapViaCLOB function
        console.log("MockSymphony.executeSwap: Calling adapter.executeSwapViaCLOB...");
        uint256 amountOutGross; // Amount adapter received from CLOB
        try symphonyAdapter.executeSwapViaCLOB(tokenIn, tokenOut, amountIn) returns (uint256 result) {
            amountOutGross = result;
            console.log("MockSymphony.executeSwap: Adapter call succeeded. Gross amountOut received by adapter: %s", amountOutGross);
        } catch Error(string memory reason) {
            console.log("MockSymphony.executeSwap: adapter.executeSwapViaCLOB failed with reason: %s", reason);
            revert(string(abi.encodePacked("MockSymphony: adapter executeSwapViaCLOB failed: ", reason)));
        } catch (bytes memory lowLevelData) {
            console.log("MockSymphony.executeSwap: adapter.executeSwapViaCLOB failed with low-level data");
            revert("MockSymphony: adapter executeSwapViaCLOB failed (low-level)");
        }

        // Basic Slippage Check
        require(amountOutGross >= minAmountOut, "MockSymphony: Slippage check failed");

        // 4. Adapter now holds amountOutGross of tokenOut. We need to get it back.
        // In reality, Symphony might have the adapter transfer directly, or Symphony pulls it.
        // Let's assume Adapter holds it and MockSymphony needs to handle payout.
        // NOTE: Adapter's executeSwapViaCLOB currently returns amountOut but DOESN'T transfer it.
        // This requires either changing the Adapter or MockSymphony pulling the funds.
        // Let's assume MockSymphony needs to retrieve funds held by the adapter.
        // THIS IS A PROBLEM - MockSymphony cannot pull funds from adapter without approval/function.
        // --- REVISED ASSUMPTION: Adapter's executeSwapViaCLOB MUST transfer amountOut to msg.sender (MockSymphony) --- 
        // Let's modify the adapter later if needed. Assume for now adapter transfers amountOutGross to MockSymphony.
        
        // Check MockSymphony's balance of tokenOut (should have increased by amountOutGross)
        IERC20 tokenOutContract = IERC20(tokenOut);
        uint256 mockSymphonyOutBalance = tokenOutContract.balanceOf(address(this));
        console.log("MockSymphony.executeSwap: Current tokenOut balance: %s (Expected increase by %s)", mockSymphonyOutBalance, amountOutGross);
        // We can't perfectly assert the balance == amountOutGross due to potential prior balance.
        // Check if balance >= amountOutGross is sufficient for mock.
        require(mockSymphonyOutBalance >= amountOutGross, "MockSymphony: Did not receive expected tokenOut balance");


        // 5. Calculate Symphony Fee based on amountOutGross
        uint256 symphonyFee = 0;
        if (symphonyFeeRate > 0 && amountOutGross > 0) {
            symphonyFee = (amountOutGross * symphonyFeeRate) / FEE_DENOMINATOR;
        }
        console.log("MockSymphony.executeSwap: Calculated Symphony Fee (%s): %s", tokenOut, symphonyFee);

        // 6. Calculate Net Amount for User
        amountOutNet = amountOutGross - symphonyFee;
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


    /* // Commented out: Old async flow helper
    /**
     * @dev Helper function to extract revert reason from a failed call
     * @param _returnData The return data from the failed call
     * @return The revert reason string
     * /
    function _getRevertMsg(bytes memory _returnData) internal pure returns (string memory) {
        // If the _returnData length is less than 68, then the transaction failed silently (without a revert message)
        if (_returnData.length < 68) return "Transaction reverted silently";

        // Extract the revert message from the _returnData
        // Skip the first 4 bytes (function selector) and the next 32 bytes (offset)
        assembly {
            // Add 4 to skip the function selector and 32 to skip the offset
            _returnData := add(_returnData, 0x44)
        }

        // Convert the remaining bytes to a string
        return abi.decode(_returnData, (string));
    }
    */
}
