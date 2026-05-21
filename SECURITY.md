# NexVault Contracts — Security Policy

## Reporting a vulnerability

Report privately via **GitHub Security Advisories**:
https://github.com/NexVaultGH/nexvault-contracts/security/advisories/new

Do **not** open public issues for security reports, and do **not** test
against live user funds. Good-faith reports are reviewed and credited.
See also: https://nexvault.one/.well-known/security.txt

## Security posture

NexVault's contracts are built defense-in-depth and are the final layer of a
5-layer model (Transport → Headers → Supply-chain SRI → Application → Contracts;
full model at https://nexvault.one/security).

- **Non-upgradeable** — no proxy; deployed bytecode is permanent.
- **Immutable hardcoded owner** — no ownership transfer. The owner **cannot
  withdraw user principal** (enforced by a reserve-balance invariant) and every
  admin function is bounded (capped min-deposit, capped per-tx dev withdrawal).
- **No price oracle / no flash-loan surface** — yield is a pure function of
  elapsed time and principal, so there is nothing to manipulate.
- **Reentrancy** — OpenZeppelin `ReentrancyGuard` + strict Checks-Effects-
  Interactions on every state-changing function.
- **Token safety** — `SafeERC20` for all transfers; explicit success checks.
- **DoS-bounded** — per-user deposit cap and capped batch sizes; no unbounded
  loops over user-controlled arrays. Withdrawals stay open even when paused.

## Testing & audit

- **258/258 tests passing**, 97%+ line coverage on production contracts.
- **Slither** static analysis: 0 medium+ findings on NexVault contracts.
- Internal CertiK-style audit — see [`CERTIK-STYLE-AUDIT.md`](./CERTIK-STYLE-AUDIT.md)
  (score 100/100, zero open findings) and [`AUDIT-REPORT.md`](./AUDIT-REPORT.md).
- **OWASP Smart Contract Top 10 (2025)** mapping published at
  https://nexvault.one/security

## OWASP Smart Contract Top 10 (2025) — coverage summary

| ID | Risk | Status |
|----|------|--------|
| SC01 | Access Control | Compile-time owner constant; bounded admin; no proxy |
| SC02 | Price Oracle Manipulation | Eliminated — no oracle, time-based yield |
| SC03 | Logic Errors | 258 tests / 97%+ coverage; reserve invariant |
| SC04 | Input Validation | Zero-value reverts, self-referral block, tier validation |
| SC05 | Reentrancy | ReentrancyGuard + CEI on all state changes |
| SC06 | Unchecked External Calls | SafeERC20; explicit checks; no raw call |
| SC07 | Flash Loan Attacks | Eliminated — yield independent of pool/spot state |
| SC08 | Integer Over/Underflow | Solidity 0.8.x checked arithmetic |
| SC09 | Insecure Randomness | Not used anywhere |
| SC10 | Denial of Service | Withdrawals always open; bounded loops/batches |

Last reviewed: 2026-05.

> **Launch status:** the contracts are **not yet deployed to Nexus mainnet**.
> USDX-on-Nexus is not live and GYDS app-source registration is required before
> the vault can be deployed and funded. Do not deploy with real funds until both
> land. See the website security page for the current status.
