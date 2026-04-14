# Nexus Mainnet Launch Checklist

## Pre-Deploy

- [ ] Get Nexus mainnet RPC URL from nexus.xyz/developers
- [ ] Get Nexus chain ID from Nexus documentation
- [ ] Get USDX token contract address from Nexus team
- [ ] Get GYDS distributor address from Nexus team
- [ ] Fill all values in `.env` file (never commit .env)
- [ ] Test deployment on Nexus testnet first
- [ ] Run `npx hardhat test` — confirm 229 passing, 0 failing

## Deploy (exact order)

```bash
npx hardhat run scripts/deploy.js --network nexus
```

Deploy order enforced by script:
1. ReferralRegistry
2. VaultGenesisBadge
3. USDXVault (receives registry + badge addresses)
4. AutoCompounder (receives vault address)
5. NexCredit (receives vault + badge + registry addresses)

## Post-Deploy Authorization

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

## Website Update

- [ ] Fill deployed addresses into app.html config block:
  - `VAULT_ADDRESS`
  - `USDX_ADDRESS`
  - `NEXCREDIT_ADDRESS`
- [ ] Update `NEXUS_CHAIN_ID` in app.html
- [ ] Update `NEXUS_RPC_URL` in app.html
- [ ] Deploy all HTML files to Netlify
- [ ] Push final contracts to GitHub

## Post-Launch

- [ ] Verify first deposit mints Genesis Badge
- [ ] Verify yield accrual after GYDS distribution
- [ ] Email waitlist and post in Nexus Discord
- [ ] Monitor vault health via dev-dashboard
