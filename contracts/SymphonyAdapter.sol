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
    // Custom Reentrancy Guard state
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    address public admin;
    address public clob;
    address public symphonyOperator;
    address public symphonyFeeRecipient;

    /* // Commented out: Related to async relay flow
    // Mapping to track Symphony nonces for each trader
    mapping(address => uint256) private symphonyNonces;

    // Mapping to track the original trader for orders relayed through the adapter
    mapping(uint256 => address) public orderIdToOriginalTrader;
    */

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

    /* // Commented out: Related to async relay flow
    /**
     * @dev Gets the Symphony nonce for a trader
     * @param trader The address of the trader
     * @return The current nonce
     * /
    function getSymphonyNonce(address trader) external view returns (uint256) {
        return symphonyNonces[trader];
    }
    */

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

    /* // Commented out: Related to async relay flow
    /**
     * @dev Relays a Symphony order to the CLOB
     * @param trader The address of the trader
     * @param baseToken The address of the base token
     * @param quoteToken The address of the quote token
     * @param price The price in quote token
     * @param quantity The quantity in base token
     * @param isBuy True if buy order, false if sell order
     * @param orderType The type of order (LIMIT, MARKET, IOC, FOK)
     * @return The ID of the created order
     * /
    function relaySymphonyOrder(
        address trader,
        address baseToken,
        address quoteToken,
        uint256 price,
        uint256 quantity,
        bool isBuy,
        uint8 orderType
    ) external onlySymphonyOperator nonReentrant returns (uint256) {
        unchecked {
            symphonyNonces[trader]++;
        }
        _handleTokenTransfersForOrder(
            trader,
            baseToken,
            quoteToken,
            price,
            quantity,
            isBuy
        );
        uint256 orderId = ICLOB(clob).placeOrder(
            baseToken,
            quoteToken,
            price,
            quantity,
            isBuy,
            orderType
        );
        orderIdToOriginalTrader[orderId] = trader;
        return orderId;
    }
    */

    /* // Commented out: Related to async relay flow
    /**
     * @dev Relays multiple Symphony orders to the CLOB in batch
     * @param traders Array of trader addresses
     * @param baseTokens Array of base token addresses
     * @param quoteTokens Array of quote token addresses
     * @param prices Array of prices in quote token
     * @param quantities Array of quantities in base token
     * @param isBuys Array of buy/sell flags
     * @param orderTypes Array of order types
     * @return Array of created order IDs
     * /
    function relayBatchSymphonyOrders(
        address[] calldata traders,
        address[] calldata baseTokens,
        address[] calldata quoteTokens,
        uint256[] calldata prices,
        uint256[] calldata quantities,
        bool[] calldata isBuys,
        uint8[] calldata orderTypes
    ) external onlySymphonyOperator nonReentrant returns (uint256[] memory) {
        require(
            traders.length == baseTokens.length &&
            traders.length == quoteTokens.length &&
            traders.length == prices.length &&
            traders.length == quantities.length &&
            traders.length == isBuys.length &&
            traders.length == orderTypes.length,
            "SymphonyAdapter: array lengths mismatch"
        );
        uint256[] memory orderIds = new uint256[](traders.length);
        unchecked {
            for (uint256 i = 0; i < traders.length; i++) {
                symphonyNonces[traders[i]]++;
                _handleTokenTransfersForOrder(
                    traders[i],
                    baseTokens[i],
                    quoteTokens[i],
                    prices[i],
                    quantities[i],
                    isBuys[i]
                );
                orderIds[i] = ICLOB(clob).placeOrder(
                    baseTokens[i],
                    quoteTokens[i],
                    prices[i],
                    quantities[i],
                    isBuys[i],
                    orderTypes[i]
                );
                orderIdToOriginalTrader[orderIds[i]] = traders[i];
            }
        }
        return orderIds;
    }
    */

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


    /* // Commented out: Related to async relay flow
    /**
     * @dev Handles token transfers for Symphony orders (from trader to adapter) (Internal)
     * @param baseToken The address of the base token
     * @param quoteToken The address of the quote token
     * @param price The price in quote token
     * @param quantity The quantity in base token
     * @param isBuy True if buy order, false if sell order
     * /
    function _handleTokenTransfersForOrder(
        address trader,
        address baseToken,
        address quoteToken,
        uint256 price,
        uint256 quantity,
        bool isBuy
    ) internal {
        uint8 baseDecimals = IERC20Decimals(baseToken).decimals();
        uint256 quoteAmount = Math.mulDiv(quantity, price, 10**uint256(baseDecimals));
        uint256 estimatedTakerFee = Math.ceilDiv(quoteAmount * clobTakerFeeRateEstimate, FEE_DENOMINATOR);
        uint256 estimatedMakerFee = Math.ceilDiv(quoteAmount * clobMakerFeeRateEstimate, FEE_DENOMINATOR);

        if (isBuy) {
            // Taker BUY: Transfer Quote + Estimated CLOB Taker Fee
            _transferTokensFromTrader(trader, quoteToken, quoteAmount + estimatedTakerFee);
            // Note: Symphony Maker Fee (if applicable) is not handled here, assumed external or paid by maker
        } else {
            // Taker SELL: Transfer Base
            _transferTokensFromTrader(trader, baseToken, quantity);
            // Transfer Quote for Estimated CLOB Taker Fee (paid by taker)
            if (estimatedTakerFee > 0) {
                 _transferTokensFromTrader(trader, quoteToken, estimatedTakerFee);
            }
            // Note: Symphony Maker Fee (if applicable) is not handled here, assumed external or paid by maker
        }
    }
    */

    /* // Commented out: Related to async settlement processing flow
    /**
     * @dev Process settlement for Symphony orders (called by processSettlements) (Internal)
     * This function handles the final transfer from the adapter to the original trader, applying Symphony TAKER fees.
     * Assumes Vault has already settled the CLOB trade, moving assets between adapter and counterparty.
     * @param settlement The settlement details from the CLOB/Vault
     * @param originalTakerTrader The address of the original taker trader (from Symphony)
     * @param originalMakerTrader The address of the original maker trader (from Symphony) - used for context, not transfers
     * @param takerOrder The original taker order details from State
     * @param makerOrder The original maker order details from State
     * /
    function _processSettlement(
        IOrderInfo.Settlement memory settlement,
        address originalTakerTrader,
        address originalMakerTrader, // Keep for context/logging if needed
        IOrderInfo.Order memory takerOrder,
        IOrderInfo.Order memory makerOrder
    ) internal {
        console.log("Adapter._processSettlement: Taker %s, Maker %s", originalTakerTrader, originalMakerTrader);
        require(symphonyFeeRecipient != address(0), "Adapter: Symphony fee recipient not set");

        uint256 quantity = settlement.quantity;
        address baseToken = takerOrder.baseToken;
        address quoteToken = takerOrder.quoteToken;

        if (takerOrder.isBuy) {
            // Taker (Buyer) received Base tokens from Vault (via Maker)
            console.log("Adapter._processSettlement: Taker BUY");
            uint256 grossBaseReceived = quantity; // Adapter holds this amount
            console.log("Adapter._processSettlement: Gross Base Received by Adapter: %s", grossBaseReceived);

            // Calculate Symphony Taker Fee (in Base)
            uint256 symphonyTakerFeeBase = Math.mulDiv(grossBaseReceived, symphonyTakerFeeRate, FEE_DENOMINATOR);
            console.log("Adapter._processSettlement: Symphony Taker Fee (Base): %s", symphonyTakerFeeBase);

            // Calculate net Base to send to original Taker
            uint256 netBaseToTaker = grossBaseReceived - symphonyTakerFeeBase;
            console.log("Adapter._processSettlement: Net Base to Original Taker: %s", netBaseToTaker);

            // Transfer net Base from adapter to original Taker (Buyer)
            if (netBaseToTaker > 0) {
                console.log("Adapter: Transferring %s BASE to original Taker %s", netBaseToTaker, originalTakerTrader);
                require(IERC20(baseToken).transfer(originalTakerTrader, netBaseToTaker), "Adapter: Transfer base to Taker failed");
            }
            // Transfer Symphony Taker Fee (Base) from adapter to Fee Recipient
            if (symphonyTakerFeeBase > 0) {
                console.log("Adapter: Transferring %s BASE (Symphony Taker Fee) to %s", symphonyTakerFeeBase, symphonyFeeRecipient);
                require(IERC20(baseToken).transfer(symphonyFeeRecipient, symphonyTakerFeeBase), "Adapter: Transfer base fee failed");
                emit SymphonyFeeCollected(originalTakerTrader, baseToken, symphonyTakerFeeBase, false); // isMaker = false
            }
            // Quote tokens were handled by Vault, no action needed by adapter
            console.log("Adapter._processSettlement: Taker BUY finished");

        } else {
            // Taker (Seller) received Quote tokens from Vault (via Maker, net of CLOB taker fee)
            console.log("Adapter._processSettlement: Taker SELL");
            uint8 baseDecimals = IERC20Decimals(baseToken).decimals();
            uint256 quoteAmount = Math.mulDiv(quantity, makerOrder.price, 10**uint256(baseDecimals));

            // Get CLOB taker fee from Vault (needed to know what adapter actually received)
            (,, address vaultAddress) = ICLOB(clob).getComponents();
            (uint256 clobTakerFee, ) = IVault(vaultAddress).calculateFees(settlement);
            console.log("Adapter._processSettlement: CLOB Taker Fee (Quote): %s", clobTakerFee);

            uint256 grossQuoteReceived = quoteAmount - clobTakerFee; // Adapter holds this amount
            console.log("Adapter._processSettlement: Gross Quote Received by Adapter: %s", grossQuoteReceived);

            // Calculate Symphony Taker Fee (in Quote)
            uint256 symphonyTakerFeeQuote = Math.mulDiv(grossQuoteReceived, symphonyTakerFeeRate, FEE_DENOMINATOR);
            console.log("Adapter._processSettlement: Symphony Taker Fee (Quote): %s", symphonyTakerFeeQuote);

            // Calculate net Quote to send to original Taker
            uint256 netQuoteToTaker = grossQuoteReceived - symphonyTakerFeeQuote;
            console.log("Adapter._processSettlement: Net Quote to Original Taker: %s", netQuoteToTaker);

            // Transfer net Quote from adapter to original Taker (Seller)
            if (netQuoteToTaker > 0) {
                console.log("Adapter: Transferring %s QUOTE to original Taker %s", netQuoteToTaker, originalTakerTrader);
                require(IERC20(quoteToken).transfer(originalTakerTrader, netQuoteToTaker), "Adapter: Transfer quote to Taker failed");
            }
            // Transfer Symphony Taker Fee (Quote) from adapter to Fee Recipient
            if (symphonyTakerFeeQuote > 0) {
                console.log("Adapter: Transferring %s QUOTE (Symphony Taker Fee) to %s", symphonyTakerFeeQuote, symphonyFeeRecipient);
                require(IERC20(quoteToken).transfer(symphonyFeeRecipient, symphonyTakerFeeQuote), "Adapter: Transfer quote fee failed");
                emit SymphonyFeeCollected(originalTakerTrader, quoteToken, symphonyTakerFeeQuote, false); // isMaker = false
            }
            // Base tokens were handled by Vault, no action needed by adapter
            console.log("Adapter._processSettlement: Taker SELL finished");
        }
        // Symphony Maker fees are assumed to be handled externally
    }
    */

    /* // Commented out: Related to async settlement processing flow
    /**
     * @dev Processes settlements received from the CLOB/Vault (Called externally, likely by Symphony Operator)
     * @param settlements Array of settlement details
     * /
    function processSettlements(
        IOrderInfo.Settlement[] calldata settlements
    ) external onlySymphonyOperator nonReentrant {
        console.log("Adapter.processSettlements: Received %s settlements", settlements.length);
        (address bookAddress, address stateAddress,) = ICLOB(clob).getComponents(); // Get State address
        require(stateAddress != address(0), "Adapter: State address not set in CLOB");
        IState stateContract = IState(stateAddress);

        for (uint256 i = 0; i < settlements.length; i++) {
            IOrderInfo.Settlement memory settlement = settlements[i];
            console.log("Adapter.processSettlements: Processing settlement %s: Taker %s, Maker %s", i, settlement.takerOrderId, settlement.makerOrderId);

            // Fetch original orders from State
            IOrderInfo.Order memory takerOrder = stateContract.getOrder(settlement.takerOrderId);
            IOrderInfo.Order memory makerOrder = stateContract.getOrder(settlement.makerOrderId);

            require(takerOrder.id != 0 && makerOrder.id != 0, "Adapter: Invalid order ID in settlement");

            // Determine original traders using fallback logic
            address originalTakerTrader = orderIdToOriginalTrader[settlement.takerOrderId];
            if (originalTakerTrader == address(0)) {
                console.log("Adapter.processSettlements: Fallback for Taker Address. Using: %s", takerOrder.trader);
                originalTakerTrader = takerOrder.trader; // Fallback to trader address from State
            }

            address originalMakerTrader = orderIdToOriginalTrader[settlement.makerOrderId];
            if (originalMakerTrader == address(0)) {
                console.log("Adapter.processSettlements: Fallback for Maker Address. Using: %s", makerOrder.trader);
                originalMakerTrader = makerOrder.trader; // Fallback to trader address from State
            }

            // Call internal processing function
            _processSettlement(settlement, originalTakerTrader, originalMakerTrader, takerOrder, makerOrder);
        }
        console.log("Adapter.processSettlements: Finished processing all settlements");
    }
    */

    // Fallback function to receive Ether (optional)
    receive() external payable {}

    // *** NEW Synchronous Function for Symphony Aggregator ***
    /**
     * @notice Executes a swap via the CLOB synchronously. Called by Symphony.
     * @dev Assumes this adapter has been approved by the caller (Symphony/MockSymphony) for tokenIn and feeToken.
     * The caller (Symphony/MockSymphony) is responsible for pulling tokens from the end-user and funding this call.
     * @param tokenIn Address of the input token.
     * @param tokenOut Address of the output token.
     * @param amountIn Amount of input token to swap.
     * @return amountOut The amount of output tokens received from the CLOB settlement and held by this adapter.
     */
    function executeSwapViaCLOB(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external nonReentrant returns (uint256 amountOut) {
        // console.log("Adapter.executeSwapViaCLOB: Called by %s with tokenIn %s, tokenOut %s, amountIn %s", msg.sender, tokenIn, tokenOut, amountIn);

        // --- Initial Implementation Steps (TDD) ---
        // 1. Determine if BUY or SELL based on tokenIn/tokenOut relative to CLOB pair (base/quote)
        //    - Requires getting pair info from CLOB/State
        // 2. Calculate price/quantity. For simplicity, assume a MARKET order (price=0) for now.
        //    - Quantity would be amountIn if tokenIn is base, or calculated if tokenIn is quote.
        // 3. Pull tokenIn from caller (msg.sender, which is Symphony/MockSymphony)

        // --- Implementation Steps ---
        // 1. Determine pair and order details
        address baseToken;
        address quoteToken;
        bool isBuy;
        uint256 quantity;
        uint256 price = 0; // Market order
        uint8 orderType = 1; // MARKET order type
        uint256 estimatedFee = 0; // Declare estimatedFee here and initialize to 0

        if (ICLOB(clob).isSupportedPair(tokenIn, tokenOut)) {
            baseToken = tokenIn;
            quoteToken = tokenOut;
            isBuy = false; // Selling base (tokenIn) for quote (tokenOut)
            quantity = amountIn; // Base quantity is the amountIn

            // Calculate estimated CLOB taker fee (paid in quote token)
            (address bookAddress,,) = ICLOB(clob).getComponents();
            uint256 bestBidPrice = IBook(bookAddress).getBestBidPrice();
            if (bestBidPrice > 0) {
                 uint8 baseDecimals = IERC20Decimals(baseToken).decimals();
                 uint8 quoteDecimals = IERC20Decimals(quoteToken).decimals();
                 uint256 priceDivisor = 10**(uint256(18 + baseDecimals) - quoteDecimals);
                 uint256 estimatedQuoteAmount = Math.mulDiv(quantity, bestBidPrice, priceDivisor);
                 estimatedFee = (estimatedQuoteAmount * clobTakerFeeRateEstimate) / FEE_DENOMINATOR;
            }

            // Pull ONLY base token (amountIn) from caller (MockSymphony)
            require(IERC20(baseToken).transferFrom(msg.sender, address(this), amountIn), "Adapter: Failed to pull baseToken");

        } else if (ICLOB(clob).isSupportedPair(tokenOut, tokenIn)) {
            baseToken = tokenOut;
            quoteToken = tokenIn;
            isBuy = true; // Buying base (tokenOut) with quote (tokenIn)

            // Calculate estimated CLOB taker fee (paid in quote token)
            estimatedFee = (amountIn * clobTakerFeeRateEstimate) / FEE_DENOMINATOR;

            // Pull quote token (amountIn + estimatedFee) from caller
            require(IERC20(quoteToken).transferFrom(msg.sender, address(this), amountIn + estimatedFee), "Adapter: Failed to pull quoteToken + fee");

            // For market BUY, quantity needs to be estimated or handled differently.
            // Assuming CLOB market buy takes BASE quantity. We need to estimate this.
            (address bookAddress,,) = ICLOB(clob).getComponents();
            uint256 bestAskPrice = IBook(bookAddress).getBestAskPrice();
            require(bestAskPrice > 0, "Adapter: No liquidity available (ask)");

            uint8 baseDecimals = IERC20Decimals(baseToken).decimals();
            uint8 quoteDecimals = IERC20Decimals(quoteToken).decimals();
            uint256 quantityMultiplier = 10**(uint256(18 + baseDecimals) - quoteDecimals);
            quantity = Math.mulDiv(amountIn, quantityMultiplier, bestAskPrice);
            require(quantity > 0, "Adapter: Estimated buy quantity is zero");

        } else {
            revert("Adapter: Unsupported token pair");
        }


        // 3. Approve Vault and Call CLOB.placeOrder
        (,,address vaultAddress) = ICLOB(clob).getComponents();

        // Approve Vault for the fee (in quote token) - Adapter must have received this from MockSymphony if selling base
        require(IERC20(quoteToken).approve(vaultAddress, estimatedFee), "Adapter: Vault approval failed for fee");

        if(isBuy) {
            // Approve Vault for the main quote amount (tokenIn + fee already pulled)
            require(IERC20(quoteToken).approve(vaultAddress, amountIn + estimatedFee), "Adapter: Vault approval failed for quote + fee");
        } else { // isSell
             // Approve Vault for the base token (tokenIn already pulled)
             require(IERC20(baseToken).approve(vaultAddress, quantity), "Adapter: Vault approval failed for base");
        }

        // === DEBUG LOGS ===
        console.log("Adapter Debug: Before placeOrder");
        console.log("  -> Adapter Base Balance:", IERC20(baseToken).balanceOf(address(this)));
        console.log("  -> Adapter Quote Balance:", IERC20(quoteToken).balanceOf(address(this)));
        console.log("  -> Vault Allowance (Base):", IERC20(baseToken).allowance(address(this), vaultAddress));
        console.log("  -> Vault Allowance (Quote):", IERC20(quoteToken).allowance(address(this), vaultAddress));
        console.log("  -> Placing Order Params:");
        console.log("    - baseToken:", baseToken);
        console.log("    - quoteToken:", quoteToken);
        console.log("    - price:", price);
        console.log("    - quantity:", quantity);
        console.log("    - isBuy:", isBuy);
        console.log("    - orderType:", orderType);
        // === END DEBUG LOGS ===

        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));

        // Restore direct placeOrder call
        /* uint256 orderId = */ ICLOB(clob).placeOrder(baseToken, quoteToken, price, quantity, isBuy, orderType);

        // 4. Read the balance of tokenOut received by this adapter *after* the placeOrder call.
        uint256 balanceAfter = IERC20(tokenOut).balanceOf(address(this));
        amountOut = balanceAfter - balanceBefore;

        // 5. Transfer the received tokenOut back to the caller (MockSymphony)
        if (amountOut > 0) {
            console.log("Adapter: Transferring %s of %s back to caller %s", amountOut, tokenOut, msg.sender);
            require(IERC20(tokenOut).transfer(msg.sender, amountOut), "Adapter: Failed to transfer tokenOut to caller");
        }

        return amountOut; // Return the gross amount received from CLOB
    }

    // --- Admin Functions ---
}
