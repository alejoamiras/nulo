# Phase 3 · Max and the corner read the exact balance

- **Tests first**, on the unfixed Max and corner, with P2's command: exit 1, 9 failed and 181
  passed. Each failure as predicted:
  - Max (18 decimals) filled the float: 1.1234567890123457 for 1.123456789012345678,
    99.87654321098765 for 99.876543210987654321, and the number 1e-7 for 0.0000001.
  - Max with no raw balance, or no decimals, still filled `[250]`, the float.
  - the corner read "124,457,554.40000001 TST" and "1.12345679 TST", and still showed with no raw
    balance or no decimals.
  - Pins that passed before the fix: a balance under 0.00000001 reads "0 TST", a zero balance hides
    the corner, a grouped amount re-clamps on its fraction alone when the decimals drop, and the
    old corner test ("42 USDC", now given its decimals and raw balance).
- **The fix**: token-mode Max writes the raw balance through `writeModelFromRaw` and fills nothing
  without the raw balance or the decimals; the corner formats the raw balance truncated at 8
  places; the raw prop's TSDoc states its units and why it, not the float, is read; the story's
  args carry decimals and a raw balance. `comma` has no caller left (F-3).
- **Gate.** P2's command: exit 0, 8 files, 190 tests passed. `bun run lint` exit 0 after
  `biome format` wrapped one `mountCard` call.
