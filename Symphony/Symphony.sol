// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./contracts/interfaces/Interfaces.sol";
import "./contracts/core/ContractErrors.sol";
import "./contracts/interfaces/IVaultMinimal.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Symphony Contract
 * @dev The Symphony contract allows users to perform token swaps the most liquid DEXes.
 * It provides functions for approving tokens, executing swaps, and handling token transfers.
 * The contract also includes reentrancy guard, contract error handling, and ownership functionality.
 */
contract Symphony is ReentrancyGuard, ContractErrors, Ownable {
    using SafeERC20 for IERC20;
    using Math for uint;
    event SwapExecuted(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint amountIn,
        uint amountOut,
        uint swapType
    );
    event PathsExecuted(
        address indexed user,
        Params.SwapParam[][] swapParams,
        uint minTotalAmountOut,
        uint finalTokenAmount
    );
    event SwapReceipt(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint amountIn,
        uint amountOut,
        uint feePercentage,
        uint feeShare,
        address feeRecipient
    );

    IDragonRouter dragonRouter;
    address public dragonRouterAddress =
        0xa4cF2F53D1195aDDdE9e4D3aCa54f556895712f2;
    IYakaRouter yakaRouter;
    address public yakaRouterAddress =
        0x9f3B1c6b0CDDfE7ADAdd7aadf72273b38eFF0ebC;
    IDonkeRouter donkeRouter;
    address public donkeRouterAddress =
        0x6e8D0B4EBe31C334D53ff7EB08722a4941049070;
    IVault jellyVault;
    address public jellyVaultAddress =
        0xFB43069f6d0473B85686a85F4Ce4Fc1FD8F00875;
    IUniversalRouter universalRouter;
    address public universalRouterAddress =
        0xa683c66045ad16abb1bCE5ad46A64d95f9A25785;
    mapping(uint => address) public v3Routers;
    uint24[] public routerKeys = [6,7];


    //CHANGE
    address public fee_address = 0xa2a9dd657D44e46E2d1843B8784eFc3dE3Cf3A57;
    IWETH public weth;
    address public wethAddress = 0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7;
    uint public feePercentage = 3;

    constructor() ReentrancyGuard() Ownable(msg.sender) {
        dragonRouter = IDragonRouter(dragonRouterAddress);
        yakaRouter = IYakaRouter(yakaRouterAddress);
        donkeRouter = IDonkeRouter(donkeRouterAddress);
        jellyVault = IVault(jellyVaultAddress);
        universalRouter = IUniversalRouter(universalRouterAddress);
        v3Routers[6] = 0x11DA6463D6Cb5a03411Dbf5ab6f6bc3997Ac7428;
        v3Routers[7] = 0xD8953D7a8643be3687DFDc401204Ec493D5e6d8A;
        weth = IWETH(wethAddress);
    }

    /**
        routers[6] = 0x11DA6463D6Cb5a03411Dbf5ab6f6bc3997Ac7428;
        routers[7] = 0xd1EFe48B71Acd98Db16FcB9E7152B086647Ef544;
    }
     * @dev Only the contract owner can call this function.
     * @param tokens Array of token addresses.
     */
    function maxApprovals(address[] calldata tokens) external onlyOwner {
        for (uint i = 0; i < tokens.length; i++) {
            IERC20 token = IERC20(tokens[i]);
            if (!token.approve(donkeRouterAddress, type(uint96).max))
                revert ApprovalFailedError(tokens[i], donkeRouterAddress);
            if (!token.approve(dragonRouterAddress, type(uint96).max))
                revert ApprovalFailedError(tokens[i], dragonRouterAddress);
            if (!token.approve(yakaRouterAddress, type(uint96).max))
                revert ApprovalFailedError(tokens[i], yakaRouterAddress);
            if (!token.approve(jellyVaultAddress, type(uint96).max))
                revert ApprovalFailedError(tokens[i], jellyVaultAddress);
            if (!token.approve(universalRouterAddress, type(uint96).max))
                revert ApprovalFailedError(tokens[i], universalRouterAddress);
            for (uint j = 0; j < routerKeys.length; j++) {
                if (!token.approve(v3Routers[routerKeys[j]], type(uint96).max))
                    revert ApprovalFailedError(tokens[i], v3Routers[routerKeys[j]]);
            }
            
        }
    }

    /**
     * @notice Revokes the allowances for the specified tokens from the routers.
     * @dev Only the contract owner can call this function.
     * @param tokens Array of token addresses.
     */
    function revokeApprovals(address[] calldata tokens) external onlyOwner {
        for (uint i = 0; i < tokens.length; i++) {
            IERC20 token = IERC20(tokens[i]);
            if (!token.approve(donkeRouterAddress, 0))
                revert RevokeApprovalFailedError(tokens[i], donkeRouterAddress);
            if (!token.approve(dragonRouterAddress, 0))
                revert RevokeApprovalFailedError(
                    tokens[i],
                    dragonRouterAddress
                );
            if (!token.approve(yakaRouterAddress, 0))
                revert RevokeApprovalFailedError(tokens[i], yakaRouterAddress);
            if (!token.approve(jellyVaultAddress, 0))
                revert RevokeApprovalFailedError(
                    tokens[i],
                    jellyVaultAddress
                );
            if (!token.approve(universalRouterAddress, 0))
                revert RevokeApprovalFailedError(
                    tokens[i],
                    universalRouterAddress
                );
            for (uint j = 0; j < routerKeys.length; j++) {
                if (!token.approve(v3Routers[routerKeys[j]], 0))
                    revert RevokeApprovalFailedError(
                        tokens[i],
                        v3Routers[routerKeys[j]]
                    );
            }
        }
    }

    /**
     * @notice Sets the fee percentage for a particular operation.
     * @dev Only the contract owner can call this function.
     * @param _feePercentage The new fee percentage to be set.
     */
    function setFeePercentage(uint _feePercentage) external onlyOwner {
        feePercentage = _feePercentage;
    }

    /**
     * @notice Sets the new fee address where fees will be sent to.
     * @dev Only the contract owner can call this function.
     * @param _newFeeAddress The new fee address to be set.
     */
    function setFeeAddress(address _newFeeAddress) external onlyOwner {
        require(_newFeeAddress != address(0), "Invalid address");
        fee_address = _newFeeAddress;
    }

    /**
     * @notice Withdraws a specific ERC20 token from the contract to the specified address.
     * @dev Only the contract owner can call this function.
     * @param _token The address of the ERC20 token to be withdrawn.
     * @param _to The address that will receive the tokens.
     */
    function withdrawTokens(address _token, address _to) external onlyOwner {
        require(_to != address(0), "Invalid address");

        IERC20 token = IERC20(_token);
        uint256 balance = token.balanceOf(address(this));

        token.safeTransfer(_to, balance);
    }

    /**
     * @notice Withdraws the entire Ether balance from the contract to the specified address.
     * @dev Only the contract owner can call this function.
     * @param _to The address that will receive the Ether.
     */
    function withdrawEther(address payable _to) external onlyOwner {
        require(_to != address(0), "Invalid address");

        uint256 balance = address(this).balance;

        (bool success, ) = _to.call{value: balance}("");
        require(success, "Transfer failed");
    }

    /**
     * @notice Executes a token swap using the specified tokenIn, tokenOut, amountIn, and amountOutMin.
     * @dev Internal function used by executeSwaps.
     * @param tokenIn Address of the input token.
     * @param tokenOut Address of the output token.
     * @param amountIn Amount of input token to swap.
     * @return A struct containing the address of the output token and the amount of output tokens received.
     */
    function dragonSwap(
        address tokenIn,
        address tokenOut,
        uint amountIn
    ) internal returns (IPool.TokenAmount memory) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        uint deadline = block.timestamp + 20 minutes;
        uint[] memory amounts = dragonRouter.swapExactTokensForTokens(
            amountIn,
            0,
            path,
            address(this),
            deadline
        );

        IPool.TokenAmount memory tokenOutAmount;
        tokenOutAmount.token = tokenOut;
        tokenOutAmount.amount = amounts[amounts.length - 1];
        emit SwapExecuted(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            amounts[amounts.length - 1],
            1
        );
        return tokenOutAmount;
    }

    /**
     * @notice Executes a token swap using the specified tokenIn, tokenOut, amountIn, and amountOutMin.
     * @dev Internal function used by executeSwaps.
     * @param tokenIn Address of the input token.
     * @param tokenOut Address of the output token.
     * @param amountIn Amount of input token to swap.
     * @return A struct containing the address of the output token and the amount of output tokens received.
     */
    function yakaSwap(
        address tokenIn,
        address tokenOut,
        uint amountIn
    ) internal returns (IPool.TokenAmount memory) {
        route[] memory path = new route[](1);
        path[0] = route({
            from: tokenIn, // Replace with actual address
            to: tokenOut, // Replace with actual address
            stable: false  // Set the boolean value
        });

        
        uint deadline = block.timestamp + 20 minutes;
        uint[] memory amounts = yakaRouter.swapExactTokensForTokens(
            amountIn,
            0,
            path,
            address(this),
            deadline
        );
        IPool.TokenAmount memory tokenOutAmount;
        tokenOutAmount.token = tokenOut;
        tokenOutAmount.amount = amounts[amounts.length - 1];
        emit SwapExecuted(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            amounts[amounts.length - 1],
            2
        );
        return tokenOutAmount;
    }

    /**
     * @notice Executes a token swap using the specified tokenIn, tokenOut, amountIn, and amountOutMin.
     * @dev Internal function used by executeSwaps.
     * @param tokenIn Address of the input token.
     * @param tokenOut Address of the output token.
     * @param amountIn Amount of input token to swap.
     * @return A struct containing the address of the output token and the amount of output tokens received.
     */
    function donkeSwap(
        address tokenIn,
        address tokenOut,
        uint amountIn
    ) internal returns (IPool.TokenAmount memory) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        uint deadline = block.timestamp + 20 minutes;
        uint[] memory amounts = donkeRouter.swapExactTokensForTokens(
            amountIn,
            0,
            path,
            address(this),
            deadline
        );

        IPool.TokenAmount memory tokenOutAmount;
        tokenOutAmount.token = tokenOut;
        tokenOutAmount.amount = amounts[amounts.length - 1];
        emit SwapExecuted(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            amounts[amounts.length - 1],
            3
        );
        return tokenOutAmount;
    }

    function jellySwap(
        address tokenIn,
        address tokenOut,
        bytes32 poolId,
        uint256 amountIn
    ) internal returns (IPool.TokenAmount memory) {
        
        IVault.SingleSwap memory singleSwap = IVault.SingleSwap({
            poolId: poolId,
            kind: IVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(tokenIn),
            assetOut: IAsset(tokenOut),
            amount: amountIn,
            userData: ""
        });
        IVault.FundManagement memory funds = IVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });
        uint256 limit = 0;
        uint256 deadline = block.timestamp + 20 minutes;
        uint256 amountOut = jellyVault.swap(singleSwap, funds, limit, deadline);

        IPool.TokenAmount memory tokenOutAmount;
        tokenOutAmount.token = tokenOut;
        tokenOutAmount.amount = amountOut;
        emit SwapExecuted(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            4
        );
        return tokenOutAmount;
    }

    function uniswapV3Swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint24 fee
    ) internal returns (IPool.TokenAmount memory) {
        // Prepare the commands for the Universal Router
        IERC20(tokenIn).transfer(address(universalRouter), amountIn);
        bytes memory commands = abi.encodePacked(
            uint8(0x00) // V3_SWAP_EXACT_IN command
        );

        // Prepare the swap data
        bytes memory swapData = abi.encode(
            address(this), // recipient
            amountIn, // amountIn
            0, // amountOutMinimum
            abi.encodePacked(tokenIn, fee, tokenOut), // path
            false
        );

        // Prepare the inputs array
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = swapData;

        // Record the balance before the swap
        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));

        // Execute the swap using the Universal Router interface
        universalRouter.execute(commands, inputs);

        // Calculate the amount received
        uint256 balanceAfter = IERC20(tokenOut).balanceOf(address(this));
        uint256 amountOut = balanceAfter - balanceBefore;

        IPool.TokenAmount memory tokenOutAmount;
        tokenOutAmount.token = tokenOut;
        tokenOutAmount.amount = amountOut;

        emit SwapExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut, 5);

        return tokenOutAmount;
    }

    function uniswapV3ExactInputSingle(
        IUniswapV3SwapRouter uniswapV3SwapRouter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint24 fee
    ) internal returns (IPool.TokenAmount memory) {
        IUniswapV3SwapRouter.ExactInputSingleParams memory params = IUniswapV3SwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: address(this),
            amountIn: amountIn,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0 // No price limit
        });

        uint256 amountOut = uniswapV3SwapRouter.exactInputSingle(params);

        IPool.TokenAmount memory tokenOutAmount;
        tokenOutAmount.token = tokenOut;
        tokenOutAmount.amount = amountOut;

        emit SwapExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut, 6);

        return tokenOutAmount;
    }

    /**
     * @notice Executes a series of swap operations based on the provided swapParams.
     * @dev This function performs chained swaps dragonSwap functions.
     * @param swapParams Array of SwapParam structures containing swap details.
     * @param minTotalAmountOut Minimum total amount of output token expected.
     */
    function executeSwaps(
        Params.SwapParam[][] memory swapParams,
        uint minTotalAmountOut,
        bool conveth,
        FeeParams memory feeData
    ) external payable nonReentrant returns (uint) {
        address tokenG = swapParams[0][0].tokenIn;
        IERC20 token = IERC20(tokenG);
        uint256 totalAmountIn = 0;
        for (uint i = 0; i < swapParams.length; i++){
            totalAmountIn += swapParams[i][0].amountIn;
        }
        if (msg.value > 0) {
            weth.deposit{value: msg.value}();
            require(totalAmountIn == msg.value, "Invalid Input Amount");            
        } else {
            token.safeTransferFrom(msg.sender, address(this), totalAmountIn);
        } 
        address finalTokenAddress;
        uint finalTokenAmount;
        for (uint i = 0; i < swapParams.length; i++) {
            uint amountInCurrent = swapParams[i][0].amountIn;
            address pathFinalTokenAddress;
            uint pathFinalTokenAmount;
            for (uint j = 0; j < swapParams[i].length; j++) {
                Params.SwapParam memory param = swapParams[i][j];
                IPool.TokenAmount memory result;
                if (param.swapType == 1) {
                    result = dragonSwap(
                        param.tokenIn,
                        param.tokenOut,
                        amountInCurrent
                    );
                } else if (param.swapType == 2) {
                    result = yakaSwap(
                        param.tokenIn,
                        param.tokenOut,
                        amountInCurrent
                    );
                } else if (param.swapType == 3) {
                    result = donkeSwap(
                        param.tokenIn,
                        param.tokenOut,
                        amountInCurrent
                    );
                } else if (param.swapType == 4){
                    result = jellySwap(
                        param.tokenIn,
                        param.tokenOut,
                        param.poolAddress,
                        amountInCurrent
                    );
                }else if(param.swapType == 5){
                    result = uniswapV3Swap(
                        param.tokenIn,
                        param.tokenOut,
                        amountInCurrent,
                        param.fee
                    );
                }else if (checkRouter(param.swapType)) {
                    IUniswapV3SwapRouter uniswapV3SwapRouter = IUniswapV3SwapRouter(v3Routers[param.swapType]);
                    result = uniswapV3ExactInputSingle(
                        uniswapV3SwapRouter,
                        param.tokenIn,
                        param.tokenOut,
                        amountInCurrent,
                        param.fee
                    );
                } else {
                    revert("Invalid swap type");
                }
                amountInCurrent = result.amount; // Update for next swap in path
                pathFinalTokenAddress = result.token;
                pathFinalTokenAmount = result.amount;
            }
            if (i == 0) {
                finalTokenAddress = pathFinalTokenAddress;
            } else {
                require(pathFinalTokenAddress == finalTokenAddress,"Invalid path");
            }
            finalTokenAddress = pathFinalTokenAddress;
            finalTokenAmount += pathFinalTokenAmount;
        }
        if (finalTokenAmount < minTotalAmountOut)
            revert AmountLessThanMinRequiredError(
                finalTokenAmount,
                minTotalAmountOut
            );
        IERC20 finalToken = IERC20(finalTokenAddress);
        // Toplam çıkış hesaplamasından sonra:
        uint amountToTransfer  = _processFee(
            totalAmountIn,
            finalTokenAmount,
            tokenG,
            finalTokenAddress,
            feeData
        );

        if (conveth && finalTokenAddress == wethAddress) {
            weth.withdraw(amountToTransfer);
            (bool success, ) = msg.sender.call{value: amountToTransfer}("");
            if (!success) {
                revert TransferFailedError(
                    address(0),
                    msg.sender,
                    amountToTransfer
                );
            }
            emit PathsExecuted(
                msg.sender,
                swapParams,
                minTotalAmountOut,
                finalTokenAmount
            );
            return amountToTransfer;
        } else {
            finalToken.safeTransfer(msg.sender, amountToTransfer);
            emit PathsExecuted(
                msg.sender,
                swapParams,
                minTotalAmountOut,
                finalTokenAmount
            );
            return amountToTransfer;
        }
    }

    function _processFee(
        uint totalAmountIn,
        uint finalTokenAmount,
        address tokenG,
        address finalTokenAddress,
        FeeParams memory feeData
    ) internal returns (uint) {
        uint amountToTransfer;
        uint fee;
        if (feeData.feeAddress != address(0)){
            fee = (finalTokenAmount * feeData.paramFee) / 1000;
            uint feeShare = (fee * feeData.feeSharePercentage) / 1000;
            amountToTransfer = finalTokenAmount - fee;
            if (!IERC20(finalTokenAddress).transfer(fee_address, fee - feeShare))
                revert TransferFailedError(finalTokenAddress, fee_address, fee - feeShare );
            if (!IERC20(finalTokenAddress).transfer(feeData.feeAddress, feeShare))
                revert TransferFailedError(finalTokenAddress, feeData.feeAddress, feeShare);
            emit SwapReceipt(
                msg.sender,
                tokenG,
                finalTokenAddress,
                totalAmountIn,
                finalTokenAmount,
                feeData.paramFee,
                fee,
                feeData.feeAddress
            );
        }else {
            fee = (finalTokenAmount * feePercentage) / 1000;
            amountToTransfer = finalTokenAmount - fee;
            if (!IERC20(finalTokenAddress).transfer(fee_address, fee))
                revert TransferFailedError(finalTokenAddress, fee_address, fee);
            emit SwapReceipt(
                msg.sender,
                tokenG,
                finalTokenAddress,
                totalAmountIn,
                finalTokenAmount,
                feePercentage,
                fee,
                fee_address
            );
        }
        return amountToTransfer;
    }

    function checkRouter(uint routerKey) internal view returns (bool) {
        return abi.encodePacked(v3Routers[routerKey]).length > 0 ? true : false;
    }

    receive() external payable {}
}
