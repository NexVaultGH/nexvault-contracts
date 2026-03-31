"""
NexVault zkVM Integration Update Script
Adds Nexus zkVM NatSpec + documentation to all protocol contracts.
"""
import os, re

CONTRACTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "/contracts"

ZKVM_BLOCK = """\
//  NEXUS zkVM EXECUTION:
//  This contract runs on NexusEVM — the EVM-compatible execution layer of
//  Nexus blockchain. Every transaction is automatically proven by the Nexus
//  zkVM (v3.0), a Stwo-backed, general-purpose zero-knowledge virtual machine
//  running on every Nexus node. No additional code changes are required:
//  ZK proofs of contract execution are generated at the network layer.
//
//  zkVM Proof Pipeline:
//  Solidity (this contract) → NexusEVM execution → Nexus zkVM proves execution
//  → Universal Proof aggregated across all nodes → Final ZK-verified state
//
//  Reference: https://docs.nexus.xyz/zkvm
//             https://github.com/nexus-xyz/nexus-zkvm
"""

CONTRACT_ZKVM_MARKERS = {
    "USDXVault.sol":          "//  No delegatecall — no external code execution risk\n",
    "AutoCompounder.sol":     "//  No stored user data — purely a pass-through keeper\n",
    "ReferralRegistry.sol":   "//  One referrer per user — cannot be overwritten\n",
    "VaultGenesisBadge.sol":  "//  Mint failure NEVER blocks a deposit (vault wraps in try/catch)\n",
    "MockUSDX.sol":           None,  # skip mock
}

for fname, marker in CONTRACT_ZKVM_MARKERS.items():
    if marker is None:
        continue
    path = os.path.join(CONTRACTS_DIR, fname)
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    if "NEXUS zkVM EXECUTION" in content:
        print(f"  {fname}: already updated, skipping")
        continue

    # Insert zkVM block after the marker line (last security property)
    insert_at = content.find(marker)
    if insert_at == -1:
        print(f"  {fname}: marker not found, skipping")
        continue

    insert_pos = insert_at + len(marker)
    content = content[:insert_pos] + "//" + "\n" + ZKVM_BLOCK + content[insert_pos:]

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  {fname}: updated with zkVM block")

print("Contract update complete.")
