# token-identity testnet deployments (2026-06-11)

Recorded per plan P1 (the frontends read these from their config files; this is the human ledger).

## Faucet drips (Aztec alpha-testnet, sponsored-FPC fees, salts gen 2)
| token | decimals | salt | address |
|---|---|---|---|
| NULO | 6 | 4244 | `0x08625297b24fe09d467506c8c83082c4cbefb215e1e084365e126594ce3d944a` |
| OLUN | 18 | 4245 | `0x24f292d7c6c1d0a56b56a83d387c3046e5b211688049d132281f3e9f3d8240a7` |
| Dripper (shared, salt 1337) | - | 1337 | `0x172684be7d86acff9c0e16b15e3f34647e5c8c26f0838a0872df7f61ddcb7070` |

Verified: `bun run verify:deployments` - all committed addresses match the rebuilt instances.

## AZLO bridge pair ("Aztec Nulo", 18 dec both sides, L2 salts 0x5b11-13)
| contract | chain | address |
|---|---|---|
| AZLO ERC20 (MintableERC20) | Sepolia | `0xa40a2fe147b7e96325d7c7d974b1f11c3ed82c68` |
| TokenPortal | Sepolia | `0x9c41d1dd627ed53e25702590ab974d9dfa0c11ea` |
| AZLO Token (L2) | Aztec testnet | `0x05e80c537c6a7c50563e5ba7bc333d6c6728ddc6290c8a8a910df3a0ba15ac20` |
| token_bridge (L2) | Aztec testnet | `0x0e31670a54cac23d4d74b0d83c44797369a4a2d08a375aab1514283623e2748e` |
| minter proxy (L2) | Aztec testnet | `0x265f078bbf8ee55520c46df595c036a66b7b20301128ba4f100e1e1bd6fdc973` |

Verified: the offline rebuild probe - TOKEN/BRIDGE/PROXY instances all MATCH the committed constants.

Deploy time: bridge end-to-end 4.8m (real proofs). Salt-generation lesson: the proxy's constructor args don't change across token renames - ALL L2 salts must bump together per generation or the deterministic address collides with the live deployment (duplicate siloed nullifier).
