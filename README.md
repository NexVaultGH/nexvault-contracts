# NexVault Protocol — Smart Contracts

[![Nexus zkVM](https://img.shields.io/badge/Nexus_zkVM-v3.0-8B5CF6?style=flat-square&logo=ethereum)](https://docs.nexus.xyz/zkvm)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.25-363636?style=flat-square&logo=solidity)](https://docs.soliditylang.org)
[![Tests](https://img.shields.io/badge/Tests-246_passing-22c55e?style=flat-square)](./test)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](./LICENSE)

USDX Savings Vault · Built on Nexus Blockchain · Up to 4.38% APY — U.S. Treasury Backed

---

## 🌐 Network Status

| Network | Status | Chain ID | RPC |
|---------|--------|----------|-----|
| Nexus Testnet | 🟢 Live | 3945 | testnet.rpc.nexus.xyz |
| Nexus Mainnet | 🟡 Q2 2026 | TBA | TBA |

### Deploy to Testnet

```bash
npx hardhat run scripts/deploy.js --network nexus_testnet
npx hardhat run scripts/deploy-nexcredit.js --network nexus_testnet
```

### Add Nexus Testnet to MetaMask
- Network Name: `Nexus Testnet`
- RPC URL: `https://testnet.rpc.nexus.xyz`
- Chain ID: `3945`
- Currency Symbol: `NEX`
- Block Explorer: `https://testnet.explorer.nexus.xyz`
- Faucet: `https://faucet.nexus.xyz`

---

## 246 / 246 Tests Passing

```
NexVault Protocol
    Deployment           7 passing
    Deposits            12 passing
    Withdrawals         13 passing
    Claim Yield          6 passing
    Compound             6 passing
    pendingYield         5 passing
    Admin Functions      7 passing
    Dev Earnings         5 passing
    Vault Health         3 passing
    ReferralRegistry    12 passing
    VaultGenesisBadge   11 passing
    AutoCompounder      10 passing
    Security             9 passing
    Lock Is Final       18 passing
    View Functions      17 passing
    Cross-User Isolation 7 passing
    Yield Math Precision 6 passing
    Full Lifecycle      20 passing

NexCredit
    Deployment           8 passing
    Privacy             11 passing
    No Deposits          3 passing
    Deposit Strength     5 passing
    Lock Commitment      5 passing
    Protocol Loyalty     7 passing
    Behavioral Excellence 6 passing
    Score Tier Labels    4 passing
    Breakdown Integrity  2 passing
    Critical Invariants  4 passing
    Founder Elite Status 5 passing
    Penalty System      12 passing

  246 passing (10s)
```

[→ View full test output](./test-results.txt)

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
| `NexCredit.sol` | On-chain credit scoring — private 0-1000 score based on deposit history |
| `MockUSDX.sol` | ERC-20 mock for local testing only — not deployed to mainnet |

## Architecture

```
User
 └─► USDXVault.sol          ← primary entry point
       ├─ ReferralRegistry.sol   ← registers referrer on deposit
       ├─ VaultGenesisBadge.sol  ← mints badge on first deposit
       ├─ AutoCompounder.sol     ← keeper compounds yield periodically
       └─ NexCredit.sol          ← reads deposit history, produces credit score
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
npx hardhat test      # all 246 tests must pass
```

## Deploy to Nexus Mainnet

```bash
npx hardhat run scripts/deploy.js --network nexus
```

See [`deploy documents.md`](./deploy%20documents.md) for full deployment guide including post-deploy steps and security notes.

## NexCredit — On-Chain Credit Scoring

NexCredit is a private on-chain credit scoring contract built into NexVault. It reads a wallet's deposit history and produces a score from 0 to 1000.

**Privacy model:**
- Wallet owners can only see their own score — free, always
- Protocol owner can see any wallet's score
- No external wallet or contract can see another user's score

**Scoring categories (250 pts each):**

| Category | Max | How to earn |
|---|---|---|
| Deposit Strength | 250 | $5K/+50, $25K/+80, $100K/+90 (cumulative) |
| Lock Commitment | 250 | 1YR=+20, 3YR=+80, 5YR=+250 (highest tier only) |
| Protocol Loyalty | 250 | 60d/180d/365d/730d/1095d thresholds |
| Behavioral Excellence | 250 | Compound 3x, 5+ deposits, 3 referrals, badge+$5K, 2 active |

**Score tiers:**

| Tier | Range |
|---|---|
| No History | 0 |
| Dormant | 1-149 |
| Building | 150-299 |
| Established | 300-499 |
| Trusted | 500-699 |
| Senior | 700-849 |
| Elite | 850-1000 |

Elite requires $100K+, 5-Year lock, and 3 years of loyalty simultaneously. Under 1% of wallets will ever qualify.

**Deploy NexCredit:**
```bash
VAULT_ADDRESS=0x... BADGE_ADDRESS=0x... REGISTRY_ADDRESS=0x... \
  npx hardhat run scripts/deploy-nexcredit.js --network nexus
```

After deployment, fill NEXCREDIT_ADDRESS in app.html config block.

---

## Security

- 246 passing tests covering deployment, deposits, withdrawals, yield, referrals, lock enforcement, credit scoring, view functions, cross-user isolation, yield math, and full lifecycle integration
- Certik audit-ready: CEI pattern in deposit(), custom errors, complete NatSpec
- OpenZeppelin ReentrancyGuard on all state-changing functions
- Strict CEI (Checks-Effects-Interactions) ordering — state changes before external calls
- Hardcoded owner address — no ownership transfer possible
- LOCK_IS_FINAL = true — lock periods enforced by on-chain timestamp, no bypass
- Owner can never withdraw user principal (enforced by on-chain invariant)
- Emergency pause blocks deposits only — withdrawals always available
- No flash loan surface — yield calculated on elapsed time, no oracle dependency
- Non-upgradeable contracts — no proxy pattern, no admin upgrade key
- All execution ZK-proven by Nexus zkVM v3.0

Full security documentation: https://nexvault.one/security

---

Built by NexVault · https://nexvault.one · Deployed on Nexus · https://nexus.xyz
