// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../interfaces/IOrderInfo.sol";

/**
 * @title SettlementUtils
 * @dev Library for settlement-related utility functions
 */
library SettlementUtils {
    /**
     * @dev Struct representing a settlement between two orders
     */
    struct Settlement {
        uint256 takerOrderId;    // ID of the taker order
        uint256 makerOrderId;    // ID of the maker order
        uint256 quantity;        // Quantity to settle
        uint256 price;           // Price of the settlement
        address takerAddress;    // Address of the taker
        address makerAddress;    // Address of the maker
        address baseToken;       // Base token address
        address quoteToken;      // Quote token address
        bool takerIsBuy;         // Whether taker is buying
        bool processed;          // Whether the settlement has been processed
    }

    /**
     * @dev Event emitted when a settlement is created
     */
    event SettlementCreated(
        uint256 indexed takerOrderId,
        uint256 indexed makerOrderId,
        uint256 quantity,
        uint256 price
    );

    /**
     * @dev Event emitted when a settlement is processed
     */
    event SettlementProcessed(
        uint256 indexed takerOrderId,
        uint256 indexed makerOrderId,
        uint256 quantity,
        uint256 price,
        uint256 takerFee,
        uint256 makerFee
    );

    /**
     * @dev Calculate the base token amount for a settlement
     * @param settlement Settlement to calculate for
     * @return Base token amount
     */
    function calculateBaseAmount(Settlement memory settlement) internal pure returns (uint256) {
        return settlement.quantity;
    }

    /**
     * @dev Calculate the quote token amount for a settlement
     * @param settlement Settlement to calculate for
     * @return Quote token amount
     */
    function calculateQuoteAmount(Settlement memory settlement) internal pure returns (uint256) {
        // Price is scaled by 1e6, so we need to adjust
        return (settlement.quantity * settlement.price) / 1e6;
    }

    /**
     * @dev Calculate the taker fee for a settlement
     * @param quoteAmount Quote token amount
     * @param takerFeeRate Taker fee rate in basis points
     * @return Taker fee amount
     */
    function calculateTakerFee(uint256 quoteAmount, uint256 takerFeeRate) internal pure returns (uint256) {
        return (quoteAmount * takerFeeRate) / 10000;
    }

    /**
     * @dev Calculate the maker fee for a settlement
     * @param quoteAmount Quote token amount
     * @param makerFeeRate Maker fee rate in basis points
     * @return Maker fee amount
     */
    function calculateMakerFee(uint256 quoteAmount, uint256 makerFeeRate) internal pure returns (uint256) {
        return (quoteAmount * makerFeeRate) / 10000;
    }

    /**
     * @dev Create a new settlement
     * @param takerOrderId ID of the taker order
     * @param makerOrderId ID of the maker order
     * @param quantity Quantity to settle
     * @param price Price of the settlement
     * @param takerAddress Address of the taker
     * @param makerAddress Address of the maker
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @param takerIsBuy Whether taker is buying
     * @return New settlement
     */
    function createSettlement(
        uint256 takerOrderId,
        uint256 makerOrderId,
        uint256 quantity,
        uint256 price,
        address takerAddress,
        address makerAddress,
        address baseToken,
        address quoteToken,
        bool takerIsBuy
    ) internal pure returns (Settlement memory) {
        return Settlement({
            takerOrderId: takerOrderId,
            makerOrderId: makerOrderId,
            quantity: quantity,
            price: price,
            takerAddress: takerAddress,
            makerAddress: makerAddress,
            baseToken: baseToken,
            quoteToken: quoteToken,
            takerIsBuy: takerIsBuy,
            processed: false
        });
    }
}
