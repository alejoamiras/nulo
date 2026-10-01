# Phase 3 — P6 schema-sourced fixtures + P7 await/disconnect — lessons

**Status: ✓ complete.** Gate: `useFullBackupImport.test.ts` 38 pass + `test:components src/components/composite/import/` 367 pass; typecheck 0; lint 0.

## What was built
- **P7 completeImport:** `await opts.completeImport(newProfile)` in an isolated try/catch — a rejected completion handshake logs but never flips status off "finished" or reaches the outer rollback (the import genuinely succeeded by then). Pin: rejected completeImport → status "finished", `deleteProfile` NOT called, no "Import failed".
- **P7 client leaks:** the backup-services restore loop is now wrapped in a WHOLE-LOOP try/finally that disconnects EVERY constructed client. A per-iteration finally was insufficient — clients are constructed up-front, so a mid-loop throw would leak all the clients AFTER the one that threw. Also wrapped `tokenService.restore` in try/finally. Pin: a first-client (transaction) throw still disconnects all 7 clients.
- **P6 fixtures:** `buildBackup` default network → new-shape (`endpoints[]` + `primaryEndpointId` + `kind`), default account → schema-complete (`profileId`/`chainId`/`address`/`index`/`type`/`name`/`visible`), so the default path mirrors what real services accept + the #220 read-codecs validate.

## Key point (P7 loop leak)
The subtle bug in my first attempt: a per-iteration `try/finally` only disconnects the client whose iteration ran. Since all 7 clients are constructed BEFORE the loop, a throw on client 1 leaves clients 2–7 constructed-but-connected and unreached → leak. The whole-loop `finally { for (client) client.disconnect() }` is the correct shape — disconnect is symmetric teardown, safe on a constructed-but-unused client, and idempotent enough for the mocks.

## Scope note (P6)
P6 is inherently limited in this suite because the composable test MOCKS every service client — the fixture shape is only exercised by the composable's OWN field reads (post-Phase-2: index by position, token `(chainId,contract)`, account address for provenance), none of which read `rpcUrl` anymore. So realistic default fixtures are the high-leverage change; a full `Schema.parse(fixture)` assertion is impractical here (the test's spec-module mocks would fight importing the real zod schemas). The real anti-invisible-row protection is the schema-conformance guardrail shipped in the prior arc (`footprint-coverage.test.ts`). Recorded honestly rather than forcing a brittle schema import into the mock graph.
