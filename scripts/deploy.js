// ─────────────────────────────────────────────────────────────────────────────
//  NexVault Protocol — Production Deploy Script
//  Deploy order: Registry → Badge → Vault → AutoCompounder → Wire up
//
//  BEFORE RUNNING:
//  1. Fill .env with PRIVATE_KEY, NEXUS_RPC_URL, NEXUS_CHAIN_ID, USDX_ADDRESS
//  2. Run: npx hardhat run scripts/deploy.js --network nexus
//  3. Copy all addresses into vault-command.html config constants
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();
const hre = require("hardhat");

const OWNER_WALLET  = "0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0";
const USDX_ADDRESS  = process.env.USDX_ADDRESS  || "";
const GYDS_ADDRESS  = process.env.GYDS_ADDRESS  || "";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║        NexVault Protocol — Deploy Script       ║");
  console.log("╚════════════════════════════════════════════════╝\n");

  // ── Verify deployer ────────────────────────────────────────────────
  console.log("🔑 Deployer:", deployer.address);
  if (deployer.address.toLowerCase() !== OWNER_WALLET.toLowerCase()) {
    console.error("\n❌ WRONG WALLET. Must deploy from owner wallet:");
    console.error("   Expected:", OWNER_WALLET);
    console.error("   Got:     ", deployer.address);
    process.exit(1);
  }

  if (!USDX_ADDRESS) {
    console.error("\n❌ USDX_ADDRESS not set in .env — cannot deploy vault");
    process.exit(1);
  }

  const network = hre.network.name;
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("🌐 Network:", network);
  console.log("💰 Balance:", hre.ethers.formatEther(balance), "NEXUS");
  console.log("📍 USDX:   ", USDX_ADDRESS);
  console.log("📍 GYDS:   ", GYDS_ADDRESS || "(set later)");
  console.log("");

  // ══════════════════════════════════════════════════════════════════
  //  STEP 1 — Deploy ReferralRegistry
  // ══════════════════════════════════════════════════════════════════
  console.log("1️⃣  Deploying ReferralRegistry...");
  const Registry = await hre.ethers.getContractFactory("ReferralRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("   ✅ ReferralRegistry:", registryAddr);

  // ══════════════════════════════════════════════════════════════════
  //  STEP 2 — Deploy VaultGenesisBadge
  // ══════════════════════════════════════════════════════════════════
  console.log("\n2️⃣  Deploying VaultGenesisBadge...");
  const Badge = await hre.ethers.getContractFactory("VaultGenesisBadge");
  const badge = await Badge.deploy();
  await badge.waitForDeployment();
  const badgeAddr = await badge.getAddress();
  console.log("   ✅ VaultGenesisBadge:", badgeAddr);

  // ══════════════════════════════════════════════════════════════════
  //  STEP 3 — Deploy USDXVault
  // ══════════════════════════════════════════════════════════════════
  console.log("\n3️⃣  Deploying USDXVault...");
  const Vault = await hre.ethers.getContractFactory("USDXVault");
  const vault = await Vault.deploy(USDX_ADDRESS, badgeAddr, registryAddr);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("   ✅ USDXVault:", vaultAddr);

  // ══════════════════════════════════════════════════════════════════
  //  STEP 4 — Deploy AutoCompounder
  // ══════════════════════════════════════════════════════════════════
  console.log("\n4️⃣  Deploying AutoCompounder...");
  const Compounder = await hre.ethers.getContractFactory("AutoCompounder");
  const compounder = await Compounder.deploy(vaultAddr);
  await compounder.waitForDeployment();
  const compounderAddr = await compounder.getAddress();
  console.log("   ✅ AutoCompounder:", compounderAddr);

  // ══════════════════════════════════════════════════════════════════
  //  STEP 5 — Wire contracts together
  // ══════════════════════════════════════════════════════════════════
  console.log("\n5️⃣  Wiring contracts...");

  // Authorize vault to register referrals
  let tx = await registry.setVaultAuthorization(vaultAddr, true);
  await tx.wait();
  console.log("   ✅ Registry: vault authorized");

  // Authorize vault to mint badges
  tx = await badge.setMinterAuthorization(vaultAddr);
  await tx.wait();
  console.log("   ✅ Badge: vault authorized as minter");

  // Authorize AutoCompounder on vault
  tx = await vault.setCompoundOperator(compounderAddr, true);
  await tx.wait();
  console.log("   ✅ Vault: AutoCompounder authorized");

  // Set GYDS if address provided
  if (GYDS_ADDRESS) {
    tx = await vault.setGYDS(GYDS_ADDRESS);
    await tx.wait();
    console.log("   ✅ Vault: GYDS set to", GYDS_ADDRESS);
  } else {
    console.log("   ⏭  Vault: GYDS not set — run setGYDS() when address known");
  }

  // ══════════════════════════════════════════════════════════════════
  //  STEP 6 — Verification checks
  // ══════════════════════════════════════════════════════════════════
  console.log("\n6️⃣  Running post-deploy verification...");

  const regAuth   = await registry.authorizedVaults(vaultAddr);
  const badgeMint = await badge.authorizedMinter();
  const compOp    = await vault.isCompoundOperator(compounderAddr);
  const vaultUSDX = await vault.usdx();
  const vaultBadge = await vault.genesisBadge();
  const vaultReg  = await vault.referralRegistry();
  const badgeSupply = await badge.remaining();

  console.log("   Registry vault auth:  ", regAuth === true ? "✅" : "❌");
  console.log("   Badge minter set:     ", badgeMint.toLowerCase() === vaultAddr.toLowerCase() ? "✅" : "❌");
  console.log("   Compounder auth:      ", compOp === true ? "✅" : "❌");
  console.log("   Vault USDX address:  ", vaultUSDX.toLowerCase() === USDX_ADDRESS.toLowerCase() ? "✅" : "❌");
  console.log("   Vault badge address: ", vaultBadge.toLowerCase() === badgeAddr.toLowerCase() ? "✅" : "❌");
  console.log("   Vault registry addr: ", vaultReg.toLowerCase() === registryAddr.toLowerCase() ? "✅" : "❌");
  console.log("   Genesis badges avail:", badgeSupply.toString());

  // ══════════════════════════════════════════════════════════════════
  //  SUMMARY — Copy these into vault-command.html
  // ══════════════════════════════════════════════════════════════════
  console.log("\n╔════════════════════════════════════════════════════════╗");
  console.log("║                 DEPLOYMENT COMPLETE ✅                  ║");
  console.log("╠════════════════════════════════════════════════════════╣");
  console.log("║  Copy these addresses into vault-command.html          ║");
  console.log("║  and app.html config constants:                        ║");
  console.log("╠════════════════════════════════════════════════════════╣");
  console.log(`║  REGISTRY_ADDRESS   = "${registryAddr}"`);
  console.log(`║  BADGE_ADDRESS      = "${badgeAddr}"`);
  console.log(`║  VAULT_ADDRESS      = "${vaultAddr}"`);
  console.log(`║  AUTOCOMPOUNDER     = "${compounderAddr}"`);
  console.log("╚════════════════════════════════════════════════════════╝\n");

  // Save to file for reference
  const fs = require("fs");
  const deployInfo = {
    network,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      ReferralRegistry: registryAddr,
      VaultGenesisBadge: badgeAddr,
      USDXVault: vaultAddr,
      AutoCompounder: compounderAddr,
      USDX: USDX_ADDRESS,
      GYDS: GYDS_ADDRESS || "NOT_SET",
    },
  };
  fs.writeFileSync(
    `deploy-${network}-${Date.now()}.json`,
    JSON.stringify(deployInfo, null, 2)
  );
  console.log("📄 Deploy info saved to deploy-" + network + "-*.json");
}

main().catch((err) => {
  console.error("\n❌ Deploy failed:", err.message);
  process.exit(1);
});
