// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Rackrate Test Dollar (rrUSD)
/// @notice Testnet-only collateral token with a rate-limited public faucet.
///         It is NOT a stablecoin and has no value. The constructor mints an initial
///         supply to a disclosed holder, used to seed test market-maker liquidity.
contract RRUSD is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    mapping(address account => uint256 timestamp) public lastClaim;

    event FaucetClaimed(address indexed account, uint256 amount);

    error FaucetCooldown(uint256 availableAt);

    constructor(address initialHolder, uint256 initialSupply) ERC20("Rackrate Test Dollar", "rrUSD") {
        if (initialSupply > 0) _mint(initialHolder, initialSupply);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Claim FAUCET_AMOUNT test dollars, at most once per FAUCET_COOLDOWN.
    function faucet() external {
        uint256 last = lastClaim[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }
}
