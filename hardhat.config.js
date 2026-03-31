require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.25",        // ← bumped from 0.8.24 (required for mcopy opcode)
    settings: {
      evmVersion: "cancun",   // ← added (required for OpenZeppelin v5 Bytes.sol mcopy)
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: false,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    // ── Nexus Mainnet (NexusEVM — zkVM-proven execution layer) ──────────────
    // NexusEVM is EVM-compatible. Every transaction is automatically proven
    // by the Nexus zkVM v3.0 running on every node — no config changes needed.
    // Docs: https://docs.nexus.xyz/zkvm
    // RPC + Chain ID: fill from https://docs.nexus.xyz at mainnet launch
    nexus: {
      url: process.env.NEXUS_RPC_URL || "",
      chainId: parseInt(process.env.NEXUS_CHAIN_ID || "0"),
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    token: "ETH",
  },
  paths: {
    sources: "./contracts",
    tests:   "./test",
    cache:   "./cache",
    artifacts: "./artifacts",
  },
};
