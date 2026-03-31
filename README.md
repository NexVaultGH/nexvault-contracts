# NexVault Protocol — Smart Contracts

[![Nexus zkVM](https://img.shields.io/badge/Nexus_zkVM-v3.0-8B5CF6?style=flat-square&logo=ethereum)](https://docs.nexus.xyz/zkvm)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.25-363636?style=flat-square&logo=solidity)](https://docs.soliditylang.org)
[![Tests](https://img.shields.io/badge/Tests-115_passing-22c55e?style=flat-square)](./test)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](./LICENSE)

The #1 USDX savings vault on Nexus blockchain. Earn up to 4.44% APY on locked USDX — backed by U.S. Treasury yield and zero-knowledge proven by Nexus zkVM v3.0.

---

## Nexus zkVM — ZK-Proven Execution

NexVault deploys on **NexusEVM**, the EVM-compatible execution layer of Nexus blockchain.
Every transaction is automatically proven by the **Nexus zkVM v3.0** — a Stwo-backed zero-knowledge virtual machine running on every Nexus node.

**No Solidity changes required.** ZK proofs of all contract execution are generated at the network layer automatically.

### Proof Pipeline

```
Solidity (this repo)
  → NexusEVM executes the transaction
  → Nexus zkVM v3.0 generates a ZK proof of execution
  → Universal Proof aggregated across all nodes
  → ZK-verified on-chain state
```

### What this means for users

- Every deposit, withdrawal, and yield calculation is **cryptographically proven correct**
- Trust is replaced by math — no reliance on execution environment
- Built on **Stwo** (StarkWare's STARK prover) — production-grade ZK security

### References

- Nexus zkVM docs: https://docs.nexus.xyz/zkvm
- Nexus zkVM GitHub: https://github.com/nexus-xyz/nexus-zkvm

---

## Contracts

| Contract | Description |
|---|---|
| `USDXVault.sol` | Core savings vault — handles deposits, lock periods, yield accrual, and withdrawals |
| `AutoCompounder.sol` | Keeper contract — compounds earned yield back into principal |
| `ReferralRegistry.sol` | Tracks referral relationships — up to +200 bps bonus per depositor |
| `VaultGenesisBadge.sol` | ERC-721 — mints a Genesis Badge NFT on first deposit (max 5,000 supply) |
| `MockUSDX.sol` | ERC-20 mock for local testing only — not deployed to mainnet |

## Architecture

```
User
 └─► USDXVault.sol          ← primary entry point
       ├─ ReferralRegistry.sol   ← registers referrer on deposit
       ├─ VaultGenesisBadge.sol  ← mints badge on first deposit
       └─ AutoCompounder.sol     ← keeper compounds yield periodically
```

## Setup

```bash
cd nexvault-contracts
npm install
cp .env.example .env
# Fill in .env — see deploy documents.md
```

## Test

```bash
npx hardhat compile   # must show 0 errors
npx hardhat test      # all 115 tests must pass
```

## Deploy to Nexus Mainnet

```bash
npx hardhat run scripts/deploy.js --network nexus
```

See [`deploy documents.md`](./deploy%20documents.md) for full deployment guide including post-deploy steps and security notes.

## Security

- 115 passing tests covering deployment, deposits, withdrawals, yield, referrals, and edge cases
- OpenZeppelin ReentrancyGuard on all state-changing functions
- Hardcoded owner address — no ownership transfer possible
- Owner can never withdraw user principal (enforced by on-chain invariant)
- Emergency pause blocks deposits only — withdrawals always available
- No flash loan surface — yield calculated on elapsed time, no oracle dependency
- All execution ZK-proven by Nexus zkVM v3.0

Full security documentation: https://nexvault.one/security

---

Built by NexVault · https://nexvault.one · Deployed on Nexus · https://nexus.xyz
