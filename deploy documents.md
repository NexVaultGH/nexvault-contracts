# NexVault Protocol — Deployment Guide

## Setup

```bash
cd nexvault-contracts
npm install
cp .env.example .env
```

Fill `.env`:
```
NEXUS_RPC_URL=https://rpc.nexus.xyz   # from Nexus docs at launch
NEXUS_CHAIN_ID=                        # from Nexus docs at launch
PRIVATE_KEY=                           # private key of 0x44e0...8ba0
USDX_ADDRESS=                          # official USDX from Nexus docs
GYDS_ADDRESS=                          # official GYDS from Nexus docs
```

## Test Locally First

```bash
npx hardhat compile          # must show 0 errors
npx hardhat test             # all 40+ tests must pass
```

## Deploy to Nexus Mainnet

```bash
npx hardhat run scripts/deploy.js --network nexus
```

The script deploys all 4 contracts in order, wires them together,
verifies all connections, and prints all addresses.

## After Deploy

Copy the 4 addresses into `vault-command.html` constants block and `app.html`:
- `REGISTRY_ADDRESS`
- `BADGE_ADDRESS`
- `VAULT_ADDRESS`
- `AUTOCOMPOUNDER_ADDRESS`

## Nexus zkVM — Zero-Knowledge Execution

NexVault deploys on **NexusEVM**, the EVM-compatible execution layer of Nexus blockchain.
Every transaction is automatically proven by the **Nexus zkVM v3.0** — no code changes required.

### What this means

| Layer | What happens |
|---|---|
| Solidity contracts | Deploy exactly as written — no changes |
| NexusEVM | Executes transactions identically to standard EVM |
| Nexus zkVM v3.0 | Automatically generates a ZK proof of every execution |
| Universal Proof | Proofs are aggregated across all nodes |
| Final state | ZK-verified on-chain — cryptographically proven correct |

### zkVM proof pipeline

```
Solidity (this repo) → NexusEVM execution → Nexus zkVM proves it
→ Universal Proof aggregated across nodes → ZK-verified on-chain state
```

### Why this matters for NexVault users

- Every deposit, withdrawal, and yield calculation is **cryptographically proven correct**
- No trust required in execution — math enforces the rules
- ZK proofs are generated at the network layer automatically
- Nexus zkVM is built on **Stwo** (StarkWare's STARK prover) — production-grade security

### References

- Nexus zkVM docs: https://docs.nexus.xyz/zkvm
- Nexus zkVM GitHub: https://github.com/nexus-xyz/nexus-zkvm
- Nexus blockchain: https://nexus.xyz

---

## Security Notes

- Only wallet 0x44e06fb3517ee815bba5612f783712ac4f498ba0 can deploy
- Only that wallet can call admin functions (pause, collect earnings, set GYDS)
- Owner can NEVER withdraw user principal — enforced by smart contract
- Emergency pause blocks deposits only — withdrawals always available
- Badge supply is permanently capped at 5,000 in the contract constant
- All execution is ZK-proven by Nexus zkVM v3.0 — no trust assumptions on execution
