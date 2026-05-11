// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

interface IUSDXVault {
    enum Tier { LOCK_1YR, LOCK_3YR, LOCK_5YR }
    struct Deposit {
        uint128 principal;
        uint64  depositedAt;
        uint64  lastYieldAt;
        uint64  lockEndsAt;
        Tier    tier;
        bool    active;
    }
    function getDeposits(address user) external view returns (Deposit[] memory);
    function getDepositCount(address user) external view returns (uint256);
}

interface IVaultGenesisBadge {
    function hasBadge(address wallet) external view returns (bool);
}

interface IReferralRegistry {
    function getReferralCount(address referrer) external view returns (uint256);
    function getReferrals(address referrer) external view returns (address[] memory);
}

contract NexCredit {

    address public constant OWNER = 0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0;
    uint256 public constant MAX_BATCH = 25;
    uint256 public constant MAX_PENALTY = 200;

    uint256 private constant THRESH_5K   =   5_000_000000;
    uint256 private constant THRESH_25K  =  25_000_000000;
    uint256 private constant THRESH_100K = 100_000_000000;

    uint64 private constant DAYS_60   =  60 days;
    uint64 private constant DAYS_180  = 180 days;
    uint64 private constant DAYS_365  = 365 days;
    uint64 private constant DAYS_730  = 730 days;
    uint64 private constant DAYS_1095 = 1095 days;

    IUSDXVault         public immutable vault;
    IVaultGenesisBadge public immutable genesisBadge;
    IReferralRegistry  public immutable referralRegistry;

    // ── Penalty System ──────────────────────────────────────
    // Penalties are applied by OWNER for negative credit events
    // (late lending payments, defaults, protocol violations).
    // Max total penalty per wallet: 200 points.
    mapping(address => uint256) public penalties;

    error NotAuthorized();
    error ZeroAddress();
    error ZeroAmount();
    error BatchTooLarge(uint256 requested, uint256 maximum);
    error PenaltyExceedsMax(uint256 requested, uint256 maximum);

    event ScoreQueried(address indexed wallet, address indexed by);
    event PenaltyApplied(address indexed wallet, uint256 points, string reason);
    event PenaltyReduced(address indexed wallet, uint256 points, string reason);

    constructor(address _vault, address _badge, address _registry) {
        if (_vault    == address(0)) revert ZeroAddress();
        if (_badge    == address(0)) revert ZeroAddress();
        if (_registry == address(0)) revert ZeroAddress();
        vault            = IUSDXVault(_vault);
        genesisBadge     = IVaultGenesisBadge(_badge);
        referralRegistry = IReferralRegistry(_registry);
    }

    // ── Penalty Management (OWNER only) ─────────────────────

    /// @notice Apply a penalty to a wallet's credit score
    /// @param wallet The wallet to penalize
    /// @param points Number of points to deduct (max total 200)
    /// @param reason Human-readable reason for the penalty
    function applyPenalty(address wallet, uint256 points, string calldata reason) external {
        if (msg.sender != OWNER) revert NotAuthorized();
        if (wallet == address(0)) revert ZeroAddress();
        if (points == 0) revert ZeroAmount();
        if (penalties[wallet] + points > MAX_PENALTY) revert PenaltyExceedsMax(penalties[wallet] + points, MAX_PENALTY);
        penalties[wallet] += points;
        emit PenaltyApplied(wallet, points, reason);
    }

    /// @notice Reduce a penalty (for good behavior recovery)
    /// @param wallet The wallet to reduce penalty for
    /// @param points Number of points to restore
    /// @param reason Human-readable reason for the reduction
    function reducePenalty(address wallet, uint256 points, string calldata reason) external {
        if (msg.sender != OWNER) revert NotAuthorized();
        if (wallet == address(0)) revert ZeroAddress();
        if (points == 0) revert ZeroAmount();
        if (points > penalties[wallet]) {
            penalties[wallet] = 0;
        } else {
            penalties[wallet] -= points;
        }
        emit PenaltyReduced(wallet, points, reason);
    }

    /// @notice Get the total penalty points for a wallet
    function getPenalty(address wallet) external view returns (uint256) {
        _onlyAuthorized(wallet);
        return _totalPenalty(wallet);
    }

    // ── Score Queries ────────────────────────────────────────

    function getScore(address wallet) external view returns (uint256) {
        _onlyAuthorized(wallet);
        return _computeScore(wallet);
    }

    function getScoreBreakdown(address wallet) external view returns (
        uint256 depositStrength,
        uint256 lockCommitment,
        uint256 protocolLoyalty,
        uint256 behavioralExcellence,
        uint256 penaltyDeductions,
        uint256 total
    ) {
        _onlyAuthorized(wallet);
        if (wallet == OWNER) {
            return (250, 250, 250, 250, 0, 1000);
        }
        depositStrength      = _depositStrength(wallet);
        lockCommitment       = _lockCommitment(wallet);
        protocolLoyalty       = _protocolLoyalty(wallet);
        behavioralExcellence = _behavioralExcellence(wallet);
        penaltyDeductions    = _totalPenalty(wallet);
        uint256 raw = depositStrength + lockCommitment + protocolLoyalty + behavioralExcellence;
        total = raw > penaltyDeductions ? raw - penaltyDeductions : 0;
    }

    function getScoreLabel(address wallet) external view returns (string memory) {
        _onlyAuthorized(wallet);
        return _tierLabel(_computeScore(wallet));
    }

    function getScoreBatch(address[] calldata wallets) external view returns (uint256[] memory scores) {
        if (msg.sender != OWNER) revert NotAuthorized();
        if (wallets.length > MAX_BATCH) revert BatchTooLarge(wallets.length, MAX_BATCH);
        scores = new uint256[](wallets.length);
        for (uint256 i = 0; i < wallets.length; ++i) {
            scores[i] = _computeScore(wallets[i]);
        }
        return scores;
    }

    // ── Internal Scoring ─────────────────────────────────────

    function _computeScore(address wallet) internal view returns (uint256) {
        // Protocol founder — permanent Elite status
        if (wallet == OWNER) return 1000;
        uint256 raw = _depositStrength(wallet) + _lockCommitment(wallet) + _protocolLoyalty(wallet) + _behavioralExcellence(wallet);
        uint256 pen = _totalPenalty(wallet);
        return raw > pen ? raw - pen : 0;
    }

    /// @notice Total penalty = admin penalties + dynamic referral inactivity penalty
    function _totalPenalty(address wallet) internal view returns (uint256) {
        uint256 adminPen = penalties[wallet];
        uint256 refPen   = _referralInactivityPenalty(wallet);
        return adminPen + refPen;
    }

    /// @notice If a user's referrals become inactive (withdraw all deposits),
    ///         the referral bonus points are reduced proportionally.
    ///         Each inactive referral costs 15 points (max 60 = all 4 referrals inactive).
    function _referralInactivityPenalty(address wallet) internal view returns (uint256 pen) {
        try referralRegistry.getReferrals(wallet) returns (address[] memory refs) {
            for (uint256 i = 0; i < refs.length; ++i) {
                if (!_hasActiveDeposit(refs[i])) {
                    pen += 15; // 15 pts per inactive referral
                }
            }
        } catch {
            // If registry call fails, no penalty
        }
    }

    /// @notice Check if a wallet has at least one active deposit
    function _hasActiveDeposit(address wallet) internal view returns (bool) {
        try vault.getDeposits(wallet) returns (IUSDXVault.Deposit[] memory deps) {
            for (uint256 i = 0; i < deps.length; ++i) {
                if (deps[i].active) return true;
            }
        } catch {}
        return false;
    }

    function _depositStrength(address wallet) internal view returns (uint256 pts) {
        IUSDXVault.Deposit[] memory deps = vault.getDeposits(wallet);
        uint256 total = 0;
        bool anyActive = false;
        for (uint256 i = 0; i < deps.length; ++i) {
            if (deps[i].active) { anyActive = true; total += deps[i].principal; }
        }
        if (!anyActive) return 0;
        pts = 30;
        if (total >= THRESH_5K)   pts += 50;
        if (total >= THRESH_25K)  pts += 80;
        if (total >= THRESH_100K) pts += 90;
    }

    function _lockCommitment(address wallet) internal view returns (uint256 pts) {
        IUSDXVault.Deposit[] memory deps = vault.getDeposits(wallet);
        uint256 highest = 0;
        for (uint256 i = 0; i < deps.length; ++i) {
            if (!deps[i].active) continue;
            uint256 t = uint256(deps[i].tier) + 1;
            if (t > highest) highest = t;
        }
        if      (highest == 3) pts = 250;
        else if (highest == 2) pts = 80;
        else if (highest == 1) pts = 20;
    }

    function _protocolLoyalty(address wallet) internal view returns (uint256 pts) {
        IUSDXVault.Deposit[] memory deps = vault.getDeposits(wallet);
        uint64 oldest = 0;
        for (uint256 i = 0; i < deps.length; ++i) {
            if (!deps[i].active) continue;
            uint64 da = deps[i].depositedAt;
            if (oldest == 0 || da < oldest) oldest = da;
        }
        if (oldest == 0) return 0;
        uint64 age = uint64(block.timestamp) - oldest;
        if      (age >= DAYS_1095) pts = 250;
        else if (age >= DAYS_730)  pts = 175;
        else if (age >= DAYS_365)  pts = 100;
        else if (age >= DAYS_180)  pts =  50;
        else if (age >= DAYS_60)   pts =  20;
    }

    function _behavioralExcellence(address wallet) internal view returns (uint256 pts) {
        IUSDXVault.Deposit[] memory deps = vault.getDeposits(wallet);
        uint256 activeCount = 0;
        uint256 compoundCount = 0;
        uint256 activePrincipal = 0;
        for (uint256 i = 0; i < deps.length; ++i) {
            if (deps[i].active) { activeCount++; activePrincipal += deps[i].principal; }
            if (deps[i].lastYieldAt > deps[i].depositedAt) compoundCount++;
        }
        if (compoundCount >= 3) pts += 30;
        if (deps.length >= 5) pts += 50;
        if (referralRegistry.getReferralCount(wallet) >= 3) pts += 60;
        if (genesisBadge.hasBadge(wallet) && activePrincipal >= THRESH_5K) pts += 60;
        if (activeCount >= 2) pts += 50;
    }

    function _onlyAuthorized(address wallet) private view {
        if (msg.sender != wallet && msg.sender != OWNER) revert NotAuthorized();
    }

    function _tierLabel(uint256 score) internal pure returns (string memory) {
        if (score == 0)    return "No History";
        if (score <= 149)  return "Dormant";
        if (score <= 299)  return "Building";
        if (score <= 499)  return "Established";
        if (score <= 699)  return "Trusted";
        if (score <= 849)  return "Senior";
        return "Elite";
    }
}
