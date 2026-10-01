// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title OutcomeToken
/// @notice LONG or SHORT leg of a Rackrate series. 6 decimals: 1e6 units = 1 GPU for the whole series window.
///         Only the issuing series can mint or burn.
contract OutcomeToken is ERC20 {
    address public immutable series;

    error OnlySeries();

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        series = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != series) revert OnlySeries();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != series) revert OnlySeries();
        _burn(from, amount);
    }
}
