// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./interfaces/IOrderInfo.sol";
import "./interfaces/IState.sol";
import "./interfaces/IBook.sol";
import "./interfaces/IVault.sol";
import "./interfaces/ICLOB.sol";
import "@openzeppelin/contracts/utils/math/Math.sol"; // Added missing import
import "hardhat/console.sol"; // Ensure console is imported

/**
 * @title Central Limit Order Book (CLOB) Contract
 * @dev Manages order placement, cancellation, and settlement with enhanced batch processing
 */
contract CLOB is ICLOB {
    address public admin;
    address public state;
    address public book;
    address public vault;
    address public symphonyAdapter;
    bool public symphonyIntegrationEnabled;

    // Events
    event OrderPlaced(uint256 indexed orderId, address indexed trader, bool isBuy, uint256 price, uint256 quantity);
    event OrderCanceled(uint256 indexed orderId, address indexed trader);
    event OrderMatched(uint256 indexed takerOrderId, uint256 indexed makerOrderId, uint256 price, uint256 quantity);
    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event StateUpdated(address indexed oldState, address indexed newState);
    event BookUpdated(address indexed oldBook, address indexed newBook);
    event VaultUpdated(address indexed oldVault, address indexed newVault);
    event SupportedPairAdded(address indexed baseToken, address indexed quoteToken);
    event SupportedPairRemoved(address indexed baseToken, address indexed quoteToken);
    event SymphonyAdapterUpdated(address indexed oldAdapter, address indexed newAdapter);
    event SymphonyIntegrationStatusChanged(bool enabled);
    event DebugCLOBBeforeMatch(uint256 indexed orderId);

    // Supported trading pairs
    mapping(address => mapping(address => bool)) public supportedPairs;

    // Constants for gas optimization
    uint256 private constant MAX_BATCH_SIZE = 50;

    constructor(
        address _admin,
        address _state,
        address _book,
        address _vault
    ) {
        admin = _admin;
        state = _state;
        book = _book;
        vault = _vault;
        symphonyIntegrationEnabled = false;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "CLOB: caller is not admin");
        _;
    }

    function setAdmin(address _admin) external onlyAdmin {
        address oldAdmin = admin;
        admin = _admin;
        emit AdminUpdated(oldAdmin, _admin);
    }

    function setState(address _state) external onlyAdmin {
        address oldState = state;
        state = _state;
        emit StateUpdated(oldState, _state);
    }

    function setBook(address _book) external onlyAdmin {
        address oldBook = book;
        book = _book;
        emit BookUpdated(oldBook, _book);
    }

    function setVault(address _vault) external onlyAdmin {
        address oldVault = vault;
        vault = _vault;
        emit VaultUpdated(oldVault, _vault);
    }

    function setSymphonyAdapter(address symphonyAdapterAddress) external override onlyAdmin {
        address oldAdapter = symphonyAdapter;
        symphonyAdapter = symphonyAdapterAddress;
        emit SymphonyAdapterUpdated(oldAdapter, symphonyAdapterAddress);
    }

    function setSymphonyIntegrationEnabled(bool enabled) external override onlyAdmin {
        symphonyIntegrationEnabled = enabled;
        emit SymphonyIntegrationStatusChanged(enabled);
    }

    function addSupportedPair(address baseToken, address quoteToken) external override onlyAdmin {
        supportedPairs[baseToken][quoteToken] = true;
        emit SupportedPairAdded(baseToken, quoteToken);
    }

    function removeSupportedPair(address baseToken, address quoteToken) external onlyAdmin {
        supportedPairs[baseToken][quoteToken] = false;
        emit SupportedPairRemoved(baseToken, quoteToken);
    }

    /**
     * @dev Internal function to place and process any order type.
     * Handles order creation, matching, settlement processing, and IOC/FOK cancellation.
     * Returns the final filled amounts.
     */
    function _placeAndProcessOrder(
        address baseToken,
        address quoteToken,
        uint256 price,
        uint256 quantity, // For LIMIT, IOC, FOK, MARKET SELL
        uint256 quoteAmount, // For MARKET BUY
        bool isBuy,
        uint8 orderType
    ) internal returns (uint256 orderId, uint256 finalFilledQuantity, uint256 finalFilledQuoteAmount) {
        require(supportedPairs[baseToken][quoteToken], "CLOB: unsupported trading pair");

        // Input validation based on order type
        if (orderType == uint8(IOrderInfo.OrderType.MARKET)) {
            require(price == 0, "CLOB: Market order price must be 0");
            if (isBuy) {
                require(quoteAmount > 0, "CLOB: Market buy quoteAmount must be > 0");
                require(quantity == 0, "CLOB: Market buy quantity must be 0");
            } else {
                require(quantity > 0, "CLOB: Market sell quantity must be > 0");
                require(quoteAmount == 0, "CLOB: Market sell quoteAmount must be 0");
            }
        } else {
            // LIMIT, IOC, FOK
            require(price > 0, "CLOB: price must be greater than 0");
            require(quantity > 0, "CLOB: quantity must be greater than 0");
            require(quoteAmount == 0, "CLOB: quoteAmount must be 0 for non-market-buy");
        }

        // TODO: Modify State/IOrderInfo to store quoteAmount if needed for market buys
        // For now, pass quantity for market buys as well, Book needs to handle it
        uint256 quantityToCreate = (orderType == uint8(IOrderInfo.OrderType.MARKET) && isBuy) ? type(uint256).max : quantity; // Placeholder for market buy quantity

        orderId = IState(state).createOrder(
            msg.sender,
            baseToken,
            quoteToken,
            price,
            quantityToCreate, // Use modified quantity
            isBuy,
            orderType
            // TODO: Add quoteAmount here if State is modified
        );

        if (orderType == uint8(IOrderInfo.OrderType.LIMIT)) {
            IBook(book).addOrder(orderId);
        }

        emit DebugCLOBBeforeMatch(orderId);
        console.log("CLOB: Before calling book.matchOrders for orderId:", orderId);

        // Call matchOrders, receive settlement count AND maker updates
        uint256 quoteAmountToPass = (orderType == uint8(IOrderInfo.OrderType.MARKET) && isBuy) ? quoteAmount : 0;
        uint256 settlementCount;
        uint256[] memory makerOrderIdsToUpdate; 
        uint8[] memory makerStatusesToUpdate;     
        uint256[] memory makerFilledQuantitiesToUpdate; 

        (settlementCount, makerOrderIdsToUpdate, makerStatusesToUpdate, makerFilledQuantitiesToUpdate) = 
            IBook(book).matchOrders(orderId, quoteAmountToPass);
        
        console.log("CLOB: Book.matchOrders returned settlement count:", settlementCount);
        console.log("CLOB: Book.matchOrders returned maker update count:", makerOrderIdsToUpdate.length);

        // --- Batch update maker statuses BEFORE processing settlements --- //
        if (makerOrderIdsToUpdate.length > 0) {
            console.log("CLOB: Calling State.updateOrderStatusBatch for %s makers...", makerOrderIdsToUpdate.length);
            IState(state).updateOrderStatusBatch(makerOrderIdsToUpdate, makerStatusesToUpdate, makerFilledQuantitiesToUpdate);
            console.log("CLOB: Returned from State.updateOrderStatusBatch.");
        } // else: No maker orders were affected by the match

        IOrderInfo.Settlement[] memory settlementsToProcess; 

        // --- Retrieve settlements (if any) --- 
        if (settlementCount > 0) {
            // Use the renamed function
            settlementsToProcess = IBook(book).retrieveAndClearPendingSettlements(orderId); 
            console.log("CLOB: Retrieved %s settlements.", settlementsToProcess.length);
            // Ensure we actually got settlements if count > 0
            require(settlementsToProcess.length == settlementCount, "CLOB: Settlement count mismatch"); 
        } else {
             console.log("CLOB: No settlements from matchOrders.");
             settlementsToProcess = new IOrderInfo.Settlement[](0);
        }
        
        // --- Process Settlements (if any) via Vault --- //
        uint256 totalFilledBaseForTaker = 0; // Initialize here
        uint256 totalFilledQuoteAmountForReturn = 0; // Renamed to avoid conflict with param
        if (settlementsToProcess.length > 0) {
             console.log("CLOB: Calling Vault to process %s settlements...", settlementsToProcess.length);
             processSettlementsBatched(settlementsToProcess); // Pass the retrieved array

             // --- Calculate total fills AFTER Vault processing --- //
             // Need total base filled by the taker for status update
             // Need total quote spent/received by the taker for return value
             uint8 baseDecimals = 18; // Assume - TODO: Get dynamically?
             IOrderInfo.Order memory tempMakerOrder;
             for(uint i=0; i < settlementsToProcess.length; i++){ 
                 totalFilledBaseForTaker += settlementsToProcess[i].quantity;
                 // Use the *maker* order price from the settlement to calculate quote value
                 // Fetching maker order again is inefficient, but necessary if price isn't in settlement struct
                 tempMakerOrder = IState(state).getOrder(settlementsToProcess[i].makerOrderId);
                 // Ensure tempMakerOrder was actually fetched (might be filled/cancelled between match and here? Unlikely but check)
                 if (tempMakerOrder.id != 0) {
                    totalFilledQuoteAmountForReturn += (settlementsToProcess[i].quantity * tempMakerOrder.price) / (10**baseDecimals); // Simplified
                 } else {
                    // Handle case where maker order is gone - should not happen with current flow
                    console.log("CLOB: Warning - Maker order %s not found during quote calculation.", settlementsToProcess[i].makerOrderId);
                 }
             }
             console.log("CLOB: Calculated totalFilledBaseForTaker: %s", totalFilledBaseForTaker);
             console.log("CLOB: Calculated totalFilledQuoteAmountForReturn: %s", totalFilledQuoteAmountForReturn);
        } // else: total fills remain 0

        // --- Update Taker Status --- //
        IOrderInfo.Order memory currentTakerOrder = IState(state).getOrder(orderId); // Get current taker order info
        IOrderInfo.OrderStatus newTakerStatus = currentTakerOrder.status; // Start with current status
        uint256 finalAmountForStateUpdate = currentTakerOrder.filledQuantity; // Start with current filled amount
        
        bool isMarketBuy = (currentTakerOrder.orderType == IOrderInfo.OrderType.MARKET && currentTakerOrder.isBuy);

        if (totalFilledBaseForTaker > 0) { // If any fill occurred during *this* match attempt
            finalAmountForStateUpdate = currentTakerOrder.filledQuantity + totalFilledBaseForTaker; // Update based on fills from this match

            if (isMarketBuy) {
                // Market buys always become PARTIALLY_FILLED if they fill anything
                newTakerStatus = IOrderInfo.OrderStatus.PARTIALLY_FILLED;
                // Don't cap filled amount for market buy
            } else {
                // For limit, IOC, FOK, Market Sell - compare TOTAL potential filled amount to original quantity
                if (finalAmountForStateUpdate >= currentTakerOrder.quantity) {
                    newTakerStatus = IOrderInfo.OrderStatus.FILLED;
                    // Cap fill amount based on original quantity
                    finalAmountForStateUpdate = currentTakerOrder.quantity; 
                } else {
                    // If total fill is still less than original quantity
                    newTakerStatus = IOrderInfo.OrderStatus.PARTIALLY_FILLED;
                }
            }
            
            // Update Taker Status in State Contract only if status has changed AND current status is not terminal
            if (newTakerStatus != currentTakerOrder.status &&
                currentTakerOrder.status != IOrderInfo.OrderStatus.FILLED &&
                currentTakerOrder.status != IOrderInfo.OrderStatus.CANCELED)
            {
                // Use the calculated finalAmountForStateUpdate and newTakerStatus
                IState(state).updateOrderStatus(orderId, uint8(newTakerStatus), finalAmountForStateUpdate);
                console.log("CLOB: Updated taker %s status to %s, filled %s", orderId, uint8(newTakerStatus), finalAmountForStateUpdate);
            } else if (newTakerStatus == currentTakerOrder.status && 
                       finalAmountForStateUpdate > currentTakerOrder.filledQuantity &&
                       currentTakerOrder.status == IOrderInfo.OrderStatus.PARTIALLY_FILLED) {
                 // Handle case where status remains PARTIALLY_FILLED but filled quantity increased
                 IState(state).updateOrderStatus(orderId, uint8(newTakerStatus), finalAmountForStateUpdate);
                 console.log("CLOB: Updated taker %s filled amount to %s (status remains PARTIALLY_FILLED)", orderId, finalAmountForStateUpdate);
            } else {
                 // Split console log due to argument limit
                 console.log("CLOB: No taker status update needed for order %s.", orderId);
                 console.log("  -> CurrentStatus=%s, NewStatus=%s", uint8(currentTakerOrder.status), uint8(newTakerStatus));
                 console.log("  -> CurrentFilled=%s, NewFilled=%s", currentTakerOrder.filledQuantity, finalAmountForStateUpdate);
            }
        } // If 0 fill, status and filled quantity remain unchanged unless cancelled below

        // --- IOC/FOK Handling --- // 
        currentTakerOrder = IState(state).getOrder(orderId); // Re-fetch taker order AFTER potential status update
        if ((currentTakerOrder.orderType == IOrderInfo.OrderType.IOC || currentTakerOrder.orderType == IOrderInfo.OrderType.FOK) &&
            currentTakerOrder.status != IOrderInfo.OrderStatus.FILLED) { // Check updated status
            // Check if cancellable (redundant check based on above, but safe)
            if (currentTakerOrder.status == IOrderInfo.OrderStatus.OPEN || currentTakerOrder.status == IOrderInfo.OrderStatus.PARTIALLY_FILLED) {
                IBook(book).removeOrder(orderId);
                IState(state).cancelOrder(orderId);
                emit OrderCanceled(orderId, currentTakerOrder.trader);
                 console.log("CLOB: Canceled IOC/FOK order %s", orderId);
            }
        }

        // --- Return Values --- // 
        IOrderInfo.Order memory finalOrder = IState(state).getOrder(orderId);
        finalFilledQuantity = finalOrder.filledQuantity; // Use final state from State contract
        finalFilledQuoteAmount = totalFilledQuoteAmountForReturn; // Use the amount calculated after processing settlements

        emit OrderPlaced(orderId, msg.sender, isBuy, price, quantity); // Emit original requested quantity
        return (orderId, finalFilledQuantity, finalFilledQuoteAmount);
    }

    // --- Public placeOrder functions --- 

    /**
     * @notice Places a limit order.
     * @dev Wrapper around _placeAndProcessOrder for LIMIT order type.
     *      Implements ICLOB interface.
     * @param baseToken The base token address.
     * @param quoteToken The quote token address.
     * @param isBuy True for a buy order, false for a sell order.
     * @param price The limit price (in quote tokens per base token, scaled by quote decimals).
     * @param quantity The quantity of base tokens to trade.
     * @return orderId The ID of the newly created order.
     * @return finalFilledQuantity The final filled base quantity after initial matching.
     * @return finalFilledQuoteAmount The final filled quote amount after initial matching.
     */
     function placeLimitOrder(
        address baseToken,
        address quoteToken,
        bool isBuy,
        uint256 price,
        uint256 quantity
    ) external returns (uint256 orderId, uint256 finalFilledQuantity, uint256 finalFilledQuoteAmount) {
       (orderId, finalFilledQuantity, finalFilledQuoteAmount) = _placeAndProcessOrder(baseToken, quoteToken, price, quantity, 0, isBuy, uint8(IOrderInfo.OrderType.LIMIT));
    }

    /**
     * @notice Places a market order.
     * @dev Wrapper around _placeAndProcessOrder for MARKET order type.
     *      Implements ICLOB interface.
     * @param baseToken The base token address.
     * @param quoteToken The quote token address.
     * @param isBuy True for a buy order, false for a sell order.
     * @param quantity The quantity of base tokens to sell (only for market sell orders).
     * @param quoteAmount The amount of quote tokens to spend (only for market buy orders).
     * @return filledQuantity The total quantity of base token filled
     * @return filledQuoteAmount The total amount of quote token filled
     */
    function placeMarketOrder(
        address baseToken,
        address quoteToken,
        bool isBuy,
        uint256 quantity, // Used for SELL
        uint256 quoteAmount // Used for BUY
    ) external override returns (uint256 filledQuantity, uint256 filledQuoteAmount) {
         (uint256 orderId, uint256 finalFilledQuantity, uint256 finalFilledQuoteAmount) = 
            _placeAndProcessOrder(baseToken, quoteToken, 0, quantity, quoteAmount, isBuy, uint8(IOrderInfo.OrderType.MARKET));
         // Ensure the return values match the ICLOB interface expectation
         filledQuantity = finalFilledQuantity;
         filledQuoteAmount = finalFilledQuoteAmount;
         // Suppress unused variable warning for orderId if needed
         orderId = orderId;
    }

    /**
     * @notice Places an Immediate-Or-Cancel (IOC) order.
     * @dev Wrapper around _placeAndProcessOrder for IOC order type.
     *      Any part of the order that cannot be filled immediately is canceled.
     * @param baseToken The base token address.
     * @param quoteToken The quote token address.
     * @param isBuy True for a buy order, false for a sell order.
     * @param price The limit price (in quote tokens per base token, scaled by quote decimals).
     * @param quantity The quantity of base tokens to trade.
     * @return orderId The ID of the newly created order.
     * @return finalFilledQuantity The final filled base quantity after initial matching.
     * @return finalFilledQuoteAmount The final filled quote amount after initial matching.
     */
     function placeIOC(
        address baseToken,
        address quoteToken,
        bool isBuy,
        uint256 price,
        uint256 quantity
    ) external returns (uint256 orderId, uint256 finalFilledQuantity, uint256 finalFilledQuoteAmount) {
        (orderId, finalFilledQuantity, finalFilledQuoteAmount) = _placeAndProcessOrder(baseToken, quoteToken, price, quantity, 0, isBuy, uint8(IOrderInfo.OrderType.IOC));
    }

     /**
     * @notice Places a Fill-Or-Kill (FOK) order.
     * @dev Wrapper around _placeAndProcessOrder for FOK order type.
     *      The entire order must be filled immediately, otherwise it is canceled.
     * @param baseToken The base token address.
     * @param quoteToken The quote token address.
     * @param isBuy True for a buy order, false for a sell order.
     * @param price The limit price (in quote tokens per base token, scaled by quote decimals).
     * @param quantity The quantity of base tokens to trade.
     * @return orderId The ID of the newly created order.
     * @return finalFilledQuantity The final filled base quantity after initial matching (will be 0 or quantity).
     * @return finalFilledQuoteAmount The final filled quote amount after initial matching.
     */
     function placeFOK(
        address baseToken,
        address quoteToken,
        bool isBuy,
        uint256 price,
        uint256 quantity
    ) external returns (uint256 orderId, uint256 finalFilledQuantity, uint256 finalFilledQuoteAmount) {
        (orderId, finalFilledQuantity, finalFilledQuoteAmount) = _placeAndProcessOrder(baseToken, quoteToken, price, quantity, 0, isBuy, uint8(IOrderInfo.OrderType.FOK));
    }

    function cancelOrder(uint256 orderId) external override {
        IOrderInfo.Order memory order = IState(state).getOrder(orderId);
        require(order.id == orderId, "CLOB: order does not exist");
        require(
            order.status == IOrderInfo.OrderStatus.OPEN ||
            order.status == IOrderInfo.OrderStatus.PARTIALLY_FILLED,
            "CLOB: order is not open or partially filled"
        );
        require(order.trader == msg.sender, "CLOB: caller is not the trader");

        IBook(book).removeOrder(orderId);
        IState(state).cancelOrder(orderId);
        emit OrderCanceled(orderId, msg.sender);
    }

    function getOrder(uint256 orderId) external view override returns (IOrderInfo.Order memory) {
        return IState(state).getOrder(orderId);
    }

    function getComponents() external view override returns (address, address, address) {
        return (book, state, vault);
    }

    function isSupportedPair(address baseToken, address quoteToken) external view override returns (bool) {
        return supportedPairs[baseToken][quoteToken];
    }

    // Updated processOrder to use new settlement flow
    function processOrder(uint256 orderId) external returns (uint256) {
        IOrderInfo.Order memory order = IState(state).getOrder(orderId);
        require(order.id == orderId, "CLOB: order does not exist");

        // Call matchOrders, receive settlement count AND maker updates
        uint256 settlementCount;
        uint256[] memory makerOrderIdsToUpdate; 
        uint8[] memory makerStatusesToUpdate;     
        uint256[] memory makerFilledQuantitiesToUpdate; 

        // Pass 0 for quoteAmount limit when manually processing an order
        (settlementCount, makerOrderIdsToUpdate, makerStatusesToUpdate, makerFilledQuantitiesToUpdate) = 
            IBook(book).matchOrders(orderId, 0);

        console.log("CLOB(processOrder): Book.matchOrders returned settlement count:", settlementCount);
        console.log("CLOB(processOrder): Book.matchOrders returned maker update count:", makerOrderIdsToUpdate.length);

        // Batch update maker statuses first
        if (makerOrderIdsToUpdate.length > 0) {
            console.log("CLOB(processOrder): Calling State.updateOrderStatusBatch for %s makers...", makerOrderIdsToUpdate.length);
            IState(state).updateOrderStatusBatch(makerOrderIdsToUpdate, makerStatusesToUpdate, makerFilledQuantitiesToUpdate);
            console.log("CLOB(processOrder): Returned from State.updateOrderStatusBatch.");
        }

        if (settlementCount > 0) {
            // Use the renamed function
            IOrderInfo.Settlement[] memory settlements = IBook(book).retrieveAndClearPendingSettlements(orderId);
            console.log("CLOB(processOrder): Retrieved settlements count:", settlements.length);
            if (settlements.length > 0) {
                processSettlementsBatched(settlements);
            } else {
                 console.log("CLOB(processOrder): Warning - retrieveAndClearPendingSettlements returned empty array despite count > 0");
            }
        }
        // Taker status update for manually processed orders (if needed)
        // This might be complex as the trigger isn't a specific taker order placement
        // For now, rely on the maker updates from matchOrders

        return settlementCount; // Return the count reported by matchOrders
    }

    function getOrderBook(
        address baseToken,
        address quoteToken,
        uint256 levels
    ) external view override returns (
        uint256[] memory bidPrices,
        uint256[] memory bidQuantities,
        uint256[] memory askPrices,
        uint256[] memory askQuantities
    ) {
        require(supportedPairs[baseToken][quoteToken], "CLOB: unsupported trading pair");
        // Renamed local variables to avoid shadowing return variables
        uint256[] memory localBidPrices = IBook(book).getBuyPrices();
        uint256[] memory localBidQuantities = new uint256[](localBidPrices.length);
        for (uint256 i = 0; i < localBidPrices.length; i++) {
            localBidQuantities[i] = IBook(book).getBuyLevelTotalQuantity(localBidPrices[i]);
        }

        uint256[] memory localAskPrices = IBook(book).getSellPrices();
        uint256[] memory localAskQuantities = new uint256[](localAskPrices.length);
        for (uint256 i = 0; i < localAskPrices.length; i++) {
            localAskQuantities[i] = IBook(book).getSellLevelTotalQuantity(localAskPrices[i]);
        }

        // Assign to return variables
        bidPrices = localBidPrices;
        bidQuantities = localBidQuantities;
        askPrices = localAskPrices;
        askQuantities = localAskQuantities;

        // Explicit return statement (optional but good practice)
        return (bidPrices, bidQuantities, askPrices, askQuantities);
    }

    function processSettlementsBatched(IOrderInfo.Settlement[] memory settlements) internal {
        uint256 numSettlements = settlements.length;
        if (numSettlements == 0) {
            return;
        }

        uint256 batchCount = (numSettlements + MAX_BATCH_SIZE - 1) / MAX_BATCH_SIZE;
        console.log("CLOB: Calculated batch count:", batchCount);

        for (uint256 i = 0; i < batchCount; i++) {
            uint256 startIndex = i * MAX_BATCH_SIZE;
            uint256 endIndex = Math.min(startIndex + MAX_BATCH_SIZE, numSettlements);
            uint256 batchSize = endIndex - startIndex;
            console.log("CLOB: Processing batch index:", i, "Size:", batchSize);

            IOrderInfo.Settlement[] memory batch = new IOrderInfo.Settlement[](batchSize);
            for (uint256 j = 0; j < batchSize; j++) {
                batch[j] = settlements[startIndex + j];
            }

            console.log("CLOB: Calling Vault.processSettlements for batch", i);
            IVault(vault).processSettlements(batch);
            console.log("CLOB: Returned from Vault.processSettlements for batch", i);
        }
        console.log("CLOB: Exiting processSettlementsBatched");
    }
}

