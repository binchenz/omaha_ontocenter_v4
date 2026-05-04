export function filterMaskedFields(
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
