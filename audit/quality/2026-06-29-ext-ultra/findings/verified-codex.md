Q-01: CONFIRMED  
Checked storage parse, messaging decode/unwrap, dApp payload, PXE client, and backup import samples. Cited lines show unchecked `JSON.parse`, `as T`, `as never`, or ad hoc conversions; no phantom sampled lines. Impact/effort look right.

Q-02: CONFIRMED  
Checked `MethodsMap`, `BaseService.invoke`, bridge `dispatch(methodName: string, args: unknown[])`, builders, scope checkers. The smell is downstream untyped dispatch/arg indexing, not just `any[]`. Impact/effort look right.

Q-03: CONFIRMED  
Checked extension client wrappers and PXE `Methods`/`IPXE`/subset/proxy/client/service surfaces. Samples really are hand-restated passthroughs and method lists. Days effort looks right.

Q-16: CONFIRMED  
`AppServices` requires lazy clients, while `createAppServices()` assigns `null as unknown as ...`; `managers.transaction` is later reassigned. I count 43 `managers.(network|transaction|account)` reads, close enough to “~44”. Impact/effort right.

Q-17: ADJUSTED  
`runExclusive` exists and every listed bypass pair exists, but the finding’s list contains 21 bypass blocks, not 22; 22 only counts `runExclusive`’s own lock pair. Impact stands; effort is hours but needs care around zeroization/phased crypto paths.

Q-19: CONFIRMED  
`required`/`proverless` booleans allow illegal combos until constructor runtime check; `profileId:chainId` and `pxe/${profileId}/${chainId}` are repeated; `NetworkInfo` has two shapes. Impact/effort right.

Q-20: CONFIRMED  
`ConfigStore` uses reflective casts and `typeof` comparison to load persisted config; union strings like `theme`/`defaultExplorer` are not domain-validated. Local impact and hours effort are right.

Q-22: ADJUSTED  
Most drift is real: Aztec docs/comments still say `4.2.0` while deps pin `5.0.0-rc.1`; crypto README says PBKDF2 250k while source is `600_000`; extension-messaging README is stale for `src/core/*` correlator and disconnect errors. Wrong instance: `wallet-core/README.md` no longer says `types: []`, though `tsconfig` does have `["node"]`.