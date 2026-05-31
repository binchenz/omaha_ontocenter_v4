import type { OntologySnapshot, SnapshotObjectType } from './ontology-snapshot';

export interface SnapshotValidationError {
  path: string;
  message: string;
}

/**
 * Structural validation of a draft snapshot, lifting the production write-path checks
 * (OntologyService.validateAllowedValues + the table unique constraints) to whole-snapshot
 * scope. Pure and dependency-free so it can gate every snapshot write — the draft PUT,
 * publish, reverse-inference output, and template instantiation — before anything reaches
 * the database. Returns the list of errors (empty = valid); callers decide the policy.
 *
 * Derived-property *expression* validity still needs the DSL analyzer with resolved
 * relations, so it stays in OntologyService at the production boundary; this function
 * covers the structural invariants that can be checked from the snapshot alone.
 */
export function validateSnapshot(snapshot: OntologySnapshot): SnapshotValidationError[] {
  const errors: SnapshotValidationError[] = [];
  const typeNames = new Set<string>();

  for (const type of snapshot.objectTypes) {
    if (type.name.trim() === '') {
      errors.push({ path: 'objectTypes', message: '对象类型缺少 name' });
      continue;
    }
    if (typeNames.has(type.name)) {
      errors.push({ path: type.name, message: `对象类型名 '${type.name}' 重复` });
    }
    typeNames.add(type.name);
    validateType(type, errors);
  }

  const relKeys = new Set<string>();
  for (const rel of snapshot.relationships) {
    const where = `relationship '${rel.name}'`;
    if (rel.name.trim() === '') {
      errors.push({ path: 'relationships', message: '关系缺少 name' });
    }
    const key = `${rel.sourceType}::${rel.name}`;
    if (relKeys.has(key)) {
      errors.push({ path: where, message: `关系 '${rel.sourceType}.${rel.name}' 重复` });
    }
    relKeys.add(key);
    if (!typeNames.has(rel.sourceType)) {
      errors.push({ path: where, message: `关系源类型 '${rel.sourceType}' 不存在于快照中` });
    }
    if (!typeNames.has(rel.targetType)) {
      errors.push({ path: where, message: `关系目标类型 '${rel.targetType}' 不存在于快照中` });
    }
  }

  return errors;
}

function validateType(type: SnapshotObjectType, errors: SnapshotValidationError[]): void {
  const fieldNames = new Set<string>();
  const allFields = [...type.properties, ...type.derivedProperties];
  for (const p of allFields) {
    if (p.name.trim() === '') {
      errors.push({ path: type.name, message: '字段缺少 name' });
      continue;
    }
    if (fieldNames.has(p.name)) {
      errors.push({ path: `${type.name}.${p.name}`, message: `字段名 '${p.name}' 重复` });
    }
    fieldNames.add(p.name);
  }

  for (const p of type.properties) {
    if (p.allowedValues === undefined) continue;
    const at = `${type.name}.${p.name}`;
    if (!Array.isArray(p.allowedValues) || p.allowedValues.length === 0) {
      errors.push({ path: at, message: 'allowedValues 存在时必须为非空数组' });
      continue;
    }
    if (p.type !== 'string') {
      errors.push({ path: at, message: `allowedValues 仅支持 string 字段（当前为 '${p.type}'）` });
    }
    const cleaned = p.allowedValues.map((v) => String(v).trim());
    if (cleaned.some((v) => v === '')) {
      errors.push({ path: at, message: 'allowedValues 不能包含空字符串' });
    }
    if (new Set(cleaned).size !== cleaned.length) {
      errors.push({ path: at, message: 'allowedValues 不能包含重复值' });
    }
  }
}
