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
    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event CLOBUpdated(address indexed oldCLOB, address indexed newCLOB);
    event DebugProcessOrder(uint256 indexed makerOrderId, uint256 index);
    event DebugBookEnteringMatch(uint256 indexed orderId);

    // Constants
    uint256 private constant MAX_SETTLEMENTS = 200;
    uint256 private constant MAX_BATCH_SIZE = 50;
    uint256 private constant MIN_SETTLEMENTS = 20; // Increased from 10
    uint256 private constant PRICE_DECIMALS = 10**18;
    uint256 private constant maxPossibleSettlements = 120; // Increased from 50

    // Structure to hold maker update data temporarily during matching
    struct MakerUpdate {
        uint256 makerOrderId;
        uint8 status;
        uint256 filledQuantity;
    }

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

    // Updated matchOrders signature
    function matchOrders(uint256 orderId, uint256 quoteAmountLimit) 
        external 
        override 
        returns (
            uint256 settlementCount,
            uint256[] memory makerOrderIdsToUpdate, 
            uint8[] memory makerStatusesToUpdate,     
            uint256[] memory makerFilledQuantitiesToUpdate 
        ) 
    {
        IOrderInfo.Order memory order = IState(state).getOrder(orderId);
        require(order.id == orderId, "Book: order does not exist");

        // Clear any previous pending settlements for this order ID
        delete pendingSettlements[orderId];

        IOrderInfo.Settlement[] memory settlements;
        uint256 remainingQuantity; // This will be updated by _matchOrders
        MakerUpdate[] memory makerUpdates; // Array to hold maker updates

        // Pass quoteAmountLimit to internal matching logic, receive settlements and maker updates
        (settlements, remainingQuantity, makerUpdates) = _matchOrders(order, quoteAmountLimit);

        settlementCount = settlements.length;
        console.log("Book.matchOrders: Found settlements count:", settlementCount);

        if (settlementCount > 0) {
            // Store the generated settlements
            pendingSettlements[orderId] = settlements;
        }

        // Prepare maker update arrays for return
        uint256 numMakerUpdates = makerUpdates.length;
        makerOrderIdsToUpdate = new uint256[](numMakerUpdates);
        makerStatusesToUpdate = new uint8[](numMakerUpdates);
        makerFilledQuantitiesToUpdate = new uint256[](numMakerUpdates);

        for (uint i = 0; i < numMakerUpdates; i++) {
            makerOrderIdsToUpdate[i] = makerUpdates[i].makerOrderId;
            makerStatusesToUpdate[i] = makerUpdates[i].status;
            makerFilledQuantitiesToUpdate[i] = makerUpdates[i].filledQuantity;
        }
        
        // settlementCount is already assigned
        return (settlementCount, makerOrderIdsToUpdate, makerStatusesToUpdate, makerFilledQuantitiesToUpdate);
    }

    // Renamed function and updated authorization check
    function retrieveAndClearPendingSettlements(uint256 takerOrderId) 
        external 
        override 
        returns (IOrderInfo.Settlement[] memory settlements) 
    {
        // Ensure caller is authorized (CLOB contract)
        require(msg.sender == clob, "Book: Caller is not the CLOB contract");

        settlements = pendingSettlements[takerOrderId];

        // Log before deleting and returning
        console.log("Book.retrieveAndClearPendingSettlements: Retrieving settlements for Taker:", takerOrderId);
        console.log("  Count:", settlements.length);
        for(uint i=0; i < settlements.length; i++){
             // Log simplified retrieved settlement details
            console.log("  Retrieved Settlement Index:", i);
            console.log("    Taker:", settlements[i].takerOrderId);
            console.log("    Maker:", settlements[i].makerOrderId);
        }

        // Clear the stored settlements after retrieval
        delete pendingSettlements[takerOrderId];

        console.log("Book.retrieveAndClearPendingSettlements: Returning retrieved settlements.");
        return settlements;
    }

    // Internal _matchOrders updated signature and logic
    function _matchOrders(
        IOrderInfo.Order memory order,
        uint256 quoteAmountLimit // Added quoteAmountLimit for market buys
    ) internal returns (
        IOrderInfo.Settlement[] memory, 
        uint256, 
        MakerUpdate[] memory // Return maker updates
    ) {
        uint256 initialFilledQuantity = order.filledQuantity;
        uint256 remainingQuantity = order.quantity - initialFilledQuantity;
        uint256 totalSettlementCount = 0;
        uint256 estimatedMaxSettlements = estimateMaxSettlements(order);
        IOrderInfo.Settlement[] memory allSettlements = new IOrderInfo.Settlement[](estimatedMaxSettlements);
        MakerUpdate[] memory allMakerUpdates = new MakerUpdate[](estimatedMaxSettlements); // Array for maker updates
        uint256 quoteAmountSpent = 0; 

        if (order.orderType == IOrderInfo.OrderType.MARKET) {
            // Pass maker updates array to be populated
            (totalSettlementCount, remainingQuantity, quoteAmountSpent) = 
                matchMarketOrder(order, remainingQuantity, quoteAmountLimit, allSettlements, allMakerUpdates);
        } else {
            // Pass maker updates array to be populated
            if (order.isBuy) {
                (totalSettlementCount, remainingQuantity, /* quoteSpent */) = 
                    matchBuyOrder(order, remainingQuantity, 0, allSettlements, allMakerUpdates);
            } else {
                (totalSettlementCount, remainingQuantity, /* quoteSpent */) = 
                    matchSellOrder(order, remainingQuantity, 0, allSettlements, allMakerUpdates);
            }
        }

        uint256 totalFilledDuringMatch = (order.quantity - initialFilledQuantity) - remainingQuantity;
        // REMOVED: updateTakerOrderStatus(order, initialFilledQuantity + totalFilledDuringMatch); 
        updateAverageMatchSize(order.baseToken, order.quoteToken, totalFilledDuringMatch, totalSettlementCount);

        // Trim settlements and maker updates to actual count
        IOrderInfo.Settlement[] memory finalSettlements = new IOrderInfo.Settlement[](totalSettlementCount);
        MakerUpdate[] memory finalMakerUpdates = new MakerUpdate[](totalSettlementCount); 

        console.log("Book._matchOrders: Final settlement count:", totalSettlementCount);
        for (uint256 i = 0; i < totalSettlementCount; i++) {
            finalSettlements[i] = allSettlements[i];
            finalMakerUpdates[i] = allMakerUpdates[i]; // Copy maker updates
            // Log simplified settlement details
            console.log("  Final Settlement Index:", i);
            console.log("    Taker:", finalSettlements[i].takerOrderId);
            console.log("    Maker:", finalSettlements[i].makerOrderId); 
            console.log("  Maker Update Index:", i);
            console.log("    Maker ID:", finalMakerUpdates[i].makerOrderId);
            console.log("    New Status:", finalMakerUpdates[i].status);
            console.log("    New Filled Qty:", finalMakerUpdates[i].filledQuantity);
        }

        // Store settlements in the pending map BEFORE returning
        pendingSettlements[order.id] = finalSettlements; 
        console.log("Book._matchOrders internal: Stored settlements and returning final data.");
        return (finalSettlements, remainingQuantity, finalMakerUpdates); // Return maker updates
    }

    // Updated matching functions to accept and populate makerUpdates array
    function matchMarketOrder(
        IOrderInfo.Order memory order,
        uint256 remainingQuantity, 
        uint256 quoteAmountLimit, 
        IOrderInfo.Settlement[] memory settlements,
        MakerUpdate[] memory makerUpdates // Added parameter
    ) internal returns (uint256 settlementCount, uint256 finalRemainingQuantity, uint256 totalQuoteSpent) {
        uint256 count = 0;
        totalQuoteSpent = 0;
        uint256 actualBaseFilled = 0; 
        IOrderInfo.Order memory takerOrder = IState(state).getOrder(order.id); 

        if (order.isBuy) {
            uint256 priceLevelIndex = 0;
            bool stopMatching = false;
            while (!stopMatching && priceLevelIndex < sellPrices.length && count < settlements.length) {
                uint256 price = sellPrices[priceLevelIndex];
                PriceLevel storage level = sellLevels[price];
                uint256 levelIndex = 0;
                while (!stopMatching && levelIndex < level.orderIds.length && count < settlements.length) {
                    if (quoteAmountLimit > 0 && totalQuoteSpent >= quoteAmountLimit) {
                        stopMatching = true; break;
                    }
                    uint256 makerOrderId = level.orderIds[levelIndex];
                    uint256 makerQuantity = level.orderQuantities[makerOrderId];
                    IOrderInfo.Order memory makerOrder = IState(state).getOrder(makerOrderId);
                    if (takerOrder.trader == makerOrder.trader) { levelIndex++; continue; }

                    uint256 baseDecimals = 18; // Assume
                    uint256 quoteRequiredForFullFill = (makerQuantity * price) / (10**baseDecimals);
                    uint256 baseFillable = makerQuantity; 
                    uint256 quoteToUse = quoteRequiredForFullFill;

                    if (quoteAmountLimit > 0) {
                        uint256 remainingQuote = quoteAmountLimit - totalQuoteSpent;
                        if (quoteRequiredForFullFill > remainingQuote) {
                            quoteToUse = remainingQuote;
                            baseFillable = price == 0 ? 0 : (quoteToUse * (10**baseDecimals)) / price;
                            stopMatching = true;
                        }
                    }
                    baseFillable = Math.min(baseFillable, makerQuantity);

                    if(baseFillable > 0){
                        totalQuoteSpent += (baseFillable * price) / (10**baseDecimals); 
                        actualBaseFilled += baseFillable;
                        settlements[count] = IOrderInfo.Settlement({
                            takerOrderId: order.id,
                            makerOrderId: makerOrderId,
                            price: price,
                            quantity: baseFillable,
                            processed: false
                        });
                        
                        // --- Accumulate Maker Update ---
                        uint256 newMakerFilledQuantity = makerOrder.filledQuantity + baseFillable;
                        IOrderInfo.OrderStatus newMakerStatus;
                        if (newMakerFilledQuantity >= makerOrder.quantity) {
                            newMakerStatus = IOrderInfo.OrderStatus.FILLED;
                            newMakerFilledQuantity = makerOrder.quantity;
                        } else {
                            newMakerStatus = IOrderInfo.OrderStatus.PARTIALLY_FILLED;
                        }
                        makerUpdates[count] = MakerUpdate({
                            makerOrderId: makerOrderId,
                            status: uint8(newMakerStatus),
                            filledQuantity: newMakerFilledQuantity
                        });
                        emit OrderMatched(order.id, makerOrderId, price, baseFillable); // Emit event here
                        // REMOVED: processSettlementUpdates call
                        // --- End Accumulate ---
                        count++;
                    } 

                    if (baseFillable == makerQuantity) {
                        levelIndex++; 
                    } else {
                        level.orderQuantities[makerOrderId] -= baseFillable;
                        level.totalQuantity -= baseFillable;
                        break; 
                    }
                    if (stopMatching) { break; }
                }
                if (level.orderIds.length == 0 && priceLevelIndex < sellPrices.length) { 
                    removeSorted(sellPrices, price, true); 
                } else if (!stopMatching) {
                    priceLevelIndex++;
                } 
            }
            finalRemainingQuantity = 0; 
        } else { // Market SELL
            uint256 priceLevelIndex = 0;
            while (remainingQuantity > 0 && priceLevelIndex < buyPrices.length && count < settlements.length) {
                uint256 price = buyPrices[priceLevelIndex];
                PriceLevel storage level = buyLevels[price];
                uint256 levelIndex = 0;
                while (remainingQuantity > 0 && levelIndex < level.orderIds.length && count < settlements.length) {
                    uint256 makerOrderId = level.orderIds[levelIndex];
                    uint256 makerQuantity = level.orderQuantities[makerOrderId];
                    IOrderInfo.Order memory makerOrder = IState(state).getOrder(makerOrderId);
                    if (takerOrder.trader == makerOrder.trader) { levelIndex++; continue; }

                    uint256 fillQuantity = Math.min(remainingQuantity, makerQuantity);
                    if(fillQuantity > 0){
                        uint256 baseDecimals = 18; // Assume
                        totalQuoteSpent += (fillQuantity * price) / (10**baseDecimals); 
                        settlements[count] = IOrderInfo.Settlement({
                            takerOrderId: order.id,
                            makerOrderId: makerOrderId,
                            price: price,
                            quantity: fillQuantity,
                            processed: false
                        });
                        
                        // --- Accumulate Maker Update ---
                        uint256 newMakerFilledQuantity = makerOrder.filledQuantity + fillQuantity;
                        IOrderInfo.OrderStatus newMakerStatus;
                        if (newMakerFilledQuantity >= makerOrder.quantity) {
                            newMakerStatus = IOrderInfo.OrderStatus.FILLED;
                            newMakerFilledQuantity = makerOrder.quantity;
                        } else {
                            newMakerStatus = IOrderInfo.OrderStatus.PARTIALLY_FILLED;
                        }
                        makerUpdates[count] = MakerUpdate({
                            makerOrderId: makerOrderId,
                            status: uint8(newMakerStatus),
                            filledQuantity: newMakerFilledQuantity
                        });
                        emit OrderMatched(order.id, makerOrderId, price, fillQuantity); // Emit event here
                        // REMOVED: processSettlementUpdates call
                        // --- End Accumulate ---
                        count++;
                        remainingQuantity -= fillQuantity;
                    } 

                    if (fillQuantity == makerQuantity) {
                        levelIndex++;
                    } else {
                        level.orderQuantities[makerOrderId] -= fillQuantity;
                        level.totalQuantity -= fillQuantity;
                        break; 
                    }
                }
                if (level.orderIds.length == 0 && priceLevelIndex < buyPrices.length) { 
                    removeSorted(buyPrices, price, false);
                } else {
                    priceLevelIndex++;
                }
            }
            finalRemainingQuantity = remainingQuantity;
        }

        // No need to trim here, handled in _matchOrders
        return (count, finalRemainingQuantity, totalQuoteSpent);
    }

    // Updated matching functions to accept and populate makerUpdates array
    function matchBuyOrder(
        IOrderInfo.Order memory order,
        uint256 remainingQuantity,
        uint256 quoteAmountLimit, // Unused for limit buy
        IOrderInfo.Settlement[] memory settlements,
        MakerUpdate[] memory makerUpdates // Added parameter
    ) internal returns (uint256 settlementCount, uint256 finalRemainingQuantity, uint256 totalQuoteSpent) {
        uint256 count = 0;
        totalQuoteSpent = 0;
        uint256 priceLevelIndex = 0;
        IOrderInfo.Order memory takerOrder = IState(state).getOrder(order.id);
        while (remainingQuantity > 0 && priceLevelIndex < sellPrices.length && count < settlements.length) {
            uint256 price = sellPrices[priceLevelIndex];
            if (order.orderType != IOrderInfo.OrderType.MARKET && price > order.price) {
                break; 
            }

            PriceLevel storage level = sellLevels[price];
            uint256 levelIndex = 0;
            while (remainingQuantity > 0 && levelIndex < level.orderIds.length && count < settlements.length) {
                uint256 makerOrderId = level.orderIds[levelIndex];
                uint256 makerQuantity = level.orderQuantities[makerOrderId];
                IOrderInfo.Order memory makerOrder = IState(state).getOrder(makerOrderId);
                if (takerOrder.trader == makerOrder.trader) { levelIndex++; continue; }

                uint256 fillQuantity = Math.min(makerQuantity, remainingQuantity);
                uint256 baseDecimals = 18; // Assume
                uint256 quoteCost = (fillQuantity * price) / (10**baseDecimals); 
                totalQuoteSpent += quoteCost;

                settlements[count] = IOrderInfo.Settlement({
                    takerOrderId: order.id,
                    makerOrderId: makerOrderId,
                    price: price,
                    quantity: fillQuantity,
                    processed: false
                });
                
                // --- Accumulate Maker Update ---
                uint256 newMakerFilledQuantity = makerOrder.filledQuantity + fillQuantity;
                IOrderInfo.OrderStatus newMakerStatus;
                if (newMakerFilledQuantity >= makerOrder.quantity) {
                    newMakerStatus = IOrderInfo.OrderStatus.FILLED;
                    newMakerFilledQuantity = makerOrder.quantity;
                } else {
                    newMakerStatus = IOrderInfo.OrderStatus.PARTIALLY_FILLED;
                }
                makerUpdates[count] = MakerUpdate({
                    makerOrderId: makerOrderId,
                    status: uint8(newMakerStatus),
                    filledQuantity: newMakerFilledQuantity
                });
                emit OrderMatched(order.id, makerOrderId, price, fillQuantity); // Emit event here
                // REMOVED: processSettlementUpdates call
                // --- End Accumulate ---
                count++;
                remainingQuantity -= fillQuantity;

                if (fillQuantity == makerQuantity) {
                    levelIndex++;
                } else {
                    level.orderQuantities[makerOrderId] -= fillQuantity;
                    level.totalQuantity -= fillQuantity;
                    break; 
                }
            }
            if (level.orderIds.length == 0) {
                removeSorted(sellPrices, price, true);
            } else {
                priceLevelIndex++;
            }
        }
        finalRemainingQuantity = remainingQuantity;
        return (count, finalRemainingQuantity, totalQuoteSpent);
    }

    // Updated matching functions to accept and populate makerUpdates array
    function matchSellOrder(
        IOrderInfo.Order memory order,
        uint256 remainingQuantity,
        uint256 quoteAmountLimit, // Unused for limit sell
        IOrderInfo.Settlement[] memory settlements,
        MakerUpdate[] memory makerUpdates // Added parameter
    ) internal returns (uint256 settlementCount, uint256 finalRemainingQuantity, uint256 totalQuoteSpent) {
        uint256 count = 0;
        totalQuoteSpent = 0;
        uint256 priceLevelIndex = 0;
        IOrderInfo.Order memory takerOrder = IState(state).getOrder(order.id);
        while (remainingQuantity > 0 && priceLevelIndex < buyPrices.length && count < settlements.length) {
            uint256 price = buyPrices[priceLevelIndex];
            if (order.orderType != IOrderInfo.OrderType.MARKET && price < order.price) {
                break; 
            }
            PriceLevel storage level = buyLevels[price];
            uint256 levelIndex = 0;
            while (remainingQuantity > 0 && levelIndex < level.orderIds.length && count < settlements.length) {
                uint256 makerOrderId = level.orderIds[levelIndex];
                uint256 makerQuantity = level.orderQuantities[makerOrderId];
                IOrderInfo.Order memory makerOrder = IState(state).getOrder(makerOrderId);
                if (takerOrder.trader == makerOrder.trader) { levelIndex++; continue; }

                uint256 fillQuantity = Math.min(makerQuantity, remainingQuantity);
                uint256 baseDecimals = 18; // Assume
                uint256 quoteReceived = (fillQuantity * price) / (10**baseDecimals); 
                totalQuoteSpent += quoteReceived;

                settlements[count] = IOrderInfo.Settlement({
                    takerOrderId: order.id,
                    makerOrderId: makerOrderId,
                    price: price,
                    quantity: fillQuantity,
                    processed: false
                });

                // --- Accumulate Maker Update ---
                uint256 newMakerFilledQuantity = makerOrder.filledQuantity + fillQuantity;
                IOrderInfo.OrderStatus newMakerStatus;
                if (newMakerFilledQuantity >= makerOrder.quantity) {
                    newMakerStatus = IOrderInfo.OrderStatus.FILLED;
                    newMakerFilledQuantity = makerOrder.quantity;
                } else {
                    newMakerStatus = IOrderInfo.OrderStatus.PARTIALLY_FILLED;
                }
                makerUpdates[count] = MakerUpdate({
                    makerOrderId: makerOrderId,
                    status: uint8(newMakerStatus),
                    filledQuantity: newMakerFilledQuantity
                });
                emit OrderMatched(order.id, makerOrderId, price, fillQuantity); // Emit event here
                // REMOVED: processSettlementUpdates call
                // --- End Accumulate ---
                count++;
                remainingQuantity -= fillQuantity;

                if (fillQuantity == makerQuantity) {
                    levelIndex++;
                } else {
                    level.orderQuantities[makerOrderId] -= fillQuantity;
                    level.totalQuantity -= fillQuantity;
                    break; 
                }
            }
            if (level.orderIds.length == 0) {
                removeSorted(buyPrices, price, false);
            } else {
                priceLevelIndex++;
            }
        }
        finalRemainingQuantity = remainingQuantity;
        return (count, finalRemainingQuantity, totalQuoteSpent);
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
        if (buyPrices.length == 0) {
            return 0;
        }
        return buyPrices[0]; // buyPrices are sorted descending
    }

    function getBestAskPrice() external view override returns (uint256) {
        if (sellPrices.length == 0) {
            return 0;
        }
        return sellPrices[0]; // sellPrices are sorted ascending
    }

    function getBuyLevelOrderIds(uint256 price) external view override returns (uint256[] memory) {
        return buyLevels[price].orderIds;
    }

    function getSellLevelOrderIds(uint256 price) external view override returns (uint256[] memory) {
        return sellLevels[price].orderIds;
    }

    function getBuyLevelTotalQuantity(uint256 price) external view override returns (uint256) {
        return buyLevels[price].totalQuantity;
    }

    function getSellLevelTotalQuantity(uint256 price) external view override returns (uint256) {
        return sellLevels[price].totalQuantity;
    }

    function getBuyPrices() external view override returns (uint256[] memory) {
        return buyPrices;
    }

    function getSellPrices() external view override returns (uint256[] memory) {
        return sellPrices;
    }

    // --- Legacy functions (remove override if not in IBook) --- 

    // Remove override if getQuantityAtPrice is not in the corrected IBook interface
    function getQuantityAtPrice(uint256 price, bool isBuy) external view returns (uint256) { 
        if (isBuy) {
            return buyLevels[price].totalQuantity;
        } else {
            return sellLevels[price].totalQuantity;
        }
    }

    // Remove override if getOrdersAtPrice is not in the corrected IBook interface
    function getOrdersAtPrice(uint256 price, bool isBuy) external view returns (uint256[] memory) {
        if (isBuy) {
            return buyLevels[price].orderIds;
        } else {
            return sellLevels[price].orderIds;
        }
    }

    // Remove override if getOrderQuantity is not in the corrected IBook interface
    function getOrderQuantity(uint256 orderId, uint256 price, bool isBuy) external view returns (uint256) {
        if (isBuy) {
            return buyLevels[price].orderQuantities[orderId];
        } else {
            return sellLevels[price].orderQuantities[orderId];
        }
    }
}

