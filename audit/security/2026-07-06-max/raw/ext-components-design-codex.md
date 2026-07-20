CLUSTER: ext-components-design

## Findings

_No findings meeting the bar._

## Notes

Checked scoped production files under `apps/extension/src/components` and `packages/design/src` for `v-html`, `innerHTML`, raw DOM HTML insertion, dynamic `:href`/`:src`, and JSON/log rendering. No production raw-HTML sink was present.

`JsonViewer` and `LogsViewer` render untrusted JSON/log data as CodeMirror document text, not HTML: `apps/extension/src/components/JsonViewer/JsonViewer.vue:47`, `apps/extension/src/components/JsonViewer/JsonViewer.vue:64`, `apps/extension/src/components/JsonViewer/LogsViewer.vue:69`, `apps/extension/src/components/JsonViewer/LogsViewer.vue:216`. Log decorations only assign fixed CSS classes: `apps/extension/src/components/JsonViewer/logs-decoration.ts:7`, `apps/extension/src/components/JsonViewer/logs-decoration.ts:23`. CSV export was reviewed at `apps/extension/src/components/JsonViewer/logs-csv.ts:41`; I did not find a concrete dApp-controlled value that reaches the start of a spreadsheet cell in current logging paths.

Reviewed URL/image sinks. `DappIdentityBlock` binds only `logoBlobUrl` into `<img src>` and escapes text with Vue interpolation: `apps/extension/src/components/composite/DappIdentityBlock.vue:33`, `apps/extension/src/components/composite/DappIdentityBlock.vue:40`, `apps/extension/src/components/composite/DappIdentityBlock.vue:56`. One handoff hop showed current discovery metadata sets sanitized `name` and `url`, not `logo`: `apps/extension/src/wallet/services/wallet-sdk/background.ts:532`, `apps/extension/src/wallet/services/wallet-sdk/background.ts:537`. Shared link primitives were checked: design `Button` adds `noopener noreferrer` for opener-capable targets at `packages/design/src/ui/Button.vue:88`, and `Toast` includes `rel="noopener noreferrer"` at `packages/design/src/ui/Toast.vue:22`. `SettingItem` has `_blank` links at `apps/extension/src/components/ui/Settings/SettingItem.vue:47`, but current external callers are wallet-controlled static URLs such as `apps/extension/src/popup/pages/settings/about.vue:51` and `apps/extension/src/popup/components/popups/ForgotPasswordPopup.vue:53`, so no untrusted URL trace met the finding bar.