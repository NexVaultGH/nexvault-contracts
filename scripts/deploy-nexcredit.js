const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const VAULT_ADDRESS    = process.env.VAULT_ADDRESS    || "";
const BADGE_ADDRESS    = process.env.BADGE_ADDRESS    || "";
const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS || "";
const EXPECTED_OWNER   = "0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0";

async function main() {
  console.log("\nDeploying NexCredit...");
  if (!VAULT_ADDRESS)    throw new Error("VAULT_ADDRESS not set");
  if (!BADGE_ADDRESS)    throw new Error("BADGE_ADDRESS not set");
  if (!REGISTRY_ADDRESS) throw new Error("REGISTRY_ADDRESS not set");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  if (deployer.address.toLowerCase() !== EXPECTED_OWNER.toLowerCase()) {
    throw new Error("Deployer is not the expected owner");
  }

  const NexCredit = await ethers.getContractFactory("NexCredit");
  const nexCredit = await NexCredit.deploy(VAULT_ADDRESS, BADGE_ADDRESS, REGISTRY_ADDRESS);
  await nexCredit.waitForDeployment();
  const addr = await nexCredit.getAddress();
  console.log(`NexCredit deployed: ${addr}`);

  const owner = await nexCredit.OWNER();
  if (owner.toLowerCase() !== EXPECTED_OWNER.toLowerCase()) throw new Error("Owner mismatch");
  console.log("✓ Owner verified");

  const deployments = {
    nexCredit: addr,
    vault: VAULT_ADDRESS,
    badge: BADGE_ADDRESS,
    registry: REGISTRY_ADDRESS,
    owner: EXPECTED_OWNER,
    deployedAt: new Date().toISOString(),
    network: (await ethers.provider.getNetwork()).name,
  };

  fs.writeFileSync(
    path.join(__dirname, "../nexcredit-deployments.json"),
    JSON.stringify(deployments, null, 2)
  );
  console.log("✓ Saved to nexcredit-deployments.json");
  console.log("\nNext step: fill NEXCREDIT_ADDRESS in app.html config block");
}

main().catch((err) => { console.error(err); process.exit(1); });
