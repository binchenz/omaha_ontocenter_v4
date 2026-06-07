/** Format a number[] as a pgvector literal string for use with $executeRawUnsafe. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
