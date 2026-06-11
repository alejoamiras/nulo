# P1 - deploy scripts + testnet deploys (lessons)

## 2026-06-11 - P1a: scripts parameterized (deploy RUNS blocked on the deployer env)
- Faucet config: NULO(6, salt 4244) + OLUN(18, salt 4245) - fresh salts so the retired USDC/ETH drips (4242/4243) and Wonderland's 1337 defaults can't collide; deploy.ts symbol union updated.
- Bridge script: ONE `TOKEN_NAME/SYMBOL/DECIMALS` source ("Aztec Nulo"/AZLO/18) replacing the three hardcoded `"Nulo USDC","USDC",6` sites + the L1==L2 decimals assert before portal wiring (the portal moves raw units).
- BLOCKED on user input: no deployer env anywhere (no .env, no shell vars). Needed to RUN the deploys: faucet `DEPLOYER_SECRET_KEY`(+`DEPLOYER_SALT`) or `DEPLOYER_SECRET`; bridge `PRIVATE_KEY` (funded Sepolia) + optional `SEPOLIA_RPC_URL`/`AZTEC_NODE_URL`. Proceeding with P2 + P3-code meanwhile; the runs + address recording + constants flip resume when the env lands.

LESSONS_FILE=implementations-plan/token-identity/lessons/phase-1.md
