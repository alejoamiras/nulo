# M3 — Unit Testing Plan

## Principles

- Only write tests where there is a real gap. Do not re-test what already exists.
- Every test locks a specific invariant that extraction could silently break.
- Tests that move with their source file are listed under "Carry over" — they are verified complete, not new.
- New tests are scoped to the smallest meaningful assertion. No coverage theater.

---

## M3.1 — `@nulo/wallet-core`

### Carry over (move with source, already solid)

| Test file | What it locks |
|---|---|
| `wallet/base/topology.test.ts` | Topological phase ordering, cycle detection, unknown-dep error |
| `wallet/utils/rw-guard.test.ts` | Concurrent read/write exclusion, FIFO ordering, throw-doesn't-leak |
| `wallet/utils/mnemonic.test.ts` | BIP39 round-trip vectors (24 reference cases + random fuzz) |
| `wallet/utils/serialization.test.ts` | Serialization round-trip |

### New tests — wallet-core gaps

Four source files with zero test coverage are moving into wallet-core.

---

#### `packages/wallet-core/src/utils/lock.test.ts`

**Why**: `Lock` is the sequencing primitive for every service's critical section. A broken release path deadlocks the entire SW.

```ts
import { describe, expect, test, vi, afterEach } from "vitest"
import { Lock } from "./lock"

/** Real-timer setTimeout flush. Do NOT call inside fake-timer tests. */
const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0))

describe("Lock", () => {
  afterEach(() => vi.useRealTimers())

  test("leave() before any enter() is a safe no-op", () => {
    // Guards against a refactor that throws on un-held leave
    expect(() => new Lock().leave()).not.toThrow()
  })

  test("sequential: second enter() waits for leave()", async () => {
    const lock = new Lock()
    const order: string[] = []

    await lock.enter()
    order.push("A:held")

    const second = (async () => {
      await lock.enter()
      order.push("B:held")
      lock.leave()
    })()

    await flushMicrotasks()
    expect(order).toEqual(["A:held"])

    lock.leave()
    await second
    expect(order).toEqual(["A:held", "B:held"])
  })

  test("FIFO: three concurrent waiters run in enqueue order", async () => {
    const lock = new Lock()
    const order: string[] = []

    await lock.enter()

    const make = (label: string) =>
      (async () => { await lock.enter(); order.push(label); lock.leave() })()

    const b = make("B")
    const c = make("C")
    const d = make("D")

    await flushMicrotasks()
    expect(order).toEqual([])

    lock.leave()
    await Promise.all([b, c, d])
    expect(order).toEqual(["B", "C", "D"])
  })

  test("force-release after 5 min unblocks next waiter", async () => {
    vi.useFakeTimers()
    const lock = new Lock()

    await lock.enter()
    // leave() is intentionally never called — simulates a hung holder

    let secondRan = false
    const second = (async () => {
      await lock.enter()
      secondRan = true
      lock.leave()
    })()

    await vi.advanceTimersByTimeAsync(0)
    expect(secondRan).toBe(false)

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 100)
    await second
    expect(secondRan).toBe(true)
  })
})
```

---

#### `packages/wallet-core/src/utils/queue.test.ts`

**Why**: `Queue` is used by `TokenBalanceService` (balance job queue). `priorityPass` dedup logic is subtle — a broken dedup enqueues duplicates that cause double-fetch bugs.

```ts
import { describe, expect, test } from "vitest"
import { Queue } from "./queue"

const q = () => new Queue<string, { id: string; v: number }>((x) => x.id)

describe("Queue", () => {
  test("empty dequeue returns undefined", () => {
    expect(q().dequeue()).toBeUndefined()
  })

  test("empty dequeueBatch returns []", () => {
    expect(q().dequeueBatch(5)).toEqual([])
  })

  test("FIFO ordering", () => {
    const queue = q()
    queue.enqueue({ id: "a", v: 1 })
    queue.enqueue({ id: "b", v: 2 })
    queue.enqueue({ id: "c", v: 3 })
    expect(queue.dequeue()?.id).toBe("a")
    expect(queue.dequeue()?.id).toBe("b")
  })

  test("enqueue deduplicates by key — same key silently dropped", () => {
    const queue = q()
    queue.enqueue({ id: "x", v: 1 })
    queue.enqueue({ id: "x", v: 2 }) // dropped
    expect(queue.length).toBe(1)
    expect(queue.dequeue()?.v).toBe(1)
  })

  test("dequeue removes key from set — same key can be re-enqueued after dequeue", () => {
    const queue = q()
    queue.enqueue({ id: "a", v: 1 })
    queue.dequeue()
    queue.enqueue({ id: "a", v: 2 }) // must succeed — key was freed
    expect(queue.length).toBe(1)
  })

  test("priorityPass promotes existing item to front, REPLACES its value, preserves others", () => {
    const queue = q()
    queue.enqueue({ id: "a", v: 1 })
    queue.enqueue({ id: "b", v: 2 })
    queue.enqueue({ id: "c", v: 3 })
    queue.priorityPass({ id: "c", v: 99 }) // c moves to front with new value 99
    expect(queue.length).toBe(3)           // all three still present
    const c = queue.dequeue()
    expect(c?.id).toBe("c")
    expect(c?.v).toBe(99)                  // value was REPLACED by priorityPass
    expect(queue.dequeue()?.id).toBe("a")
    expect(queue.dequeue()?.id).toBe("b")
  })

  test("priorityPass inserts new item at front", () => {
    const queue = q()
    queue.enqueue({ id: "a", v: 1 })
    queue.priorityPass({ id: "z", v: 0 })
    expect(queue.dequeue()?.id).toBe("z")
    expect(queue.length).toBe(1)
  })

  test("priorityPass of item already at front keeps position but REPLACES value (not idempotent)", () => {
    const queue = q()
    queue.enqueue({ id: "a", v: 1 })
    queue.enqueue({ id: "b", v: 2 })
    queue.priorityPass({ id: "a", v: 99 }) // a is already at front, value replaced
    expect(queue.length).toBe(2)
    const a = queue.dequeue()
    expect(a?.id).toBe("a")
    expect(a?.v).toBe(99) // value was REPLACED (splice removed old, unshift added new)
  })

  test("dequeueBatch returns at most n items, empties correctly", () => {
    const queue = q()
    for (const id of ["a", "b", "c", "d", "e"]) queue.enqueue({ id, v: 0 })
    const batch = queue.dequeueBatch(3)
    expect(batch.map((x) => x.id)).toEqual(["a", "b", "c"])
    expect(queue.length).toBe(2)
  })

  test("dequeueBatch with size > queue length returns all items", () => {
    const queue = q()
    queue.enqueue({ id: "a", v: 0 })
    queue.enqueue({ id: "b", v: 0 })
    const batch = queue.dequeueBatch(10)
    expect(batch.length).toBe(2)
    expect(queue.length).toBe(0)
  })

  test("peek does not consume", () => {
    const queue = q()
    queue.enqueue({ id: "a", v: 1 })
    expect(queue.peek()?.id).toBe("a")
    expect(queue.length).toBe(1)
  })

  test("clear empties items and key set — re-enqueue succeeds", () => {
    const queue = q()
    queue.enqueue({ id: "a", v: 1 })
    queue.clear()
    expect(queue.length).toBe(0)
    queue.enqueue({ id: "a", v: 2 }) // would be dropped if key set weren't cleared
    expect(queue.length).toBe(1)
  })
})
```

---

#### `packages/wallet-core/src/utils/event-handler.test.ts`

**Why**: `EventHandler` is used for service events (`onTokenUpdated`, `onAccountChanged`, etc.). The error isolation invariant (catch in invoke) prevents one bad callback from killing all listeners.

```ts
import { describe, expect, test } from "vitest"
import { EventHandler } from "./event-handler"

describe("EventHandler", () => {
  test("invoke calls all registered listeners", () => {
    const eh = new EventHandler<number>()
    const calls: number[] = []
    eh.add((n) => calls.push(n))
    eh.add((n) => calls.push(n * 10))
    eh.invoke(3)
    expect(calls).toEqual([3, 30])
  })

  test("add is idempotent — same reference added twice fires once", () => {
    const eh = new EventHandler<string>()
    const calls: string[] = []
    const fn = (s: string) => calls.push(s)
    eh.add(fn)
    eh.add(fn)
    eh.invoke("x")
    expect(calls).toEqual(["x"])
  })

  test("remove prevents future invocations", () => {
    const eh = new EventHandler<number>()
    const calls: number[] = []
    const fn = (n: number) => calls.push(n)
    eh.add(fn)
    eh.remove(fn)
    eh.invoke(1)
    expect(calls).toEqual([])
  })

  test("remove() of a never-added callback is a safe no-op", () => {
    // Guards against refactors that introduce splice(-1, 1) — which removes the last element
    const eh = new EventHandler<number>()
    const calls: number[] = []
    const valid = (n: number) => calls.push(n)
    eh.add(valid)
    expect(() => eh.remove(() => {})).not.toThrow() // never-added
    eh.invoke(5)
    expect(calls).toEqual([5]) // valid callback still present
  })

  test("error in callback is isolated — throwing cb fires, subsequent cbs still run", () => {
    const eh = new EventHandler<string>()
    const fired: string[] = []
    eh.add(() => { fired.push("throw"); throw new Error("boom") })
    eh.add((s) => fired.push(s))
    expect(() => eh.invoke("hello")).not.toThrow()
    expect(fired).toEqual(["throw", "hello"])
  })

  test("invoke on empty handler is safe", () => {
    const eh = new EventHandler<void>()
    expect(() => eh.invoke()).not.toThrow()
  })
})
```

---

#### `packages/wallet-core/src/storage/entity_storage.test.ts`

**Why**: `EntityStorage` is an untested primitive that M3.1 refactors (purifies the `StorageType | StorageArea` union ctor). The class is non-trivial: JSON serialize/deserialize on every operation, root-scoped keys (`root@id`), `contains()` using `key in res` as existence check. Untested refactor = regression vector. These tests lock the contract BEFORE purification, then the purified version must keep them green.

Critical note: use `FakeBrowserApi`'s `api.storage.local` (not raw `@webext-core/fake-browser`). `FakeBrowserApi` normalizes `{ key: undefined }` → `{}` to match real chrome.storage — otherwise `contains()` returns true for missing keys and the ID-picking loops elsewhere in the codebase infinite-loop.

```ts
import { beforeEach, describe, expect, test } from "vitest"
import { FakeBrowserApi } from "../testing/fake-browser-api"
import { EntityStorage } from "./entity_storage"

type User = { name: string; age: number }

describe("EntityStorage", () => {
  let api: FakeBrowserApi
  let storage: EntityStorage<User>

  beforeEach(() => {
    api = new FakeBrowserApi()
    api.reset()
    storage = new EntityStorage<User>("users", api.storage.local)
  })

  test("set/get round-trip preserves the entity", async () => {
    await storage.set("alice", { name: "Alice", age: 30 })
    expect(await storage.get("alice")).toEqual({ name: "Alice", age: 30 })
  })

  test("get of missing id returns undefined (not null, not {})", async () => {
    expect(await storage.get("nobody")).toBeUndefined()
  })

  test("contains: true after set, false for missing, false after delete", async () => {
    await storage.set("a", { name: "A", age: 1 })
    expect(await storage.contains("a")).toBe(true)
    expect(await storage.contains("b")).toBe(false)
    await storage.delete("a")
    expect(await storage.contains("a")).toBe(false)
  })

  test("getAll returns all [id, entity] pairs scoped to root", async () => {
    await storage.set("a", { name: "A", age: 1 })
    await storage.set("b", { name: "B", age: 2 })
    const all = await storage.getAll()
    expect(all.sort()).toEqual([
      ["a", { name: "A", age: 1 }],
      ["b", { name: "B", age: 2 }],
    ])
  })

  test("getKeys strips the `root@` prefix", async () => {
    await storage.set("alice", { name: "Alice", age: 30 })
    await storage.set("bob", { name: "Bob", age: 25 })
    const keys = await storage.getKeys()
    expect(keys.sort()).toEqual(["alice", "bob"])
  })

  test("different roots do not leak across namespaces", async () => {
    const other = new EntityStorage<{ x: number }>("other", api.storage.local)
    await storage.set("alice", { name: "Alice", age: 30 })
    await other.set("alice", { x: 99 })
    expect(await storage.get("alice")).toEqual({ name: "Alice", age: 30 })
    expect(await other.get("alice")).toEqual({ x: 99 })
    expect((await storage.getAll()).length).toBe(1)
    expect((await other.getAll()).length).toBe(1)
  })

  test("findByPredicate returns matching entities with their keys", async () => {
    await storage.set("a", { name: "A", age: 30 })
    await storage.set("b", { name: "B", age: 25 })
    await storage.set("c", { name: "C", age: 40 })
    const adults = await storage.findByPredicate((u) => u.age >= 30)
    expect(adults.map((r) => r.key).sort()).toEqual(["a", "c"])
  })

  test("getVersion returns 0 when unset; setVersion round-trips", async () => {
    expect(await storage.getVersion()).toBe(0)
    await storage.setVersion(5)
    expect(await storage.getVersion()).toBe(5)
  })
})
```

---

#### `packages/wallet-core/src/storage/value-storage.test.ts`

**Why**: Same reason as EntityStorage — untested + M3.1 refactors the ctor. Simpler surface (no id, single value per root) but still needs round-trip coverage.

```ts
import { beforeEach, describe, expect, test } from "vitest"
import { FakeBrowserApi } from "../testing/fake-browser-api"
import { ValueStorage } from "./value-storage"

describe("ValueStorage", () => {
  let api: FakeBrowserApi

  beforeEach(() => {
    api = new FakeBrowserApi()
    api.reset()
  })

  test("get returns undefined when unset", async () => {
    const vs = new ValueStorage<number>("count", api.storage.local)
    expect(await vs.get()).toBeUndefined()
  })

  test("set/get round-trip for primitives", async () => {
    const vs = new ValueStorage<number>("count", api.storage.local)
    await vs.set(42)
    expect(await vs.get()).toBe(42)
  })

  test("set/get round-trip for objects", async () => {
    const vs = new ValueStorage<{ a: number; b: string }>("config", api.storage.local)
    await vs.set({ a: 1, b: "x" })
    expect(await vs.get()).toEqual({ a: 1, b: "x" })
  })

  test("delete clears the value; subsequent get is undefined", async () => {
    const vs = new ValueStorage<number>("count", api.storage.local)
    await vs.set(42)
    await vs.delete()
    expect(await vs.get()).toBeUndefined()
  })

  test("two ValueStorages with different roots are isolated", async () => {
    const a = new ValueStorage<number>("a", api.storage.local)
    const b = new ValueStorage<number>("b", api.storage.local)
    await a.set(1)
    await b.set(2)
    expect(await a.get()).toBe(1)
    expect(await b.get()).toBe(2)
  })
})
```

---

#### `packages/wallet-core/src/utils/arrays.test.ts`

**Why**: `array_equals` is used in crypto comparisons; `hasIntersectionByKeys` drives token-matching logic; `array_max` underpins `wrapParams`/`unwrapParams`. All have subtle edge cases.

```ts
import { describe, expect, test } from "vitest"
import { array_equals, array_max, hasIntersectionByKeys } from "./arrays"

describe("array_equals", () => {
  test("identical arrays → true", () => {
    expect(array_equals(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true)
  })
  test("different value at one byte → false", () => {
    expect(array_equals(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false)
  })
  test("different lengths → false (short-circuits without out-of-bounds)", () => {
    expect(array_equals(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false)
  })
  test("empty equals empty", () => {
    expect(array_equals(new Uint8Array(), new Uint8Array())).toBe(true)
  })
})

describe("array_max", () => {
  test("empty → 0 (identity value)", () => { expect(array_max([])).toBe(0) })
  test("single element", () => { expect(array_max([5])).toBe(5) })
  test("max in the middle", () => { expect(array_max([1, 9, 3, 7])).toBe(9) })
  // Documented quirk: initializer is 0, so all-negative input returns 0, not the max negative.
  // Callers (wrapParams index space) always use non-negative indices — this is safe as-is.
  test("all-negative input → 0 (known quirk, callers use non-negative indices)", () => {
    expect(array_max([-5, -1, -3])).toBe(0)
  })
})

describe("hasIntersectionByKeys", () => {
  const item = (id: string, n: number) => ({ id, n })

  test("matching item → true", () => {
    expect(hasIntersectionByKeys([item("a", 1)], [item("a", 2)], ["id"])).toBe(true)
  })
  test("no match → false", () => {
    expect(hasIntersectionByKeys([item("a", 1)], [item("b", 1)], ["id"])).toBe(false)
  })
  test("multi-key composite match: same id + same n → true", () => {
    expect(hasIntersectionByKeys([{ id: "x", n: 1 }], [{ id: "x", n: 1 }], ["id", "n"])).toBe(true)
  })
  test("multi-key composite: same id + different n → false", () => {
    expect(hasIntersectionByKeys([{ id: "x", n: 1 }], [{ id: "x", n: 2 }], ["id", "n"])).toBe(false)
  })
  test("empty first array → false", () => {
    expect(hasIntersectionByKeys([], [item("a", 1)], ["id"])).toBe(false)
  })
  test("bigint values stringify correctly — no false positive", () => {
    const a = [{ id: "x", v: 1n }]
    const b = [{ id: "x", v: 1n }]
    expect(hasIntersectionByKeys(a, b, ["v"])).toBe(true)
  })
})
```

---

## M3.2 — `@nulo/wallet-crypto`

### Carry over (move with source)

| Test file | What it locks |
|---|---|
| `profile/encryption/encryption-key.test.ts` | AES-GCM round-trip, randomized IV, wrong-key rejection |
| `profile/password-secret-box.test.ts` | PBKDF2+AES seal/unseal, wrong-password rejection |
| `wallet/crypto/key-vectors.test.ts` | **Stays in extension** (AccountType dep), but imports update to `@nulo/wallet-crypto` — M2.6 vectors lock derivation chain |

### New tests

None. The moved tests (`encryption-key.test.ts`, `password-secret-box.test.ts`) already cover the crypto surface. `key-vectors.test.ts` provides the cryptographic regression guard from the extension side.

**One verification step to add to the M3.2 plan**: run `bun run test` in `packages/wallet-crypto/` immediately after scaffolding and moving. The moved tests must pass before any import migration in extension.

---

## M3.3 — `@nulo/extension-messaging`

### Carry over (move with source)

| Test file | What it locks |
|---|---|
| `wallet/base/errors.test.ts` | WalletError hierarchy, `walletErrorFromPayload` round-trip, unknown code fallback |
| `wallet/base/zod-helpers.test.ts` | `validateParams` / `validateResult` happy/sad paths, issue surfacing |
| `wallet/base/background/client.test.ts` | `ServiceClient<T>` connect/call/event cycle (fake-browser) |
| `wallet/base/offscreen/client.test.ts` | `OffscreenServiceClient` message round-trip |

### New tests — extension-messaging gaps

#### `packages/extension-messaging/src/utils.test.ts`

**Why**: `wrapParams`/`unwrapParams` is the RPC wire serialization for every method call in the system. Silent drift here corrupts all params — no type error, just wrong values at the other end. Moves from `wallet/base/utils.ts` to extension-messaging in M3.3.

```ts
import { describe, expect, test } from "vitest"
import { wrapParams, unwrapParams } from "./utils"

describe("wrapParams / unwrapParams", () => {
  test("round-trip: single element", () => {
    expect(unwrapParams(wrapParams(["x"]))).toEqual(["x"])
  })

  test("round-trip: multiple primitives", () => {
    const params = ["hello", 42, true]
    expect(unwrapParams(wrapParams(params))).toEqual(params)
  })

  test("round-trip: undefined holes preserved", () => {
    const params: unknown[] = [0, undefined, 2]
    const result = unwrapParams(wrapParams(params)) as unknown[]
    expect(result[0]).toBe(0)
    expect(result[1]).toBeUndefined()
    expect(result[2]).toBe(2)
  })

  test("empty params round-trip → empty array", () => {
    expect(unwrapParams(wrapParams([]))).toEqual([])
  })

  test("wrapParams produces numeric-keyed object", () => {
    const wrapped = wrapParams(["a", "b"])
    expect(wrapped).toMatchObject({ 0: "a", 1: "b" })
  })

  test("nested objects survive round-trip", () => {
    const params: unknown[] = [{ x: 1, y: [2, 3] }]
    const result = unwrapParams(wrapParams(params)) as typeof params
    expect(result[0]).toEqual({ x: 1, y: [2, 3] })
  })
})
```

---

## M3.4 — `@nulo/aztec-runtime`

### Pattern — tests STAY in extension, source MOVES to aztec-runtime

Same pattern as M3.2's `key-vectors.test.ts`. The test files import extension-internal types (`Network` from `@/wallet/services/network/client`, `ConfigServiceClient` from `@/wallet/services/config/client`). Two options were considered:

1. **Move tests to aztec-runtime + inline fixture shapes** — fragile; local type drift from production
2. **Keep tests in extension, move only source** ✅ — preserves production-type coupling, catches regressions when Network/ConfigServiceClient shapes evolve

Option 2 is consistent with M3.2 and is the defensible choice.

### Carry over — source moves, test stays

| Test file | Location after M3.4 | Source moves to |
|---|---|---|
| `wallet/services/pxe/artifact-registry.test.ts` | ❌ stays in `@nulo/extension` | `@nulo/aztec-runtime/src/artifact-registry.ts` |
| `wallet/services/pxe/chain-runtime.test.ts` | ❌ stays in `@nulo/extension` | `@nulo/aztec-runtime/src/chain-runtime.ts` |

Import updates in these staying-in-extension tests:
- `import { ArtifactRegistry } from "./artifact-registry"` → `from "@nulo/aztec-runtime"`
- `import { ChainRuntime, ChainRuntimeRegistry, type PxeFactory } from "./chain-runtime"` → `from "@nulo/aztec-runtime"`
- Type-only imports (`Network`, `ConfigServiceClient`) stay as `@/wallet/services/...` — these are extension types

The tests run as part of the extension's `bun run test` suite. aztec-runtime itself has no test files.

### New tests

None. WASM-bound behavior cannot be meaningfully unit-tested beyond what already exists. Structural typing enforces the seam interface at compile time.

---

## M3.5 — `@nulo/wallet-bridge`

### Carry over (move with source)

| Test file | What it locks |
|---|---|
| `wallet/services/wallet-sdk/scope-enforcement.test.ts` | All scope dimensions, grant matching, violation throws |

### New tests — wallet-bridge gaps

#### `packages/wallet-bridge/src/capability-map.test.ts`

**Why**: `capability-map.ts` is the first gate in the dispatcher. A miscategorized method silently bypasses capability checks — a security invariant. All 14 entries in `METHOD_CAPABILITY_MAP` are tested via `test.each` to prevent silent drift.

```ts
import { describe, expect, test } from "vitest"
import { getRequiredCapability, isCapabilityExempt } from "./capability-map"

// All 14 entries in METHOD_CAPABILITY_MAP — missing entries fail this table.
describe("getRequiredCapability — full coverage", () => {
  test.each([
    // accounts
    ["getCompleteAddress", "accounts"],
    ["createAuthWit", "accounts"],
    ["registerToken", "accounts"],
    // contracts
    ["registerContract", "contracts"],
    ["getContractMetadata", "contracts"],
    // contractClasses
    ["getContractClassMetadata", "contractClasses"],
    // simulation
    ["simulateTx", "simulation"],
    ["executeUtility", "simulation"],
    ["profileTx", "simulation"],
    ["simulateViews", "simulation"],
    // transaction
    ["sendTx", "transaction"],
    // data
    ["getPrivateEvents", "data"],
    ["getAddressBook", "data"],
    ["registerSender", "data"],
  ] as const)("%s → %s", (method, expectedCap) => {
    expect(getRequiredCapability(method)).toBe(expectedCap)
  })

  test("unknown method returns null (must not grant access)", () => {
    expect(getRequiredCapability("nonExistentMethod")).toBeNull()
  })

  test("getAccounts returns null — it is exempt, not capability-gated", () => {
    expect(getRequiredCapability("getAccounts")).toBeNull()
  })

  test("case sensitivity: 'SendTx' (capital S) returns null — no case-insensitive bypass", () => {
    expect(getRequiredCapability("SendTx")).toBeNull()
  })
})

describe("isCapabilityExempt", () => {
  test.each(["getChainInfo", "requestCapabilities", "batch", "getAccounts"])(
    "%s is exempt",
    (method) => expect(isCapabilityExempt(method)).toBe(true)
  )

  test.each(["sendTx", "simulateTx", "createAuthWit", "unknownMethod"])(
    "%s is NOT exempt",
    (method) => expect(isCapabilityExempt(method)).toBe(false)
  )
})
```

---

#### `packages/wallet-bridge/src/discovery-queue.test.ts`

**Why**: `DiscoveryQueue.drain()` re-queuing logic (wallet locked mid-drain) is the invariant that prevents dropped dApp connections after wallet unlock. Stale rejection prevents unbounded memory growth. Non-pending skip is a security invariant.

**Note**: `wallet-bridge/package.json` must declare `@nulo/wallet-core` as a dependency (for `ILogger`). This is already in the M3.5 plan's package.json scaffold.

```ts
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest"
import { DiscoveryQueue } from "./discovery-queue"
import type { BackgroundConnectionHandler, PendingDiscovery } from "@aztec/wallet-sdk/extension/handlers"
import type { ILogger } from "@nulo/wallet-core"

// chrome.action is called synchronously by enqueue() and drain() via updateBadge().
// Must be stubbed — jsdom does not provide chrome globals.
beforeEach(() => {
  vi.stubGlobal("chrome", {
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

const makeLogger = (): ILogger => ({ log: vi.fn() })

const makeHandler = (overrides: Partial<BackgroundConnectionHandler> = {}): BackgroundConnectionHandler =>
  ({
    getPendingDiscovery: vi.fn(),
    rejectDiscovery: vi.fn(),
    ...overrides,
  }) as unknown as BackgroundConnectionHandler

const makeDiscovery = (id: string, status: PendingDiscovery["status"] = "pending"): PendingDiscovery =>
  ({
    requestId: id,
    appId: "test-app",
    origin: "https://example.com",
    tabId: 0,
    status,
    timestamp: Date.now(),
  }) as unknown as PendingDiscovery

describe("DiscoveryQueue", () => {
  test("empty drain is a no-op", async () => {
    const handler = makeHandler()
    const dq = new DiscoveryQueue(handler, makeLogger())
    await dq.drain(async () => true)
    expect(handler.getPendingDiscovery).not.toHaveBeenCalled()
  })

  test("enqueue increments size", () => {
    const dq = new DiscoveryQueue(makeHandler(), makeLogger())
    dq.enqueue("req-1", "https://example.com")
    dq.enqueue("req-2", "https://other.com")
    expect(dq.size).toBe(2)
  })

  test("drain skips gone discovery (getPendingDiscovery returns undefined)", async () => {
    const handler = makeHandler({ getPendingDiscovery: vi.fn(() => undefined) })
    const dq = new DiscoveryQueue(handler, makeLogger())
    dq.enqueue("req-1", "https://example.com")

    const processFn = vi.fn(async () => true)
    await dq.drain(processFn)

    expect(processFn).not.toHaveBeenCalled()
    expect(dq.size).toBe(0)
  })

  test("drain skips non-pending discovery (e.g. already approved)", async () => {
    // A discovery approved while the wallet was locked must not be re-processed.
    const approved = makeDiscovery("req-1", "approved" as PendingDiscovery["status"])
    const handler = makeHandler({ getPendingDiscovery: vi.fn(() => approved) })
    const dq = new DiscoveryQueue(handler, makeLogger())
    dq.enqueue("req-1", "https://example.com")

    const processFn = vi.fn(async () => true)
    await dq.drain(processFn)

    expect(processFn).not.toHaveBeenCalled()
  })

  test("drain rejects stale discovery and continues without calling processFn", async () => {
    const staleDiscovery = {
      ...makeDiscovery("req-1"),
      timestamp: Date.now() - 6 * 60 * 1000, // 6 min ago — past STALE_MS (5 min)
    } as unknown as PendingDiscovery

    const rejectDiscovery = vi.fn()
    const handler = makeHandler({
      getPendingDiscovery: vi.fn(() => staleDiscovery),
      rejectDiscovery,
    })

    const dq = new DiscoveryQueue(handler, makeLogger())
    dq.enqueue("req-1", "https://example.com")

    const processFn = vi.fn(async () => true)
    await dq.drain(processFn)

    expect(rejectDiscovery).toHaveBeenCalledWith("req-1")
    expect(processFn).not.toHaveBeenCalled()
  })

  test("drain re-queues remaining items in original order when processFn returns false (wallet locked mid-drain)", async () => {
    const now = Date.now()
    const discoveries = new Map([
      ["req-1", { ...makeDiscovery("req-1"), timestamp: now }],
      ["req-2", { ...makeDiscovery("req-2"), timestamp: now }],
      ["req-3", { ...makeDiscovery("req-3"), timestamp: now }],
    ])

    const handler = makeHandler({
      getPendingDiscovery: vi.fn((id: string) => discoveries.get(id)),
    })

    const dq = new DiscoveryQueue(handler, makeLogger())
    dq.enqueue("req-1", "https://x.com")
    dq.enqueue("req-2", "https://x.com")
    dq.enqueue("req-3", "https://x.com")

    let callCount = 0
    await dq.drain(async () => {
      callCount++
      return callCount === 1 // req-1 succeeds, req-2 returns false (wallet locked)
    })

    // req-2 and req-3 re-queued (req-1 processed successfully)
    expect(dq.size).toBe(2)

    // Verify re-queue ORDER: req-2 must come before req-3
    const processedIds: string[] = []
    await dq.drain(async (d) => {
      processedIds.push(d.requestId)
      return true
    })
    expect(processedIds).toEqual(["req-2", "req-3"])
  })
})
```

---

## M3.6 — `@nulo/extension-ui`

### Carry over

None — no existing tests for components or composables.

### New tests

**Deferred to M5.1** per M3.6 plan. Vue component testing requires `@vue/test-utils` + additional setup. The M3.6 verification gate is: `bun run typecheck` zero errors + visual smoke (fonts, icons, button styles render correctly).

---

## M3.7 — Boundary enforcement

### No unit tests — CI integration is the test layer

The three CI steps defined in the M3.7 plan ARE the test suite for this milestone:
1. `bun run typecheck:all` — zero type errors across all packages
2. `bun run test:all` — all moved tests pass in their new home
3. `bun run check:deps` — depcruiser zero boundary violations

**`tsc --noEmit` with `"types": []`** in wallet-core's tsconfig IS the real chrome-access enforcement. The depcruiser `wallet-core-no-chrome` rule reinforces it at the module-import level.

**No dedicated smoke tests.** Each extracted package has real unit tests that import its source through relative paths. Cross-package imports are exercised every time a consumer's tests run (e.g. wallet-bridge tests import `@nulo/wallet-core`'s `ILogger`). A broken barrel, missing export, or bad `exports` field in `package.json` will surface via:
- `bun run build` — vite bundler resolves all workspace deps
- `bun run typecheck:all` — tsc fails on missing exports
- `bun run test:all` — real tests fail to import
- `bun run check:deps` — depcruiser catches boundary violations

Manufactured `Object.keys(pkg).length > 0` tests add no signal the above four checks don't already provide — they would be coverage theater. Also: colocating them would require either a `__tests__/` directory (forbidden by CLAUDE.md) or an awkward `src/index.test.ts` that merely shadows the barrel.

---

## Summary table

| Milestone | Carry-over tests | New tests | Gaps closed |
|---|---|---|---|
| M3.1 | topology, rw-guard, mnemonic, serialization, fake-browser-api, mock-clock | lock (4), queue (11), event-handler (6), arrays (9), entity_storage (8), value-storage (5) | 6 uncovered primitives entering wallet-core — includes the untested storage refactor |
| M3.2 | encryption-key, password-secret-box, key-vectors (in extension) | none | Existing tests move + update imports |
| M3.3 | errors, zod-helpers, bg/client, offscreen/client | wrapParams/unwrapParams (6 cases) | RPC wire serialization invariant |
| M3.4 | artifact-registry, chain-runtime (⚠ import updates required) | none | WASM boundary not unit-testable |
| M3.5 | scope-enforcement | capability-map (test.each all 14 entries + case sensitivity + exempts), discovery-queue (5 cases incl. chrome stub + non-pending + re-queue order) | Security gate + dApp unlock re-queue order |
| M3.6 | none | none (deferred to M5.1) | Visual smoke only |
| M3.7 | all | none — real tests already exercise public surface | Boundary via depcruiser+tsc; build is the canary |
