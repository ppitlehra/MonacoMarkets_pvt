// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IOrderInfo.sol";
import "./interfaces/ICLOB.sol";
import "./interfaces/IState.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IBook.sol"; // Added missing import
import "hardhat/console.sol"; // Added console log

// Interface for ERC20 decimals function
interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/**
 * @title SymphonyAdapter
 * @dev Adapter for Symphony integration with the CLOB
 */
contract SymphonyAdapter {
    using Math for uint256;
    // Custom Reentrancy Guard state
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    address public admin;
    address public clob;
    address public symphonyOperator;
    address public symphonyFeeRecipient;

    // Fee rates for Symphony (used for internal calculations, e.g., Symphony fee)
    uint256 public symphonyMakerFeeRate = 300; // 3% (Example)
    uint256 public symphonyTakerFeeRate = 300; // 3% (Example)

    // Fee rates used for estimating CLOB fees during initial transfer
    // Make these public so MockSymphony can read them
    uint256 public clobMakerFeeRateEstimate = 50; // 0.5%
    uint256 public clobTakerFeeRateEstimate = 100; // 1.0%

    uint256 private constant FEE_DENOMINATOR = 10000;

    // Event for Symphony Fee Collection
    event SymphonyFeeCollected(address indexed trader, address indexed token, uint256 amount, bool isMaker);

    /**
     * @dev Constructor
     * @param _admin Admin address
     * @param _clob CLOB contract address
     */
    constructor(
        address _admin,
        address _clob
    ) {
        admin = _admin;
        clob = _clob;
        _status = _NOT_ENTERED; // Initialize reentrancy status
    }

    /**
     * @dev Custom Reentrancy Guard modifier
     */
    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    /**
     * @dev Modifier to restrict access to admin
     */
    modifier onlyAdmin() {
        require(msg.sender == admin, "SymphonyAdapter: caller is not admin");
        _;
    }

    /**
     * @dev Modifier to restrict access to Symphony operator
     */
    modifier onlySymphonyOperator() {
        require(msg.sender == symphonyOperator, "SymphonyAdapter: caller is not Symphony operator");
        _;
    }

    /**
     * @dev Allows the admin to approve the Vault contract to spend tokens held by this adapter.
     * This is necessary because the Vault needs to pull tokens from the adapter during settlement.
     * @param token The address of the ERC20 token to approve.
     * @param amount The amount to approve.
     */
    function approveVault(address token, uint256 amount) external onlyAdmin {
        (,, address vaultAddress) = ICLOB(clob).getComponents();
        require(vaultAddress != address(0), "SymphonyAdapter: Vault address not set in CLOB");
        require(
            IERC20(token).approve(vaultAddress, amount),
            "SymphonyAdapter: approve failed"
        );
    }

    /**
     * @dev Sets the Symphony operator address
     * @param _symphonyOperator The address of the Symphony operator
     */
    function setSymphonyOperator(address _symphonyOperator) external onlyAdmin {
        symphonyOperator = _symphonyOperator;
    }

    /**
     * @dev Sets the Symphony fee recipient address
     * @param _symphonyFeeRecipient The address of the Symphony fee recipient
     */
    function setSymphonyFeeRecipient(address _symphonyFeeRecipient) external onlyAdmin {
        require(_symphonyFeeRecipient != address(0), "Adapter: Fee recipient cannot be zero address");
        symphonyFeeRecipient = _symphonyFeeRecipient;
    }

    /**
     * @dev Sets the fee rates used for estimating CLOB fees
     * @param _makerFeeRate The maker fee rate (in basis points)
     * @param _takerFeeRate The taker fee rate (in basis points)
     */
    function setFeeRates(uint256 _makerFeeRate, uint256 _takerFeeRate) external onlyAdmin {
        clobMakerFeeRateEstimate = _makerFeeRate;
        clobTakerFeeRateEstimate = _takerFeeRate;
    }

    /**
     * @dev Sets the Symphony fee rates
     * @param _makerFeeRate The Symphony maker fee rate (in basis points)
     * @param _takerFeeRate The Symphony taker fee rate (in basis points)
     */
    function setSymphonyFeeRates(uint256 _makerFeeRate, uint256 _takerFeeRate) external onlyAdmin {
        symphonyMakerFeeRate = _makerFeeRate;
        symphonyTakerFeeRate = _takerFeeRate;
    }

    /**
     * @dev Transfers tokens from trader to SymphonyAdapter before placing an order (Internal)
     * @param trader The address of the trader
     * @param token The address of the token to transfer
     * @param amount The amount to transfer
     */
    function _transferTokensFromTrader(
        address trader,
        address token,
        uint256 amount
    ) internal {
        if (amount == 0) {
            return;
        }
        require(
            IERC20(token).balanceOf(trader) >= amount,
            "SymphonyAdapter: insufficient token balance"
        );
        require(
            IERC20(token).transferFrom(trader, address(this), amount),
            "SymphonyAdapter: transferFrom failed"
        );
    }

    /**
     * @notice Executes a swap synchronously via the CLOB using a market order.
     * @dev Called by Symphony (or MockSymphony). Assumes tokenIn (+ fees if applicable) has been transferred to this adapter.
     * @param tokenIn The address of the input token.
     * @param tokenOut The address of the output token.
     * @param amountIn The amount of input token provided.
     * @return amountOutNet The net amount of output token received by the adapter after CLOB settlement (and CLOB fees).
     */
    function executeSwapViaCLOB(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external nonReentrant returns (uint256 amountOutNet) {
        console.log("Adapter.executeSwapViaCLOB: START");
        console.log("  -> Caller (Symphony/Mock):", msg.sender);
        console.log("  -> Token In:", tokenIn);
        console.log("  -> Token Out:", tokenOut);
        console.log("  -> Amount In:", amountIn);

        address baseToken;
        address quoteToken;
        bool isBuy; // Is the CLOB order a BUY order?
        uint256 quantity; // Quantity for the CLOB market order (in base token)
        uint256 quoteAmount; // Quote amount for the CLOB market order (if selling base)

        // Determine swap direction and parameters for CLOB market order
        if (ICLOB(clob).isSupportedPair(tokenOut, tokenIn)) {
            // User wants to BUY base (tokenOut) using quote (tokenIn)
            baseToken = tokenOut;
            quoteToken = tokenIn;
            isBuy = true;
            quantity = 0; // For market buy, quantity is determined by quoteAmount
            quoteAmount = amountIn; // Use the full amountIn as the quote amount for the market buy
            console.log("Adapter.executeSwapViaCLOB: Direction: BUY BASE (%s) with QUOTE (%s)", baseToken, quoteToken);
            console.log("  -> CLOB Market Order: isBuy=true, quoteAmount=%s", quoteAmount);

        } else if (ICLOB(clob).isSupportedPair(tokenIn, tokenOut)) {
            // User wants to SELL base (tokenIn) for quote (tokenOut)
            baseToken = tokenIn;
            quoteToken = tokenOut;
            isBuy = false;
            quantity = amountIn; // Use the full amountIn as the quantity for the market sell
            quoteAmount = 0; // For market sell, quoteAmount is determined by quantity
            console.log("Adapter.executeSwapViaCLOB: Direction: SELL BASE (%s) for QUOTE (%s)", baseToken, quoteToken);
            console.log("  -> CLOB Market Order: isBuy=false, quantity=%s", quantity);

        } else {
            revert("SymphonyAdapter: Unsupported token pair");
        }

        // Check adapter's balance of the input token (should have been transferred by caller)
        uint256 adapterInputBalance = IERC20(tokenIn).balanceOf(address(this));
        console.log("Adapter.executeSwapViaCLOB: Adapter balance of tokenIn (%s) BEFORE CLOB: %s", tokenIn, adapterInputBalance);
        // Note: We might have received extra quote fee if selling base, so >= amountIn
        require(adapterInputBalance >= amountIn, "Adapter: Insufficient tokenIn balance received");

        // Check adapter's allowance for the Vault
        (,, address vaultAddress) = ICLOB(clob).getComponents();
        uint256 vaultAllowance = IERC20(tokenIn).allowance(address(this), vaultAddress);
        console.log("Adapter.executeSwapViaCLOB: Adapter allowance for Vault (%s) on tokenIn (%s) BEFORE CLOB: %s", vaultAddress, tokenIn, vaultAllowance);
        require(vaultAllowance >= amountIn, "Adapter: Insufficient Vault allowance for tokenIn");

        // If selling base, check quote allowance for fees
        if (!isBuy) {
            uint256 quoteFeeAllowance = IERC20(quoteToken).allowance(address(this), vaultAddress);
            console.log("Adapter.executeSwapViaCLOB: Adapter allowance for Vault (%s) on quoteToken (%s) for fees BEFORE CLOB: %s", vaultAddress, quoteToken, quoteFeeAllowance);
            // We don't know the exact fee yet, but check it's non-zero if needed
            // require(quoteFeeAllowance > 0, "Adapter: Insufficient Vault allowance for quoteToken fees");
        }

        // Place the market order on the CLOB
        // The CLOB's placeMarketOrder handles the interaction with Vault for settlement
        // The Vault will pull tokenIn (+ quote fee if selling base) from this adapter
        // The Vault will push tokenOut to this adapter
        console.log("Adapter.executeSwapViaCLOB: Calling clob.placeMarketOrder...");
        uint256 filledQuantity; // Base quantity filled
        uint256 filledQuoteAmount; // Quote amount filled (Gross before CLOB fees)
        try ICLOB(clob).placeMarketOrder(baseToken, quoteToken, isBuy, quantity, quoteAmount) returns (uint256 qty, uint256 quoteQty) {
            filledQuantity = qty;
            filledQuoteAmount = quoteQty; // This is the GROSS quote amount before fees
            console.log("Adapter.executeSwapViaCLOB: clob.placeMarketOrder SUCCESS");
            console.log("  -> Filled Base Quantity:", filledQuantity);
            console.log("  -> Filled Quote Amount (Gross):", filledQuoteAmount);
        } catch Error(string memory reason) {
            console.log("Adapter.executeSwapViaCLOB: clob.placeMarketOrder REVERTED with reason: %s", reason);
            revert(string(abi.encodePacked("Adapter: CLOB placeMarketOrder failed: ", reason)));
        } catch (bytes memory lowLevelData) {
            console.log("Adapter.executeSwapViaCLOB: clob.placeMarketOrder REVERTED with low-level data");
            revert("Adapter: CLOB placeMarketOrder failed (low-level)");
        }

        // Determine the NET amount of tokenOut received by the adapter AFTER CLOB settlement/fees
        uint256 adapterOutputBalance = IERC20(tokenOut).balanceOf(address(this));
        console.log("Adapter.executeSwapViaCLOB: Adapter balance of tokenOut (%s) AFTER CLOB call: %s", tokenOut, adapterOutputBalance);

        if (isBuy) {
            // Buying base, output is base. Vault transfers base directly.
            amountOutNet = adapterOutputBalance; // The balance IS the net amount received
        } else {
            // Selling base, output is quote. Vault transfers quote, then deducts taker fee.
            amountOutNet = adapterOutputBalance; // The balance IS the net amount received after fee deduction
        }
        console.log("Adapter.executeSwapViaCLOB: Net amountOut (%s) determined from balance: %s", tokenOut, amountOutNet);

        // Transfer the NET amountOut from this adapter to the caller (Symphony/MockSymphony)
        // The caller will handle Symphony fees and final net transfer to the user.
        if (amountOutNet > 0) {
            console.log("Adapter.executeSwapViaCLOB: Transferring %s of %s to caller %s", amountOutNet, tokenOut, msg.sender);
            bool success = IERC20(tokenOut).transfer(msg.sender, amountOutNet);
            require(success, "Adapter: Failed to transfer tokenOut to caller");
            console.log("Adapter.executeSwapViaCLOB: Transfer SUCCESS");
        }

        console.log("Adapter.executeSwapViaCLOB: END");
        // Return the NET amount received by the adapter
        return amountOutNet;
    }

}

