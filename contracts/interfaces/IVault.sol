// SPDX-License-Identifier: MIT
// Copyright © 2025 Prajwal Pitlehra
// This file is proprietary and confidential.
// Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
pragma solidity ^0.8.17;

import "./IOrderInfo.sol";

/**
 * @title IVault
 * @dev Interface for the Vault component
 */
interface IVault {
    /**
     * @dev Processes a settlement
     * @param settlement The settlement to process
     */
    function processSettlement(IOrderInfo.Settlement memory settlement) external;

    /**
     * @dev Processes multiple settlements in batch
     * @param settlements The settlements to process
     */
    function processSettlements(IOrderInfo.Settlement[] memory settlements) external;

    /**
     * @dev Calculates fees for a settlement
     * @param settlement The settlement
     * @return takerFee The fee for the taker
     * @return makerFee The fee for the maker
     */
    function calculateFees(IOrderInfo.Settlement memory settlement) external view returns (uint256 takerFee, uint256 makerFee);

    /**
     * @dev Sets the fee rates
     * @param takerFeeRate The fee rate for takers (in basis points)
     * @param makerFeeRate The fee rate for makers (in basis points)
     */
    function setFeeRates(uint256 takerFeeRate, uint256 makerFeeRate) external;

    /**
     * @dev Gets the current fee rates
     * @return takerFeeRate The fee rate for takers (in basis points)
     * @return makerFeeRate The fee rate for makers (in basis points)
     */
    function getFeeRates() external view returns (uint256 takerFeeRate, uint256 makerFeeRate);

    /**
     * @dev Sets the fee recipient
     * @param feeRecipient The address of the fee recipient
     */
    function setFeeRecipient(address feeRecipient) external;

    /**
     * @dev Gets the fee recipient
     * @return The address of the fee recipient
     */
    function getFeeRecipient() external view returns (address);

    /**
     * @dev Sets the book address
     * @param bookAddress The address of the book
     */
    function setBook(address bookAddress) external;
    
    /**
     * @dev Sets the CLOB address
     * @param clobAddress The address of the CLOB
     */
    function setCLOB(address clobAddress) external;
    
    /**
     * @dev Transfers admin role to a new address
     * @param newAdmin The address of the new admin
     */
    function transferAdmin(address newAdmin) external;
}
