// interfaces/Interfaces.sol

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

interface IWETH {
    function deposit() external payable;

    function transfer(address to, uint value) external returns (bool);

    function withdraw(uint) external;

    function balanceOf(address account) external view returns (uint256);
}

interface IPool {
    struct TokenAmount {
        address token;
        uint amount;
    }
}

interface IDragonRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

struct route {
    address from;
    address to;
    bool stable;
}

struct FeeParams {
    uint256 paramFee;
    address feeAddress;
    uint256 feeSharePercentage;
}

interface IYakaRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        route[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IDonkeRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface Params {
    struct SwapParam {
        bytes32 poolAddress;
        address tokenIn;
        address tokenOut;
        uint amountIn;
        uint amountOutMin;
        uint swapType;
        uint24 fee;
    }
}


interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs)
        external
        payable;

}

interface IUniswapV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee; // pool fee
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}