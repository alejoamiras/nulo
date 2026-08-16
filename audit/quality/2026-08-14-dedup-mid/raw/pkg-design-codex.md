## Findings

### 1. Tooltip alignment logic is duplicated across all four sides

**Smell:** Duplicate Code — identical position-alignment switches are repeated for opposite sides.

**Impact bucket:** local. Blast radius: 1 production module, `Tooltip.vue`; all tooltip consumers inherit changes. Change frequency: 4 commits since the May 2026 import.

**Evidence:**

- Top and bottom duplicate the same `position → xPos` calculation:
  - [Tooltip.vue:70](packages/design/src/ui/Tooltip.vue:70)
  - [Tooltip.vue:88](packages/design/src/ui/Tooltip.vue:88)
- Left and right duplicate the same `position → yPos` calculation:
  - [Tooltip.vue:106](packages/design/src/ui/Tooltip.vue:106)
  - [Tooltip.vue:124](packages/design/src/ui/Tooltip.vue:124)

Each duplicated switch handles `center`, `start`, and `end` with identical formulas on the relevant axis. Only the perpendicular side offset differs.

**Why it harms future change:** Adding another alignment mode, changing the definition of `start`/`end`, or introducing an alignment gap requires editing two branches per axis. A partial edit would make behavior depend unexpectedly on tooltip side.

**Smallest safe refactoring:** Extract Function — extract `horizontalAlignment(position, triggerRect, tooltipRect)` and `verticalAlignment(...)`; each side branch then calculates only its side-specific offset and calls the appropriate alignment function. Two repeated three-case switches disappear.

**Instances:**

- [Tooltip.vue:70](packages/design/src/ui/Tooltip.vue:70)
- [Tooltip.vue:88](packages/design/src/ui/Tooltip.vue:88)
- [Tooltip.vue:106](packages/design/src/ui/Tooltip.vue:106)
- [Tooltip.vue:124](packages/design/src/ui/Tooltip.vue:124)

---

### 2. Every CTA button variant repeats the same structural typography

**Smell:** Duplicate Code — the three CTA variants independently declare the same seven-property CTA contract.

**Impact bucket:** structural. Blast radius: 1 design-system module and 15 current production consumer files using CTA variants. Change frequency: 6 commits since May 2026.

**Evidence:**

The following identical declarations appear in all three blocks: `width: 100%`, headline font, weight `700`, size `14px`, spacing `0.2em`, uppercase transformation, and `padding: 20px 0`.

- Base CTA: [Button.vue:302](packages/design/src/ui/Button.vue:302), specifically common declarations at lines 303 and 307–312.
- Outline CTA: [Button.vue:326](packages/design/src/ui/Button.vue:326), specifically lines 327 and 331–336.
- Destructive CTA: [Button.vue:347](packages/design/src/ui/Button.vue:347), specifically lines 348 and 352–357.

The background, foreground, fill, border, and interaction rules genuinely vary and are not part of the duplication.

**Why it harms future change:** A design-wide adjustment to CTA height, tracking, font size, or font family requires three synchronized edits. A new CTA variant is also likely to copy the entire block again.

**Smallest safe refactoring:** Extract Function analog for CSS — group the three selectors into one shared CTA rule, leaving only color, border, and interaction differences in their individual selectors. Twenty-one repeated declarations collapse to seven shared declarations.

**Instances:**

- [Button.vue:302](packages/design/src/ui/Button.vue:302)
- [Button.vue:326](packages/design/src/ui/Button.vue:326)
- [Button.vue:347](packages/design/src/ui/Button.vue:347)

---

### 3. Public components advertise two unimplemented API features

**Smell:** Dead Code — an unused `suffix` prop and an event that is declared but never emitted or observed remain in public component APIs. The event declaration has additionally propagated into the host wrapper, creating a small Shotgun Surgery shadow.

**Impact bucket:** structural. Blast radius: 2 scoped design-system modules plus 1 extension wrapper. Change frequency: `Input.vue` 3 commits, `Button.vue` 6 commits, wrapper 4 commits since May 2026.

**Evidence:**

- `Input` declares a `suffix` string prop at [Input.vue:48](packages/design/src/ui/Input.vue:48), but there is no `props.suffix` read or prop rendering anywhere. The similarly named construct at [Input.vue:305](packages/design/src/ui/Input.vue:305) is a Vue slot, and all production consumers use `#suffix`; repository search found no `suffix=`/`:suffix=` use on `Input`.
- The shared button declares `onKeybind` at [Button.vue:7](packages/design/src/ui/Button.vue:7), but contains no `emit` call.
- The extension wrapper mirrors the same inert declaration at [apps/extension Button.vue:17](apps/extension/src/components/ui/Button.vue:17), also without emitting or forwarding it.
- Repository-wide production search found no `@onKeybind` or `@on-keybind` listener.

Registration mechanisms do not cover these symbols: `@nulo/design` uses explicit component exports, while the extension’s component auto-registration only resolves the `Button`/`Input` components. Neither mechanism synthesizes prop consumption or event emission.

**Why it harms future change:** Consumers can reasonably infer that `suffix="..."` and `@on-keybind` are supported contracts, but neither does anything. The mirrored event declaration also means later removal or real implementation must account for both the base and wrapper.

**Smallest safe refactoring:** Remove Dead Code — delete the unused `suffix` prop and both `onKeybind` declarations. The existing `#suffix` slot remains unchanged.

**Instances:**

- [Input.vue:48](packages/design/src/ui/Input.vue:48)
- [Button.vue:7](packages/design/src/ui/Button.vue:7)
- [apps/extension Button.vue:17](apps/extension/src/components/ui/Button.vue:17)

## Non-findings

- **Bordered-surface candidate:** Rejected. `Card`, `Tag`, `Toast`, `AddressDisplay`, and `EmojiGrid` share token-level border/background declarations but have different semantics, layout, padding, and interaction behavior. The shared design decision is already centralized in CSS variables.
- **Severity mappings:** Rejected. `Badge`, `Banner`, and `Toast` share vocabulary but intentionally apply severity to different visual channels; `ToastManagerBase` exposes a separate raw-color axis. There is no repeated mapping implementation that could be safely unified without changing the API.
- **Two icon systems:** Rejected. SVG path rendering and Material Symbols font rendering have different assets, runtime contracts, and implementation logic; parallel exports alone are not Duplicate Code.
- **Uppercase label styles:** Rejected. The instances differ in font family, spacing, weight, size, and role. Only generic typography properties overlap.
- **Large `Input.vue`:** Rejected as a Long Method/Large Class finding. Its size is mostly template and component-local CSS; the longest handler remains one input-normalization pipeline rather than unrelated change responsibilities.
- **Empty `Card.vue` script block:** Rejected as cosmetic generated/scaffold residue with negligible future-change cost.