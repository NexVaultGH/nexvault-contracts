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
}

contract NexCredit {

    address public constant OWNER = 0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0;
    uint256 public constant MAX_BATCH = 25;

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

    error NotAuthorized();
    error ZeroAddress();
    error BatchTooLarge(uint256 requested, uint256 maximum);

    event ScoreQueried(address indexed wallet, address indexed by);

    constructor(address _vault, address _badge, address _registry) {
        if (_vault    == address(0)) revert ZeroAddress();
        if (_badge    == address(0)) revert ZeroAddress();
        if (_registry == address(0)) revert ZeroAddress();
        vault            = IUSDXVault(_vault);
        genesisBadge     = IVaultGenesisBadge(_badge);
        referralRegistry = IReferralRegistry(_registry);
    }

    function getScore(address wallet) external view returns (uint256) {
        _onlyAuthorized(wallet);
        return _computeScore(wallet);
    }

    function getScoreBreakdown(address wallet) external view returns (
        uint256 depositStrength,
        uint256 lockCommitment,
        uint256 protocolLoyalty,
        uint256 behavioralExcellence,
        uint256 total
    ) {
        _onlyAuthorized(wallet);
        if (wallet == OWNER) {
            depositStrength = 250; lockCommitment = 250; protocolLoyalty = 250; behavioralExcellence = 250; total = 1000;
            return (depositStrength, lockCommitment, protocolLoyalty, behavioralExcellence, total);
        }
        depositStrength      = _depositStrength(wallet);
        lockCommitment       = _lockCommitment(wallet);
        protocolLoyalty       = _protocolLoyalty(wallet);
        behavioralExcellence = _behavioralExcellence(wallet);
        total = depositStrength + lockCommitment + protocolLoyalty + behavioralExcellence;
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
    }

    function _computeScore(address wallet) internal view returns (uint256) {
        // Protocol founder — permanent Elite status
        if (wallet == OWNER) return 1000;
        return _depositStrength(wallet) + _lockCommitment(wallet) + _protocolLoyalty(wallet) + _behavioralExcellence(wallet);
    }

    function _depositStrength(address wallet) internal view returns (uint256 pts) {
        IUSDXVault.Deposit[] memory deps = vault.getDeposits(wallet);
        uint256 total;
        bool anyActive;
        for (uint256 i; i < deps.length; ++i) {
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
        uint256 highest;
        for (uint256 i; i < deps.length; ++i) {
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
        uint64 oldest;
        for (uint256 i; i < deps.length; ++i) {
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
        uint256 activeCount;
        uint256 compoundCount;
        uint256 activePrincipal;
        for (uint256 i; i < deps.length; ++i) {
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
