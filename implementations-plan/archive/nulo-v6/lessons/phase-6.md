# Phase 6 · Publish the V6-line packages

## Step 1 · The dry run (2026-10-01)

- `gh workflow run publish-packages.yml --ref dev -f version=0.2.0`, dispatched at 13:24:41Z right
  after #736 merged: run `36868475369`, `dev` at `80663b61`, every job green; the `publish` and
  `verify` jobs skipped, as a dry run does.
- The `pack` job's tarballs (downloaded, hashed locally):
  - `alejoamiras-nulo-resolve-asset-0.2.0.tgz`
    `dddd631aaad90bb2bad727fe5b8f5b3c7b6d7be39e7974568ebbc559ffa4405d`
  - `alejoamiras-nulo-wallet-crypto-0.2.0.tgz`
    `36f5fe2d27cd5d60166ec4e0d304f69974e742ddf3282a1b29cf744baf03319c`
  - `alejoamiras-nulo-wallet-sdk-schema-patch-0.2.0.tgz`
    `bb2e31815a87e8ced14be48cbc7e406c8c374d2228911afb073f758baf3cf85e`
- Staged peers, each exact: wallet-crypto on `@aztec-labs/accounts` and `@aztec-labs/foundation`,
  schema-patch on `@aztec-labs/aztec.js` and `@aztec-labs/stdlib`, all `6.0.0-rc.1`; schema-patch
  keeps its one dependency, `zod ^4.4.3`; resolve-asset has neither. 0.1.0 had the same shape on
  `@aztec/*@5.2.0` (`npm view`), so 0.2.0 moves the scope and the line, nothing else.
- `check-digests.ts` binds only 0.1.0's digests, so 0.2.0 passes it with a note: what binds
  0.2.0 is step 2's comparison before the approval, not the script.

## Step 2 · The real run

- Dispatched by the driver on the owner's word, 2026-10-01: "Regarding the npm run, also: can't
  you do it yourself? Im explicitly authorizing you". `gh workflow run publish-packages.yml --ref
  dev -f version=0.2.0 -f dry_run=false` at 13:56:04Z: run `36872399302`, `dev` at `80663b61`,
  the dry run's commit.
- Its `pack` artifact, downloaded and hashed before the approval: the same three sha256 digests
  as the dry run's. (The artifact zips' own digests differ, `306ce47e…` against `32168ff4…`:
  GitHub zips each upload anew. The tarballs inside are what bind.) The `publish` job downloads
  that artifact by id, checks it against `pack`'s digests and publishes those files.
- The driver's approval of `npm-publish` through the API was refused by the session's safety
  classifier, so the owner approved it in the UI; `publish` started at 14:04:16Z. `publish`
  (14:04:43Z) and the workflow's own `verify` (14:07:19Z) passed; the run ended green.

## Step 3 · The V6 facts for unleashed

- `ListAgents` listed unleashed's session (`unleashed-57`, idle), which had asked for the version
  once the packages were on npm. Sent at about 14:10Z: the three packages at 0.2.0 with their
  peers and provenance commit; L1 chain id, rollup version and wallet chain id; the node's origin
  only, with the key policy; the PrivateFPC and its derivation, and that unleashed's V6 manifest
  must name exactly that address; the SponsoredFPC and its class; and that arc C waits for
  unleashed's V6 generation.
- unleashed's reply: it pins `@alejoamiras/nulo-*` at exactly 0.2.0 on its V6 worktree, checked
  the peers and provenance on npm itself, and its PrivateFPC pin is the same address. Its V6
  testnet manifest (`walletChainId 2904119610`) comes with its generation deploy, which waits on
  the owner's V6 toolchain install.

## Validation gate

Run at about 14:08Z, after the publish run ended; every step exited 0.
- `npm view <pkg>@0.2.0 peerDependencies dependencies`: wallet-crypto peers
  `@aztec-labs/accounts` and `@aztec-labs/foundation`, schema-patch `@aztec-labs/aztec.js` and
  `@aztec-labs/stdlib`, each exactly `6.0.0-rc.1`; resolve-asset has neither field.
- `npm pack <pkg>@0.2.0` for each, then `sha256sum -c` against the dry run's digests: OK ×3, so
  the published bytes are the dry run's.
- A scratch `npm install --ignore-scripts` of all three at 0.2.0: 295 packages. `npm audit
  signatures`: 295 with verified registry signatures, 46 with verified attestations.
- `scripts/publish/verify-provenance.sh <tarball>` with its defaults, on each registry tarball:
  each verifies and prints the attested source commit `80663b61`.

Pass, as written: every peer exact on `@aztec-labs/*@6.0.0-rc.1`, signatures and provenance
verified, the published digests equal to the dry run's.
