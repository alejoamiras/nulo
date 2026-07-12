# Q-20 — config store → zod schema (replace reflective `typeof` validation) · tier: **light** (moderate-confidence, claude-only)

**Re-verify (STEP 1, vs `dev-quality`):** VALID. `store.ts` `apply()` (46-56) validates by `typeof src[key] === typeof dst[key]` — so a literal-union value (`theme`, `defaultExplorer`) out of its domain loads as valid if it's the right primitive type (a corrupt/migrated `theme:"bogus"` is accepted because it's a string). `Config` is treated as `Record<string, unknown>`. **zod is already a dep** (`^4.4.3`) + `wallet/base/zod-helpers.ts` exists.

## Current shape (config.ts)
`Config` is a **class** with field defaults: `theme: "dark"|"light"|"system"="system"`, several `boolean`s, `sessionTtl:number=1_800_000`, **`strictSecurityMode:boolean=true` (AUDIT A1 — FROZEN security default, asserted by config.test.ts)**, `defaultExplorer: BlockExplorerType|null="aztecscan"` (`BlockExplorerType="aztecscan"` — single-member today), dev flags. `ConfigKey=keyof Config`; `ConfigProp` = `{key,value}` DU. `new Config()` used in `store.ts:11,43` + `config.test.ts`.

## Design (zod as the source)
- `ConfigSchema = z.object({ theme: z.enum(["dark","light","system"]).default("system"), …booleans `.default(…)`, sessionTtl: z.number().default(1_800_000), strictSecurityMode: z.boolean().default(true), defaultExplorer: z.enum(EXPLORER_IDS).nullable().default("aztecscan"), … })`.
- `export type Config = z.infer<typeof ConfigSchema>`; `ConfigKey`/`ConfigProp` derived from it. `defaultConfig(): Config = ConfigSchema.parse({})` replaces `new Config()`.
- `store.ts apply()`: validate the stored object with the schema and **keep the current/default value for any key that fails** (per-key tolerance — `ConfigSchema.partial().safeParse` or per-key `.shape[key].safeParse`), preserving today's "ignore an invalid/missing stored prop, keep default" + the per-key `onUpdate` emit ONLY for keys that PASS and DIFFER from current (matching the current emit condition).

## Behavior preservation + pins
- **FROZEN security default:** `strictSecurityMode` MUST stay `.default(true)`; keep the `config.test.ts` freeze assertions green (update `new Config()` → `defaultConfig()`, assertions unchanged). Same for `sessionTtl` 30min, `theme` "system", dev flags OFF.
- **Tightening is the fix (sanctioned behavior change):** a stored out-of-domain value (e.g. `theme:"bogus"`) now FAILS the schema → kept-as-default instead of loaded. No-backwards-compat ruling allows this; the loader must keep-default gracefully (never throw/crash on a bad stored config).
- **Persisted shape unchanged:** `ValueStorage<Config>` JSON stays `{key: value}`; zod just validates it. No migration.
- `set()` already takes a typed `value: Config[TKey]` — unchanged (the schema doesn't gate `set`, only load; consider validating in `set` too, but that's a behavior addition — keep `set` as-is unless codex argues otherwise).

## Validation gate
- `bun run lint` + `bun run typecheck:all`.
- `bun run test` for **extension** (config.test.ts frozen defaults — updated to `defaultConfig()` + the assertions intact; + a NEW test: an out-of-domain stored `theme` is rejected → kept-as-default; a valid stored override is applied + emits).
- smoke + FULL network (config drives popup settings/theme/sessionTtl).

## Codex consult questions
1. Replace the `Config` class with `z.infer` + `defaultConfig()` (per the finding), or keep the class + a parallel schema? Trade-offs for the `new Config()` callers + config.test.ts freeze.
2. `apply()` semantics: per-key keep-default-on-invalid + emit-on-pass-and-differ — does this preserve the current emit/observable behavior exactly?
3. Is tightening the persisted-config validation (rejecting out-of-domain values → default) safe given no-backwards-compat, or is there a flow that relied on loading an out-of-domain value?
4. Should `set()` also validate, or stays type-gated only (current)? Any consistency risk if load validates but set doesn't?
5. The FROZEN `strictSecurityMode` default — any way the schema refactor could silently flip/weaken it?

## Codex consult — `conditional approve` (session 019f19ee); ADOPTED design
Recommended schema (NO coercion, NO `.positive()/.int()/.min()` — `sessionTtl: 0` must stay valid):
```ts
export const ConfigSchema = z.object({
  theme: z.enum(["dark","light","system"]).default("system"),
  sidePanel: z.boolean().default(false),
  showNode: z.boolean().default(true),
  showPopupFullscreen: z.boolean().default(true),
  disableAnimations: z.boolean().default(false),
  sessionTtl: z.number().default(30 * 60 * 1000),
  strictSecurityMode: z.boolean().default(true),
  defaultExplorer: z.enum(["aztecscan"]).nullable().default("aztecscan"),
  incomingTransfersVisible: z.boolean().default(true),
  developerMode: z.boolean().default(false),
  debugMode: z.boolean().default(false),
  indicateFailures: z.boolean().default(false),
})
export type Config = z.infer<typeof ConfigSchema>
export const defaultConfig = (): Config => ConfigSchema.parse({})
```
**Adopted findings:**
1. **(High) Replace the class everywhere** — `new Config()` has **14 sites** (not just store/test): `popup/app.vue:26`, `popup/pages/settings/{appearance:25,security/index:30,advanced/index:57}`, `composables/fullscreenPopupSetting.ts:23`, `components/Header.vue:34`, `components/JsonViewer/LogsViewer.vue:46`, `store.ts:11,43`, `onboarding/app.vue:23`, `config.test.ts:29,36,47,51`. All → `defaultConfig()` (add the import per file; drop the `Config`-class import where now unused).
2. **(High) `defaultExplorer: null`** — today's `apply()` REJECTS a persisted `null` (`typeof null !== "string"`), keeping `"aztecscan"`; zod `.nullable()` ACCEPTS it (correct for the declared domain — a latent bug fix). **Pin with a test** (now-accepted null).
3. **(High) Validate `set()` too** — the RPC config spec is type-only, so runtime callers can pass bad values. Load = tolerant (keep default); `set()` = fail-fast (validate the per-key schema, throw before mutating memory/storage). Reuse `ConfigSchema.shape[key]`.
4. **(Moderate) Tolerant `apply()` is PER-KEY, not whole-object** — `partial().safeParse(stored)` fails the whole object on one bad key. Iterate `Object.keys(defaultConfig())`, `ConfigSchema.shape[key].safeParse(stored[key])`, ignore missing/extra, emit only when parse passes AND value `!== current`.
5. **(Moderate) Test security defaults directly** — `strictSecurityMode===true`, `sessionTtl===1_800_000`; + a corrupted stored `strictSecurityMode` can't flip `false` unless a valid boolean `false` was intentionally persisted.

**Implementation note:** removing the `Config` class is an API break (no-backwards-compat OK). `ConfigProp`/`ConfigKey` re-derive from the inferred `Config`. Keep `config.test.ts` freeze assertions identical, only swapping `new Config()` → `defaultConfig()`.
