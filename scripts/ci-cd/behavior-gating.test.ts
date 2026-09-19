/**
 * Anti-drift guard for the CI paths-filter gates.
 *
 * The smoke / network / build gates are DERIVED FROM THE DEPENDENCY GRAPH, not a
 * hand-curated list (see CI.md "CI gating" + implementations-plan/paths-filter-negation-fix/).
 * This test recomputes each gate's target graph from package.json and asserts the
 * live filter still covers it — so a new `@nulo/*` dependency added without gating
 * it, or a re-introduced `!` negation (the dorny `some`-quantifier footgun), fails CI.
 *
 * Wired into CI via the root `test:ci-gating` script in `_unit-tests.yml` — without
 * that step this guard would never run on a PR and the whole mechanism would be hollow.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
// apps/ vs packages/ split (FLAT layout): deployable leaves live under apps/, libs under packages/.
const APPS = new Set(["extension", "tools", "landing", "playground"])
const dirOf = (pkg: string): string => (APPS.has(pkg) ? "apps" : "packages")

/** Direct `@nulo/*` workspace deps of a package (runtime + dev — what it's built/tested from). */
function directDeps(pkg: string): string[] {
  const p = JSON.parse(readFileSync(join(ROOT, dirOf(pkg), pkg, "package.json"), "utf8"))
  return Object.keys({ ...p.dependencies, ...p.devDependencies })
    .filter((k) => k.startsWith("@nulo/"))
    .map((k) => k.slice("@nulo/".length))
}

/** Transitive `@nulo/*` dependency closure of a target (EXCLUDING the target itself). */
function transitiveDeps(target: string): string[] {
  const seen = new Set<string>()
  const walk = (pkg: string) => {
    for (const d of directDeps(pkg))
      if (!seen.has(d)) {
        seen.add(d)
        walk(d)
      }
  }
  walk(target)
  return [...seen].sort()
}

/** Parse a workflow's dorny `changes` filters — TWO-LEVEL (workflow YAML → the `with.filters` string), never regex. */
function filtersOf(workflow: string): Record<string, string[]> {
  // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
  const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows", workflow), "utf8")) as any
  for (const job of Object.values(wf.jobs)) {
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    for (const step of (job as any).steps ?? []) {
      if (typeof step.uses === "string" && step.uses.includes("dorny/paths-filter") && step.with?.filters) {
        return Bun.YAML.parse(step.with.filters) as Record<string, string[]>
      }
    }
  }
  throw new Error(`no dorny/paths-filter step found in ${workflow}`)
}

/** A gate's pattern set must whole-package the target and src+manifest every transitive dep lib. */
function assertGraphCovered(patterns: string[], target: string, label: string) {
  expect(patterns, `${label}: target '${target}' must be whole-package gated`).toContain(`${dirOf(target)}/${target}/**`)
  for (const dep of transitiveDeps(target)) {
    expect(patterns, `${label}: dep lib '${dep}' src must be gated`).toContain(`packages/${dep}/src/**`)
    expect(patterns, `${label}: dep lib '${dep}' package.json must be gated`).toContain(`packages/${dep}/package.json`)
  }
}

const FILTER_WORKFLOWS = [
  "pr-quick.yml",
  "pr-extension-smoke-e2e.yml",
  "pr-extension-network-e2e.yml",
  "pr-extension-smoke-e2e-firefox.yml",
  "pr-extension-network-e2e-firefox.yml",
  "bridge-contracts.yml",
  "pr-tools-e2e.yml",
  "actionlint.yml",
]

/**
 * The check-run each PR workflow's aggregator job produces. Branch protection matches these BY
 * NAME (CLAUDE.md § Branching), so a renamed job that isn't repointed there blocks every merge —
 * this pin fails first. `required-checks.ts` renames the protection to the same names.
 */
const AGGREGATOR_CHECKS: Record<string, string> = {
  "pr-quick.yml": "quality-status",
  "pr-extension-smoke-e2e.yml": "extension-smoke-e2e-status",
  "pr-extension-network-e2e.yml": "extension-network-e2e-status",
  "pr-extension-smoke-e2e-firefox.yml": "extension-smoke-e2e-firefox-status",
  "pr-extension-network-e2e-firefox.yml": "extension-network-e2e-firefox-status",
  "bridge-contracts.yml": "bridge-contracts-status",
  "pr-tools-e2e.yml": "tools-e2e-status",
}

describe("CI aggregator check names", () => {
  test("each PR workflow's status job produces its documented check-run name", () => {
    for (const [file, name] of Object.entries(AGGREGATOR_CHECKS)) {
      // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
      const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8")) as any
      expect(wf.jobs.status?.name, `${file}: jobs.status.name`).toBe(name)
      expect(wf.jobs.status?.if, `${file}: the aggregator must always run`).toBe("always()")
    }
  })

  test("the protection runbook renames onto exactly these names", async () => {
    const { RENAMES } = await import("./required-checks")
    for (const target of Object.values(RENAMES)) {
      expect(Object.values(AGGREGATOR_CHECKS), `rename target '${target}' must be a produced check`).toContain(target)
    }
  })
})

describe("CI behavior-gating guard", () => {
  const smoke = filtersOf("pr-extension-smoke-e2e.yml")["smoke-surface"]
  const network = filtersOf("pr-extension-network-e2e.yml")["extension-network"]
  const quick = filtersOf("pr-quick.yml")

  test("NO `!` negation patterns anywhere (the dorny some-quantifier footgun)", () => {
    for (const wf of FILTER_WORKFLOWS) {
      for (const [name, pats] of Object.entries(filtersOf(wf))) {
        for (const p of pats) {
          expect(p.startsWith("!"), `${wf} → filter '${name}' has a forbidden negation: ${p}`).toBe(false)
        }
      }
    }
  })

  test("smoke-surface covers the extension graph", () => {
    assertGraphCovered(smoke, "extension", "smoke-surface")
  })

  test("extension-network covers the extension graph + the playground harness", () => {
    assertGraphCovered(network, "extension", "extension-network")
    expect(network, "network must gate the playground dApp harness").toContain("apps/playground/**")
  })

  test("needs-extension-build (pr-quick filter union) covers the extension graph", () => {
    const union = [
      ...quick["core-foundation"],
      ...quick["aztec-runtime"],
      ...quick["wallet-bridge"],
      ...quick["extension"],
    ]
    assertGraphCovered(union, "extension", "needs-extension-build")
  })

  test("tools build covers the tools graph", () => {
    assertGraphCovered(quick["tools"], "tools", "tools")
    expect(quick["tools"], "tools must gate its build workflow").toContain(".github/workflows/_build-tools.yml")
  })

  test("bridge-contracts covers the contracts, the harness package, its graph, and the adopted manifests", () => {
    const contracts = filtersOf("bridge-contracts.yml")["contracts"]
    expect(contracts, "the Solidity + Noir sources").toContain("contracts/bridge/**")
    assertGraphCovered(contracts, "bridge-core", "bridge-contracts")
    for (const manifest of ["apps/tools/public/testnet-bridge.json", "apps/tools/public/mainnet-bridge.json"]) {
      expect(contracts, "a manifest bump is the frontend adopting a generation — the round trips must re-run").toContain(manifest)
    }
    for (const p of ["package.json", "bun.lock", "bunfig.toml", "patches/**", ".github/actions/setup-aztec/**", ".github/actions/setup-bun/**"]) {
      expect(contracts, `bridge-contracts must gate ${p}`).toContain(p)
    }
  })

  test("tools-e2e covers the tools graph, the bridge contracts, the harness package, and its own pipeline", () => {
    const filter = filtersOf("pr-tools-e2e.yml")["tools-e2e"]
    assertGraphCovered(filter, "tools", "tools-e2e")
    expect(filter, "the sandbox deploys the contracts the UI bridges through").toContain("contracts/bridge/**")
    expect(filter, "bridge-core's scripts ARE the sandbox harness").toContain("packages/bridge-core/**")
    for (const p of [
      "package.json",
      "bun.lock",
      "bunfig.toml",
      "patches/**",
      ".github/workflows/pr-tools-e2e.yml",
      ".github/workflows/_tools-e2e.yml",
      ".github/actions/setup-aztec/**",
      ".github/actions/setup-bun/**",
      ".github/actions/setup-playwright/**",
    ]) {
      expect(filter, `tools-e2e must gate ${p}`).toContain(p)
    }
  })

  test("the tools build job is wired from the changes output through to quality-status", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/pr-quick.yml"), "utf8")) as any
    const outputs = wf.jobs.changes.outputs ?? {}
    expect(outputs.tools).toBe("${{ steps.override.outputs.full || steps.filter.outputs.tools }}")
    expect(outputs["needs-tools-build"]).toBe("${{ steps.compute.outputs.needs-tools-build }}")
    expect(wf.jobs["build-tools"]?.if).toBe("needs.changes.outputs.needs-tools-build == 'true'")
    expect(wf.jobs.status.needs, "quality-status must wait on build-tools").toContain("build-tools")
    const aggregate = wf.jobs.status.steps.map((s: { run?: string }) => s.run ?? "").join("\n")
    expect(aggregate, "quality-status must fail on a build-tools failure").toContain("needs.build-tools.result")
  })

  test("cross-cutting inputs (patches + root build inputs) gate the e2e suites", () => {
    for (const [label, pats] of [
      ["smoke", smoke],
      ["network", network],
    ] as const) {
      expect(pats, `${label}: patches/** rewrites installed deps`).toContain("patches/**")
      for (const root of ["package.json", "bun.lock", "bunfig.toml", "tsconfig.json"]) {
        expect(pats, `${label}: root input ${root}`).toContain(root)
      }
    }
  })

  // The network-e2e suite is split across a PROVERLESS shard pool and several PROVER-ON dedicated
  // jobs. The shard pool's `exclude_files` must be EXACTLY the union of every dedicated job's
  // `test_files`, or a file silently runs in both pools (wasted) or in NEITHER (never run). The
  // latter is the real danger for the mandatory `frozen-account-canary` bump gate: a bad edit could
  // drop it out of both pools and it would silently stop running. This pins the partition
  // mechanically (the workflow's own "keep in sync" comment can't).
  test("network-e2e proverless-exclusions == the union of the dedicated jobs' test_files", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/pr-extension-network-e2e.yml"), "utf8")) as any
    const words = (v: unknown): string[] => (typeof v === "string" ? v.split(/\s+/).filter(Boolean) : [])

    let excluded: string[] = []
    const dedicated: string[] = []
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    for (const job of Object.values(wf.jobs) as any[]) {
      if (job.with?.exclude_files) excluded = words(job.with.exclude_files)
      if (job.with?.test_files) dedicated.push(...words(job.with.test_files))
    }

    expect(excluded.length, "the proverless pool must exclude the dedicated files").toBeGreaterThan(0)
    expect(dedicated.length, "there must be dedicated test_files jobs").toBeGreaterThan(0)
    // The two sets are EQUAL: every dedicated file is excluded from the shard pool, and nothing
    // extra is excluded (no file runs in both pools; none is left in neither).
    expect([...excluded].sort(), "proverless exclude_files must equal the union of dedicated test_files").toEqual(
      [...new Set(dedicated)].sort(),
    )
    // The canary specifically must live in a dedicated (prover-ON) job — never only proverless.
    expect(dedicated, "frozen-account-canary must run in a dedicated prover-ON job").toContain(
      "tests/e2e/network/frozen-account-canary.test.ts",
    )
  })

  // The self-pay phase gate — the wallet simulating and sending as the account a dApp names,
  // with the node's setup allow-list enforced — must keep running on every PR: the matrix in a
  // dedicated heavy job at retry 0 (a retry would re-mask an intermittent wallet regression),
  // the cheap two-account simulate in the shard pool (never excluded, so it cannot drop out).
  test("network-e2e keeps the self-pay phase gate in place at retry 0", () => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/pr-extension-network-e2e.yml"), "utf8")) as any
    const words = (v: unknown): string[] => (typeof v === "string" ? v.split(/\s+/).filter(Boolean) : [])
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const jobs = Object.entries(wf.jobs) as [string, any][]

    const matrix = jobs.find(([, job]) => words(job.with?.test_files).includes("tests/e2e/network/selfpay-phase.test.ts"))
    expect(matrix, "selfpay-phase must run in a dedicated test_files job").toBeDefined()
    expect(String(matrix?.[1].with?.retry), "selfpay-phase runs at retry 0").toBe("0")
    expect(matrix?.[1].with?.proverless, "selfpay-phase runs proverless like the other heavy fee flows").toBe(true)

    const pool = jobs.find(([, job]) => job.with?.exclude_files)
    expect(words(pool?.[1].with?.exclude_files), "sim-from-selfpay stays in the shard pool").not.toContain(
      "tests/e2e/network/sim-from-selfpay.test.ts",
    )
    expect(String(pool?.[1].with?.retry), "the shard pool runs at retry 0").toBe("0")
    expect(existsSync(join(ROOT, "apps/extension/tests/e2e/network/sim-from-selfpay.test.ts")), "sim-from-selfpay exists").toBe(true)
    expect(existsSync(join(ROOT, "apps/extension/tests/e2e/network/selfpay-phase.test.ts")), "selfpay-phase exists").toBe(true)
  })
})

/**
 * The Firefox lanes are twins of the Chrome ones and ADVISORY. Two ways that can rot silently: a
 * twin drifts from the lane it mirrors (a file stops running on Firefox and nothing says so), or
 * a Firefox job slips into an aggregator a branch requires and starts blocking merges.
 */
describe("Firefox lanes", () => {
  // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
  const workflow = (file: string): any => Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows", file), "utf8"))
  const words = (v: unknown): string[] => (typeof v === "string" ? v.split(/\s+/).filter(Boolean) : [])
  const CHROME_ONLY_CANARY = "tests/e2e/network/frozen-account-canary.test.ts"
  type SuiteJob = { uses?: string; with?: Record<string, unknown>; strategy?: unknown; needs?: unknown; if?: unknown; secrets?: unknown }
  const TWINS = [
    { chrome: "pr-extension-smoke-e2e.yml", firefox: "pr-extension-smoke-e2e-firefox.yml", filter: "smoke-surface" },
    { chrome: "pr-extension-network-e2e.yml", firefox: "pr-extension-network-e2e-firefox.yml", filter: "extension-network" },
  ]

  test("each Firefox filter is its Chrome twin's, re-pointed at its own file, plus geckodriver", () => {
    for (const { chrome, firefox, filter } of TWINS) {
      const expected = filtersOf(chrome)
        [filter].map((pattern) => (pattern === `.github/workflows/${chrome}` ? `.github/workflows/${firefox}` : pattern))
        .concat(".github/actions/setup-geckodriver/**")
      expect([...filtersOf(firefox)[filter]].sort(), firefox).toEqual([...expected].sort())
    }
  })

  test("every Firefox PR suite job runs the Chrome job's files on firefox, minus the Chrome-only canary", () => {
    for (const { chrome, firefox } of TWINS) {
      const [chromeJobs, firefoxJobs] = [workflow(chrome).jobs, workflow(firefox).jobs]
      expect(Object.keys(firefoxJobs), firefox).toEqual(Object.keys(chromeJobs))
      for (const [name, job] of Object.entries(chromeJobs) as [string, SuiteJob][]) {
        if (!job.uses) continue
        const twin: SuiteJob = firefoxJobs[name]
        expect(job.with?.browser, `${chrome} → ${name} stays on the default browser`).toBeUndefined()
        // Whole-shape equality: a dropped shard, input, dependency or condition is a lost file.
        const { test_files: chromeFiles, ...chromeWith } = job.with ?? {}
        const { test_files: firefoxFiles, ...firefoxWith } = twin.with ?? {}
        expect(firefoxWith, `${firefox} → ${name} with`).toEqual({ ...chromeWith, browser: "firefox" })
        expect(words(firefoxFiles), `${firefox} → ${name} test_files`).toEqual(
          words(chromeFiles).filter((file) => file !== CHROME_ONLY_CANARY),
        )
        for (const key of ["uses", "strategy", "needs", "if", "secrets"] as const) {
          expect(twin[key], `${firefox} → ${name} ${key}`).toEqual(job[key])
        }
      }
    }
  })

  test("the Firefox PR lanes hold no write scope and skip drafts", () => {
    for (const { firefox } of TWINS) {
      const wf = workflow(firefox)
      expect(wf.permissions, firefox).toEqual({ contents: "read" })
      for (const [name, job] of Object.entries(wf.jobs) as [string, { permissions?: unknown }][]) {
        const want = name === "changes" ? { contents: "read", "pull-requests": "read" } : undefined
        expect(job.permissions, `${firefox} → ${name}`).toEqual(want)
      }
      const gate = wf.jobs.decide.steps[0]
      expect(gate.run, `${firefox}: decide`).toContain('if [ "$DRAFT" = "true" ]')
      expect(gate.env.DRAFT, `${firefox}: the gate reads the PR's real draft flag`).toBe("${{ github.event.pull_request.draft }}")
    }
  })

  // Exact, not a /firefox/ denylist: quality-status legitimately needs `build-firefox`.
  test("the required extension aggregators wait on exactly the Chrome suites", () => {
    expect(workflow("pr-extension-smoke-e2e.yml").jobs.status.needs).toEqual(["changes", "decide", "smoke"])
    expect(workflow("pr-extension-network-e2e.yml").jobs.status.needs).toEqual([
      "changes",
      "decide",
      "network-e2e",
      "network-e2e-heavy",
      "network-e2e-heavy-concurrent",
      "network-e2e-canary",
    ])
  })

  test("nightly and release run Firefox twins that no aggregator or publish step waits on", () => {
    for (const [file, gates] of [
      ["nightly.yml", ["status", "publish-nightly"]],
      ["release.yml", ["status", "attach-assets"]],
    ] as const) {
      const { jobs } = workflow(file)
      // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
      const firefoxJobs = Object.entries(jobs).filter(([, job]) => (job as any).with?.browser === "firefox").map(([name]) => name)
      expect(firefoxJobs, `${file} runs Firefox`).toContain("smoke-firefox-against-artifact")
      for (const [name, job] of Object.entries(jobs) as [string, { needs?: string | string[] }][]) {
        const needs = [job.needs ?? []].flat()
        const waitsOnFirefox = needs.filter((need) => firefoxJobs.includes(need))
        expect(waitsOnFirefox, `${file} → ${name} must not wait on an advisory Firefox job`).toEqual([])
      }
      for (const gate of gates) expect(jobs[gate], `${file} → ${gate}`).toBeDefined()
    }
  })

  test("nightly's Firefox network jobs mirror its Chrome ones", () => {
    const { jobs } = workflow("nightly.yml")
    for (const name of ["network-e2e", "network-e2e-heavy", "network-e2e-heavy-concurrent", "network-e2e-canary"]) {
      const [chrome, firefox] = [jobs[name], jobs[`${name}-firefox`]]
      expect(firefox, `nightly.yml → ${name}-firefox`).toBeDefined()
      expect(firefox.with.browser).toBe("firefox")
      expect(words(firefox.with.exclude_files)).toEqual(words(chrome.with.exclude_files))
      expect(words(firefox.with.test_files)).toEqual(words(chrome.with.test_files).filter((file) => file !== CHROME_ONLY_CANARY))
      expect(firefox.strategy).toEqual(chrome.strategy)
    }
  })

  test("the shared pieces default to chrome, and the browser caches share no key prefix", () => {
    for (const file of ["_extension-smoke-e2e.yml", "_extension-network-e2e.yml"]) {
      expect(workflow(file).on.workflow_call.inputs.browser.default, file).toBe("chrome")
    }
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const action = Bun.YAML.parse(readFileSync(join(ROOT, ".github/actions/setup-puppeteer/action.yml"), "utf8")) as any
    expect(action.inputs.browser.default).toBe("chrome")
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const caches = action.runs.steps.filter((step: any) => String(step.uses).startsWith("actions/cache@"))
    // biome-ignore lint/suspicious/noExplicitAny: parsed-YAML shape is dynamic.
    const [chrome, firefox] = ["chrome", "firefox"].map((browser) => caches.find((step: any) => step.if === `inputs.browser == '${browser}'`))
    const chromePrefix = String(chrome.with["restore-keys"]).trim()
    expect(chromePrefix.length).toBeGreaterThan(0)
    expect(String(firefox.with.key).startsWith(chromePrefix), "a Firefox key Chrome's restore prefix would match").toBe(false)
    expect(firefox.with["restore-keys"]).toBeUndefined()
  })
})
