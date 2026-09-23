export interface ListenerBag<T> {
	/** The live array. Dispatch loops stay caller-owned: iterate it directly or a `[...snapshot]`,
	 *  whichever the fake being modelled does. */
	readonly items: T[]
	add(item: T): void
	/** Removes the first occurrence only, like an unsubscribe closure. */
	remove(item: T): void
	/** Removes every occurrence, like `chrome.events.Event.removeListener`. */
	removeAll(item: T): void
}

export function createListenerBag<T>(): ListenerBag<T> {
	const items: T[] = []
	return {
		items,
		add: (item) => {
			items.push(item)
		},
		remove: (item) => {
			const i = items.indexOf(item)
			if (i >= 0) items.splice(i, 1)
		},
		removeAll: (item) => {
			for (let i = items.length - 1; i >= 0; i--) if (items[i] === item) items.splice(i, 1)
		},
	}
}
