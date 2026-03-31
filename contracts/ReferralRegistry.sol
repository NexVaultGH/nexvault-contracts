// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

// ─────────────────────────────────────────────────────────────────────────────
//
//  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗ █████╗ ██╗   ██╗██╗  ████████╗
//  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔══██╗██║   ██║██║  ╚══██╔══╝
//  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████║██║   ██║██║     ██║
//  ██║╚██╗██║██╔══╝   ██╔██╗ ╚██╗ ██╔╝██╔══██║██║   ██║██║     ██║
//  ██║ ╚████║███████╗██╔╝ ██╗ ╚████╔╝ ██║  ██║╚██████╔╝███████╗██║
//  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝
//
//  ReferralRegistry — NexVault Protocol v1.0
//  Tracks referral relationships for APY bonus distribution.
//
//  SECURITY PROPERTIES:
//  ✓ Owner hardcoded — no ownership transfer possible
//  ✓ Vault authorization required to register referrals
//  ✓ All failures are silent — never blocks a deposit
//  ✓ One referrer per user — cannot be overwritten
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
//  ✓ Self-referral blocked
//  ✓ Max 4 referrals per address (bonus cap)
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title  ReferralRegistry
 * @notice Tracks referral relationships for NexVault yield bonuses.
 *         Referrers earn +50 basis points APY per active referral,
 *         capped at +200 bps (4 referrals). Never blocks deposits.
 * @author NexVault Protocol
 */
contract ReferralRegistry {

    // ── Immutable owner — CANNOT be changed after deploy ──────────────
    address public constant OWNER =
        0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0;

    // ── Execution environment — Nexus zkVM v3.0 ───────────────────────
    string public constant EXECUTION_LAYER = "NexusEVM";
    string public constant PROOF_SYSTEM    = "Nexus zkVM v3.0";

    // ── Custom errors ──────────────────────────────────────────────────
    error NotOwner();
    error ZeroAddress();

    // ── Referral economics ─────────────────────────────────────────────
    uint16 public constant BONUS_PER_REFERRAL_BPS = 50;   // +0.50% per referral
    uint16 public constant MAX_BONUS_BPS          = 200;  // +2.00% maximum
    uint8  public constant MAX_REFERRALS          = 4;    // 4 referrals = max bonus

    // ── State ──────────────────────────────────────────────────────────
    /// @notice Maps user → who referred them (address(0) = no referrer)
    mapping(address => address)   public referrerOf;

    /// @notice Maps referrer → array of wallets they referred
    mapping(address => address[]) private _referralsOf;

    /// @notice Vaults authorised to register referrals
    mapping(address => bool) public authorizedVaults;

    // ── Events ─────────────────────────────────────────────────────────
    event ReferralRegistered(
        address indexed user,
        address indexed referrer,
        uint256 referralCount
    );
    event VaultAuthorized(address indexed vault, bool authorized);

    // ── Modifiers ──────────────────────────────────────────────────────
    // ── Additional custom errors ───────────────────────────────────────
    error UnauthorizedVault();

    modifier onlyOwner() {
        if (msg.sender != OWNER) revert NotOwner();
        _;
    }

    modifier onlyAuthorizedVault() {
        if (!authorizedVaults[msg.sender]) revert UnauthorizedVault();
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────
    constructor() {
        if (msg.sender != OWNER) revert NotOwner();
    }

    // ── Admin ──────────────────────────────────────────────────────────

    /**
     * @notice Authorize or revoke a vault contract's ability to register referrals.
     * @param vault      The vault contract address.
     * @param authorized True to authorize, false to revoke.
     */
    function setVaultAuthorization(
        address vault,
        bool    authorized
    ) external onlyOwner {
        if (vault == address(0)) revert ZeroAddress();
        authorizedVaults[vault] = authorized;
        emit VaultAuthorized(vault, authorized);
    }

    // ── Referral registration ──────────────────────────────────────────

    /**
     * @notice Register a referral relationship.
     *         Called by USDXVault on a user's FIRST deposit only.
     *         Silently ignores all invalid conditions — never reverts.
     * @param user     The new depositor.
     * @param referrer The wallet that referred them.
     */
    function registerReferral(
        address user,
        address referrer
    ) external onlyAuthorizedVault {
        // All validations fail silently — must never block a deposit
        if (user == address(0))          return;
        if (referrer == address(0))      return;
        if (user == referrer)            return; // no self-referral
        if (referrerOf[user] != address(0)) return; // already registered
        if (_referralsOf[referrer].length >= MAX_REFERRALS) return; // cap reached

        referrerOf[user] = referrer;
        _referralsOf[referrer].push(user);

        emit ReferralRegistered(user, referrer, _referralsOf[referrer].length);
    }

    // ── View functions ─────────────────────────────────────────────────

    /**
     * @notice Get the APY bonus in basis points for a referrer.
     *         Returns 0 if the address has no referrals.
     * @param  referrer The wallet to check.
     * @return bps      Bonus basis points (0–200).
     */
    function getBonusBps(address referrer) external view returns (uint16 bps) {
        uint256 count = _referralsOf[referrer].length;
        if (count == 0) return 0;
        uint256 bonus = count * BONUS_PER_REFERRAL_BPS;
        return uint16(bonus > MAX_BONUS_BPS ? MAX_BONUS_BPS : bonus);
    }

    /**
     * @notice Return all wallets referred by an address.
     * @param  referrer The referrer to look up.
     * @return Array of referred wallet addresses.
     */
    function getReferrals(address referrer)
        external
        view
        returns (address[] memory)
    {
        return _referralsOf[referrer];
    }

    /**
     * @notice How many wallets has an address referred?
     */
    function getReferralCount(address referrer)
        external
        view
        returns (uint256)
    {
        return _referralsOf[referrer].length;
    }
}
