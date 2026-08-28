/**
 * Behavioral pin for the e2e `Decide` gates.
 *
 * Its sibling `behavior-gating.test.ts` pins which PATHS each filter covers. Nothing pinned what
 * the gate then DOES with that answer, and that is exactly where the defect lived: the paths
 * clause was additionally conditioned on `github.base_ref == "dev"`, so a stacked PR — whose base
 * is the branch below it — could never reach the suite by paths, skipped it, and had the
 * aggregator report success-on-skip. Four green PRs carried a real regression that way.
 *
 * So this executes the gate script itself against a table of inputs rather than asserting on its
 * text: a rule that re-appears in a different spelling still fails here.
 *
 * Wired into CI via the root `test:ci-gating` script in `_unit-tests.yml`.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

const ROOT = join(import.meta.dir, "..", "..")

interface GateSpec {
  /** Workflow file holding the gate. */
  file: string
  /** The env var carrying the paths-filter verdict (`NETWORK` / `SMOKE`). */
  filterVar: string
}

const GATES: GateSpec[] = [
  { file: ".github/workflows/pr-network-e2e.yml", filterVar: "NETWORK" },
  { file: ".github/workflows/pr-smoke-e2e.yml", filterVar: "SMOKE" },
]

/**
 * The gate's shell body, lifted out of the workflow.
 *
 * Extracted by locating the `if [ "$EVENT" ...` line and taking through the closing `fi` — the
 * gate is the only multi-line `if` in its step. Deliberately NOT a YAML parse: the point is to run
 * the same characters CI runs.
 */
function gateScript(file: string): string {
  const yaml = readFileSync(join(ROOT, file), "utf8")
  const lines = yaml.split("\n")
  const start = lines.findIndex((l) => l.includes('if [ "$EVENT" = "workflow_dispatch" ]'))
  expect(start, `${file}: gate opener not found — did the Decide step move?`).toBeGreaterThan(-1)
  const indent = lines[start].length - lines[start].trimStart().length
  const end = lines.findIndex((l, i) => i > start && l.trim() === "fi" && l.length - l.trimStart().length === indent)
  expect(end, `${file}: gate has no closing fi`).toBeGreaterThan(start)
  return lines
    .slice(start, end + 1)
    .map((l) => l.slice(indent))
    .join("\n")
}

/** Run the gate with the given env and return what it wrote to `$GITHUB_OUTPUT`. */
function runGate(file: string, env: Record<string, string>): string {
  // A real file, not `/dev/stdout`: the gate appends with `>>`, which the spawned shell cannot do
  // to an inherited pipe.
  const out = join(mkdtempSync(join(tmpdir(), "decide-gate-")), "output")
  const r = spawnSync("bash", ["-c", gateScript(file)], {
    env: { ...process.env, ...env, GITHUB_OUTPUT: out },
    encoding: "utf8",
  })
  expect(r.status, `${file}: gate exited ${r.status}: ${r.stderr}`).toBe(0)
  const written = readFileSync(out, "utf8").trim()
  rmSync(dirname(out), { recursive: true, force: true })
  return written
}

describe.each(GATES)("Decide gate — $file", ({ file, filterVar }) => {
  const env = (over: Record<string, string>) => ({
    EVENT: "pull_request",
    BASE: "dev",
    LABEL_HIT: "false",
    [filterVar]: "false",
    ...over,
  })

  test("a relevant diff runs the suite on a STACKED base, not just dev", () => {
    // The regression this file exists for. `github.base_ref` on a stacked PR is the arc below it.
    expect(runGate(file, env({ BASE: "log-safety/03-call-sites", [filterVar]: "true" }))).toBe("run=true")
  })

  test("a relevant diff runs the suite on dev", () => {
    expect(runGate(file, env({ [filterVar]: "true" }))).toBe("run=true")
  })

  test("an irrelevant diff still skips — the filter is what decides", () => {
    expect(runGate(file, env({ BASE: "some/feature-branch" }))).toBe("run=false")
    expect(runGate(file, env({ BASE: "dev" }))).toBe("run=false")
  })

  test("main force-runs regardless of the filter", () => {
    expect(runGate(file, env({ BASE: "main" }))).toBe("run=true")
  })

  test("the label force-runs regardless of base or filter", () => {
    expect(runGate(file, env({ BASE: "some/feature-branch", LABEL_HIT: "true" }))).toBe("run=true")
  })

  test("workflow_dispatch force-runs", () => {
    expect(runGate(file, env({ EVENT: "workflow_dispatch" }))).toBe("run=true")
  })
})
