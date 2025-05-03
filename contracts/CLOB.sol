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

    function placeOrder(
        address baseToken,
        address quoteToken,
        uint256 price,
        uint256 quantity,
        bool isBuy,
        uint8 orderType
    ) public override returns (uint256) {
        require(supportedPairs[baseToken][quoteToken], "CLOB: unsupported trading pair");
        require(quantity > 0, "CLOB: quantity must be greater than 0");

        if (orderType != uint8(IOrderInfo.OrderType.MARKET)) {
            require(price > 0, "CLOB: price must be greater than 0");
        }

        uint256 orderId = IState(state).createOrder(
            msg.sender,
            baseToken,
            quoteToken,
            price,
            quantity,
            isBuy,
            orderType
        );

        if (orderType == uint8(IOrderInfo.OrderType.LIMIT)) {
            IBook(book).addOrder(orderId);
        }

        emit DebugCLOBBeforeMatch(orderId);
        console.log("CLOB: Before calling book.matchOrders for orderId:", orderId);

        // Call matchOrders, get settlement count
        uint256 settlementCount = IBook(book).matchOrders(orderId);
        console.log("CLOB: Book.matchOrders returned settlement count:", settlementCount);

        if (settlementCount > 0) {
            console.log("CLOB: Found settlements, calling getPendingSettlements...");
            // Retrieve settlements using the new function
            IOrderInfo.Settlement[] memory settlements = IBook(book).getPendingSettlements(orderId);
            console.log("CLOB: Retrieved settlements count:", settlements.length);

            if (settlements.length > 0) { // Double check retrieved length
                 console.log("CLOB: Calling processSettlementsBatched...");
                processSettlementsBatched(settlements);
                // Emit OrderMatched event for each settlement
                for (uint256 i = 0; i < settlements.length; i++) {
                    emit OrderMatched(
                        settlements[i].takerOrderId,
                        settlements[i].makerOrderId,
                        settlements[i].price,
                        settlements[i].quantity
                    );
                }
            } else {
                 console.log("CLOB: Warning - getPendingSettlements returned empty array despite count > 0");
            }
        } else {
            console.log("CLOB: No settlements to process.");
        }

        // --- IOC/FOK Handling: Cancel if not fully filled ---
        IOrderInfo.Order memory currentOrder = IState(state).getOrder(orderId);
        if ((currentOrder.orderType == IOrderInfo.OrderType.IOC || currentOrder.orderType == IOrderInfo.OrderType.FOK) &&
            currentOrder.status != IOrderInfo.OrderStatus.FILLED) {
            if (currentOrder.status == IOrderInfo.OrderStatus.OPEN || currentOrder.status == IOrderInfo.OrderStatus.PARTIALLY_FILLED) {
                IBook(book).removeOrder(orderId);
                IState(state).cancelOrder(orderId);
                emit OrderCanceled(orderId, currentOrder.trader);
            }
        }
        // --- End IOC/FOK Handling ---

        emit OrderPlaced(orderId, msg.sender, isBuy, price, quantity);
        return orderId;
    }

    // --- Other placeOrder variants --- 

    function placeLimitOrder(
        address baseToken,
        address quoteToken,
        bool isBuy,
        uint256 price,
        uint256 quantity
    ) external returns (uint256) {
        return placeOrder(baseToken, quoteToken, price, quantity, isBuy, uint8(IOrderInfo.OrderType.LIMIT));
    }

    function placeMarketOrder(
        address baseToken,
        address quoteToken,
        bool isBuy,
        uint256 quantity
    ) external returns (uint256) {
        return placeOrder(baseToken, quoteToken, 0, quantity, isBuy, uint8(IOrderInfo.OrderType.MARKET));
    }

    function placeIOCOrder(
        address baseToken,
        address quoteToken,
        bool isBuy,
        uint256 price,
        uint256 quantity
    ) external returns (uint256) {
        return placeOrder(baseToken, quoteToken, price, quantity, isBuy, uint8(IOrderInfo.OrderType.IOC));
    }

    // Updated placeFOKOrder to use new settlement flow
    function placeFOKOrder(
        address baseToken,
        address quoteToken,
        bool isBuy,
        uint256 price,
        uint256 quantity
    ) external returns (uint256) {
        require(supportedPairs[baseToken][quoteToken], "CLOB: unsupported trading pair");
        require(price > 0, "CLOB: price must be greater than 0");
        require(quantity > 0, "CLOB: quantity must be greater than 0");

        uint256 orderId = IState(state).createOrder(
            msg.sender,
            baseToken,
            quoteToken,
            price,
            quantity,
            isBuy,
            uint8(IOrderInfo.OrderType.FOK)
        );

        (bool canBeFilled, ) = IBook(book).canOrderBeFullyFilled(orderId);
        if (!canBeFilled) {
            IState(state).updateOrderStatus(orderId, uint8(IOrderInfo.OrderStatus.CANCELED), 0);
            emit OrderPlaced(orderId, msg.sender, isBuy, price, quantity);
            return orderId;
        }

        IBook(book).addOrder(orderId);

        uint256 settlementCount = IBook(book).matchOrders(orderId);
        console.log("CLOB(FOK): Book.matchOrders returned settlement count:", settlementCount);

        if (settlementCount > 0) {
            IOrderInfo.Settlement[] memory settlements = IBook(book).getPendingSettlements(orderId);
            console.log("CLOB(FOK): Retrieved settlements count:", settlements.length);
            if (settlements.length > 0) {
                processSettlementsBatched(settlements);
            } else {
                 console.log("CLOB(FOK): Warning - getPendingSettlements returned empty array");
            }
        } else {
            console.log("CLOB(FOK): No settlements found after match.");
        }
        emit OrderPlaced(orderId, msg.sender, isBuy, price, quantity);
        return orderId;
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

        uint256 settlementCount = IBook(book).matchOrders(orderId);
        console.log("CLOB(processOrder): Book.matchOrders returned settlement count:", settlementCount);

        if (settlementCount > 0) {
            IOrderInfo.Settlement[] memory settlements = IBook(book).getPendingSettlements(orderId);
            console.log("CLOB(processOrder): Retrieved settlements count:", settlements.length);
            if (settlements.length > 0) {
                processSettlementsBatched(settlements);
            } else {
                 console.log("CLOB(processOrder): Warning - getPendingSettlements returned empty array");
            }
        }
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
        uint256[] memory allBuyPrices = IBook(book).getBuyPrices();
        uint256[] memory allSellPrices = IBook(book).getSellPrices();

        uint256 numBidLevels = allBuyPrices.length < levels ? allBuyPrices.length : levels;
        uint256 numAskLevels = allSellPrices.length < levels ? allSellPrices.length : levels;

        bidPrices = new uint256[](numBidLevels);
        bidQuantities = new uint256[](numBidLevels);
        askPrices = new uint256[](numAskLevels);
        askQuantities = new uint256[](numAskLevels);

        // Simplified logic - assumes prices are sorted correctly by Book
        for (uint256 i = 0; i < numBidLevels; i++) {
            bidPrices[i] = allBuyPrices[i];
            bidQuantities[i] = IBook(book).getQuantityAtPrice(bidPrices[i], true);
        }
        for (uint256 i = 0; i < numAskLevels; i++) {
            askPrices[i] = allSellPrices[i];
            askQuantities[i] = IBook(book).getQuantityAtPrice(askPrices[i], false);
        }

        return (bidPrices, bidQuantities, askPrices, askQuantities);
    }

    function processSettlementsBatched(IOrderInfo.Settlement[] memory settlements) internal {
        uint256 numSettlements = settlements.length;
        if (numSettlements == 0) {
            return;
        }

        uint256 batchCount = (numSettlements + MAX_BATCH_SIZE - 1) / MAX_BATCH_SIZE;
        console.log("CLOB: Calculated batch count:", batchCount);

        for (uint256 batchIndex = 0; batchIndex < batchCount; batchIndex++) {
            uint256 startIndex = batchIndex * MAX_BATCH_SIZE;
            uint256 endIndex = Math.min(startIndex + MAX_BATCH_SIZE, numSettlements);
            uint256 batchSize = endIndex - startIndex;
            console.log("CLOB: Processing batch index:", batchIndex, "Size:", batchSize);

            IOrderInfo.Settlement[] memory batchSettlements = new IOrderInfo.Settlement[](batchSize);
            for (uint256 i = 0; i < batchSize; i++) {
                batchSettlements[i] = settlements[startIndex + i];
            }

            console.log("CLOB: Calling Vault.processSettlements for batch", batchIndex);
            IVault(vault).processSettlements(batchSettlements);
            console.log("CLOB: Returned from Vault.processSettlements for batch", batchIndex);
        }
        console.log("CLOB: Exiting processSettlementsBatched");
    }
}

