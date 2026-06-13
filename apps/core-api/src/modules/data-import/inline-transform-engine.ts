export interface InlineTransform {
  column: string;
  op: 'multiply' | 'divide' | 'map' | 'compute';
  arg?: number | Record<string, any> | string;
  outputColumn?: string;
}

export class InlineTransformEngine {
  static apply(rows: Record<string, unknown>[], transforms: InlineTransform[]): Record<string, unknown>[] {
    return rows.map(row => {
      let transformedRow = { ...row };

      for (const transform of transforms) {
        transformedRow = this.applyTransform(transformedRow, transform);
      }

      return transformedRow;
    });
  }

  private static applyTransform(row: Record<string, unknown>, transform: InlineTransform): Record<string, unknown> {
    const { column, op, arg, outputColumn } = transform;
    const targetColumn = outputColumn || column;

    switch (op) {
      case 'multiply':
        return this.applyMultiply(row, column, arg as number, targetColumn);
      case 'divide':
        return this.applyDivide(row, column, arg as number, targetColumn);
      case 'map':
        return this.applyMap(row, column, arg as Record<string, any>, targetColumn);
      case 'compute':
        return this.applyCompute(row, targetColumn, arg as string);
      default:
        throw new Error(`Unknown operation: ${op}`);
    }
  }

  private static applyMultiply(
    row: Record<string, unknown>,
    column: string,
    multiplier: number,
    targetColumn: string,
  ): Record<string, unknown> {
    if (!(column in row)) {
      throw new Error(`Column '${column}' not found`);
    }

    const value = row[column];
    const numValue = typeof value === 'string' ? parseFloat(value) : Number(value);

    if (isNaN(numValue)) {
      throw new Error('Cannot multiply non-numeric value');
    }

    return { ...row, [targetColumn]: numValue * multiplier };
  }

  private static applyDivide(
    row: Record<string, unknown>,
    column: string,
    divisor: number,
    targetColumn: string,
  ): Record<string, unknown> {
    if (!(column in row)) {
      throw new Error(`Column '${column}' not found`);
    }

    const value = row[column];
    const numValue = typeof value === 'string' ? parseFloat(value) : Number(value);

    if (isNaN(numValue)) {
      throw new Error('Cannot divide non-numeric value');
    }

    return { ...row, [targetColumn]: numValue / divisor };
  }

  private static applyMap(
    row: Record<string, unknown>,
    column: string,
    mapping: Record<string, any>,
    targetColumn: string,
  ): Record<string, unknown> {
    if (!(column in row)) {
      throw new Error(`Column '${column}' not found`);
    }

    const value = row[column];
    const mappedValue = mapping[String(value)] !== undefined ? mapping[String(value)] : value;

    return { ...row, [targetColumn]: mappedValue };
  }

  private static applyCompute(
    row: Record<string, unknown>,
    targetColumn: string,
    expression: string,
  ): Record<string, unknown> {
    // Simple expression evaluator for basic arithmetic
    // Supports: column names, +, -, *, /, parentheses
    const tokens = expression.match(/\w+|[+\-*/()]/g);
    if (!tokens) {
      throw new Error('Invalid expression syntax');
    }

    // Replace column names with their values
    let jsExpression = expression;
    for (const [key, value] of Object.entries(row)) {
      const regex = new RegExp(`\\b${key}\\b`, 'g');
      jsExpression = jsExpression.replace(regex, String(value));
    }

    try {
      // eslint-disable-next-line no-eval
      const result = eval(jsExpression);
      return { ...row, [targetColumn]: result };
    } catch (error) {
      throw new Error(`Failed to evaluate expression: ${expression}`);
    }
  }
}
