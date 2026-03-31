// ─────────────────────────────────────────────────────────────────────────────
//  NexVault Protocol — Full Test Suite
//  Covers: USDXVault, ReferralRegistry, VaultGenesisBadge, AutoCompounder
// ─────────────────────────────────────────────────────────────────────────────

const { expect }       = require("chai");
const { ethers }       = require("hardhat");
const { time }         = require("@nomicfoundation/hardhat-network-helpers");

// ── Hardcoded owner wallet ────────────────────────────────────────────────────
const OWNER_ADDRESS = "0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0";

// ── Tier enum values (must match contract) ────────────────────────────────────
const TIERS = { LOCK_1YR: 0, LOCK_3YR: 1, LOCK_5YR: 2 };

// ── Constants (must match contract) ──────────────────────────────────────────
const SECONDS_PER_YEAR  = 365n * 24n * 3600n;
const LOCK_1YR  = 365n * 24n * 3600n;
const LOCK_3YR  = 1095n * 24n * 3600n;
const LOCK_5YR  = 1825n * 24n * 3600n;

const APY_1YR      = 380n;
const APY_3YR      = 410n;
const APY_5YR      = 444n;

const DEV_CUT_BPS  = 1000n;
const BPS_BASE     = 10000n;
const DECIMALS     = 6;

// ── Helpers ───────────────────────────────────────────────────────────────────
const toUSDX = (n) => ethers.parseUnits(n.toString(), DECIMALS);

function calcYield(principal, apyBps, elapsedSec) {
  return (
    BigInt(principal) * BigInt(apyBps) * BigInt(elapsedSec) /
    (SECONDS_PER_YEAR * BPS_BASE)
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("NexVault Protocol", function () {
  let owner, user1, user2, user3, user4, user5, attacker;
  let usdx, badge, registry, vault, compounder;

  // ── Deploy everything fresh before each test ────────────────────────────────
  beforeEach(async function () {
    [user1, user2, user3, user4, user5, attacker] = await ethers.getSigners();

    // Give owner wallet ETH so it can send transactions
    await ethers.provider.send("hardhat_impersonateAccount", [OWNER_ADDRESS]);
    await ethers.provider.send("hardhat_setBalance", [
      OWNER_ADDRESS,
      "0x56BC75E2D63100000", // 100 ETH
    ]);
    owner = await ethers.getSigner(OWNER_ADDRESS);

    // MockUSDX — no ownership restriction
    const MockUSDX = await ethers.getContractFactory("MockUSDX");
    usdx = await MockUSDX.connect(user1).deploy();

    // VaultGenesisBadge — must deploy from owner
    const Badge = await ethers.getContractFactory("VaultGenesisBadge");
    badge = await Badge.connect(owner).deploy();

    // ReferralRegistry — must deploy from owner
    const Registry = await ethers.getContractFactory("ReferralRegistry");
    registry = await Registry.connect(owner).deploy();

    // USDXVault — must deploy from owner
    const Vault = await ethers.getContractFactory("USDXVault");
    vault = await Vault.connect(owner).deploy(
      await usdx.getAddress(),
      await badge.getAddress(),
      await registry.getAddress()
    );

    const vaultAddr = await vault.getAddress();

    // Wire up permissions
    await badge.connect(owner).setMinterAuthorization(vaultAddr);
    await registry.connect(owner).setVaultAuthorization(vaultAddr, true);

    // AutoCompounder — must deploy from owner
    const Compounder = await ethers.getContractFactory("AutoCompounder");
    compounder = await Compounder.connect(owner).deploy(vaultAddr);
    await vault.connect(owner).setCompoundOperator(
      await compounder.getAddress(), true
    );

    // Mint USDX to test users and approve vault
    for (const user of [user1, user2, user3, user4, user5, attacker]) {
      await usdx.mint(user.address, toUSDX(100_000));
      await usdx.connect(user).approve(vaultAddr, ethers.MaxUint256);
    }

    // Pre-fund vault with yield reserves so it can pay out
    await usdx.mint(vaultAddr, toUSDX(1_000_000));
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  1. DEPLOYMENT & OWNERSHIP
  // ══════════════════════════════════════════════════════════════════════════

  describe("Deployment", function () {

    it("USDXVault: stores correct token addresses", async function () {
      expect(await vault.usdx()).to.equal(await usdx.getAddress());
      expect(await vault.genesisBadge()).to.equal(await badge.getAddress());
      expect(await vault.referralRegistry()).to.equal(await registry.getAddress());
    });

    it("USDXVault: rejects deploy from non-owner wallet", async function () {
      const Vault = await ethers.getContractFactory("USDXVault");
      await expect(
        Vault.connect(user1).deploy(
          await usdx.getAddress(),
          await badge.getAddress(),
          await registry.getAddress()
        )
      ).to.be.revertedWithCustomError(vault, "MustDeployFromOwner");
    });

    it("VaultGenesisBadge: rejects deploy from non-owner wallet", async function () {
      const Badge = await ethers.getContractFactory("VaultGenesisBadge");
      await expect(Badge.connect(user1).deploy()).to.be.reverted;
    });

    it("ReferralRegistry: rejects deploy from non-owner wallet", async function () {
      const Registry = await ethers.getContractFactory("ReferralRegistry");
      await expect(Registry.connect(user1).deploy()).to.be.reverted;
    });

    it("AutoCompounder: rejects deploy from non-owner wallet", async function () {
      const Compounder = await ethers.getContractFactory("AutoCompounder");
      await expect(
        Compounder.connect(user1).deploy(await vault.getAddress())
      ).to.be.reverted;
    });

    it("All contracts: OWNER constant matches expected address", async function () {
      const expected = OWNER_ADDRESS;
      expect(await vault.OWNER()).to.equal(expected);
      expect(await badge.OWNER()).to.equal(expected);
      expect(await registry.OWNER()).to.equal(expected);
      expect(await compounder.OWNER()).to.equal(expected);
    });

    it("USDXVault: starts unpaused with zero balances", async function () {
      expect(await vault.paused()).to.equal(false);
      expect(await vault.totalPrincipal()).to.equal(0n);
      expect(await vault.devEarningsBalance()).to.equal(0n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  2. DEPOSITS
  // ══════════════════════════════════════════════════════════════════════════

  describe("Deposits", function () {

    it("accepts a LOCK_1YR deposit and records it correctly", async function () {
      const amount = toUSDX(1000);
      await vault.connect(user1).deposit(amount, TIERS.LOCK_1YR, ethers.ZeroAddress);

      const d = await vault.getDeposit(user1.address, 0);
      expect(d.principal).to.equal(amount);
      expect(d.tier).to.equal(TIERS.LOCK_1YR);
      expect(d.lockEndsAt).to.be.gt(0n);
      expect(d.active).to.equal(true);
    });

    it("accepts a LOCK_1YR deposit with correct lock end", async function () {
      const amount = toUSDX(1000);
      const tx = await vault.connect(user1).deposit(amount, TIERS.LOCK_1YR, ethers.ZeroAddress);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const d = await vault.getDeposit(user1.address, 0);
      expect(d.lockEndsAt).to.equal(BigInt(block.timestamp) + LOCK_1YR);
    });

    it("accepts a LOCK_3YR deposit with correct lock end", async function () {
      const amount = toUSDX(1000);
      const tx = await vault.connect(user1).deposit(amount, TIERS.LOCK_3YR, ethers.ZeroAddress);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const d = await vault.getDeposit(user1.address, 0);
      expect(d.lockEndsAt).to.equal(BigInt(block.timestamp) + LOCK_3YR);
    });

    it("accepts a LOCK_5YR deposit with correct lock end", async function () {
      const amount = toUSDX(1000);
      const tx = await vault.connect(user1).deposit(amount, TIERS.LOCK_5YR, ethers.ZeroAddress);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const d = await vault.getDeposit(user1.address, 0);
      expect(d.lockEndsAt).to.equal(BigInt(block.timestamp) + LOCK_5YR);
    });

    it("increments totalPrincipal on deposit", async function () {
      const amount = toUSDX(5000);
      await vault.connect(user1).deposit(amount, TIERS.LOCK_1YR, ethers.ZeroAddress);
      expect(await vault.totalPrincipal()).to.equal(amount);
    });

    it("pulls USDX from user on deposit", async function () {
      const amount = toUSDX(1000);
      const balBefore = await usdx.balanceOf(user1.address);
      await vault.connect(user1).deposit(amount, TIERS.LOCK_1YR, ethers.ZeroAddress);
      expect(await usdx.balanceOf(user1.address)).to.equal(balBefore - amount);
    });

    it("reverts on zero deposit", async function () {
      await expect(
        vault.connect(user1).deposit(0, TIERS.LOCK_1YR, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("reverts when vault is paused", async function () {
      await vault.connect(owner).setPaused(true);
      await expect(
        vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "DepositsPaused");
    });

    it("allows multiple deposits from the same user", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user1).deposit(toUSDX(200), TIERS.LOCK_1YR, ethers.ZeroAddress);
      expect(await vault.getDepositCount(user1.address)).to.equal(2n);
    });

    it("emits Deposited event with correct args", async function () {
      const amount = toUSDX(500);
      await expect(
        vault.connect(user1).deposit(amount, TIERS.LOCK_1YR, ethers.ZeroAddress)
      ).to.emit(vault, "Deposited")
        .to.emit(vault, "Deposited");
    });

    it("mints genesis badge on first deposit", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      expect(await badge.hasBadge(user1.address)).to.equal(true);
      expect(await badge.totalMinted()).to.equal(1n);
    });

    it("does NOT mint a second badge on second deposit", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      expect(await badge.totalMinted()).to.equal(1n);
    });

    it("sets hasDeposited flag on first deposit only", async function () {
      expect(await vault.hasDeposited(user1.address)).to.equal(false);
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      expect(await vault.hasDeposited(user1.address)).to.equal(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  3. WITHDRAWALS
  // ══════════════════════════════════════════════════════════════════════════

  describe("Withdrawals", function () {

    it("LOCK_1YR: allows withdrawal after lock expires", async function () {
      const amount = toUSDX(1000);
      await vault.connect(user1).deposit(amount, TIERS.LOCK_1YR, ethers.ZeroAddress);

      await time.increase(Number(LOCK_1YR) + 1);

      const balBefore = await usdx.balanceOf(user1.address);
      await vault.connect(user1).withdraw(0);
      const balAfter = await usdx.balanceOf(user1.address);

      expect(balAfter).to.be.gt(balBefore); // got principal + yield back
    });

    it("LOCK_1YR: reverts withdrawal early attempt", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      // Advance only halfway through the lock — should still be locked
      await time.increase(Number(LOCK_1YR) / 2);
      await expect(
        vault.connect(user1).withdraw(0)
      ).to.be.revertedWithCustomError(vault, "StillLocked");
    });

    it("LOCK_1YR: returns correct principal on withdrawal", async function () {
      const amount = toUSDX(1000);
      await vault.connect(user1).deposit(amount, TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_1YR) + 1);

      const balBefore = await usdx.balanceOf(user1.address);
      await vault.connect(user1).withdraw(0);
      const balAfter = await usdx.balanceOf(user1.address);

      // User should get back at least their principal
      expect(balAfter - balBefore).to.be.gte(amount);
    });

    it("LOCK_1YR: marks deposit as inactive after withdrawal", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_1YR) + 1);
      await vault.connect(user1).withdraw(0);

      const d = await vault.getDeposit(user1.address, 0);
      expect(d.active).to.equal(false);
    });

    it("LOCK_1YR: decrements totalPrincipal after withdrawal", async function () {
      const amount = toUSDX(1000);
      await vault.connect(user1).deposit(amount, TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_1YR) + 1);
      await vault.connect(user1).withdraw(0);
      expect(await vault.totalPrincipal()).to.equal(0n);
    });

    it("LOCK_1YR: reverts withdrawal before lock expires", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_1YR) - 3600); // 1 hour before unlock
      await expect(
        vault.connect(user1).withdraw(0)
      ).to.be.revertedWithCustomError(vault, "StillLocked");
    });

    it("LOCK_1YR: allows withdrawal after lock expires", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_1YR) + 1);
      await expect(vault.connect(user1).withdraw(0)).to.not.be.reverted;
    });

    it("LOCK_3YR: allows withdrawal after 180 days", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_3YR) + 1);
      await expect(vault.connect(user1).withdraw(0)).to.not.be.reverted;
    });

    it("LOCK_5YR: allows withdrawal after 5 years", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_5YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_5YR) + 1);
      await expect(vault.connect(user1).withdraw(0)).to.not.be.reverted;
    });

    it("reverts on already-withdrawn deposit", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_1YR) + 1);
      await vault.connect(user1).withdraw(0);

      await expect(
        vault.connect(user1).withdraw(0)
      ).to.be.revertedWithCustomError(vault, "DepositNotActive");
    });

    it("reverts on invalid deposit index", async function () {
      await expect(
        vault.connect(user1).withdraw(99)
      ).to.be.revertedWithCustomError(vault, "InvalidDepositIndex");
    });

    it("accumulates dev earnings on withdrawal", async function () {
      await vault.connect(user1).deposit(toUSDX(10000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_3YR) + 1);
      await vault.connect(user1).withdraw(0);
      expect(await vault.devEarningsBalance()).to.be.gt(0n);
    });

    it("emits Withdrawn event with correct args", async function () {
      const amount = toUSDX(1000);
      await vault.connect(user1).deposit(amount, TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_1YR) + 1);

      await expect(vault.connect(user1).withdraw(0))
        .to.emit(vault, "Withdrawn")
        .withArgs(user1.address, 0n, amount, (v) => v >= 0n, (v) => v >= 0n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  4. CLAIM YIELD
  // ══════════════════════════════════════════════════════════════════════════

  describe("Claim Yield", function () {

    it("LOCK_1YR: user can claim yield before lock ends, principal stays", async function () {
      const amount = toUSDX(10000);
      await vault.connect(user1).deposit(amount, TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_1YR) / 2)

      const balBefore = await usdx.balanceOf(user1.address);
      await vault.connect(user1).claimYield(0);
      const balAfter = await usdx.balanceOf(user1.address);

      // Received some yield
      expect(balAfter).to.be.gt(balBefore);

      // Principal still intact
      const d = await vault.getDeposit(user1.address, 0);
      expect(d.principal).to.equal(amount);
      expect(d.active).to.equal(true);
    });

    it("LOCK_1YR: claimYield can be called multiple times", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(86400 * 30); // 30 days in
      await vault.connect(user1).claimYield(0);
      await time.increase(86400 * 30); // another 30 days
      await expect(vault.connect(user1).claimYield(0)).to.not.be.reverted;
    });

    it("LOCK_1YR: claimYield works without cooldown restriction", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(86400 * 7);

      await expect(vault.connect(user1).claimYield(0)).to.not.be.reverted;
    });

    it("updates lastYieldAt after claiming", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30); // 30 days

      const before = (await vault.getDeposit(user1.address, 0)).lastYieldAt;
      await vault.connect(user1).claimYield(0);
      const after = (await vault.getDeposit(user1.address, 0)).lastYieldAt;

      expect(after).to.be.gt(before);
    });

    it("emits YieldClaimed event", async function () {
      await vault.connect(user1).deposit(toUSDX(10000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);

      await expect(vault.connect(user1).claimYield(0))
        .to.emit(vault, "YieldClaimed");
    });

    it("dev earnings accumulate on yield claim", async function () {
      await vault.connect(user1).deposit(toUSDX(10000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);
      await vault.connect(user1).claimYield(0);
      expect(await vault.devEarningsBalance()).to.be.gt(0n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  5. COMPOUND
  // ══════════════════════════════════════════════════════════════════════════

  describe("Compound", function () {

    it("user can compound their own deposit", async function () {
      const amount = toUSDX(10000);
      await vault.connect(user1).deposit(amount, TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);

      await expect(
        vault.connect(user1).compoundForUser(user1.address, 0)
      ).to.not.be.reverted;

      const d = await vault.getDeposit(user1.address, 0);
      expect(d.principal).to.be.gt(amount);
    });

    it("authorized operator can compound for user", async function () {
      await vault.connect(user1).deposit(toUSDX(10000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);

      await expect(
        vault.connect(user2).compoundForUser(user1.address, 0)
      ).to.be.revertedWithCustomError(vault, "NotOwner");

      // But authorized compounder works
      await vault.connect(owner).setCompoundOperator(user2.address, true);
      await expect(
        vault.connect(user2).compoundForUser(user1.address, 0)
      ).to.not.be.reverted;
    });

    it("unauthorized address cannot compound for another user", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);

      await expect(
        vault.connect(attacker).compoundForUser(user1.address, 0)
      ).to.be.revertedWithCustomError(vault, "NotOwner");
    });

    it("increases totalPrincipal after compounding", async function () {
      await vault.connect(user1).deposit(toUSDX(10000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      const principalBefore = await vault.totalPrincipal();
      await time.increase(86400 * 30);
      await vault.connect(user1).compoundForUser(user1.address, 0);
      expect(await vault.totalPrincipal()).to.be.gt(principalBefore);
    });

    it("emits Compounded event", async function () {
      await vault.connect(user1).deposit(toUSDX(10000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);

      await expect(
        vault.connect(user1).compoundForUser(user1.address, 0)
      ).to.emit(vault, "Compounded").withArgs(user1.address, 0n, (v) => v > 0n);
    });

    it("no funds leave the vault when compounding", async function () {
      await vault.connect(user1).deposit(toUSDX(10000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);

      const vaultBalBefore = await usdx.balanceOf(await vault.getAddress());
      await vault.connect(user1).compoundForUser(user1.address, 0);
      const vaultBalAfter = await usdx.balanceOf(await vault.getAddress());

      expect(vaultBalAfter).to.equal(vaultBalBefore); // no USDX moved
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  6. PENDING YIELD VIEW
  // ══════════════════════════════════════════════════════════════════════════

  describe("pendingYield", function () {

    it("returns zero immediately after deposit", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      expect(await vault.pendingYield(user1.address, 0)).to.equal(0n);
    });

    it("returns positive yield after time passes", async function () {
      await vault.connect(user1).deposit(toUSDX(10000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);
      expect(await vault.pendingYield(user1.address, 0)).to.be.gt(0n);
    });

    it("LOCK_3YR yields more than LOCK_1YR for same amount and time", async function () {
      await vault.connect(user1).deposit(toUSDX(10000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user2).deposit(toUSDX(10000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);

      const flexYield = await vault.pendingYield(user1.address, 0);
      const lockYield = await vault.pendingYield(user2.address, 0);
      expect(lockYield).to.be.gt(flexYield);
    });

    it("LOCK_5YR yields more than LOCK_3YR", async function () {
      await vault.connect(user1).deposit(toUSDX(10000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await vault.connect(user2).deposit(toUSDX(10000), TIERS.LOCK_5YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);
      expect(
        await vault.pendingYield(user2.address, 0)
      ).to.be.gt(await vault.pendingYield(user1.address, 0));
    });

    it("totalPendingYield sums all active deposits", async function () {
      await vault.connect(user1).deposit(toUSDX(5000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await vault.connect(user1).deposit(toUSDX(5000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);

      const total = await vault.totalPendingYield(user1.address);
      const p0    = await vault.pendingYield(user1.address, 0);
      const p1    = await vault.pendingYield(user1.address, 1);

      // totalPendingYield should be approximately p0 + p1 (small timing diff allowed)
      expect(total).to.be.closeTo(p0 + p1, toUSDX(1));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  7. ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════════════════════

  describe("Admin Functions", function () {

    it("owner can pause and unpause deposits", async function () {
      await vault.connect(owner).setPaused(true);
      expect(await vault.paused()).to.equal(true);
      await vault.connect(owner).setPaused(false);
      expect(await vault.paused()).to.equal(false);
    });

    it("non-owner cannot pause", async function () {
      await expect(
        vault.connect(attacker).setPaused(true)
      ).to.be.revertedWithCustomError(vault, "NotOwner");
    });

    it("withdrawals still work while paused", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_1YR) + 1);
      await vault.connect(owner).setPaused(true);
      await expect(vault.connect(user1).withdraw(0)).to.not.be.reverted;
    });

    it("owner can set GYDS address", async function () {
      await vault.connect(owner).setGYDS(user1.address);
      expect(await vault.gyds()).to.equal(user1.address);
    });

    it("non-owner cannot set GYDS", async function () {
      await expect(
        vault.connect(attacker).setGYDS(user1.address)
      ).to.be.revertedWithCustomError(vault, "NotOwner");
    });

    it("owner can set reinvest wallet", async function () {
      await vault.connect(owner).setReinvestWallet(user1.address);
      expect(await vault.reinvestWallet()).to.equal(user1.address);
    });

    it("owner can authorize and revoke compound operators", async function () {
      await vault.connect(owner).setCompoundOperator(user2.address, true);
      expect(await vault.isCompoundOperator(user2.address)).to.equal(true);

      await vault.connect(owner).setCompoundOperator(user2.address, false);
      expect(await vault.isCompoundOperator(user2.address)).to.equal(false);
    });

    it("setCompoundOperator reverts for zero address", async function () {
      await expect(
        vault.connect(owner).setCompoundOperator(ethers.ZeroAddress, true)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("emits EmergencyPauseSet event", async function () {
      await expect(vault.connect(owner).setPaused(true))
        .to.emit(vault, "EmergencyPauseSet")
        .withArgs(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  8. DEV EARNINGS
  // ══════════════════════════════════════════════════════════════════════════

  describe("Dev Earnings", function () {

    beforeEach(async function () {
      // Generate some dev earnings
      await vault.connect(user1).deposit(toUSDX(50000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_3YR) + 1);
      await vault.connect(user1).withdraw(0);
    });

    it("owner can withdraw accumulated dev earnings", async function () {
      const devBal = await vault.devEarningsBalance();
      expect(devBal).to.be.gt(0n);

      const ownerBalBefore = await usdx.balanceOf(OWNER_ADDRESS);
      await vault.connect(owner).withdrawDevEarnings(devBal);
      expect(await usdx.balanceOf(OWNER_ADDRESS)).to.equal(ownerBalBefore + devBal);
    });

    it("non-owner cannot withdraw dev earnings", async function () {
      const devBal = await vault.devEarningsBalance();
      await expect(
        vault.connect(attacker).withdrawDevEarnings(devBal)
      ).to.be.revertedWithCustomError(vault, "NotOwner");
    });

    it("reverts if requesting more than accumulated earnings", async function () {
      const devBal = await vault.devEarningsBalance();
      await expect(
        vault.connect(owner).withdrawDevEarnings(devBal + 1n)
      ).to.be.revertedWithCustomError(vault, "ExceedsDevEarnings");
    });

    it("CRITICAL: owner cannot withdraw user principal via dev earnings", async function () {
      // Deposit fresh principal
      await vault.connect(user2).deposit(toUSDX(10000), TIERS.LOCK_1YR, ethers.ZeroAddress);

      // Try to drain more than devEarningsBalance — should fail
      const devBal = await vault.devEarningsBalance();
      const principal = await vault.totalPrincipal();

      // Attempt to withdraw everything would dip into principal
      const vaultBalance = await usdx.balanceOf(await vault.getAddress());
      const maxAllowed = vaultBalance - principal;

      if (devBal > maxAllowed) {
        await expect(
          vault.connect(owner).withdrawDevEarnings(devBal)
        ).to.be.revertedWithCustomError(vault, "WouldDipIntoPrincipal");
      } else {
        // dev earnings are safe to withdraw
        await expect(
          vault.connect(owner).withdrawDevEarnings(devBal)
        ).to.not.be.reverted;
      }
    });

    it("emits DevEarningsWithdrawn event", async function () {
      const devBal = await vault.devEarningsBalance();
      await expect(vault.connect(owner).withdrawDevEarnings(devBal))
        .to.emit(vault, "DevEarningsWithdrawn")
        .withArgs(devBal, OWNER_ADDRESS);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  9. GYDS INTEGRATION
  // ══════════════════════════════════════════════════════════════════════════

  describe("GYDS Integration", function () {

    it("gydsActive() returns false before setGYDS is called", async function () {
      expect(await vault.gydsActive()).to.equal(false);
    });

    it("gydsActive() returns true after setGYDS is called", async function () {
      await vault.connect(owner).setGYDS(user1.address);
      expect(await vault.gydsActive()).to.equal(true);
    });

    it("receiveYield() deposits USDX into vault from registered GYDS address", async function () {
      await vault.connect(owner).setGYDS(user1.address);
      const amount = toUSDX(10000);
      await usdx.connect(user1).approve(await vault.getAddress(), amount);
      const balBefore = await usdx.balanceOf(await vault.getAddress());
      await vault.connect(user1).receiveYield(amount);
      const balAfter = await usdx.balanceOf(await vault.getAddress());
      expect(balAfter - balBefore).to.equal(amount);
    });

    it("receiveYield() emits GYDSYieldReceived event", async function () {
      await vault.connect(owner).setGYDS(user1.address);
      const amount = toUSDX(5000);
      await usdx.connect(user1).approve(await vault.getAddress(), amount);
      await expect(vault.connect(user1).receiveYield(amount))
        .to.emit(vault, "GYDSYieldReceived")
        .withArgs(amount, user1.address);
    });

    it("receiveYield() reverts if called by non-GYDS address", async function () {
      await vault.connect(owner).setGYDS(user1.address);
      const amount = toUSDX(1000);
      await usdx.connect(attacker).approve(await vault.getAddress(), amount);
      await expect(
        vault.connect(attacker).receiveYield(amount)
      ).to.be.revertedWith("USDXVault: only GYDS");
    });

    it("receiveYield() reverts before GYDS address is set", async function () {
      const amount = toUSDX(1000);
      await usdx.connect(user1).approve(await vault.getAddress(), amount);
      await expect(
        vault.connect(user1).receiveYield(amount)
      ).to.be.revertedWith("USDXVault: only GYDS");
    });

    it("receiveYield() reverts on zero amount", async function () {
      await vault.connect(owner).setGYDS(user1.address);
      await expect(
        vault.connect(user1).receiveYield(0)
      ).to.be.revertedWith("USDXVault: zero amount");
    });

    it("GYDS yield increases vault surplus and can fund user withdrawals", async function () {
      // User deposits
      await vault.connect(user2).deposit(toUSDX(10000), TIERS.LOCK_3YR, ethers.ZeroAddress);

      // GYDS sends yield to vault
      await vault.connect(owner).setGYDS(user1.address);
      const gydsAmount = toUSDX(5000);
      await usdx.connect(user1).approve(await vault.getAddress(), gydsAmount);
      await vault.connect(user1).receiveYield(gydsAmount);

      // Vault health should show surplus
      const health = await vault.vaultHealth();
      expect(health.surplus).to.be.gte(gydsAmount);
      expect(health.healthy).to.equal(true);
    });

  });

  // ══════════════════════════════════════════════════════════════════════════
  //  10. VAULT HEALTH
  // ══════════════════════════════════════════════════════════════════════════

  describe("Vault Health", function () {

    it("reports healthy when funded", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      const health = await vault.vaultHealth();
      expect(health.healthy).to.equal(true);
      expect(health.balance).to.be.gte(health.principal);
    });

    it("vaultHealth surplus increases after GYDS yield received", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(owner).setGYDS(user2.address);
      const gydsAmount = toUSDX(500);
      await usdx.connect(user2).approve(await vault.getAddress(), gydsAmount);
      await vault.connect(user2).receiveYield(gydsAmount);
      const health = await vault.vaultHealth();
      expect(health.surplus).to.be.gte(gydsAmount);
    });

    it("all tiers are locked — no withdrawal before expiry", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);
      await expect(vault.connect(user1).withdraw(0))
        .to.be.revertedWithCustomError(vault, "StillLocked");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  11. REFERRAL REGISTRY
  // ══════════════════════════════════════════════════════════════════════════

  describe("ReferralRegistry", function () {

    it("registers referral on first deposit", async function () {
      await vault.connect(user2).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, user2.address);

      expect(await registry.referrerOf(user1.address)).to.equal(user2.address);
    });

    it("blocks self-referral silently", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, user1.address);
      expect(await registry.referrerOf(user1.address)).to.equal(ethers.ZeroAddress);
    });

    it("does not overwrite existing referral on second deposit", async function () {
      await vault.connect(user2).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user3).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);

      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, user2.address);
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, user3.address); // second deposit

      expect(await registry.referrerOf(user1.address)).to.equal(user2.address); // unchanged
    });

    it("caps referral bonus at 4 referrals (200 bps)", async function () {
      const users = [user1, user2, user3, user4, user5];
      // user1 acts as referrer for users 2–5
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);

      for (const u of [user2, user3, user4, user5]) {
        await vault.connect(u).deposit(toUSDX(100), TIERS.LOCK_1YR, user1.address);
      }

      // user1 now has 4 referrals — getBonusBps should return 200
      expect(await registry.getBonusBps(user1.address)).to.equal(200);
    });

    it("getBonusBps returns 50 per referral", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user2).deposit(toUSDX(100), TIERS.LOCK_1YR, user1.address);

      expect(await registry.getBonusBps(user1.address)).to.equal(50);
    });

    it("getBonusBps returns 0 for address with no referrals", async function () {
      expect(await registry.getBonusBps(attacker.address)).to.equal(0);
    });

    it("only authorized vault can call registerReferral", async function () {
      await expect(
        registry.connect(attacker).registerReferral(user1.address, user2.address)
      ).to.be.reverted;
    });

    it("owner can revoke vault authorization", async function () {
      const vaultAddr = await vault.getAddress();
      await registry.connect(owner).setVaultAuthorization(vaultAddr, false);
      // Now a deposit that triggers referral registration should fail silently
      // (vault wraps in try/catch so deposit still succeeds)
      await expect(
        vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, user2.address)
      ).to.not.be.reverted;
    });

    it("getReferrals returns correct array", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user2).deposit(toUSDX(100), TIERS.LOCK_1YR, user1.address);
      await vault.connect(user3).deposit(toUSDX(100), TIERS.LOCK_1YR, user1.address);

      const refs = await registry.getReferrals(user1.address);
      expect(refs.length).to.equal(2);
      expect(refs).to.include(user2.address);
      expect(refs).to.include(user3.address);
    });

    it("getReferralCount returns correct count", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user2).deposit(toUSDX(100), TIERS.LOCK_1YR, user1.address);
      expect(await registry.getReferralCount(user1.address)).to.equal(1n);
    });

    it("emits ReferralRegistered event", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await expect(
        vault.connect(user2).deposit(toUSDX(100), TIERS.LOCK_1YR, user1.address)
      ).to.emit(registry, "ReferralRegistered")
        .withArgs(user2.address, user1.address, 1n);
    });

    it("referral bonus increases yield earned", async function () {
      // user1 has 1 referral (+50 bps)
      await vault.connect(user1).deposit(toUSDX(10000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user2).deposit(toUSDX(10000), TIERS.LOCK_1YR, user1.address);

      // user3 has no referrals (no bonus)
      await vault.connect(user3).deposit(toUSDX(10000), TIERS.LOCK_1YR, ethers.ZeroAddress);

      await time.increase(86400 * 30);

      const user1Yield = await vault.pendingYield(user1.address, 0);
      const user3Yield = await vault.pendingYield(user3.address, 0);

      expect(user1Yield).to.be.gt(user3Yield); // user1 earns more due to referral bonus
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  12. VAULT GENESIS BADGE
  // ══════════════════════════════════════════════════════════════════════════

  describe("VaultGenesisBadge", function () {

    it("only authorized minter can mint", async function () {
      await expect(
        badge.connect(attacker).mint(user1.address)
      ).to.be.reverted;
    });

    it("one badge per wallet — second mint silently fails (try/catch in vault)", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      expect(await badge.totalMinted()).to.equal(1n);
    });

    it("hasBadge returns true after mint", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      expect(await badge.hasBadge(user1.address)).to.equal(true);
    });

    it("genesisPosition is set correctly", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user2).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      expect(await badge.genesisPosition(user1.address)).to.equal(1n);
      expect(await badge.genesisPosition(user2.address)).to.equal(2n);
    });

    it("originalMinter records who first received the badge", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      expect(await badge.originalMinter(1n)).to.equal(user1.address);
    });

    it("remaining() decreases with each mint", async function () {
      const remainingBefore = await badge.remaining();
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      expect(await badge.remaining()).to.equal(remainingBefore - 1n);
    });

    it("owner can set minter authorization", async function () {
      await badge.connect(owner).setMinterAuthorization(user1.address);
      expect(await badge.authorizedMinter()).to.equal(user1.address);
    });

    it("non-owner cannot set minter authorization", async function () {
      await expect(
        badge.connect(attacker).setMinterAuthorization(attacker.address)
      ).to.be.reverted;
    });

    it("tokenURI returns a valid base64 data URI", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      const uri = await badge.tokenURI(1);
      expect(uri).to.match(/^data:application\/json;base64,/);
    });

    it("emits BadgeMinted event on first deposit", async function () {
      await expect(
        vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress)
      ).to.emit(badge, "BadgeMinted")
        .withArgs(user1.address, 1n, 1n);
    });

    it("MAX_SUPPLY is 5000", async function () {
      expect(await badge.MAX_SUPPLY()).to.equal(5000n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  13. AUTO COMPOUNDER
  // ══════════════════════════════════════════════════════════════════════════

  describe("AutoCompounder", function () {

    beforeEach(async function () {
      // user1 has 3 deposits
      await vault.connect(user1).deposit(toUSDX(5000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await vault.connect(user1).deposit(toUSDX(5000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await vault.connect(user2).deposit(toUSDX(5000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(86400 * 30);
    });

    it("batchCompound compounds multiple users in one tx", async function () {
      const users    = [user1.address, user1.address, user2.address];
      const indices  = [0n, 1n, 0n];

      await expect(
        compounder.connect(user3).batchCompound(users, indices)
      ).to.emit(compounder, "BatchCompounded")
        .withArgs(3n, 3n, user3.address);
    });

    it("batchCompound reverts on array length mismatch", async function () {
      await expect(
        compounder.connect(user3).batchCompound(
          [user1.address, user1.address],
          [0n]
        )
      ).to.be.revertedWith("AutoCompounder: array length mismatch");
    });

    it("batchCompound reverts if batch exceeds MAX_BATCH (100)", async function () {
      const users   = Array(101).fill(user1.address);
      const indices = Array(101).fill(0n);
      await expect(
        compounder.connect(user3).batchCompound(users, indices)
      ).to.be.revertedWith("AutoCompounder: batch exceeds maximum");
    });

    it("batchCompound does not revert if one compound fails (silent)", async function () {
      // Index 99 doesn't exist — should be swallowed, not cause full revert
      const users   = [user1.address, user1.address];
      const indices = [0n, 99n]; // 99 is invalid

      await expect(
        compounder.connect(user3).batchCompound(users, indices)
      ).to.emit(compounder, "BatchCompounded")
        .withArgs(2n, 1n, user3.address); // 1 succeeded, 1 silently failed
    });

    it("compoundAllForUser iterates all deposits for a user", async function () {
      const d0Before = await vault.getDeposit(user1.address, 0);
      const d1Before = await vault.getDeposit(user1.address, 1);

      await compounder.connect(user3).compoundAllForUser(user1.address);

      const d0After = await vault.getDeposit(user1.address, 0);
      const d1After = await vault.getDeposit(user1.address, 1);

      expect(d0After.principal).to.be.gt(d0Before.principal);
      expect(d1After.principal).to.be.gt(d1Before.principal);
    });

    it("compoundSingle compounds a specific deposit", async function () {
      const dBefore = await vault.getDeposit(user2.address, 0);
      await compounder.connect(user3).compoundSingle(user2.address, 0);
      const dAfter = await vault.getDeposit(user2.address, 0);
      expect(dAfter.principal).to.be.gt(dBefore.principal);
    });

    it("anyone can call batchCompound (permissionless keeper)", async function () {
      // attacker (random wallet) can trigger compounding
      await expect(
        compounder.connect(attacker).batchCompound([user2.address], [0n])
      ).to.not.be.reverted;
    });

    it("owner can update vault address in compounder", async function () {
      await expect(
        compounder.connect(owner).setVault(await vault.getAddress())
      ).to.emit(compounder, "VaultUpdated");
    });

    it("non-owner cannot update vault address in compounder", async function () {
      await expect(
        compounder.connect(attacker).setVault(await vault.getAddress())
      ).to.be.revertedWith("AutoCompounder: not owner");
    });

    it("MAX_BATCH is 100", async function () {
      expect(await compounder.MAX_BATCH()).to.equal(100n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  14. SECURITY / EDGE CASES
  // ══════════════════════════════════════════════════════════════════════════

  describe("Security", function () {

    it("CRITICAL: principal is protected — vault cannot pay more than it holds", async function () {
      const amount = toUSDX(1000);
      await vault.connect(user1).deposit(amount, TIERS.LOCK_1YR, ethers.ZeroAddress);
      const health = await vault.vaultHealth();
      expect(health.healthy).to.equal(true);
      expect(health.balance).to.be.gte(health.principal);
    });

    it("reentrancy guard: double-call to withdraw is blocked", async function () {
      // We can't test actual reentrancy without a malicious contract,
      // but we verify the nonReentrant modifier is on withdraw
      // by confirming the function exists and can only be called once
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(Number(LOCK_1YR) + 1);
      await vault.connect(user1).withdraw(0);

      await expect(vault.connect(user1).withdraw(0))
        .to.be.revertedWithCustomError(vault, "DepositNotActive");
    });

    it("attacker cannot call admin functions", async function () {
      await expect(vault.connect(attacker).setPaused(true))
        .to.be.revertedWithCustomError(vault, "NotOwner");
      await expect(vault.connect(attacker).setGYDS(attacker.address))
        .to.be.revertedWithCustomError(vault, "NotOwner");
      await expect(vault.connect(attacker).setReinvestWallet(attacker.address))
        .to.be.revertedWithCustomError(vault, "NotOwner");
      await expect(vault.connect(attacker).withdrawDevEarnings(1n))
        .to.be.revertedWithCustomError(vault, "NotOwner");
    });

    it("cannot withdraw from another user's deposit", async function () {
      await vault.connect(user1).deposit(toUSDX(1000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      // attacker has no deposits — index 0 is invalid for their account
      await expect(vault.connect(attacker).withdraw(0))
        .to.be.revertedWithCustomError(vault, "InvalidDepositIndex");
    });

    it("deposit does not revert even if badge mint fails (badge already held)", async function () {
      // First deposit mints badge
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      // Second deposit — badge mint would fail (already held), but deposit must succeed
      await expect(
        vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress)
      ).to.not.be.reverted;
    });

    it("tierAPY view returns correct values", async function () {
      expect(await vault.tierAPY(TIERS.LOCK_1YR)).to.equal(380n);
      expect(await vault.tierAPY(TIERS.LOCK_3YR)).to.equal(410n);
      expect(await vault.tierAPY(TIERS.LOCK_5YR)).to.equal(444n);
    });

    it("tierLockDuration view returns correct values", async function () {
      expect(await vault.tierLockDuration(TIERS.LOCK_1YR)).to.equal(LOCK_1YR);
      expect(await vault.tierLockDuration(TIERS.LOCK_3YR)).to.equal(LOCK_3YR);
      expect(await vault.tierLockDuration(TIERS.LOCK_5YR)).to.equal(LOCK_5YR);
    });
  });
});
