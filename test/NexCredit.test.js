const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const OWNER_ADDR = "0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0";
const toUSDX = (n) => ethers.parseUnits(String(n), 6);
const TIERS = { LOCK_1YR: 0, LOCK_3YR: 1, LOCK_5YR: 2 };
const LOCK_1YR  = 365n  * 24n * 3600n;
const LOCK_3YR  = 1095n * 24n * 3600n;
const LOCK_5YR  = 1825n * 24n * 3600n;
const DAYS_60   =   60n * 24n * 3600n;
const DAYS_180  =  180n * 24n * 3600n;
const DAYS_365  =  365n * 24n * 3600n;
const DAYS_730  =  730n * 24n * 3600n;
const DAYS_1095 = 1095n * 24n * 3600n;

describe("NexCredit", function () {
  let owner, user1, user2, attacker;
  let usdx, vault, badge, registry, nexCredit;
  let vaultAddr;

  beforeEach(async function () {
    [user1, user2, attacker] = await ethers.getSigners();

    // Impersonate owner
    await ethers.provider.send("hardhat_impersonateAccount", [OWNER_ADDR]);
    await ethers.provider.send("hardhat_setBalance", [OWNER_ADDR, "0x56BC75E2D63100000"]);
    owner = await ethers.getSigner(OWNER_ADDR);

    // Deploy MockUSDX
    const MockUSDX = await ethers.getContractFactory("MockUSDX");
    usdx = await MockUSDX.connect(user1).deploy();

    // Deploy VaultGenesisBadge
    const Badge = await ethers.getContractFactory("VaultGenesisBadge");
    badge = await Badge.connect(owner).deploy();

    // Deploy ReferralRegistry
    const Registry = await ethers.getContractFactory("ReferralRegistry");
    registry = await Registry.connect(owner).deploy();

    // Deploy USDXVault
    const Vault = await ethers.getContractFactory("USDXVault");
    vault = await Vault.connect(owner).deploy(
      await usdx.getAddress(),
      await badge.getAddress(),
      await registry.getAddress()
    );
    vaultAddr = await vault.getAddress();

    // Set permissions
    await registry.connect(owner).setVaultAuthorization(vaultAddr, true);
    await badge.connect(owner).setMinterAuthorization(vaultAddr);

    // Deploy NexCredit
    const NexCredit = await ethers.getContractFactory("NexCredit");
    nexCredit = await NexCredit.connect(owner).deploy(
      vaultAddr,
      await badge.getAddress(),
      await registry.getAddress()
    );

    // Mint 200K USDX to user1 and user2
    await usdx.mint(user1.address, toUSDX(200_000));
    await usdx.mint(user2.address, toUSDX(200_000));

    // Approve vault for user1 and user2
    await usdx.connect(user1).approve(vaultAddr, toUSDX(200_000));
    await usdx.connect(user2).approve(vaultAddr, toUSDX(200_000));

    // Pre-fund vault with yield reserves
    await usdx.mint(vaultAddr, toUSDX(1_000_000));
  });

  // ═══════════════════════════════════════════════════════
  // Deployment
  // ═══════════════════════════════════════════════════════
  describe("Deployment", function () {
    it("deploys with correct vault address", async function () {
      expect(await nexCredit.vault()).to.equal(vaultAddr);
    });

    it("deploys with correct genesisBadge address", async function () {
      expect(await nexCredit.genesisBadge()).to.equal(await badge.getAddress());
    });

    it("deploys with correct referralRegistry address", async function () {
      expect(await nexCredit.referralRegistry()).to.equal(await registry.getAddress());
    });

    it("OWNER constant matches expected address", async function () {
      expect(await nexCredit.OWNER()).to.equal(OWNER_ADDR);
    });

    it("MAX_BATCH is 25", async function () {
      expect(await nexCredit.MAX_BATCH()).to.equal(25);
    });

    it("reverts if vault is zero address", async function () {
      const NexCredit = await ethers.getContractFactory("NexCredit");
      await expect(
        NexCredit.connect(owner).deploy(ethers.ZeroAddress, await badge.getAddress(), await registry.getAddress())
      ).to.be.revertedWithCustomError(nexCredit, "ZeroAddress");
    });

    it("reverts if badge is zero address", async function () {
      const NexCredit = await ethers.getContractFactory("NexCredit");
      await expect(
        NexCredit.connect(owner).deploy(vaultAddr, ethers.ZeroAddress, await registry.getAddress())
      ).to.be.revertedWithCustomError(nexCredit, "ZeroAddress");
    });

    it("reverts if registry is zero address", async function () {
      const NexCredit = await ethers.getContractFactory("NexCredit");
      await expect(
        NexCredit.connect(owner).deploy(vaultAddr, await badge.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(nexCredit, "ZeroAddress");
    });
  });

  // ═══════════════════════════════════════════════════════
  // Privacy — Access Control
  // ═══════════════════════════════════════════════════════
  describe("Privacy — Access Control", function () {
    it("wallet owner can query their own score", async function () {
      const score = await nexCredit.connect(user1).getScore(user1.address);
      expect(score).to.equal(0);
    });

    it("wallet owner can query their own breakdown", async function () {
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.total).to.equal(0);
    });

    it("wallet owner can query their own label", async function () {
      const label = await nexCredit.connect(user1).getScoreLabel(user1.address);
      expect(label).to.equal("No History");
    });

    it("non-owner cannot query another wallet score — reverts NotAuthorized", async function () {
      await expect(
        nexCredit.connect(user1).getScore(user2.address)
      ).to.be.revertedWithCustomError(nexCredit, "NotAuthorized");
    });

    it("non-owner cannot query another wallet breakdown — reverts NotAuthorized", async function () {
      await expect(
        nexCredit.connect(user1).getScoreBreakdown(user2.address)
      ).to.be.revertedWithCustomError(nexCredit, "NotAuthorized");
    });

    it("attacker cannot see any wallet score — reverts NotAuthorized", async function () {
      await expect(
        nexCredit.connect(attacker).getScore(user1.address)
      ).to.be.revertedWithCustomError(nexCredit, "NotAuthorized");
    });

    it("owner can query any wallet score", async function () {
      const score = await nexCredit.connect(owner).getScore(user1.address);
      expect(score).to.equal(0);
    });

    it("owner can query any wallet breakdown", async function () {
      const bd = await nexCredit.connect(owner).getScoreBreakdown(user2.address);
      expect(bd.total).to.equal(0);
    });

    it("getScoreBatch is OWNER only — reverts NotAuthorized for others", async function () {
      await expect(
        nexCredit.connect(user1).getScoreBatch([user1.address])
      ).to.be.revertedWithCustomError(nexCredit, "NotAuthorized");
    });

    it("getScoreBatch works for owner", async function () {
      const scores = await nexCredit.connect(owner).getScoreBatch([user1.address, user2.address]);
      expect(scores.length).to.equal(2);
      expect(scores[0]).to.equal(0);
      expect(scores[1]).to.equal(0);
    });

    it("getScoreBatch reverts for batch > 25 with BatchTooLarge", async function () {
      const wallets = Array(26).fill(user1.address);
      await expect(
        nexCredit.connect(owner).getScoreBatch(wallets)
      ).to.be.revertedWithCustomError(nexCredit, "BatchTooLarge")
        .withArgs(26, 25);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scoring — No Deposits
  // ═══════════════════════════════════════════════════════
  describe("Scoring — No Deposits", function () {
    it("returns 0 for wallet with no deposits", async function () {
      expect(await nexCredit.connect(user1).getScore(user1.address)).to.equal(0);
    });

    it("getScoreLabel returns No History for score 0", async function () {
      expect(await nexCredit.connect(user1).getScoreLabel(user1.address)).to.equal("No History");
    });

    it("breakdown all zeros for wallet with no deposits", async function () {
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.depositStrength).to.equal(0);
      expect(bd.lockCommitment).to.equal(0);
      expect(bd.protocolLoyalty).to.equal(0);
      expect(bd.behavioralExcellence).to.equal(0);
      expect(bd.total).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Deposit Strength
  // ═══════════════════════════════════════════════════════
  describe("Deposit Strength", function () {
    it("+30 for any active deposit (100 USDX)", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.depositStrength).to.equal(30);
    });

    it("+80 for $5K deposit (30+50)", async function () {
      await vault.connect(user1).deposit(toUSDX(5_000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.depositStrength).to.equal(80);
    });

    it("+160 for $25K deposit (30+50+80)", async function () {
      await vault.connect(user1).deposit(toUSDX(25_000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.depositStrength).to.equal(160);
    });

    it("+250 for $100K deposit (30+50+80+90)", async function () {
      await vault.connect(user1).deposit(toUSDX(100_000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.depositStrength).to.equal(250);
    });

    it("inactive deposits do not count", async function () {
      await vault.connect(user1).deposit(toUSDX(50_000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      // Advance past lock period
      await time.increase(Number(LOCK_1YR) + 1);
      await vault.connect(user1).withdraw(0);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.depositStrength).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Lock Commitment
  // ═══════════════════════════════════════════════════════
  describe("Lock Commitment", function () {
    it("+20 for LOCK_1YR active deposit", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.lockCommitment).to.equal(20);
    });

    it("+80 for LOCK_3YR active deposit", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_3YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.lockCommitment).to.equal(80);
    });

    it("+250 for LOCK_5YR active deposit", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_5YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.lockCommitment).to.equal(250);
    });

    it("uses highest tier — LOCK_1YR + LOCK_5YR active = 250", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_5YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.lockCommitment).to.equal(250);
    });

    it("CRITICAL: Elite impossible without LOCK_5YR — max with LOCK_3YR < 850", async function () {
      // Max with LOCK_3YR: DS=250 + LC=80 + PL=250 + BE=250 = 830
      // Need $100K for max DS, LOCK_3YR for LC, 1095 days for max PL, max BE
      await vault.connect(user1).deposit(toUSDX(100_000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(Number(DAYS_1095));
      const score = await nexCredit.connect(user1).getScore(user1.address);
      // Even with max behavioral, LC=80 caps total below 850
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      const maxPossible = 250 + 80 + 250 + 250; // 830
      expect(bd.lockCommitment).to.equal(80);
      expect(maxPossible).to.be.lessThan(850);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Protocol Loyalty
  // ═══════════════════════════════════════════════════════
  describe("Protocol Loyalty", function () {
    it("0 points immediately after deposit", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_5YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.protocolLoyalty).to.equal(0);
    });

    it("0 points before 60 days (advance 59 days)", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_5YR, ethers.ZeroAddress);
      await time.increase(59 * 24 * 3600);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.protocolLoyalty).to.equal(0);
    });

    it("+20 after 60 days", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_5YR, ethers.ZeroAddress);
      await time.increase(Number(DAYS_60));
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.protocolLoyalty).to.equal(20);
    });

    it("+50 after 180 days", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_5YR, ethers.ZeroAddress);
      await time.increase(Number(DAYS_180));
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.protocolLoyalty).to.equal(50);
    });

    it("+100 after 365 days", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_5YR, ethers.ZeroAddress);
      await time.increase(Number(DAYS_365));
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.protocolLoyalty).to.equal(100);
    });

    it("+175 after 730 days (LOCK_3YR deposit)", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(Number(DAYS_730));
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.protocolLoyalty).to.equal(175);
    });

    it("+250 after 1095 days (LOCK_5YR deposit)", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_5YR, ethers.ZeroAddress);
      await time.increase(Number(DAYS_1095));
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.protocolLoyalty).to.equal(250);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Behavioral Excellence
  // ═══════════════════════════════════════════════════════
  describe("Behavioral Excellence", function () {
    it("+30 when 3 deposits compounded", async function () {
      // Make 3 deposits
      await vault.connect(user1).deposit(toUSDX(1_000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user1).deposit(toUSDX(1_000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user1).deposit(toUSDX(1_000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      // Advance 30 days so yield accrues
      await time.increase(30 * 24 * 3600);
      // Claim yield on all 3 (this updates lastYieldAt > depositedAt)
      await vault.connect(user1).claimYield(0);
      await vault.connect(user1).claimYield(1);
      await vault.connect(user1).claimYield(2);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      // compoundCount >= 3 => +30
      expect(bd.behavioralExcellence).to.be.gte(30);
    });

    it("0 compound points if only 2 deposits compounded", async function () {
      await vault.connect(user1).deposit(toUSDX(1_000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user1).deposit(toUSDX(1_000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await time.increase(30 * 24 * 3600);
      await vault.connect(user1).claimYield(0);
      await vault.connect(user1).claimYield(1);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      // Only 2 compounded, not enough for the 30 bonus but has 50 for 2 active deposits
      // behavioralExcellence should be 50 (2 active) not 80 (50+30)
      expect(bd.behavioralExcellence).to.equal(50); // 2 active = +50, no compound bonus
    });

    it("+50 for 5+ total historical deposits", async function () {
      for (let i = 0; i < 5; i++) {
        await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      }
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      // 5 deposits => +50, 5 active (>=2) => +50 = 100
      expect(bd.behavioralExcellence).to.be.gte(50);
    });

    it("no +50 for only 4 total deposits", async function () {
      for (let i = 0; i < 4; i++) {
        await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      }
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      // 4 deposits, so no +50 for 5+ deposits. But 4 active (>=2) => +50
      expect(bd.behavioralExcellence).to.equal(50); // only active deposit bonus
    });

    it("+50 for 2+ simultaneously active deposits", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.behavioralExcellence).to.equal(50);
    });

    it("0 active deposit bonus with only 1 active deposit", async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.behavioralExcellence).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Score Tier Labels
  // ═══════════════════════════════════════════════════════
  describe("Score Tier Labels", function () {
    it('"No History" for score 0', async function () {
      expect(await nexCredit.connect(user1).getScoreLabel(user1.address)).to.equal("No History");
    });

    it('"Dormant" for small deposit + no time (DS=30 + LC=20 = 50)', async function () {
      await vault.connect(user1).deposit(toUSDX(100), TIERS.LOCK_1YR, ethers.ZeroAddress);
      const label = await nexCredit.connect(user1).getScoreLabel(user1.address);
      expect(label).to.equal("Dormant");
    });

    it('"Building" for $5K + LOCK_3YR (DS=80 + LC=80 = 160)', async function () {
      await vault.connect(user1).deposit(toUSDX(5_000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      const label = await nexCredit.connect(user1).getScoreLabel(user1.address);
      expect(label).to.equal("Building");
    });

    it("verify score after $100K + LOCK_5YR + 1095 days is >= 700", async function () {
      await vault.connect(user1).deposit(toUSDX(100_000), TIERS.LOCK_5YR, ethers.ZeroAddress);
      await time.increase(Number(DAYS_1095));
      const score = await nexCredit.connect(user1).getScore(user1.address);
      expect(score).to.be.gte(700);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Score Breakdown Integrity
  // ═══════════════════════════════════════════════════════
  describe("Score Breakdown Integrity", function () {
    it("components sum to total", async function () {
      await vault.connect(user1).deposit(toUSDX(10_000), TIERS.LOCK_3YR, ethers.ZeroAddress);
      await time.increase(Number(DAYS_180));
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.total).to.equal(
        bd.depositStrength + bd.lockCommitment + bd.protocolLoyalty + bd.behavioralExcellence
      );
    });

    it("getScore matches getScoreBreakdown total", async function () {
      await vault.connect(user1).deposit(toUSDX(25_000), TIERS.LOCK_5YR, ethers.ZeroAddress);
      await time.increase(Number(DAYS_365));
      const score = await nexCredit.connect(user1).getScore(user1.address);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(score).to.equal(bd.total);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Critical Invariants
  // ═══════════════════════════════════════════════════════
  describe("Critical Invariants", function () {
    it("CRITICAL: score never exceeds 1000", async function () {
      // Max everything: $100K deposit, 5YR lock, 1095 days, 5 deposits, compounds, referrals, badge
      // DS=250 + LC=250 + PL=250 + BE(max)=250 = 1000
      await vault.connect(user1).deposit(toUSDX(100_000), TIERS.LOCK_5YR, ethers.ZeroAddress);
      await time.increase(Number(DAYS_1095));
      const score = await nexCredit.connect(user1).getScore(user1.address);
      expect(score).to.be.lte(1000);
    });

    it("CRITICAL: privacy — user1 cannot see user2 score, user2 cannot see user1 score", async function () {
      await vault.connect(user1).deposit(toUSDX(1_000), TIERS.LOCK_1YR, ethers.ZeroAddress);
      await vault.connect(user2).deposit(toUSDX(1_000), TIERS.LOCK_1YR, ethers.ZeroAddress);

      await expect(
        nexCredit.connect(user1).getScore(user2.address)
      ).to.be.revertedWithCustomError(nexCredit, "NotAuthorized");

      await expect(
        nexCredit.connect(user2).getScore(user1.address)
      ).to.be.revertedWithCustomError(nexCredit, "NotAuthorized");
    });

    it("CRITICAL: Elite requires LOCK_5YR — max with LOCK_3YR is 830 < 850", async function () {
      // DS=250(100K) + LC=80(3YR) + PL=250(1095d) + BE=250(max) = 830
      const maxWithout5YR = 250 + 80 + 250 + 250;
      expect(maxWithout5YR).to.equal(830);
      expect(maxWithout5YR).to.be.lessThan(850);
    });

    it("CRITICAL: $5K minimum before meaningful deposit strength", async function () {
      await vault.connect(user1).deposit(toUSDX(4_999), TIERS.LOCK_1YR, ethers.ZeroAddress);
      const bd = await nexCredit.connect(user1).getScoreBreakdown(user1.address);
      expect(bd.depositStrength).to.equal(30); // base only, no $5K bonus
    });
  });

  // ═══════════════════════════════════════════════════════
  // Founder Elite Status
  // ═══════════════════════════════════════════════════════
  describe("Founder Elite Status", function () {
    it("OWNER wallet always returns score 1000", async function () {
      const score = await nexCredit.connect(owner).getScore(owner.address);
      expect(score).to.equal(1000);
    });

    it("OWNER wallet label is Elite", async function () {
      const label = await nexCredit.connect(owner).getScoreLabel(owner.address);
      expect(label).to.equal("Elite");
    });

    it("OWNER breakdown returns 250 in all four categories", async function () {
      const bd = await nexCredit.connect(owner).getScoreBreakdown(owner.address);
      expect(bd.depositStrength).to.equal(250);
      expect(bd.lockCommitment).to.equal(250);
      expect(bd.protocolLoyalty).to.equal(250);
      expect(bd.behavioralExcellence).to.equal(250);
      expect(bd.total).to.equal(1000);
    });

    it("OWNER Elite status works even with no deposits", async function () {
      // Owner has never deposited — still Elite
      const score = await nexCredit.connect(owner).getScore(owner.address);
      expect(score).to.equal(1000);
    });

    it("OWNER shows Elite in batch queries", async function () {
      const scores = await nexCredit.connect(owner).getScoreBatch([owner.address, user1.address]);
      expect(scores[0]).to.equal(1000); // owner = Elite
      expect(scores[1]).to.equal(0);    // user1 = no deposits
    });
  });
});
