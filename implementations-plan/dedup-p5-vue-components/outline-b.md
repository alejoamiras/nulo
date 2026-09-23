# Outline B — the safest-first alternative (no new composable, no new popup components)

Same ids, different bet: touch only what can be proven identical by a diff and leave every "shape with variants"
alone. Land L2 (merge), K3 (merge), K8 (adopt the existing composite), N8 (`v-for`), M1 (`ScopePatternList`),
L5 + M5's classes (two `composes:` partials), I5 (story meta), N3 at the two FPC popups (existing component +
`color` prop). Skip N1 (four semantic variants across nine sites — a composable with four options is a new
abstraction for −45 lines), N2 (a five-line row that already reads as what it is; fourteen sites but two lines
saved each), N4 (two strings and two props to share a 15-line classifier and two inputs), N7 (the highest-risk file
in the popup cluster for −18 lines), M5's toggle button (four sites, one component, −24), N5, M6.

Cost: ≈ −250 lines instead of ≈ −420; no C1 composable; no new L2/L3 primitives beyond `ScopePatternList`.
Benefit: every change is a diff-provable move; nothing new to learn; the audit surface is a third of Plan A's.
Where it loses: the popup cluster keeps its nine sync copies and fourteen warning rows, which is the exact class of
copy-paste the ledger flagged as most likely to grow.
