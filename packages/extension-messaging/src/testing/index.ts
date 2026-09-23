// Only side-effect-free fakes: `transport-harness` installs vitest hooks on import and must stay
// a deliberate, per-file import.
export * from "./port-registry"
