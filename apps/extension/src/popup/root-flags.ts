import type { RouteMeta } from "vue-router"

/**
 * Mirrors the route's layout flags onto `<html>`, where the popup's stylesheet reads them:
 * `data-has-nav` lets a page clear the bottom nav, and `data-fills-window` lays a window drawn at
 * its window's width out at that width instead of the popup's 360px column.
 */
export function applyRootFlags(root: Element, meta: RouteMeta): void {
	root.setAttribute("data-has-nav", meta.showBottomNav ? "true" : "false")
	root.setAttribute("data-fills-window", meta.fillsWindow ? "true" : "false")
}
