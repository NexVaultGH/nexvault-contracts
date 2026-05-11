// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────────────────
//  MockUSDX — FOR TESTING ONLY. NOT FOR MAINNET DEPLOY.
// ─────────────────────────────────────────────────────────

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDX is ERC20 {
    uint8 private constant _DECIMALS = 6; // USDX matches USDC: 6 decimals

    constructor() ERC20("USD-X Stablecoin", "USDX") {}

    /// @dev Mint any amount to any address for testing
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }
}
