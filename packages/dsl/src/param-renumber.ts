/**
 * Renumber PostgreSQL positional parameters ($1, $2, ...) in a SQL fragment.
 * Used when merging compiled DSL fragments with different parameter offsets.
 *
 * @param sql - SQL fragment with $1-based parameters
 * @param offset - Offset to add to each parameter number
 * @returns SQL with renumbered parameters
 *
 * @example
 * renumberParams("SELECT * WHERE x = $1 AND y = $2", 5)
 * // => "SELECT * WHERE x = $6 AND y = $7"
 */
export function renumberParams(sql: string, offset: number): string {
  if (offset === 0) return sql;
  return sql.replace(/\$(\d+)/g, (_match, idx) => `$${Number(idx) + offset}`);
}
