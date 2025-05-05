// SPDX-License-Identifier: MIT
// Copyright © 2025 Prajwal Pitlehra
// This file is proprietary and confidential.
// Shared for evaluation purposes only. Redistribution or reuse is prohibited without written permission.
pragma solidity ^0.8.19;

import "hardhat/console.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol"; // Added Math import
import "./interfaces/IState.sol";
import "./interfaces/IOrderInfo.sol";
import "./interfaces/IVault.sol";

// Interface for ERC20 decimals function (Added)
interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

contract Vault is IVault, Ownable {
    using SafeERC20 for IERC20;

    address public immutable state;
    address public feeRecipient;
    address public bookAddress; // Added book address state variable
    uint16 public makerFeeRateBps; // Basis points (e.g., 10 = 0.1%)
    uint16 public takerFeeRateBps; // Basis points (e.g., 20 = 0.2%)

    // Mapping to track processed settlements (takerOrderId => makerOrderId => bool)
    mapping(uint256 => mapping(uint256 => bool)) public processedSettlements;

    event FeeRecipientUpdated(address indexed newFeeRecipient);
    event FeeRateUpdated(uint16 newMakerFeeRate, uint16 newTakerFeeRate);
    event BookAddressUpdated(address indexed newBookAddress); // Added event for book address update
    // Updated FeeCollected event to include isMaker (max 3 indexed)
    event FeeCollected(address indexed token, address indexed payer, address recipient, uint256 amount, bool indexed isMaker);
    // Added SettlementProcessed event
    event SettlementProcessed(uint256 indexed takerOrderId, uint256 indexed makerOrderId, uint256 quantity, uint256 price);


    modifier onlyAdmin() {
        require(owner() == msg.sender, "Vault: caller is not the owner");
        _;
    }

    // Modifier to restrict access to the book contract
    modifier onlyBook() {
        require(msg.sender == bookAddress, "Vault: caller is not the book");
        _;
    }

    constructor(
        address initialOwner,
        address _state,
        address _feeRecipient,
        uint16 _makerFeeRate,
        uint16 _takerFeeRate
    ) Ownable(initialOwner) {
        require(_state != address(0), "Vault: state address cannot be zero");
        require(_feeRecipient != address(0), "Vault: fee recipient address cannot be zero");
        state = _state;
        feeRecipient = _feeRecipient;
        makerFeeRateBps = _makerFeeRate;
        takerFeeRateBps = _takerFeeRate;
        // bookAddress is set later by the admin via setBook
    }

    // --- Admin Functions (Matching Ownable/Custom) ---

    // Overriding setFeeRecipient from IVault
    function setFeeRecipient(address _newFeeRecipient) public override onlyAdmin {
        require(_newFeeRecipient != address(0), "Vault: new fee recipient cannot be zero");
        feeRecipient = _newFeeRecipient;
        emit FeeRecipientUpdated(_newFeeRecipient);
    }

    // Implementing setFeeRates from IVault (using uint256 as per interface)
    function setFeeRates(uint256 _newMakerFeeRate, uint256 _newTakerFeeRate) public override onlyAdmin {
        require(_newMakerFeeRate <= 10000 && _newTakerFeeRate <= 10000, "Vault: Fee rate cannot exceed 10000 bps"); // Example validation
        makerFeeRateBps = uint16(_newMakerFeeRate);
        takerFeeRateBps = uint16(_newTakerFeeRate);
        emit FeeRateUpdated(uint16(_newMakerFeeRate), uint16(_newTakerFeeRate));
    }

    // Implementing setBook from IVault (Now functional)
    function setBook(address _bookAddress) external override onlyAdmin {
        require(_bookAddress != address(0), "Vault: book address cannot be zero");
        bookAddress = _bookAddress;
        emit BookAddressUpdated(_bookAddress);
    }

    // Implementing setCLOB from IVault
    function setCLOB(address /*clobAddress*/) external override onlyAdmin {
        // No-op - Vault doesn't need direct CLOB address
    }

    // Implementing transferAdmin from IVault (using Ownable's transferOwnership)
    function transferAdmin(address newAdmin) external override onlyAdmin {
        transferOwnership(newAdmin);
    }

    // --- Settlement Logic (Matching IVault) ---

    // Implementing processSettlement from IVault with onlyBook modifier
    function processSettlement(IOrderInfo.Settlement memory settlement) public override onlyBook {
         _processSingleSettlement(settlement); // Reverted to calling single process
    }

    // Implementing processSettlements from IVault with onlyBook modifier
    // Reverted back to original looping implementation
    function processSettlements(IOrderInfo.Settlement[] memory settlements) public override onlyBook {
        uint256 numSettlements = settlements.length;
        console.log("Vault.processSettlements: Received batch of size %s", numSettlements);
        // REVERTED: Cannot declare local mapping
        // mapping(uint256 => mapping(uint256 => bool)) processedInThisTx;

        for (uint256 i = 0; i < numSettlements; ++i) {
            console.log("Vault.processSettlements Loop: Processing index %s (Taker: %s, Maker: %s)", i, settlements[i].takerOrderId, settlements[i].makerOrderId);
            _processSingleSettlement(settlements[i]); // REVERTED: Call original
        }
        console.log("Vault.processSettlements: Finished batch.");
    }

    // Internal processing logic (Original - called by the loop)
    // REVERTED: Remove temporary mapping parameter
    function _processSingleSettlement(
        IOrderInfo.Settlement memory settlement
        // REVERTED: mapping(uint256 => mapping(uint256 => bool)) storage processedInThisTx 
    ) internal {
         // REVERTED: Remove temporary check
         // if (processedInThisTx[settlement.takerOrderId][settlement.makerOrderId]) { ... }
         // processedInThisTx[settlement.takerOrderId][settlement.makerOrderId] = true;

        console.log("Vault._processSingle: Checking processed flag (STORAGE) for Taker %s, Maker %s", settlement.takerOrderId, settlement.makerOrderId);
        // --- Check if already processed (STORAGE) --- //
        require(!processedSettlements[settlement.takerOrderId][settlement.makerOrderId], "Vault: settlement already processed"); // Original check

        console.log("Vault._processSingle: Passed check. Fetching orders...");
        IOrderInfo.Order memory takerOrder = IState(state).getOrder(settlement.takerOrderId);
        IOrderInfo.Order memory makerOrder = IState(state).getOrder(settlement.makerOrderId);

        require(takerOrder.id != 0 && makerOrder.id != 0, "Vault: Invalid order ID in settlement");
        require(takerOrder.trader != makerOrder.trader, "Vault: Self-trade detected in settlement");

        // --- Check token matching ---
        require(takerOrder.baseToken == makerOrder.baseToken, "Vault: Base tokens do not match");
        require(takerOrder.quoteToken == makerOrder.quoteToken, "Vault: Quote tokens do not match");

        _processSettlementInternal(settlement, takerOrder, makerOrder);

        console.log("Vault._processSingle: Marking processed flag for Taker %s, Maker %s", settlement.takerOrderId, settlement.makerOrderId);
        // --- Mark as processed --- //
        processedSettlements[settlement.takerOrderId][settlement.makerOrderId] = true;

        // Emit SettlementProcessed event after internal processing
        emit SettlementProcessed(settlement.takerOrderId, settlement.makerOrderId, settlement.quantity, makerOrder.price);
    }

    // Renamed back from _processSingleSettlement_OriginalLogic
    // This contains the core transfer logic called by _processSingleSettlement
    function _processSettlementInternal(
        IOrderInfo.Settlement memory settlement,
        IOrderInfo.Order memory takerOrder,
        IOrderInfo.Order memory makerOrder
    ) internal {
        uint256 quoteAmount;
        uint256 baseAmount = settlement.quantity;
        uint256 makerFee;
        uint256 takerFee;
        address quoteToken = takerOrder.quoteToken;
        address baseToken = takerOrder.baseToken;

        // Corrected quoteAmount calculation using base token decimals
        uint8 baseDecimals = IERC20Decimals(baseToken).decimals();
        quoteAmount = Math.mulDiv(baseAmount, makerOrder.price, 10**uint256(baseDecimals));

        // Calculate fees using current BPS rates
        makerFee = (quoteAmount * uint256(makerFeeRateBps)) / 10000; // Explicitly cast BPS rate
        takerFee = (quoteAmount * uint256(takerFeeRateBps)) / 10000; // Explicitly cast BPS rate

        // Perform transfers based on taker's side
        if (!takerOrder.isBuy) { // takerOrder.side == IOrderInfo.OrderSide.SELL
            // Taker is selling base token (receiving quote token)
            console.log("Vault: Taker SELL settlement");
            // Maker transfers quote to taker
            transferTokens(quoteToken, makerOrder.trader, takerOrder.trader, quoteAmount);
            // Maker transfers maker fee to recipient
            if (makerFee > 0) {
                console.log("Vault: Checking allowance/balance before Maker Fee transfer (Taker SELL)");
                console.log("Vault: Maker (%s) Quote Balance: %s", makerOrder.trader, IERC20(quoteToken).balanceOf(makerOrder.trader));
                console.log("Vault: Vault Allowance from Maker (%s): %s", makerOrder.trader, IERC20(quoteToken).allowance(makerOrder.trader, address(this)));
                transferTokens(quoteToken, makerOrder.trader, feeRecipient, makerFee);
                emit FeeCollected(quoteToken, makerOrder.trader, feeRecipient, makerFee, true); // isMaker = true
            }
            // Taker transfers taker fee to recipient
            if (takerFee > 0) {
                console.log("Vault: Checking allowance/balance before Taker Fee transfer (Taker SELL)");
                console.log("Vault: Taker (%s) Quote Balance: %s", takerOrder.trader, IERC20(quoteToken).balanceOf(takerOrder.trader));
                console.log("Vault: Vault Allowance from Taker (%s): %s", takerOrder.trader, IERC20(quoteToken).allowance(takerOrder.trader, address(this)));
                transferTokens(quoteToken, takerOrder.trader, feeRecipient, takerFee);
                emit FeeCollected(quoteToken, takerOrder.trader, feeRecipient, takerFee, false); // isMaker = false
            }
            // Taker transfers base to maker
            transferTokens(baseToken, takerOrder.trader, makerOrder.trader, baseAmount);
        } else { // takerOrder.side == IOrderInfo.OrderSide.BUY
            // Taker is buying base token (paying with quote token)
            console.log("Vault: Taker BUY settlement");
            console.log("Vault: Taker Trader=", takerOrder.trader);
            console.log("Vault: Maker Trader=", makerOrder.trader);
            console.log("Vault: Quote Token=", quoteToken);
            console.log("Vault: Base Token=", baseToken);
            console.log("Vault: Quote Amount=", quoteAmount);
            console.log("Vault: Base Amount=", baseAmount);
            console.log("Vault: Maker Fee=", makerFee);
            console.log("Vault: Taker Fee=", takerFee);

            // Taker transfers quote to maker (net of maker fee)
            console.log("Vault: Checking allowance/balance before Quote to Maker transfer (Taker BUY)");
            console.log("Vault: Taker (%s) Quote Balance: %s", takerOrder.trader, IERC20(quoteToken).balanceOf(takerOrder.trader));
            console.log("Vault: Vault Allowance from Taker (%s): %s", takerOrder.trader, IERC20(quoteToken).allowance(takerOrder.trader, address(this)));
            console.log("Vault: DEBUG - Taker BUY - quoteAmount: %s, makerFee: %s", quoteAmount, makerFee); 
            transferTokens(quoteToken, takerOrder.trader, makerOrder.trader, quoteAmount - makerFee);

            // Taker transfers maker fee to recipient
            if (makerFee > 0) {
                console.log("Vault: Checking allowance/balance before Maker Fee transfer (Taker BUY)");
                console.log("Vault: Taker (%s) Quote Balance: %s", takerOrder.trader, IERC20(quoteToken).balanceOf(takerOrder.trader));
                console.log("Vault: Vault Allowance from Taker (%s): %s", takerOrder.trader, IERC20(quoteToken).allowance(takerOrder.trader, address(this)));
                transferTokens(quoteToken, takerOrder.trader, feeRecipient, makerFee);
                emit FeeCollected(quoteToken, takerOrder.trader, feeRecipient, makerFee, true); // isMaker = true
            }

            // Taker transfers taker fee to recipient
            if (takerFee > 0) {
                console.log("Vault: Checking allowance/balance before Taker Fee transfer (Taker BUY)");
                console.log("Vault: Taker (%s) Quote Balance: %s", takerOrder.trader, IERC20(quoteToken).balanceOf(takerOrder.trader));
                console.log("Vault: Vault Allowance from Taker (%s): %s", takerOrder.trader, IERC20(quoteToken).allowance(takerOrder.trader, address(this)));
                transferTokens(quoteToken, takerOrder.trader, feeRecipient, takerFee);
                emit FeeCollected(quoteToken, takerOrder.trader, feeRecipient, takerFee, false); // isMaker = false
            }

            // Maker transfers base to taker
            console.log("Vault: Checking allowance/balance before Base to Taker transfer (Taker BUY)");
            console.log("Vault: Maker (%s) Base Balance: %s", makerOrder.trader, IERC20(baseToken).balanceOf(makerOrder.trader));
            console.log("Vault: Vault Allowance from Maker (%s): %s", makerOrder.trader, IERC20(baseToken).allowance(makerOrder.trader, address(this)));
            transferTokens(baseToken, makerOrder.trader, takerOrder.trader, baseAmount);
        }
    }

    function transferTokens(address token, address from, address to, uint256 amount) internal {
         if (amount == 0) {
            return;
        }
        console.log("Vault.transferTokens: Transferring", amount, "of", token);
        console.log("Vault.transferTokens: from", from, "to", to);
        // Restore direct call
        IERC20(token).safeTransferFrom(from, to, amount);
        console.log("Vault.transferTokens: Transfer successful."); // Added confirmation log
    }

    // --- Getter Functions (Matching IVault) ---

    // Implementing getFeeRecipient from IVault
    function getFeeRecipient() public view override returns (address) {
        return feeRecipient;
    }

    // Implementing getFeeRates from IVault (using uint256)
    function getFeeRates() public view override returns (uint256, uint256) {
        return (uint256(makerFeeRateBps), uint256(takerFeeRateBps)); // Corrected order: maker, taker
    }

    // --- Missing IVault Function Stubs ---

    // Implementing calculateFees from IVault
    // Corrected function signature to match return order and test expectations
    function calculateFees(IOrderInfo.Settlement memory settlement) public view override returns (uint256 makerFee, uint256 takerFee) {
        IOrderInfo.Order memory makerOrder = IState(state).getOrder(settlement.makerOrderId);
        IOrderInfo.Order memory takerOrder = IState(state).getOrder(settlement.takerOrderId); // Need taker order for base token
        address baseToken = takerOrder.baseToken;
        uint256 baseAmount = settlement.quantity;

        // Corrected quoteAmount calculation using base token decimals
        uint8 baseDecimals = IERC20Decimals(baseToken).decimals();
        uint256 quoteAmount = Math.mulDiv(baseAmount, makerOrder.price, 10**uint256(baseDecimals));

        makerFee = (quoteAmount * uint256(makerFeeRateBps)) / 10000;
        takerFee = (quoteAmount * uint256(takerFeeRateBps)) / 10000;
        return (makerFee, takerFee); // Return order matches signature
    }

    // Fallback function to receive Ether (optional)
    receive() external payable {}

    // Function to withdraw ERC20 tokens accidentally sent to the contract (Admin only)
    function withdrawERC20(address tokenAddress, address to, uint256 amount) external onlyAdmin {
        require(to != address(0), "Vault: invalid recipient address");
        uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
        require(amount <= balance, "Vault: insufficient balance");
        IERC20(tokenAddress).safeTransfer(to, amount);
    }

    // Function to withdraw Ether accidentally sent to the contract (Admin only)
    function withdrawEther(address payable to, uint256 amount) external onlyAdmin {
        require(to != address(0), "Vault: invalid recipient address");
        uint256 balance = address(this).balance;
        require(amount <= balance, "Vault: insufficient balance");
        (bool success, ) = to.call{value: amount}("");
        require(success, "Vault: Ether withdrawal failed");
    }
}

