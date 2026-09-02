/**
 * Test-only barrel for the light-theme guards. Lets consuming packages (extension, tools) run the
 * SAME undefined-var guard against their own SFCs without duplicating the logic. Not part of the
 * runtime API — `exports["./testing"]`. Consumers pass the canonical base.css path to `declaredVars`
 * (in the monorepo: `join(process.cwd(), "../design/src/base.css")`).
 */

export * from "./theme-vars"
export * from "./theme-contrast"
