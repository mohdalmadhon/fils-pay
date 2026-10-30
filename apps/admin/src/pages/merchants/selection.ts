/**
 * Bulk-selection rules for the merchant list. The selection only ever means
 * "rows the operator can see right now": ids that are not in the loaded rows
 * are never sent, and "all selected" is decided by ids, not by counts.
 */

/** The selected ids that are also loaded, in the order the rows are shown. */
export function selectedLoadedIds(selected: ReadonlySet<string>, loaded: ReadonlyArray<{ id: string }>): string[] {
  return loaded.filter((row) => selected.has(row.id)).map((row) => row.id);
}

/** True when there is at least one loaded row and every loaded row is selected. */
export function allLoadedSelected(selected: ReadonlySet<string>, loaded: ReadonlyArray<{ id: string }>): boolean {
  return loaded.length > 0 && loaded.every((row) => selected.has(row.id));
}

/** The header checkbox: clear everything if every loaded row is selected, else select exactly the loaded rows. */
export function toggleAllLoaded(selected: ReadonlySet<string>, loaded: ReadonlyArray<{ id: string }>): Set<string> {
  return allLoadedSelected(selected, loaded) ? new Set() : new Set(loaded.map((row) => row.id));
}
