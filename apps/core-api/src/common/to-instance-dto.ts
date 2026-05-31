/**
 * The single OUTPUT-seam materializer: turns an Object Instance's raw `properties`
 * bag into the property bag returned to the caller, applying field-level
 * visibility and the optional `select` projection.
 *
 * The mask-before-select ordering is load-bearing and sealed here: masking runs
 * first, then `select` narrows what survived. A caller cannot reorder it to
 * select-then-mask (which would let `select` surface a masked field). Both the
 * parent query path and the included-children path route through this one
 * function, so no read path can materialize a row without honouring visibility.
 *
 * `allowedFields === null` (the common case: admin / a role with no field
 * restriction) returns the masking step by identity — no copy.
 */
export function toInstanceDto(
  properties: Record<string, unknown> | null | undefined,
  allowedFields: Set<string> | null,
  select?: string[],
): Record<string, unknown> {
  const props = (properties ?? {}) as Record<string, unknown>;

  const masked = maskFields(props, allowedFields);

  if (!select || select.length === 0) return masked;
  const projected: Record<string, unknown> = {};
  for (const key of select) {
    if (key in masked) projected[key] = masked[key];
  }
  return projected;
}

function maskFields(
  properties: Record<string, unknown>,
  allowedFields: Set<string> | null,
): Record<string, unknown> {
  if (!allowedFields) return properties;
  const filtered: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in properties) filtered[field] = properties[field];
  }
  return filtered;
}
