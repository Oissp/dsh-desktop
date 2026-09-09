/**
 * Node half of the dsh-desktop-archived bundle.
 *
 * The panel is client-only — all UI lives in lib/client.js and registers into
 * the web client's slot system. This node half exists because a bundle must be
 * mountable as a loader entry: client-modules only scans MOUNTED entries for a
 * `dsh.client` declaration, and only a scanned package gets its browser bundle
 * served. So this apply() is intentionally empty but must not be absent.
 */

/** Stable plugin name. */
export const name = 'dsh-desktop-archived'

/** No host services needed; the panel's data arrives over the desktop bridge. */
export function apply() {}