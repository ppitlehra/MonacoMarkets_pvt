// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IOrderInfo.sol";
import "./interfaces/IState.sol";
import "./interfaces/IBook.sol";
import "./libraries/OrderMatchingHelpers.sol";
import "hardhat/console.sol"; // Ensure console is imported

/**
 * @title Optimized Book Contract for SEI CLOB
 * @dev This implementation includes gas optimizations and SEI-specific parallelization enhancements
 */
contract Book is IBook {
    address public admin;
    address public state;
    address public vault;
    address public baseToken;
    address public quoteToken;
    address public clob;

    // Events
    event OrderAdded(uint256 indexed orderId, uint256 price, uint256 quantity, bool isBuy);
    event OrderRemoved(uint256 indexed orderId, uint256 price, uint256 quantity, bool isBuy);
    event OrderMatched(uint256 indexed takerOrderId, uint256 indexed makerOrderId, uint256 price, uint256 quantity);
    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event CLOBUpdated(address indexed oldCLOB, address indexed newCLOB);
    event VaultUpdated(address indexed oldVault, address indexed newVault);
    event DebugProcessOrder(uint256 indexed makerOrderId, uint256 index); // ADDED FOR DEBUGGING
    event DebugBookEnteringMatch(uint256 indexed orderId); // ADDED debug event

    // Constants
    uint256 private constant MAX_SETTLEMENTS = 200;
    uint256 private constant MAX_BATCH_SIZE = 50;
    uint256 private constant MIN_SETTLEMENTS = 20; // Increased from 10
    uint256 private constant PRICE_DECIMALS = 10**18;

    struct PriceLevel {
        uint256 totalQuantity;
        uint256[] orderIds;
        mapping(uint256 => uint256) orderQuantities;
        mapping(uint256 => uint256) orderIndexes;
    }

    mapping(uint256 => PriceLevel) private buyLevels;
    mapping(uint256 => PriceLevel) private sellLevels;

    uint256[] private buyPrices; // Descending order
    uint256[] private sellPrices; // Ascending order

    mapping(uint256 => uint256) private priceCache;
    mapping(address => mapping(address => uint256)) private averageMatchSizes;

    // Storage for pending settlements
    mapping(uint256 => IOrderInfo.Settlement[]) private pendingSettlements;

    constructor(
        address _admin,
        address _state,
        address _baseToken,
        address _quoteToken
    ) {
        admin = _admin;
        state = _state;
        baseToken = _baseToken;
        quoteToken = _quoteToken;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Book: caller is not admin");
        _;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "Book: caller is not vault");
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == admin ||
            msg.sender == vault ||
            msg.sender == clob,
            "Book: caller is not authorized"
        );
        _;
    }

    function setAdmin(address _admin) external onlyAdmin {
        address oldAdmin = admin;
        admin = _admin;
        emit AdminUpdated(oldAdmin, _admin);
    }

    function setCLOB(address _clob) external onlyAdmin {
        address oldCLOB = clob;
        clob = _clob;
        emit CLOBUpdated(oldCLOB, _clob);
    }

    function setVault(address _vault) external override onlyAdmin {
        address oldVault = vault;
        vault = _vault;
        emit VaultUpdated(oldVault, _vault);
    }

    function addOrder(uint256 orderId) external override onlyAuthorized {
        IOrderInfo.Order memory order = IState(state).getOrder(orderId);
        require(
            order.status == IOrderInfo.OrderStatus.OPEN ||
            order.status == IOrderInfo.OrderStatus.PARTIALLY_FILLED,
            "Book: order is not open or partially filled"
        );
        uint256 remainingQuantity = order.quantity - order.filledQuantity;
        require(remainingQuantity > 0, "Book: order has no remaining quantity");
        priceCache[orderId] = order.price;
        if (order.isBuy) {
            addToBuyLevel(order.price, orderId, remainingQuantity);
        } else {
            addToSellLevel(order.price, orderId, remainingQuantity);
        }
        emit OrderAdded(orderId, order.price, remainingQuantity, order.isBuy);
    }

    function removeOrder(uint256 orderId) external override onlyAuthorized {
        IOrderInfo.Order memory order = IState(state).getOrder(orderId);
        uint256 price = priceCache[orderId] > 0 ? priceCache[orderId] : order.price;
        if (order.isBuy) {
            removeFromBuyLevel(price, orderId);
        } else {
            removeFromSellLevel(price, orderId);
        }
        delete priceCache[orderId];
        emit OrderRemoved(orderId, price, 0, order.isBuy);
    }

    function canOrderBeFullyFilled(uint256 orderId) external view override returns (bool, uint256) {
        IOrderInfo.Order memory order = IState(state).getOrder(orderId);
        require(order.id == orderId, "Book: order does not exist");
        uint256 remainingQuantity = order.quantity - order.filledQuantity;
        uint256 fillableQuantity = 0;
        if (order.isBuy) {
            for (uint256 i = 0; i < sellPrices.length; i++) {
                uint256 price = sellPrices[i];
                if (order.orderType != IOrderInfo.OrderType.MARKET && price > order.price) break;
                fillableQuantity += sellLevels[price].totalQuantity;
                if (fillableQuantity >= remainingQuantity) return (true, remainingQuantity);
            }
        } else {
            for (uint256 i = 0; i < buyPrices.length; i++) {
                uint256 price = buyPrices[i];
                if (order.orderType != IOrderInfo.OrderType.MARKET && price < order.price) break;
                fillableQuantity += buyLevels[price].totalQuantity;
                if (fillableQuantity >= remainingQuantity) return (true, remainingQuantity);
            }
        }
        return (false, fillableQuantity);
    }

    // Updated matchOrders to return count and store settlements
    function matchOrders(uint256 orderId) external override returns (uint256 settlementCount) {
        IOrderInfo.Order memory order = IState(state).getOrder(orderId);
        require(order.id == orderId, "Book: order does not exist");

        // Clear any previous pending settlements for this order ID
        delete pendingSettlements[orderId];

        IOrderInfo.Settlement[] memory settlements;
        uint256 remainingQuantity; // This will be updated by _matchOrders
        (settlements, remainingQuantity) = _matchOrders(order);

        settlementCount = settlements.length;
        console.log("Book.matchOrders: Found settlements count:", settlementCount);

        if (settlementCount > 0) {
            // Store the generated settlements
            pendingSettlements[orderId] = settlements;
        }

        return settlementCount;
    }

    // New function to retrieve and clear pending settlements
    function getPendingSettlements(uint256 takerOrderId) external override returns (IOrderInfo.Settlement[] memory settlements) {
        // Ensure caller is authorized (e.g., CLOB contract)
        require(msg.sender == clob, "Book: Caller is not the CLOB contract");

        settlements = pendingSettlements[takerOrderId];

        // Clear the stored settlements after retrieval
        delete pendingSettlements[takerOrderId];

        console.log("Book.getPendingSettlements: Returning settlements count:", settlements.length);
        return settlements;
    }

    // Internal _matchOrders remains largely the same, returning the settlements array
    function _matchOrders(
        IOrderInfo.Order memory order
    ) internal returns (IOrderInfo.Settlement[] memory, uint256) {

        uint256 initialFilledQuantity = order.filledQuantity;
        uint256 remainingQuantity = order.quantity - initialFilledQuantity;
        uint256 totalSettlementCount = 0;
        uint256 maxPossibleSettlements = estimateMaxSettlements(order);
        IOrderInfo.Settlement[] memory allSettlements = new IOrderInfo.Settlement[](maxPossibleSettlements);

        if (order.orderType == IOrderInfo.OrderType.MARKET) {
            (totalSettlementCount, remainingQuantity) = matchMarketOrder(order, remainingQuantity, allSettlements);
        } else {
            uint256 batchCount = 0;
            uint256 maxBatches = 20;
            while (remainingQuantity > 0 && totalSettlementCount < maxPossibleSettlements && batchCount < maxBatches) {
                IOrderInfo.Settlement[] memory batchSettlements = new IOrderInfo.Settlement[](MAX_BATCH_SIZE);
                uint256 batchSettlementCount = 0;
                if (order.isBuy) {
                    (batchSettlementCount, remainingQuantity) = matchBuyOrder(order, remainingQuantity, batchSettlements);
                } else {
                    (batchSettlementCount, remainingQuantity) = matchSellOrder(order, remainingQuantity, batchSettlements);
                }
                if (batchSettlementCount == 0) {
                    break;
                }
                for (uint256 i = 0; i < batchSettlementCount; i++) {
                    if (totalSettlementCount < maxPossibleSettlements) {
                        allSettlements[totalSettlementCount] = batchSettlements[i];
                        totalSettlementCount++;
                    }
                }
                if (order.isBuy) {
                    uint256 bestAskPrice = this.getBestAskPrice();
                    if (sellPrices.length == 0 || (order.price > 0 && bestAskPrice > order.price)) { // Check price only if limit order
                        break;
                    }
                } else {
                    uint256 bestBidPrice = this.getBestBidPrice();
                    if (buyPrices.length == 0 || (order.price > 0 && bestBidPrice < order.price)) { // Check price only if limit order
                        break;
                    }
                }
                batchCount++;
            }
        }

        uint256 totalFilledDuringMatch = (order.quantity - initialFilledQuantity) - remainingQuantity;
        updateTakerOrderStatus(order, initialFilledQuantity + totalFilledDuringMatch);
        updateAverageMatchSize(order.baseToken, order.quoteToken, totalFilledDuringMatch, totalSettlementCount);

        IOrderInfo.Settlement[] memory finalSettlements = new IOrderInfo.Settlement[](totalSettlementCount);
        for (uint256 i = 0; i < totalSettlementCount; i++) {
            finalSettlements[i] = allSettlements[i];
        }
        console.log("Book._matchOrders internal: Returning settlements count:", totalSettlementCount);
        return (finalSettlements, remainingQuantity);
    }

    function matchMarketOrder(
        IOrderInfo.Order memory order,
        uint256 remainingQuantity,
        IOrderInfo.Settlement[] memory settlements // This is the pre-allocated array from _matchOrders
    ) internal returns (uint256 totalSettlementCount, uint256 finalRemainingQuantity) {
        totalSettlementCount = 0;
        finalRemainingQuantity = remainingQuantity;
        uint256 batchCount = 0;
        uint256 maxBatches = 20;

        while (finalRemainingQuantity > 0 && totalSettlementCount < settlements.length && batchCount < maxBatches) {
            IOrderInfo.Settlement[] memory batchSettlements = new IOrderInfo.Settlement[](MAX_BATCH_SIZE);
            uint256 batchSettlementCount = 0;

            if (order.isBuy) {
                if (sellPrices.length == 0) break; // No more asks
                (batchSettlementCount, finalRemainingQuantity) = matchBuyOrder(order, finalRemainingQuantity, batchSettlements);
            } else {
                if (buyPrices.length == 0) break; // No more bids
                (batchSettlementCount, finalRemainingQuantity) = matchSellOrder(order, finalRemainingQuantity, batchSettlements);
            }

            if (batchSettlementCount == 0) break; // No matches in this batch

            // Copy batch results into the main settlements array
            for (uint256 i = 0; i < batchSettlementCount; i++) {
                if (totalSettlementCount < settlements.length) {
                    settlements[totalSettlementCount] = batchSettlements[i];
                    totalSettlementCount++;
                }
            }
            batchCount++;
        }
        return (totalSettlementCount, finalRemainingQuantity);
    }

    function matchBuyOrder(
        IOrderInfo.Order memory takerOrder,
        uint256 remainingTakerQty,
        IOrderInfo.Settlement[] memory settlements // Array to populate
    ) internal returns (uint256 settlementsCreated, uint256 finalRemainingTakerQty) {
        settlementsCreated = 0;
        finalRemainingTakerQty = remainingTakerQty;
        uint256 priceLevelIndex = 0;

        while (priceLevelIndex < sellPrices.length && finalRemainingTakerQty > 0 && settlementsCreated < settlements.length) {
            uint256 price = sellPrices[priceLevelIndex];

            // If limit order, check price constraint
            if (takerOrder.orderType != IOrderInfo.OrderType.MARKET && price > takerOrder.price) {
                break; // Price too high for taker
            }

            PriceLevel storage level = sellLevels[price];
            uint256 orderIndex = 0;
            uint256 ordersToRemoveCount = 0;
            uint256[] memory ordersToRemoveIndices = new uint256[](level.orderIds.length); // Max possible removals

            while (orderIndex < level.orderIds.length && finalRemainingTakerQty > 0 && settlementsCreated < settlements.length) {
                uint256 makerOrderId = level.orderIds[orderIndex];
                uint256 newRemainingTakerQty;
                uint256 batchSettlementsCreated;
                bool removeMaker;

                (newRemainingTakerQty, batchSettlementsCreated, removeMaker) = _processMakerOrderBuy(
                    takerOrder,
                    makerOrderId,
                    price,
                    level,
                    finalRemainingTakerQty,
                    settlements, // Pass the main array
                    settlementsCreated // Pass current count
                );

                finalRemainingTakerQty = newRemainingTakerQty;
                settlementsCreated += batchSettlementsCreated;

                if (removeMaker) {
                    ordersToRemoveIndices[ordersToRemoveCount] = orderIndex;
                    ordersToRemoveCount++;
                }
                orderIndex++;
            }

            // Remove filled/invalid orders from the level efficiently (process removals in reverse index order)
            for (uint256 i = ordersToRemoveCount; i > 0; i--) {
                removeOrderFromLevel(level, ordersToRemoveIndices[i - 1]);
            }

            // If level is now empty, remove price from sorted list
            if (level.orderIds.length == 0) {
                removeSorted(sellPrices, price, true);
                // Do not increment priceLevelIndex, as the next price shifts into the current index
            } else {
                priceLevelIndex++; // Move to the next price level
            }
        }
        console.log("Book.matchBuyOrder: Returning settlementsCreated=", settlementsCreated);
        return (settlementsCreated, finalRemainingTakerQty);
    }

    function matchSellOrder(
        IOrderInfo.Order memory takerOrder,
        uint256 remainingTakerQty,
        IOrderInfo.Settlement[] memory settlements // Array to populate
    ) internal returns (uint256 settlementsCreated, uint256 finalRemainingTakerQty) {
        settlementsCreated = 0;
        finalRemainingTakerQty = remainingTakerQty;
        uint256 priceLevelIndex = 0;

        while (priceLevelIndex < buyPrices.length && finalRemainingTakerQty > 0 && settlementsCreated < settlements.length) {
            uint256 price = buyPrices[priceLevelIndex];

            // If limit order, check price constraint
            if (takerOrder.orderType != IOrderInfo.OrderType.MARKET && price < takerOrder.price) {
                break; // Price too low for taker
            }

            PriceLevel storage level = buyLevels[price];
            uint256 orderIndex = 0;
            uint256 ordersToRemoveCount = 0;
            uint256[] memory ordersToRemoveIndices = new uint256[](level.orderIds.length);

            while (orderIndex < level.orderIds.length && finalRemainingTakerQty > 0 && settlementsCreated < settlements.length) {
                uint256 makerOrderId = level.orderIds[orderIndex];
                uint256 newRemainingTakerQty;
                uint256 batchSettlementsCreated;
                bool removeMaker;

                (newRemainingTakerQty, batchSettlementsCreated, removeMaker) = _processMakerOrderSell(
                    takerOrder,
                    makerOrderId,
                    price,
                    level,
                    finalRemainingTakerQty,
                    settlements, // Pass the main array
                    settlementsCreated // Pass current count
                );

                finalRemainingTakerQty = newRemainingTakerQty;
                settlementsCreated += batchSettlementsCreated;

                if (removeMaker) {
                    ordersToRemoveIndices[ordersToRemoveCount] = orderIndex;
                    ordersToRemoveCount++;
                }
                orderIndex++;
            }

            // Remove filled/invalid orders
            for (uint256 i = ordersToRemoveCount; i > 0; i--) {
                removeOrderFromLevel(level, ordersToRemoveIndices[i - 1]);
            }

            // If level is empty, remove price
            if (level.orderIds.length == 0) {
                removeSorted(buyPrices, price, false);
            } else {
                priceLevelIndex++;
            }
        }
        console.log("Book.matchSellOrder: Returning settlementsCreated=", settlementsCreated);
        return (settlementsCreated, finalRemainingTakerQty);
    }

    // --- Refactored Helper for Stack Depth --- 
    function _processMakerOrderBuy(
        IOrderInfo.Order memory takerOrder,
        uint256 makerOrderId,
        uint256 price,
        PriceLevel storage level,
        uint256 currentRemainingTakerQty,
        IOrderInfo.Settlement[] memory settlements,
        uint256 currentSettlementCount
    ) internal returns (uint256 newRemainingTakerQty, uint256 settlementsCreated, bool removeMaker) {
        console.log("Book._processMakerOrderBuy: TakerOrderId=%d, MakerOrderId=%d", takerOrder.id, makerOrderId);
        IOrderInfo.Order memory makerOrder = IState(state).getOrder(makerOrderId);
        removeMaker = false;
        settlementsCreated = 0;
        newRemainingTakerQty = currentRemainingTakerQty;

        console.log("Book._processMakerOrderBuy: Checking self-trade. Taker=%s, Maker=%s", takerOrder.trader, makerOrder.trader);
        if (takerOrder.trader == makerOrder.trader) {
            console.log("Book._processMakerOrderBuy: SELF-TRADE DETECTED! Skipping.");
            return (newRemainingTakerQty, 0, false);
        }

        console.log("Book._processMakerOrderBuy: Checking maker status. MakerStatus=%d (OPEN=0, PARTIALLY_FILLED=1)", uint8(makerOrder.status));
        if (makerOrder.status != IOrderInfo.OrderStatus.OPEN && makerOrder.status != IOrderInfo.OrderStatus.PARTIALLY_FILLED) {
            console.log("Book._processMakerOrderBuy: Maker status invalid! Skipping.");
            removeMaker = true;
            return (newRemainingTakerQty, settlementsCreated, removeMaker);
        }

        uint256 makerInitialFilled = makerOrder.filledQuantity;
        uint256 makerRemainingQuantity = makerOrder.quantity - makerInitialFilled;
        uint256 matchQuantity = Math.min(newRemainingTakerQty, makerRemainingQuantity);
        console.log("Book._processMakerOrderBuy: Calculated matchQuantity=%d (TakerRem=%d, MakerRem=%d)", matchQuantity, newRemainingTakerQty, makerRemainingQuantity);

        if (matchQuantity > 0) {
            console.log("Book._processMakerOrderBuy: Creating settlement...");
            // Ensure we don't exceed the bounds of the passed settlements array
            if (currentSettlementCount < settlements.length) {
                settlements[currentSettlementCount] = IOrderInfo.Settlement({
                    takerOrderId: takerOrder.id,
                    makerOrderId: makerOrderId,
                    quantity: matchQuantity,
                    price: price,
                    processed: false
                });
                settlementsCreated = 1;
                newRemainingTakerQty -= matchQuantity;

                uint256 makerTotalFilled = makerInitialFilled + matchQuantity;
                IOrderInfo.OrderStatus makerNewStatus = (makerTotalFilled == makerOrder.quantity) ? IOrderInfo.OrderStatus.FILLED : IOrderInfo.OrderStatus.PARTIALLY_FILLED;
                IState(state).updateOrderStatus(makerOrderId, uint8(makerNewStatus), makerTotalFilled);

                level.totalQuantity -= matchQuantity;
                level.orderQuantities[makerOrderId] -= matchQuantity;

                emit OrderMatched(takerOrder.id, makerOrderId, price, matchQuantity);

                if (makerTotalFilled == makerOrder.quantity) {
                    console.log("Book._processMakerOrderBuy: Maker order fully filled.");
                    removeMaker = true;
                }
            } else {
                 console.log("Book._processMakerOrderBuy: Settlement array full! Cannot create more settlements.");
            }
        } else {
            console.log("Book._processMakerOrderBuy: Match quantity is zero. Skipping settlement.");
        }
        return (newRemainingTakerQty, settlementsCreated, removeMaker);
    }

    function _processMakerOrderSell(
        IOrderInfo.Order memory takerOrder,
        uint256 makerOrderId,
        uint256 price,
        PriceLevel storage level,
        uint256 currentRemainingTakerQty,
        IOrderInfo.Settlement[] memory settlements,
        uint256 currentSettlementCount
    ) internal returns (uint256 newRemainingTakerQty, uint256 settlementsCreated, bool removeMaker) {
        console.log("Book._processMakerOrderSell: TakerOrderId=%d, MakerOrderId=%d", takerOrder.id, makerOrderId);
        IOrderInfo.Order memory makerOrder = IState(state).getOrder(makerOrderId);
        removeMaker = false;
        settlementsCreated = 0;
        newRemainingTakerQty = currentRemainingTakerQty;

        console.log("Book._processMakerOrderSell: Checking self-trade. Taker=%s, Maker=%s", takerOrder.trader, makerOrder.trader);
        if (takerOrder.trader == makerOrder.trader) {
            console.log("Book._processMakerOrderSell: SELF-TRADE DETECTED! Skipping.");
            return (newRemainingTakerQty, 0, false);
        }

        console.log("Book._processMakerOrderSell: Checking maker status. MakerStatus=%d (OPEN=0, PARTIALLY_FILLED=1)", uint8(makerOrder.status));
        if (makerOrder.status != IOrderInfo.OrderStatus.OPEN && makerOrder.status != IOrderInfo.OrderStatus.PARTIALLY_FILLED) {
            console.log("Book._processMakerOrderSell: Maker status invalid! Skipping.");
            removeMaker = true;
            return (newRemainingTakerQty, settlementsCreated, removeMaker);
        }

        uint256 makerInitialFilled = makerOrder.filledQuantity;
        uint256 makerRemainingQuantity = makerOrder.quantity - makerInitialFilled;
        uint256 matchQuantity = Math.min(newRemainingTakerQty, makerRemainingQuantity);
        console.log("Book._processMakerOrderSell: Calculated matchQuantity=%d (TakerRem=%d, MakerRem=%d)", matchQuantity, newRemainingTakerQty, makerRemainingQuantity);

        if (matchQuantity > 0) {
            console.log("Book._processMakerOrderSell: Creating settlement...");
            if (currentSettlementCount < settlements.length) {
                settlements[currentSettlementCount] = IOrderInfo.Settlement({
                    takerOrderId: takerOrder.id,
                    makerOrderId: makerOrderId,
                    quantity: matchQuantity,
                    price: price,
                    processed: false
                });
                settlementsCreated = 1;
                newRemainingTakerQty -= matchQuantity;

                uint256 makerTotalFilled = makerInitialFilled + matchQuantity;
                IOrderInfo.OrderStatus makerNewStatus = (makerTotalFilled == makerOrder.quantity) ? IOrderInfo.OrderStatus.FILLED : IOrderInfo.OrderStatus.PARTIALLY_FILLED;
                IState(state).updateOrderStatus(makerOrderId, uint8(makerNewStatus), makerTotalFilled);

                level.totalQuantity -= matchQuantity;
                level.orderQuantities[makerOrderId] -= matchQuantity;

                emit OrderMatched(takerOrder.id, makerOrderId, price, matchQuantity);

                if (makerTotalFilled == makerOrder.quantity) {
                    console.log("Book._processMakerOrderSell: Maker order fully filled.");
                    removeMaker = true;
                }
            } else {
                 console.log("Book._processMakerOrderSell: Settlement array full! Cannot create more settlements.");
            }
        } else {
            console.log("Book._processMakerOrderSell: Match quantity is zero. Skipping settlement.");
        }
        return (newRemainingTakerQty, settlementsCreated, removeMaker);
    }

    // --- Internal Helper Functions ---

    function addToBuyLevel(uint256 price, uint256 orderId, uint256 quantity) internal {
        PriceLevel storage level = buyLevels[price];
        if (level.orderIds.length == 0) {
            insertSorted(buyPrices, price, false); // false for descending
        }
        level.orderIds.push(orderId);
        level.orderQuantities[orderId] = quantity;
        level.orderIndexes[orderId] = level.orderIds.length - 1;
        level.totalQuantity += quantity;
    }

    function addToSellLevel(uint256 price, uint256 orderId, uint256 quantity) internal {
        PriceLevel storage level = sellLevels[price];
        if (level.orderIds.length == 0) {
            insertSorted(sellPrices, price, true); // true for ascending
        }
        level.orderIds.push(orderId);
        level.orderQuantities[orderId] = quantity;
        level.orderIndexes[orderId] = level.orderIds.length - 1;
        level.totalQuantity += quantity;
    }

    function removeFromBuyLevel(uint256 price, uint256 orderId) internal {
        PriceLevel storage level = buyLevels[price];
        uint256 quantity = level.orderQuantities[orderId];
        if (quantity > 0) {
            removeOrderFromLevel(level, level.orderIndexes[orderId]);
            level.totalQuantity -= quantity;
            if (level.orderIds.length == 0) {
                removeSorted(buyPrices, price, false);
            }
        }
    }

    function removeFromSellLevel(uint256 price, uint256 orderId) internal {
        PriceLevel storage level = sellLevels[price];
        uint256 quantity = level.orderQuantities[orderId];
        if (quantity > 0) {
            removeOrderFromLevel(level, level.orderIndexes[orderId]);
            level.totalQuantity -= quantity;
            if (level.orderIds.length == 0) {
                removeSorted(sellPrices, price, true);
            }
        }
    }

    function removeOrderFromLevel(PriceLevel storage level, uint256 index) internal {
        uint256 lastIndex = level.orderIds.length - 1;
        uint256 orderIdToRemove = level.orderIds[index];
        uint256 lastOrderId = level.orderIds[lastIndex];

        level.orderIds[index] = lastOrderId;
        level.orderIndexes[lastOrderId] = index;

        level.orderIds.pop();
        delete level.orderQuantities[orderIdToRemove];
        delete level.orderIndexes[orderIdToRemove];
    }

    function insertSorted(uint256[] storage arr, uint256 value, bool ascending) internal {
        uint256 index = findInsertionIndex(arr, value, ascending);
        arr.push(0); // Expand array
        // Shift elements to make space
        for (uint256 i = arr.length - 1; i > index; i--) {
            arr[i] = arr[i - 1];
        }
        arr[index] = value;
    }

    function removeSorted(uint256[] storage arr, uint256 value, bool ascending) internal {
        uint256 index = findInsertionIndex(arr, value, ascending);
        // Verify the element exists at the expected index (binary search finds insertion point)
        if (index < arr.length && arr[index] == value) {
            // Shift elements left
            for (uint256 i = index; i < arr.length - 1; i++) {
                arr[i] = arr[i + 1];
            }
            arr.pop(); // Shrink array
        }
    }

    function findInsertionIndex(uint256[] storage arr, uint256 value, bool ascending) internal view returns (uint256) {
        uint256 low = 0;
        uint256 high = arr.length;
        while (low < high) {
            uint256 mid = low + (high - low) / 2;
            bool condition = ascending ? (arr[mid] < value) : (arr[mid] > value);
            if (condition) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return low;
    }

    function updateTakerOrderStatus(IOrderInfo.Order memory order, uint256 totalFilled) internal {
        IOrderInfo.OrderStatus newStatus;
        if (totalFilled == order.quantity) {
            newStatus = IOrderInfo.OrderStatus.FILLED;
        } else if (totalFilled > order.filledQuantity) {
            newStatus = IOrderInfo.OrderStatus.PARTIALLY_FILLED;
        } else {
            newStatus = order.status; // No change if no fill occurred
        }
        // Only update if status changed or filled quantity increased
        if (newStatus != order.status || totalFilled > order.filledQuantity) {
             IState(state).updateOrderStatus(order.id, uint8(newStatus), totalFilled);
        }
    }

    function estimateMaxSettlements(IOrderInfo.Order memory order) internal view returns (uint256) {
        uint256 avgSize = averageMatchSizes[order.baseToken][order.quoteToken];
        if (avgSize == 0) avgSize = 1 ether; // Default if no history
        uint256 estimatedCount = (order.quantity - order.filledQuantity) / avgSize;
        return Math.max(MIN_SETTLEMENTS, Math.min(MAX_SETTLEMENTS, estimatedCount));
    }

    function updateAverageMatchSize(address base, address quote, uint256 totalFilled, uint256 settlementCount) internal {
        if (settlementCount > 0) {
            uint256 currentAvg = averageMatchSizes[base][quote];
            uint256 newAvg = totalFilled / settlementCount;
            // Simple moving average (adjust weight as needed)
            averageMatchSizes[base][quote] = (currentAvg * 9 + newAvg) / 10;
        }
    }

    // --- Getter Functions ---
    function getBestBidPrice() external view override returns (uint256) {
        return buyPrices.length > 0 ? buyPrices[0] : 0;
    }

    function getBestAskPrice() external view override returns (uint256) {
        return sellPrices.length > 0 ? sellPrices[0] : 0;
    }

    function getQuantityAtPrice(uint256 price, bool isBuy) external view override returns (uint256) {
        return isBuy ? buyLevels[price].totalQuantity : sellLevels[price].totalQuantity;
    }

    function getOrdersAtPrice(uint256 price, bool isBuy) external view override returns (uint256[] memory) {
        return isBuy ? buyLevels[price].orderIds : sellLevels[price].orderIds;
    }

    function getOrderQuantity(uint256 orderId, uint256 price, bool isBuy) external view override returns (uint256) {
        return isBuy ? buyLevels[price].orderQuantities[orderId] : sellLevels[price].orderQuantities[orderId];
    }

    function getBuyPrices() external view override returns (uint256[] memory) {
        return buyPrices;
    }

    function getSellPrices() external view override returns (uint256[] memory) {
        return sellPrices;
    }
}

