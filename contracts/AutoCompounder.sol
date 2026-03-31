// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//
//  AutoCompounder — NexVault Protocol v1.0
//  Public keeper contract for automated yield compounding.
//
//  SECURITY PROPERTIES:
//  ✓ Anyone can call batchCompound — permissionless keeper
//  ✓ All per-user failures are silent — one failure doesn't stop the batch
//  ✓ Cannot move any funds — only calls compoundForUser on the vault
//  ✓ Owner hardcoded — only owner can update vault address
//  ✓ Max 100 users per batch — prevents out-of-gas griefing
//  ✓ No stored user data — purely a pass-through keeper
//
//  NEXUS zkVM EXECUTION:
//  Every transaction on this contract is automatically proven by the Nexus
//  zkVM (v3.0) — a Stwo-backed zero-knowledge virtual machine running on
//  every Nexus node. NexVault deploys on NexusEVM (the EVM-compatible layer
//  of Nexus blockchain). No Solidity changes are needed: ZK proofs of all
//  execution are generated at the network verification layer automatically.
//
//  Proof pipeline:
//    Solidity → NexusEVM execution → Nexus zkVM proves it →
//    Universal Proof aggregated → ZK-verified on-chain state
//
//  Docs:  https://docs.nexus.xyz/zkvm
//  GitHub: https://github.com/nexus-xyz/nexus-zkvm
//
//
// ─────────────────────────────────────────────────────────────────────────────

interface IUSDXVault {
    function compoundForUser(address user, uint256 depositIndex) external;
    function getDepositCount(address user) external view returns (uint256);
}

/**
 * @title  AutoCompounder
 * @notice Permissionless keeper that compounds yield for multiple users
 *         in a single transaction. Anyone can run this as a keeper bot.
 *         Failures per-user are swallowed — the batch always completes.
 * @author NexVault Protocol
 */
contract AutoCompounder {

    // ── Immutable owner ────────────────────────────────────────────────
    address public constant OWNER =
        0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0;

    /// @notice Maximum users per batch (prevents out-of-gas)
    uint256 public constant MAX_BATCH = 100;

    /// @notice The USDXVault contract to compound into
    IUSDXVault public vault;

    // ── Events ─────────────────────────────────────────────────────────
    event BatchCompounded(
        uint256 attempted,
        uint256 succeeded,
        address indexed caller
    );
    event VaultUpdated(address indexed vault);

    // ── Modifier ───────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == OWNER, "AutoCompounder: not owner");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────
    constructor(address _vault) {
        require(
            msg.sender == OWNER,
            "AutoCompounder: must deploy from owner wallet"
        );
        require(_vault != address(0), "AutoCompounder: zero vault");
        vault = IUSDXVault(_vault);
        emit VaultUpdated(_vault);
    }

    // ── Admin ──────────────────────────────────────────────────────────

    /**
     * @notice Update vault address if needed (e.g., if vault is redeployed).
     * @param  _vault New USDXVault contract address.
     */
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "AutoCompounder: zero vault");
        vault = IUSDXVault(_vault);
        emit VaultUpdated(_vault);
    }

    // ── Compounding ────────────────────────────────────────────────────

    /**
     * @notice Compound yield for a batch of users and their deposit indices.
     *         Anyone can call — runs as a permissionless keeper.
     *         Per-user failures are swallowed silently.
     *
     * @param users          Array of wallet addresses to compound for.
     * @param depositIndices Array of deposit indices (parallel to users).
     */
    function batchCompound(
        address[] calldata users,
        uint256[] calldata depositIndices
    ) external {
        require(
            users.length == depositIndices.length,
            "AutoCompounder: array length mismatch"
        );
        require(
            users.length <= MAX_BATCH,
            "AutoCompounder: batch exceeds maximum"
        );

        uint256 succeeded = 0;
        uint256 len = users.length;

        for (uint256 i = 0; i < len; ) {
            try vault.compoundForUser(users[i], depositIndices[i]) {
                unchecked { succeeded++; }
            } catch {}
            unchecked { i++; }
        }

        emit BatchCompounded(users.length, succeeded, msg.sender);
    }

    /**
     * @notice Compound all active deposits for a single user.
     *         Iterates all deposit indices and compounds each one.
     *         Individual failures are swallowed.
     *
     * @param user The wallet to compound all deposits for.
     */
    function compoundAllForUser(address user) external {
        uint256 count = vault.getDepositCount(user);
        for (uint256 i = 0; i < count; ) {
            try vault.compoundForUser(user, i) {} catch {}
            unchecked { i++; }
        }
    }

    /**
     * @notice Compound a single specific deposit.
     * @param user         The depositor's wallet.
     * @param depositIndex The deposit index to compound.
     */
    function compoundSingle(address user, uint256 depositIndex) external {
        vault.compoundForUser(user, depositIndex);
    }
}
