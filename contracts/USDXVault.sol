// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

// ─────────────────────────────────────────────────────────────────────────────
//
//  USDXVault — NexVault Protocol v1.0
//  Core USDX savings vault on Nexus blockchain.
//
//  SECURITY PROPERTIES:
//  ✓ Owner hardcoded — 0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0
//  ✓ Only owner wallet can deploy (constructor enforces this)
//  ✓ CEI (Checks-Effects-Interactions) pattern throughout
//  ✓ ReentrancyGuard on all state-changing functions
//  ✓ SafeERC20 for all token transfers
//  ✓ Emergency pause blocks ONLY deposits — withdrawals always open
//  ✓ Owner can NEVER withdraw user principal — enforced by reserve check
//  ✓ No upgradeable proxy — deployed code is permanent
//  ✓ No flash loan surface — yield requires time elapsed
//  ✓ No price oracle — fixed APY constants only
//  ✓ No delegatecall — no external code execution risk
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
//  ✓ Genesis badge mint failure never blocks deposit (try/catch)
//  ✓ Referral registration failure never blocks deposit (try/catch)
//
//  YIELD TIERS:
//  LOCK_1YR  —  3.80% APY  — 365-day lock (1 year)
//  LOCK_3YR  —  4.10% APY  — 1095-day lock (3 years)
//  LOCK_5YR  —  4.44% APY  — 1825-day lock (5 years)
//
//  DEV CUT: 10% of all user yield accrued — funded from GYDS distributions
//
//  GYDS INTEGRATION:
//  NexVault is a registered USDX integrator on Nexus. Once the Global Yield
//  Distribution System (GYDS) is active, Nexus automatically distributes
//  protocol yield to this vault via the receiveYield() function.
//
//  GYDS YIELD COMPOSITION (per Nexus official documentation):
//  Base:    U.S. Treasury bill yield (~4.3-4.5% APY) via M0 framework
//  Layer 2: Nexus Exchange fee revenue (proportional to exchange volume)
//  Layer 3: Early NEX token overlay (time-limited, early integrator bonus)
//  Total:   Variable — floor is T-bill rate, ceiling grows with Nexus exchange
//
//  GYDS measures time-weighted USDX TVL weekly across registered app sources
//  and streams yield proportionally. No governance votes. No manual allocation.
//  The setGYDS() function registers the official GYDS distributor address.
//  Only the registered GYDS address may call receiveYield().
//
// ─────────────────────────────────────────────────────────────────────────────

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ── External contract interfaces ──────────────────────────────────────────────

interface IVaultGenesisBadge {
    function mint(address recipient) external returns (uint256 tokenId);
    function hasBadge(address wallet) external view returns (bool);
    function totalMinted() external view returns (uint256);
    function remaining() external view returns (uint256);
}

interface IReferralRegistry {
    function registerReferral(address user, address referrer) external;
    function getBonusBps(address referrer) external view returns (uint16);
}

/**
 * @title  USDXVault
 * @notice NexVault core savings vault. Users deposit USDX and earn fixed-rate
 *         yield powered by Nexus's Global Yield Distribution System (GYDS).
 *         All yield obligations to users take priority over dev earnings.
 * @author NexVault Protocol
 */
contract USDXVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Immutable owner — CANNOT be changed ───────────────────────────
    address public constant OWNER =
        0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0;

    // ── Execution environment — Nexus zkVM v3.0 ───────────────────────
    // These constants are permanently recorded on-chain, describing the
    // zero-knowledge execution environment this contract runs inside.
    // Every transaction is automatically proven by the Nexus zkVM running
    // on every node — no additional code or configuration required.
    string public constant EXECUTION_LAYER = "NexusEVM";
    string public constant PROOF_SYSTEM    = "Nexus zkVM v3.0";
    string public constant PROOF_PROVER    = "Stwo (StarkWare STARK)";
    string public constant ZKVM_DOCS       = "https://docs.nexus.xyz/zkvm";

    // ── Lock finality guarantee ────────────────────────────────────────
    // LOCK_IS_FINAL = true means: once a user deposits into a tier,
    // the chosen lock period CANNOT be shortened, bypassed, or cancelled
    // by anyone — including the owner. The choice of tier is PERMANENT.
    // Withdrawal before lockEndsAt is IMPOSSIBLE at the contract level.
    bool public constant LOCK_IS_FINAL = true;

    // ── Genesis badge limit ────────────────────────────────────────────
    uint256 public constant GENESIS_BADGE_LIMIT = 5_000;

    // ── Time constants ─────────────────────────────────────────────────
    uint256 public constant SECONDS_PER_YEAR  = 365 days;   // 31,536,000
    // ── APY constants in basis points (1 bps = 0.01%) ─────────────────
    uint256 public constant APY_1YR      = 380;   // 3.80%
    uint256 public constant APY_3YR      = 410;   // 4.10%
    uint256 public constant APY_5YR      = 444;   // 4.44%

    // ── Lock durations ─────────────────────────────────────────────────
    uint256 public constant LOCK_1YR  = 365 days;
    uint256 public constant LOCK_3YR  = 1095 days;
    uint256 public constant LOCK_5YR  = 1825 days;

    // ── Dev cut: 10% of all generated yield ───────────────────────────
    uint256 public constant DEV_CUT_BPS = 1_000; // 10.00%
    uint256 public constant BPS_BASE    = 10_000;

    // ── Yield tier enum ────────────────────────────────────────────────
    enum Tier { LOCK_1YR, LOCK_3YR, LOCK_5YR }

    // ── Per-deposit record (packed into 3 storage slots) ──────────────
    struct Deposit {
        uint128 principal;    // USDX amount (6 decimals)
        uint64  depositedAt;  // Unix timestamp of deposit
        uint64  lastYieldAt;  // Unix timestamp of last yield claim/compound
        uint64  lockEndsAt;   // Unlock timestamp
        Tier    tier;         // Yield tier
        bool    active;       // False after full withdrawal
    }

    // ── External contracts ─────────────────────────────────────────────
    IERC20             public immutable usdx;
    IVaultGenesisBadge public immutable genesisBadge;
    IReferralRegistry  public immutable referralRegistry;

    // ── Configurable addresses (set after deploy) ──────────────────────
    address public gyds;           // GYDS yield distributor (future hook)

    // ── Vault state ────────────────────────────────────────────────────
    bool    public paused;              // Emergency pause (deposits only)
    uint256 public totalPrincipal;      // Sum of all active deposit principals
    uint256 public devEarningsBalance;  // Accumulated dev earnings (claimable)

    // ── Per-user state ─────────────────────────────────────────────────
    mapping(address => Deposit[]) private _deposits;
    mapping(address => bool)      public  hasDeposited;       // first-deposit flag
    mapping(address => bool)      public  isCompoundOperator; // AutoCompounder auth

    // ── Events ─────────────────────────────────────────────────────────
    event Deposited(
        address indexed user,
        uint256 indexed depositIndex,
        uint256 amount,
        Tier    tier,
        uint64  lockEndsAt
    );
    event Withdrawn(
        address indexed user,
        uint256 indexed depositIndex,
        uint256 principal,
        uint256 userYield,
        uint256 devCut
    );
    event YieldClaimed(
        address indexed user,
        uint256 indexed depositIndex,
        uint256 userYield,
        uint256 devCut
    );
    event Compounded(
        address indexed user,
        uint256 indexed depositIndex,
        uint256 addedToPrincipal
    );
    event GenesisBadgeMinted(address indexed user, uint256 tokenId);
    event EmergencyPauseSet(bool paused);
    event GYDSSet(address indexed gyds);
    event CompoundOperatorSet(address indexed operator, bool authorized);
    event DevEarningsWithdrawn(uint256 amount, address indexed to);
    event GYDSYieldReceived(uint256 amount, address indexed from);

    // ── Custom errors (gas-efficient) ──────────────────────────────────
    error NotOwner();
    error DepositsPaused();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidDepositIndex();
    error DepositNotActive();
    error StillLocked(uint256 unlocksAt);        // lock period has not expired
    error InsufficientYieldBalance();
    error ExceedsDevEarnings();
    error WouldDipIntoPrincipal();
    error AmountOverflow();
    error MustDeployFromOwner();
    error NotGYDS();                              // caller is not the registered GYDS address
    error GYDSNotConfigured();                    // GYDS address has not been set yet
    error GYDSZeroAmount();                       // receiveYield called with zero amount
    error UnauthorizedCompoundCaller();           // caller is neither the user nor an authorized operator

    // ── Modifiers ──────────────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != OWNER) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert DepositsPaused();
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────

    /**
     * @notice Deploy the vault. MUST be called from the owner wallet.
     *         Enforced on-chain — any other deployer causes revert.
     * @param _usdx      Official USDX token address on Nexus mainnet.
     * @param _badge     Deployed VaultGenesisBadge contract address.
     * @param _registry  Deployed ReferralRegistry contract address.
     */
    constructor(
        address _usdx,
        address _badge,
        address _registry
    ) {
        if (msg.sender != OWNER)    revert MustDeployFromOwner();
        if (_usdx == address(0))    revert ZeroAddress();
        if (_badge == address(0))   revert ZeroAddress();
        if (_registry == address(0)) revert ZeroAddress();

        usdx             = IERC20(_usdx);
        genesisBadge     = IVaultGenesisBadge(_badge);
        referralRegistry = IReferralRegistry(_registry);
    }

    // ══════════════════════════════════════════════════════════════════
    //  ADMIN FUNCTIONS — onlyOwner (0x44e0...8ba0 ONLY)
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Set the GYDS yield distributor address.
     *         Called once at mainnet after Nexus publishes the GYDS address.
     *         Once set, GYDS will automatically push USDX yield to this vault
     *         by calling receiveYield(). This is what funds all user yield.
     */
    function setGYDS(address _gyds) external onlyOwner {
        if (_gyds == address(0)) revert ZeroAddress();
        gyds = _gyds;
        emit GYDSSet(_gyds);
    }

    /**
     * @notice Called by the Nexus GYDS contract to deposit protocol yield
     *         into the vault. This is the primary funding mechanism for
     *         all user yield obligations.
     *
     *         Only the registered GYDS address may call this function.
     *         GYDS pushes USDX here automatically once active on mainnet.
     *
     * @param amount Amount of USDX yield being deposited (6 decimals).
     */
    function receiveYield(uint256 amount) external nonReentrant {
        if (gyds == address(0))      revert GYDSNotConfigured();
        if (msg.sender != gyds)      revert NotGYDS();
        if (amount == 0)             revert GYDSZeroAmount();
        usdx.safeTransferFrom(msg.sender, address(this), amount);
        emit GYDSYieldReceived(amount, msg.sender);
    }

    /**
     * @notice Returns true if the GYDS yield distributor has been set.
     *         When false, the vault is in pre-GYDS mode — yield reserves
     *         must be seeded manually and deposit capacity should be capped.
     */
    function gydsActive() external view returns (bool) {
        return gyds != address(0);
    }

    /**
     * @notice Emergency pause — blocks new deposits ONLY.
     *         Withdrawals remain open at all times.
     *         Use if a security issue is detected.
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit EmergencyPauseSet(_paused);
    }

    /**
     * @notice Authorize or revoke an AutoCompounder operator.
     */
    function setCompoundOperator(
        address operator,
        bool    authorized
    ) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        isCompoundOperator[operator] = authorized;
        emit CompoundOperatorSet(operator, authorized);
    }

    /**
     * @notice Withdraw accumulated dev earnings (10% of all generated yield).
     *
     *         SAFETY GUARANTEE: This function enforces two checks before transfer:
     *         1. amount <= devEarningsBalance  (cannot exceed tracked earnings)
     *         2. contractBalance >= totalPrincipal + amount  (principal untouchable)
     *
     *         If either check fails, the transaction reverts. User principal is
     *         MATHEMATICALLY IMPOSSIBLE to withdraw through this function.
     *
     * @param amount Amount of USDX to withdraw (6 decimals).
     */
    function withdrawDevEarnings(uint256 amount) external nonReentrant onlyOwner {
        if (amount == 0)                  revert ZeroAmount();
        if (amount > devEarningsBalance)  revert ExceedsDevEarnings();

        // Critical invariant: owner can NEVER touch user principal
        uint256 vaultBalance = usdx.balanceOf(address(this));
        if (vaultBalance < totalPrincipal + amount) revert WouldDipIntoPrincipal();

        // Effects before interaction
        devEarningsBalance -= amount;

        // Interaction
        usdx.safeTransfer(OWNER, amount);

        emit DevEarningsWithdrawn(amount, OWNER);
    }

    // ══════════════════════════════════════════════════════════════════
    //  USER FUNCTIONS
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit USDX into the vault and start earning yield.
     *
     *         On first deposit:
     *         - Registers referral if provided (silent fail)
     *         - Mints a Vault Genesis badge if supply remaining (silent fail)
     *
     * @param amount   USDX amount to deposit (must be > 0, 6 decimals).
     * @param tier     Yield tier: LOCK_1YR, LOCK_3YR, or LOCK_5YR.
     * @param referrer Wallet that referred this user (address(0) if none).
     */
    function deposit(
        uint256 amount,
        Tier    tier,
        address referrer
    ) external nonReentrant whenNotPaused {
        // ── CHECKS ────────────────────────────────────────────────────
        if (amount == 0)                 revert ZeroAmount();
        if (amount > type(uint128).max)  revert AmountOverflow();

        // ── EFFECTS ───────────────────────────────────────────────────
        // All state changes occur before the external token transfer.
        // This follows strict CEI (Checks-Effects-Interactions) order.
        // If safeTransferFrom reverts below, Solidity rolls back all
        // state changes here automatically.
        uint64 now_    = uint64(block.timestamp);
        uint64 lockEnd = _lockEnd(tier, now_);

        _deposits[msg.sender].push(Deposit({
            principal:   uint128(amount),
            depositedAt: now_,
            lastYieldAt: now_,
            lockEndsAt:  lockEnd,
            tier:        tier,
            active:      true
        }));

        totalPrincipal += amount;
        uint256 depositIndex = _deposits[msg.sender].length - 1;

        // Track first-deposit status before any external calls
        bool isFirstDeposit = !hasDeposited[msg.sender];
        if (isFirstDeposit) {
            hasDeposited[msg.sender] = true;
        }

        // ── INTERACTION ───────────────────────────────────────────────
        // Token transfer is the primary external interaction.
        // nonReentrant prevents any ERC20 hook from reentering this function.
        // SafeERC20 reverts on failed transfer, rolling back all effects above.
        usdx.safeTransferFrom(msg.sender, address(this), amount);

        // ── FIRST-DEPOSIT SIDE EFFECTS ────────────────────────────────
        // Both wrapped in try/catch: failure never blocks a deposit.
        // These external calls execute after transfer succeeds —
        // nonReentrant still guards against reentrant callbacks.
        if (isFirstDeposit) {
            if (referrer != address(0) && referrer != msg.sender) {
                try referralRegistry.registerReferral(msg.sender, referrer) {}
                catch {}
            }
            try genesisBadge.mint(msg.sender) returns (uint256 tokenId) {
                emit GenesisBadgeMinted(msg.sender, tokenId);
            } catch {}
        }

        emit Deposited(msg.sender, depositIndex, amount, tier, lockEnd);
    }

    /**
     * @notice Withdraw principal and all accrued yield from a deposit.
     *         Closes the deposit record permanently.
     *
     *         All tiers are locked — not withdrawable before lockEndsAt.
     *
     * @param depositIndex Index in the caller's deposit array.
     */
    function withdraw(uint256 depositIndex) external nonReentrant {
        Deposit storage d = _getActiveDeposit(msg.sender, depositIndex);

        // ── Lock check — all tiers require lock to expire ─────────────
        if (block.timestamp < d.lockEndsAt) revert StillLocked(d.lockEndsAt);

        // ── Calculate amounts ─────────────────────────────────────────
        uint256 principal = d.principal;
        uint256 rawYield  = _calcYield(msg.sender, d);
        uint256 devCut    = rawYield * DEV_CUT_BPS / BPS_BASE;
        uint256 userYield = rawYield - devCut;
        uint256 totalOut  = principal + userYield;

        // ── Safety: vault must have enough to pay ─────────────────────
        if (usdx.balanceOf(address(this)) < totalOut)
            revert InsufficientYieldBalance();

        // ── Effects (before interaction — CEI pattern) ────────────────
        d.active         = false;
        totalPrincipal  -= principal;
        devEarningsBalance += devCut;

        // ── Interaction ───────────────────────────────────────────────
        usdx.safeTransfer(msg.sender, totalOut);

        emit Withdrawn(msg.sender, depositIndex, principal, userYield, devCut);
    }

    /**
     * @notice Claim accrued yield without withdrawing principal.
     *         Principal remains in the vault and continues earning.
     *
     *         All tiers: yield can be claimed anytime during the lock period.
     *
     * @param depositIndex Index in the caller's deposit array.
     */
    function claimYield(uint256 depositIndex) external nonReentrant {
        Deposit storage d = _getActiveDeposit(msg.sender, depositIndex);

        uint256 rawYield  = _calcYield(msg.sender, d);
        if (rawYield == 0) return; // nothing to claim — silent no-op

        uint256 devCut    = rawYield * DEV_CUT_BPS / BPS_BASE;
        uint256 userYield = rawYield - devCut;

        // Safety check: paying yield must not endanger user principals
        if (usdx.balanceOf(address(this)) < totalPrincipal + userYield)
            revert InsufficientYieldBalance();

        // Effects
        d.lastYieldAt = uint64(block.timestamp);
        devEarningsBalance += devCut;

        // Interaction
        usdx.safeTransfer(msg.sender, userYield);

        emit YieldClaimed(msg.sender, depositIndex, userYield, devCut);
    }

    /**
     * @notice Compound accrued yield back into principal.
     *         Can be called by the user themselves or an authorized AutoCompounder.
     *         Increases principal without a new deposit — gas efficient.
     *         No cooldown restriction (compounding doesn't move funds out).
     *
     * @param user         The depositor to compound for.
     * @param depositIndex Index in the user's deposit array.
     */
    function compoundForUser(
        address user,
        uint256 depositIndex
    ) external nonReentrant {
        if (msg.sender != user && !isCompoundOperator[msg.sender])
            revert UnauthorizedCompoundCaller();

        Deposit storage d = _getActiveDeposit(user, depositIndex);

        uint256 rawYield  = _calcYield(user, d);
        if (rawYield == 0) return; // nothing to compound

        uint256 devCut    = rawYield * DEV_CUT_BPS / BPS_BASE;
        uint256 addToP    = rawYield - devCut;

        // Prevent uint128 overflow (extremely unlikely with real deposits)
        if (uint256(d.principal) + addToP > type(uint128).max)
            revert AmountOverflow();

        // Effects — no transfer needed; yield stays in contract as principal
        d.principal    = uint128(uint256(d.principal) + addToP);
        d.lastYieldAt  = uint64(block.timestamp);
        totalPrincipal += addToP;
        devEarningsBalance += devCut;

        emit Compounded(user, depositIndex, addToP);
    }

    // ══════════════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Get all deposit records for a user.
     * @param  user The wallet address to query.
     * @return Array of Deposit structs (including inactive ones).
     */
    function getDeposits(address user)
        external
        view
        returns (Deposit[] memory)
    {
        return _deposits[user];
    }

    /**
     * @notice Get a single deposit record.
     */
    function getDeposit(address user, uint256 index)
        external
        view
        returns (Deposit memory)
    {
        require(index < _deposits[user].length, "USDXVault: invalid index");
        return _deposits[user][index];
    }

    /**
     * @notice Number of deposit records for a user (including closed ones).
     */
    function getDepositCount(address user) external view returns (uint256) {
        return _deposits[user].length;
    }

    /**
     * @notice Pending yield for a specific deposit (user's portion after dev cut).
     * @return userYield Amount the user would receive if claiming now.
     */
    function pendingYield(address user, uint256 depositIndex)
        external
        view
        returns (uint256 userYield)
    {
        if (depositIndex >= _deposits[user].length) return 0;
        Deposit storage d = _deposits[user][depositIndex];
        if (!d.active) return 0;

        uint256 raw    = _calcYield(user, d);
        uint256 devCut = raw * DEV_CUT_BPS / BPS_BASE;
        return raw - devCut;
    }

    /**
     * @notice Total pending yield across ALL active deposits for a user.
     */
    function totalPendingYield(address user)
        external
        view
        returns (uint256 total)
    {
        Deposit[] storage deps = _deposits[user];
        for (uint256 i = 0; i < deps.length; i++) {
            if (!deps[i].active) continue;
            uint256 raw    = _calcYield(user, deps[i]);
            uint256 devCut = raw * DEV_CUT_BPS / BPS_BASE;
            total += raw - devCut;
        }
    }

    /**
     * @notice APY for a given tier in basis points.
     */
    function tierAPY(Tier tier) external pure returns (uint256) {
        return _tierAPY(tier);
    }

    /**
     * @notice Lock duration for a given tier in seconds.
     */
    function tierLockDuration(Tier tier) external pure returns (uint256) {
        if (tier == Tier.LOCK_1YR) return LOCK_1YR;
        if (tier == Tier.LOCK_3YR) return LOCK_3YR;
        return LOCK_5YR;
    }

    /**
     * @notice Check vault financial health.
     * @return balance      Current USDX balance of the vault.
     * @return principal    Total user principal (must always be covered).
     * @return devBalance   Accumulated dev earnings available to withdraw.
     * @return surplus      Vault balance above principal (accrued yields + unallocated GYDS).
     * @return healthy      True if balance >= principal.
     */
    function vaultHealth() external view returns (
        uint256 balance,
        uint256 principal,
        uint256 devBalance,
        uint256 surplus,
        bool    healthy
    ) {
        balance    = usdx.balanceOf(address(this));
        principal  = totalPrincipal;
        devBalance = devEarningsBalance;
        surplus    = balance > principal ? balance - principal : 0;
        healthy    = balance >= principal;
    }

    /**
     * @notice Returns true if a deposit is currently inside its lock period.
     *         Withdrawal is IMPOSSIBLE when this returns true.
     *         LOCK_IS_FINAL guarantees this cannot be bypassed by anyone.
     * @param  user         The depositor's wallet.
     * @param  depositIndex Index in the user's deposit array.
     * @return locked       True while inside lock window, false after expiry.
     */
    function isLocked(address user, uint256 depositIndex)
        external
        view
        returns (bool locked)
    {
        if (depositIndex >= _deposits[user].length) return false;
        Deposit storage d = _deposits[user][depositIndex];
        if (!d.active) return false;
        return block.timestamp < d.lockEndsAt;
    }

    /**
     * @notice Seconds remaining until a deposit can be withdrawn.
     *         Returns 0 if the lock has already expired or the deposit is inactive.
     * @param  user         The depositor's wallet.
     * @param  depositIndex Index in the user's deposit array.
     * @return seconds_      Time remaining in the lock period.
     */
    function timeUntilUnlock(address user, uint256 depositIndex)
        external
        view
        returns (uint256 seconds_)
    {
        if (depositIndex >= _deposits[user].length) return 0;
        Deposit storage d = _deposits[user][depositIndex];
        if (!d.active) return 0;
        if (block.timestamp >= d.lockEndsAt) return 0;
        return d.lockEndsAt - block.timestamp;
    }

    /**
     * @notice Full lock status for a deposit in a single call.
     * @param  user            The depositor's wallet.
     * @param  depositIndex    Index in the user's deposit array.
     * @return lockEndsAt_     Unix timestamp when lock expires.
     * @return secondsLeft     Seconds remaining until unlock (0 if unlocked).
     * @return unlocked        True if the deposit can be withdrawn now.
     * @return tierName        Human-readable tier name.
     */
    function lockInfo(address user, uint256 depositIndex)
        external
        view
        returns (
            uint64  lockEndsAt_,
            uint256 secondsLeft,
            bool    unlocked,
            string memory tierName
        )
    {
        if (depositIndex >= _deposits[user].length) return (0, 0, false, "");
        Deposit storage d = _deposits[user][depositIndex];
        lockEndsAt_ = d.lockEndsAt;
        if (block.timestamp >= d.lockEndsAt) {
            secondsLeft = 0;
            unlocked    = true;
        } else {
            secondsLeft = d.lockEndsAt - block.timestamp;
            unlocked    = false;
        }
        if (d.tier == Tier.LOCK_1YR) tierName = "1-Year Lock (365 days)";
        else if (d.tier == Tier.LOCK_3YR) tierName = "3-Year Lock (1095 days)";
        else tierName = "5-Year Lock (1825 days)";
    }

    /**
     * @notice Returns the on-chain zkVM execution environment metadata.
     *         Every transaction in this contract is automatically proven by
     *         the Nexus zkVM v3.0. This function surfaces that fact on-chain.
     * @return executionLayer  "NexusEVM"
     * @return proofSystem     "Nexus zkVM v3.0"
     * @return prover          "Stwo (StarkWare STARK)"
     * @return docsUrl         Link to zkVM documentation
     */
    function zkVMInfo()
        external
        pure
        returns (
            string memory executionLayer,
            string memory proofSystem,
            string memory prover,
            string memory docsUrl
        )
    {
        return (EXECUTION_LAYER, PROOF_SYSTEM, PROOF_PROVER, ZKVM_DOCS);
    }

    // ══════════════════════════════════════════════════════════════════
    //  INTERNAL HELPERS
    // ══════════════════════════════════════════════════════════════════

    /**
     * @dev Fetch and validate an active deposit. Reverts with descriptive errors.
     * @param user  The depositor's wallet address.
     * @param index The index into the user's deposit array.
     * @return d    Storage reference to the validated deposit.
     */
    function _getActiveDeposit(address user, uint256 index)
        internal
        view
        returns (Deposit storage d)
    {
        if (index >= _deposits[user].length) revert InvalidDepositIndex();
        d = _deposits[user][index];
        if (!d.active) revert DepositNotActive();
    }

    /**
     * @dev Calculate raw yield for a deposit (before dev cut).
     *      Applies referral bonus to APY if the user is a referrer.
     *
     *      Formula: principal × (APY + referralBonus) × elapsed
     *               ─────────────────────────────────────────────
     *               SECONDS_PER_YEAR × BPS_BASE
     *
     *      NOTE ON block.timestamp: yield calculations use block.timestamp
     *      for elapsed time. Miners can manipulate this by ~±15 seconds.
     *      This is acceptable here because:
     *      (a) yield accrues continuously — no threshold cliff to exploit
     *      (b) 15 seconds of yield manipulation on any realistic deposit
     *          is negligible (< 0.00005% of principal for max APY)
     *      (c) lock expiry checks also use block.timestamp — the same
     *          15-second window applies symmetrically to both accrual and
     *          unlock, providing no economic exploit surface.
     *
     * @param user The depositor's wallet (used to look up referral bonus).
     * @param d    Storage reference to the deposit record.
     * @return     Raw yield amount in USDX (6 decimals), before dev cut.
     */
    function _calcYield(address user, Deposit storage d)
        internal
        view
        returns (uint256)
    {
        uint256 elapsed = block.timestamp - d.lastYieldAt;
        if (elapsed == 0) return 0;

        uint256 apy = _tierAPY(d.tier);

        // Add referral bonus — external view call wrapped in try/catch.
        // getBonusBps is a pure view; try/catch handles any unexpected revert.
        try referralRegistry.getBonusBps(user) returns (uint16 bonus) {
            apy += bonus;
        } catch {}

        // yield = principal × apy × elapsed / (SECONDS_PER_YEAR × BPS_BASE)
        // Multiplication order prevents overflow: principal (uint128, max ~3.4e38)
        // × apy (max 644 bps with full referral bonus) × elapsed (max ~1.5e8 for
        // 5 years) = max ~3.3e51, which fits in uint256 (max ~1.15e77).
        return uint256(d.principal) * apy * elapsed / (SECONDS_PER_YEAR * BPS_BASE);
    }

    /**
     * @dev APY basis points for a tier.
     * @param tier The yield tier enum value.
     * @return     APY in basis points (380, 410, or 444).
     */
    function _tierAPY(Tier tier) internal pure returns (uint256) {
        if (tier == Tier.LOCK_1YR) return APY_1YR;
        if (tier == Tier.LOCK_3YR) return APY_3YR;
        return APY_5YR;
    }

    /**
     * @dev Lock expiry timestamp for a given tier and deposit time.
     * @param tier The yield tier enum value.
     * @param now_ The deposit timestamp (block.timestamp at deposit).
     * @return     Unix timestamp when the lock expires.
     */
    function _lockEnd(Tier tier, uint64 now_) internal pure returns (uint64) {
        if (tier == Tier.LOCK_1YR) return now_ + uint64(LOCK_1YR);
        if (tier == Tier.LOCK_3YR) return now_ + uint64(LOCK_3YR);
        return now_ + uint64(LOCK_5YR);
    }
}
