/**
 * Small WHERE/DELETE builders for the ops scripts. Column and table names are
 * trusted (callers pass literals); values are always parameters.
 *
 * An empty array used to be skipped like undefined, so a filter of
 * `{ id: [] }` (nothing to match) produced no WHERE at all and buildDelete
 * returned a bare `DELETE FROM <table>`. An empty array now throws, and
 * buildDelete refuses to build a statement without a WHERE clause.
 */
export function buildWhere(
  filters: Record<string, unknown>,
): { clause: string; values: unknown[]; paramOffset: number } {
  const parts: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [col, val] of Object.entries(filters)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      if (val.length === 0) {
        throw new Error(`buildWhere: empty array for "${col}" would match everything once dropped; handle "nothing to do" before building SQL`);
      }
      values.push(val);
      parts.push(`${col} = ANY($${idx}::uuid[])`);
      idx++;
    } else {
      values.push(val);
      parts.push(`${col} = $${idx}`);
      idx++;
    }
  }
  const clause = parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "";
  return { clause, values, paramOffset: idx };
}

export function buildDelete(
  table: string,
  filters: Record<string, unknown>,
): { text: string; values: unknown[] } {
  const { clause, values } = buildWhere(filters);
  if (clause === "") {
    throw new Error(`buildDelete: refusing to build DELETE FROM ${table} with no WHERE clause`);
  }
  return { text: `DELETE FROM ${table} ${clause}`, values };
}
