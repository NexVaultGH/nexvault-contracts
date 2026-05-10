# NexVault Deployment Checklist

## 🟢 Nexus Testnet Deployment (Available NOW)

Use this for testing the full protocol stack on real Nexus infrastructure before mainnet.

### Prerequisites
- [ ] Add Nexus Testnet to MetaMask
  - Network Name: Nexus Testnet
  - RPC URL: https://testnet.rpc.nexus.xyz
  - Chain ID: 3945
  - Currency: NEX
  - Explorer: https://testnet.explorer.nexus.xyz
- [ ] Get testnet NEX from https://faucet.nexus.xyz
- [ ] Get testnet USDX address from Nexus team (check docs.nexus.xyz or developer Discord)
- [ ] Set PRIVATE_KEY in .env (deployer wallet with testnet NEX)

### Deployment Steps
1. `npx hardhat compile`
2. `npx hardhat test` — confirm all tests passing
3. `npx hardhat run scripts/deploy.js --network nexus_testnet`
4. Save deployed addresses from output
5. Run authorization sequence:
   - `registry.setVaultAuthorization(vaultAddress, true)`
   - `badge.setMinterAuthorization(vaultAddress)`
   - `vault.setCompoundOperator(autoCompounderAddress, true)`
6. `npx hardhat run scripts/deploy-nexcredit.js --network nexus_testnet`
7. Update app.html config block with all deployed addresses
8. Switch ACTIVE_NETWORK to NETWORKS.testnet in app.html (already default)
9. Deploy app.html to Netlify
10. Test full flow: connect wallet → deposit → claim yield → check NexCredit score → withdraw

## 🟡 Nexus Mainnet Deployment (Q2 2026)

Wait for official Nexus mainnet launch. Then:

### Prerequisites
- [ ] Get Nexus mainnet RPC URL from Nexus team
- [ ] Get Nexus mainnet Chain ID from Nexus team
- [ ] Get production USDX token address
- [ ] Get production GYDS distributor address
- [ ] Smart contract audit complete (target $10K-$15K spend)
- [ ] All tests passing on testnet for 30+ days without issues
- [ ] At least 100 successful testnet deposits/withdrawals completed

### Deployment Steps
Same as testnet steps above, but:
- Use --network nexus instead of --network nexus_testnet
- Switch ACTIVE_NETWORK to NETWORKS.mainnet in app.html
- Update testnet banner on homepage to reflect mainnet status
- Email entire waitlist with launch announcement

## Post-Deploy Authorization (both networks)

```bash
# Run from OWNER wallet (0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0)
registry.setVaultAuthorization(vaultAddress, true)
badge.setMinterAuthorization(vaultAddress)
vault.setCompoundOperator(autoCompounderAddress, true)
vault.setGYDS(gydsAddress)
```

## Verify

- [ ] `vault.OWNER()` returns `0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0`
- [ ] `vault.gydsActive()` returns `true`
- [ ] `badge.authorizedMinter()` returns vault address
- [ ] `registry.authorizedVaults(vaultAddress)` returns `true`
- [ ] `vault.compoundOperators(autoCompounderAddress)` returns `true`

## Post-Launch

- [ ] Verify first deposit mints Genesis Badge
- [ ] Verify yield accrual after GYDS distribution
- [ ] Email waitlist and post in Nexus Discord
- [ ] Monitor vault health via dev-dashboard
