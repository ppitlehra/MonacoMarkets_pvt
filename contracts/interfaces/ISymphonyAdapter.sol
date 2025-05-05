// SPDX-License-Identifier: MIT
// Copyright © 2025 Prajwal Pitlehra
// This file is proprietary and confidential.
// Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
pragma solidity ^0.8.4;

import "./IOrderInfo.sol";

interface ISymphonyAdapter {
    // --- Events ---
    event OrderRelayed(
        address indexed trader,
        address indexed baseToken,
        address indexed quoteToken,
        uint256 price,
        uint256 quantity,
        bool isBuy,
        uint256 orderId // CLOB Order ID
    );

    event SettlementProcessed(
        uint256 indexed clobSettlementId, // Assuming Vault provides this
        address indexed originalTrader,
        address tokenSold,
        uint256 amountSold,
        address tokenBought,
        uint256 amountBoughtNet // Net amount after Symphony fees
    );

    event SymphonyFeeCollected(
        address indexed token,
        address indexed payer, // Should be the adapter itself
        address indexed recipient,
        uint256 amount
    );

    // --- Functions ---

    // Existing function (potentially deprecated for direct Symphony calls)
    function relaySymphonyOrder(
        address traderAddress,
        address baseToken,
        address quoteToken,
        uint256 price,
        uint256 quantity,
        bool isBuy,
        uint8 orderType // 0: LIMIT, 1: MARKET (if supported)
    ) external returns (uint256 orderId);

    // Existing function (potentially deprecated for direct Symphony calls)
    function processSettlements(
        IOrderInfo.Settlement[] calldata settlements
    ) external;

    // *** NEW Synchronous Function for Symphony Aggregator ***
    function executeSwapViaCLOB(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external returns (uint256 amountOut);

    // --- Admin/Config Functions ---
    function setSymphonyOperator(address _operator) external;
    function setFeeRates(uint16 _makerFeeRate, uint16 _takerFeeRate) external; // Potentially redundant if Vault handles CLOB fees
    function setSymphonyFeeRecipient(address _recipient) external;
    function approveVault(address _token, uint256 _amount) external;
    function withdrawTokens(address _token, address _to, uint256 _amount) external;

    // --- View Functions ---
    function clobAddress() external view returns (address);
    function symphonyOperator() external view returns (address);
    function symphonyFeeRecipient() external view returns (address);
    // Add other relevant view functions if needed

    // Add getters for estimated CLOB fee rates
    function clobMakerFeeRateEstimate() external view returns (uint256);
    function clobTakerFeeRateEstimate() external view returns (uint256);
}

