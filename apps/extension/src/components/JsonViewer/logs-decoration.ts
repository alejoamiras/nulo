import { type Text, RangeSetBuilder, StateField } from "@codemirror/state"
import { Decoration, EditorView } from "@codemirror/view"

const LOG_PREFIX = /\n(?=\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[)/
const LEVEL_RE = /\] (DEBUG|WARN|ERROR):/

function levelClassFor(text: string): string {
	const match = text.match(LEVEL_RE)
	const level = match ? match[1] : "INFO"
	if (level === "ERROR") return "log-line-error"
	if (level === "WARN") return "log-line-warn"
	if (level === "DEBUG") return "log-line-debug"
	return "log-line-info"
}

export function buildLogDecorations(doc: Text) {
	const builder = new RangeSetBuilder<Decoration>()
	const fullText = doc.toString()
	const logs = fullText.split(LOG_PREFIX)

	let pos = 0
	for (const log of logs) {
		builder.add(pos, pos + log.length, Decoration.mark({ class: levelClassFor(log) }))
		pos += log.length + 1
	}

	return builder.finish()
}

export const logDecorationsField = StateField.define({
	create(state) {
		return buildLogDecorations(state.doc)
	},
	update(decorations, transaction) {
		if (transaction.docChanged) {
			return buildLogDecorations(transaction.newDoc)
		}
		return decorations
	},
	provide: (f) => EditorView.decorations.from(f),
})
