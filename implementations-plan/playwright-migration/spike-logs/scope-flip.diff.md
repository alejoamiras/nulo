# Scope-flip edit to apply after baseline run

The single change for Cell P-test: replace `dappConnectedExtension`'s file-scoped
body with the per-test fresh-launch body. (`dappConnectedExtensionPerTest` already
exists at the same file — we just point `dappConnectedExtension` at the same
shape so test files don't need to be touched.)

File: `packages/extension/tests/e2e/fixtures/extension.ts`

## Before (lines 237-252)

```ts
dappConnectedExtension: [
    async ({ registeredExtension }, use) => {
        // CRITICAL: switch to Local Network BEFORE connecting the playground.
        // The playground passes Fr.ZERO chainInfo (= chainId 0 = Local Network);
        // without this switch the extension defaults to Testnet, where there are
        // no accounts → cap-account-item list is empty → every accounts/sendTx/
        // sim test fails. (Confirmed by Codex audit run 1 — Codex 2026-04-26.)
        const setupPage = await openPopup(registeredExtension)
        await waitForHash(setupPage, "#/popup/general", 15_000)
        await switchToLocalNetwork(setupPage)
        await setupPage.close()
        const playgroundPage = await connectPlayground(registeredExtension)
        await use(Object.assign(registeredExtension, { playgroundPage }))
    },
    { scope: "file" },
],
```

## After (apply on top of baseline-clean state)

```ts
dappConnectedExtension: [
    // SPIKE: temporarily per-test fresh launch to test cumulative-load H1.
    // Was { scope: "file" } using a shared registeredExtension. Revert after spike.
    // biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
    async ({}, use) => {
        const ctx = await launchExtension()
        await registerProfile(ctx)
        const setupPage = await openPopup(ctx)
        await waitForHash(setupPage, "#/popup/general", 15_000)
        await switchToLocalNetwork(setupPage)
        await setupPage.close()
        const playgroundPage = await connectPlayground(ctx)
        await use(Object.assign(ctx, { playgroundPage }))
        await ctx.browser.close()
    },
    { scope: "test" },
],
```

## Rationale

- One-line semantic flip: `{ scope: "file" }` → `{ scope: "test" }`. The body
  changes to manage its own browser lifecycle (matches the existing
  `dappConnectedExtensionPerTest` body at lines 254-268), so it doesn't depend
  on the file-scoped `registeredExtension`.
- All ~30 dapp tests using `dappConnectedExtension` automatically pick this up —
  no per-test file edits.
- Expected impact: each dapp test pays ~30-40s setup (launch + register + switch
  net + connect playground). Adds ~15-20 min wall-clock to network suite total.
- If H1 is supported, the cumulative-load failures (~7 in the prior session's
  observation) collapse and pass rate climbs from ~46/66 → ~53-60/66.
- If H1 is falsified, pass rate is similar or worse (per-test SW-boot adds
  flakiness without resolving the underlying issue).

## How to apply

```bash
# When baseline run is done:
# 1. Apply the edit with Edit tool
# 2. git commit -m "spike: flip dappConnectedExtension to per-test scope"
# 3. cd packages/extension && bun run e2e:agent 2>&1 | tee ../../implementations-plan/playwright-migration/spike-logs/scope-flip.log
```

## How to revert

```bash
git checkout dev -- packages/extension/tests/e2e/fixtures/extension.ts
```
