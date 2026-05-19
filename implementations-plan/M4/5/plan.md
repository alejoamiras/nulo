# M4.5 — Proactive TTL via `chrome.alarms` (1-2d)

> **Audit tier**: dual (codex xhigh + Plan agent).

## Context & entry state

Today the wallet's session TTL is **reactive**: `SessionManager.isExpired` (`packages/extension/src/wallet/services/profile/session-manager.ts:275`) checks `since + sessionTtl <= Date.now()` only when a method like `getActive()`, `getSecret()`, or `restore()` runs. Between checks, the secret is held in memory past its expiry window. If the SW gets suspended and restored, `restore()` fires the same check — but only on the next user-initiated call. There's no automatic clear at the TTL boundary.

`AlarmsPort` already exists at `packages/wallet-core/src/ports/alarms-port.ts` (introduced M1-seed) with `create(name, options)`, `clear(name)`, `onAlarm(listener)`. Chrome adapter at `packages/extension/src/core/adapters/chrome-browser-api.ts:183`. Fake at `packages/wallet-core/src/testing/fake-browser-api.ts:256` (verified — supports `trigger` for tests). **No service consumes it yet** — M4.5 is the first.

**Codex audit pass-through**: spec the explicit invariants:
- `sessionTtl === 0` (TTL disabled): no alarm scheduled; existing reactive check stays as the path of last resort.
- Alarm refresh: every successful `SessionManager.refresh()` cancels-then-recreates the alarm.
- Manual lock cancels the alarm.
- Config change shortening TTL reschedules the alarm.
- SW startup with `lockedAt < now`: synchronous lock-fence BEFORE any RPC handler runs.

**Plan agent audit pass-through**: persist `lockedAt` in storage so SW restart doesn't lose the deadline. Synchronous rehydrate-fence on `chrome.runtime.onStartup`.

## Architecture invariants (preserved)

1. **Existing reactive `isExpired` check** — STAYS. Defense-in-depth for the path between alarm-fired and next op (also covers `sessionTtl === 0` case + race conditions where alarm hasn't yet fired).
2. **`SessionManager.open / close / refresh / restore` semantics** — UNCHANGED externally. Internally each gets alarm-management hooks.
3. **`Session` storage shape (`nulo:core:session`)** — adds optional `lockedAt: number` field. Reads of pre-M4.5 sessions work (field is optional; defaulting to `since + sessionTtl` derived value).
4. **`AlarmsPort` API** — UNCHANGED.
5. **`chrome.alarms` 30s minimum period** — N/A here; `delayInMinutes` is fine for typical TTLs (default config probably ≥1 min). For sub-minute TTLs (debug only), document the 30s floor and bypass to reactive-only.
6. **`onActiveProfileChanged` event ordering** — UNCHANGED. Alarm firing → `close()` → existing emit path.
7. **M2.6 vectors** — N/A (TTL doesn't touch crypto).

## Sub-step breakdown

Two commits in one PR.

### Step 1 — Wire `AlarmsPort` into `SessionManager`

**Modified**: `packages/extension/src/wallet/services/profile/session-manager.ts`

#### Constructor changes

Receive `alarmsPort: AlarmsPort` (optional for backwards-compat with code paths that build SessionManager without a full BrowserApi; required in production via the existing `BrowserApi`'s `alarms` field at line 17 of `browser-api.ts`).

Store as a private field. Do NOT wire `onAlarm` here — the listener fires SW-wide and we route by alarm name. Add a single shared listener on the port that matches the TTL alarm name and invokes the appropriate close.

#### Alarm name + scheduling

Constant: `const TTL_ALARM_NAME = "nulo:core:session:ttl"`

On `open(profile, secretBuffer, passhash)` (line 157):
- After successful storage write, schedule:
  ```ts
  if (this.sessionTtl !== 0) {
    const lockedAt = session.since + this.sessionTtl
    await this.alarmsPort.create(TTL_ALARM_NAME, { when: lockedAt })
    session.lockedAt = lockedAt        // persist
    await this.session.set(session)
  }
  ```

On `refresh()` (line 191):
- Bump `since`. Recompute `lockedAt = since + sessionTtl`. Cancel + recreate alarm:
  ```ts
  await this.alarmsPort.clear(TTL_ALARM_NAME)
  if (this.sessionTtl !== 0) {
    await this.alarmsPort.create(TTL_ALARM_NAME, { when: lockedAt })
  }
  session.lockedAt = lockedAt
  await this.session.set(session)
  ```

On `close()` (line 176):
- After successful storage delete:
  ```ts
  await this.alarmsPort.clear(TTL_ALARM_NAME)
  ```

On `restore()` (line 215):
- After successful re-hydration, schedule the alarm based on the persisted `lockedAt` (if absent, derive from `since + sessionTtl`):
  ```ts
  const lockedAt = session.lockedAt ?? (session.since + this.sessionTtl)
  if (this.sessionTtl !== 0) {
    await this.alarmsPort.create(TTL_ALARM_NAME, { when: lockedAt })
  }
  ```

#### Alarm listener

Subscribe in constructor (after the config subscription):

```ts
this.alarmsUnsubscribe = this.alarmsPort.onAlarm((alarm) => {
  if (alarm.name !== TTL_ALARM_NAME) return
  // Caller may already have closed; close() is idempotent.
  void this.close()
})
```

(Maintain `alarmsUnsubscribe` and call it in a hypothetical `dispose()` if SessionManager ever gets a teardown path. Today it's permanent for the SW lifetime.)

#### Synchronous lock fence on SW startup

`SessionManager.restore()` is the existing init-time silent re-hydrate path. **Critical addition**: before re-entering the active session, check `lockedAt`:

```ts
public async restore(lookup, unseal): Promise<void> {
  const session = await this.session.get()
  if (!session) return
  // M4.5 fence: persisted lockedAt < now → silent close, no re-hydrate.
  // Catches the race where chrome.alarms didn't fire because the SW was
  // suspended past the alarm time, then restarted to a stale session.
  const lockedAt = session.lockedAt ?? (session.since + this.sessionTtl)
  if (this.sessionTtl !== 0 && lockedAt <= Date.now()) {
    this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session past lockedAt fence")
    await this.silentClose()
    return
  }
  // … existing TTL-derived isExpired check + restore body …
}
```

This MUST run before any RPC handler that reads `getSecret(profileId)` — `restore()` is already called during service init (`ProfileService.init`), which is awaited before the service is registered for RPC dispatch. Verify the init ordering at execution time.

#### Config-change handler

The existing `onConfigUpdated` (line 294) updates `this.sessionTtl`. Extend it: on TTL change, if the wallet is unlocked, reschedule the alarm against the new value:

```ts
private readonly onConfigUpdated = async (prop: ConfigProp) => {
  if (prop.key !== "sessionTtl") return
  const oldTtl = this.sessionTtl
  this.sessionTtl = prop.value
  if (!this.activeSession) return
  await this.alarmsPort.clear(TTL_ALARM_NAME)
  const newLockedAt = this.activeSession.session.since + this.sessionTtl
  if (this.sessionTtl === 0) {
    // TTL disabled — drop persisted lockedAt for clarity
    delete this.activeSession.session.lockedAt
  } else {
    this.activeSession.session.lockedAt = newLockedAt
    await this.alarmsPort.create(TTL_ALARM_NAME, { when: newLockedAt })
  }
  await this.session.set(this.activeSession.session)
}
```

(NOTE: existing handler is sync. M4.5 makes it async for the storage + alarm calls. Verify caller chain — `config.onUpdate.add(handler)` accepts async handlers? Check `IConfig.onUpdate` semantics during execution.)

### Step 2 — Persist `lockedAt` in `Session` shape

**Modified**: `packages/extension/src/wallet/services/profile/spec.ts`

Add `lockedAt?: number` to `Session` type. Optional for backwards-compat.

**Modified**: `packages/extension/src/wallet/services/profile/session-manager.ts:159-163` (the `open` method body) — also writes `lockedAt`.

**Modified**: `packages/extension/src/wallet/services/profile/session-manager.ts:194-196` (`refresh`) — writes the new `lockedAt`.

(M4.7 will own the broader migration story; this single optional field is forwards-compat without M4.7. M4.7 plan covers `nulo:core:session` as one of the migrators.)

## Test plan

ALL tests use `FakeBrowserApi` (`packages/wallet-core/src/testing/fake-browser-api.ts`) — fake alarms support `trigger(name)` to simulate firing.

**New test file**: `packages/extension/src/wallet/services/profile/session-manager.alarms.test.ts`

1. **Alarm fires once at unlock + ttl**: open a session at `t=0` with `ttl=60000`. Advance clock to `t=60000`. Trigger `TTL_ALARM_NAME`. Assert `getActive()` returns `undefined` and `onChange(undefined)` was emitted.
2. **`sessionTtl === 0` skips alarm scheduling**: open with ttl=0. Assert `fakeBrowser.alarms.create` was not called for `TTL_ALARM_NAME`. The reactive check still permits `getActive()` to return the session indefinitely.
3. **Refresh reschedules alarm**: open at t=0, ttl=60000. At t=30000 call `refresh()`. Inspect alarm registry: previous alarm cleared, new alarm scheduled for `30000+60000=90000`. Trigger at original 60000 — alarm name doesn't exist (cleared), no firing.
4. **Manual `close()` cancels alarm**: open + close. Assert alarm absent from fake registry.
5. **SW restart with `lockedAt < now` triggers silent close**: write a `Session` to fake storage with `since=0`, `lockedAt=10`, then construct a fresh `SessionManager` and call `restore()` with mock `now=1000`. Assert: `activeSession` is undefined, no `onChange` event fired (silent), persisted session deleted.
6. **SW restart with `lockedAt > now` re-schedules alarm** during restore. Assert fake alarm registry has the alarm at the persisted `lockedAt`.
7. **Config TTL change reschedules alarm**: open at t=0 with ttl=60000. Drop ttl to 30000 via `onUpdate`. Assert alarm rescheduled to t=30000 (since=0 + new ttl).
8. **Config TTL → 0 cancels alarm**: open, then set ttl=0. Assert alarm cleared.
9. **Stale alarm fires after manual lock**: open, manually `close()`, then trigger `TTL_ALARM_NAME` (simulating racing alarm delivery in real chrome). `close()` is idempotent — no error, no double-emit.

9 tests total. Each tests a distinct invariant. No per-callsite white-box tests.

**NOT TESTED:**
- Real `chrome.alarms` timing accuracy (fake-browser is the right level; real chrome is the e2e layer).
- Multiple active sessions (single-profile-active model unchanged).
- E2E manual lock UX (defer — M4.5 is internal).
- M2.6 vectors (untouched).

**Existing tests to consider**: 
- `session-manager.test.ts` if it exists — keep, extend if any pre-M4.5 TTL test now needs an alarm assertion. Likely just additive.

## Verification commands

```bash
bun run --filter '@nulo/extension' test     # session-manager.alarms.test.ts passes
bun run typecheck:all                        # AlarmsPort wiring resolves
bun run test:all                             # M2.6 unaffected
bun run check:imports                        # boundary clean
bun run build                                # alarms permission already in manifest (line 33), no manifest change
```

Manual QA (15 min):
1. Set `sessionTtl` to a short value (e.g. 30s if config UI allows; otherwise edit storage).
2. Unlock + leave the popup; wait the TTL.
3. Confirm: when popup re-opens, wallet is locked.
4. Repeat with `sessionTtl = 0`: wallet stays unlocked indefinitely.
5. Repeat with manual lock + alarm-time: no double-emit.

## Risks tracked

1. **30s minimum alarm period in production Chrome.** For dev/QA configs with `sessionTtl < 30s`, the alarm fires no earlier than 30s. The reactive `isExpired` check still catches the missed window. Document in `SessionManager` JSDoc.
2. **`chrome.alarms` does not survive full browser restart.** `chrome.storage.session` doesn't either, so this is consistent — but if the user closes Chrome with a session active and reopens, they're locked. Same as today's behavior (chrome.storage.session clears on browser exit). No regression.
3. **Alarm listener registered SW-wide.** SessionManager listens for `TTL_ALARM_NAME` only; M4.4's offscreen alarms or future timer alarms must use distinct names. Convention: `nulo:<service>:<purpose>`.
4. **Async config-update handler** — verify `IConfig.onUpdate` accepts async listeners; if not, schedule the alarm work via a microtask.
5. **`lockedAt` field added to persisted `Session`** — old sessions written pre-M4.5 won't have it. The fence in `restore()` falls back to `since + sessionTtl` derivation. Forward-compat only; backward-compat is "no field, derive."

## Rollback

`git revert <m4.5-commit-sha>` rolls back. The new field is optional + the alarm wiring is additive — old session records continue to work.

## Open questions / decision flags

1. **Config-change handler async** — verify `IConfig.onUpdate.add` callback signature at execution time. If sync-only, wrap the alarm reschedule in `void (async () => { … })()`.
2. **Manifest `alarms` permission** — already declared (`manifest.config.ts:33`). No change.
