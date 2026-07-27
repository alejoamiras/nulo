// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {ERC20} from "@oz/token/ERC20/ERC20.sol";

/**
 * @title TestUsdc
 * @notice The DP7 rehearsal token: permissionless capped `mint()` (the faucet's Mint button works)
 *         but NO Permit2 allowance override — holders start at ZERO allowance, exactly like real
 *         Circle USDC, so the testnet cutover genuinely exercises the app's one-time
 *         `approve(Permit2, max)` fallback. This is the deliberate middle ground D9/D17 name:
 *         plain OZ lacks `mint()`; `MintableERC20` auto-grants Permit2 and leaves the approve path
 *         dead code (codex F2/F4 + round-2 Critical #2). Manifest `token.source` stays
 *         "permissionless-mint" (it IS mintable); the difference from MintableERC20 is purely the
 *         missing auto-approval.
 *
 * @dev No allowlist, no owner — testnet-only. Per-call cap deters cheap pool manipulation, matching
 *      MintableERC20's shape so deploy tooling treats them alike.
 */
contract TestUsdc is ERC20 {
    uint8 private immutable _decimals;

    /// @notice Maximum amount mintable in a single `mint` call (base units).
    uint256 public immutable maxMintPerTx;

    error MintCapExceeded(uint256 requested, uint256 cap);

    /// @param maxWholePerTx Per-tx cap in WHOLE tokens; scaled by `decimals_`.
    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 maxWholePerTx)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
        maxMintPerTx = maxWholePerTx * (10 ** decimals_);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Permissionless mint, capped per call.
    function mint(address to, uint256 amount) external {
        if (amount > maxMintPerTx) revert MintCapExceeded(amount, maxMintPerTx);
        _mint(to, amount);
    }
}
