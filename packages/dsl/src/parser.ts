export type CompareOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

export type Ast =
  | { kind: 'ident'; name: string }
  | { kind: 'param'; name: string }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'compare'; op: CompareOp; left: Ast; right: Ast }
  | { kind: 'and'; left: Ast; right: Ast }
  | { kind: 'or'; left: Ast; right: Ast }
  | { kind: 'not'; expr: Ast }
  | { kind: 'exists'; relation: string; predicate: Ast };

type Tok =
  | { kind: 'ident'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'colon' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

const OPS = ['<=', '>=', '!=', '=', '<', '>'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      out.push({ kind: 'lparen' });
      i++;
      continue;
    }
    if (c === ')') {
      out.push({ kind: 'rparen' });
      i++;
      continue;
    }
    if (c === ':') {
      out.push({ kind: 'colon' });
      i++;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== "'") j++;
      if (j >= src.length) throw new Error('Unterminated string literal');
      out.push({ kind: 'string', value: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ kind: 'number', value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const value = src.slice(i, j);
      out.push({ kind: 'ident', value });
      i = j;
      continue;
    }
    let matched = '';
    for (const op of OPS) {
      if (src.slice(i, i + op.length) === op) {
        matched = op;
        break;
      }
    }
    if (matched) {
      out.push({ kind: 'op', value: matched });
      i += matched.length;
      continue;
    }
    throw new Error(`Unexpected character '${c}' at position ${i}`);
  }
  return out;
}

export function parse(src: string): Ast {
  const toks = tokenize(src);
  const p = new Parser(toks);
  const expr = p.parseExpr();
  if (!p.eof()) throw new Error(`Unexpected trailing token: ${JSON.stringify(p.peek())}`);
  return expr;
}

const KEYWORDS = new Set(['and', 'or', 'not', 'exists', 'where', 'true', 'false']);

class Parser {
  private pos = 0;
  constructor(private readonly toks: Tok[]) {}

  eof(): boolean {
    return this.pos >= this.toks.length;
  }

  peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  parseExpr(): Ast {
    return this.parseOr();
  }

  private parseOr(): Ast {
    let left = this.parseAnd();
    while (this.matchKeyword('or')) {
      const right = this.parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): Ast {
    let left = this.parseNot();
    while (this.matchKeyword('and')) {
      const right = this.parseNot();
      left = { kind: 'and', left, right };
    }
    return left;
  }

  private parseNot(): Ast {
    if (this.matchKeyword('not')) {
      const expr = this.parseNot();
      return { kind: 'not', expr };
    }
    return this.parseExists();
  }

  private parseExists(): Ast {
    if (this.matchKeyword('exists')) {
      const relTok = this.peek();
      if (!relTok || relTok.kind !== 'ident' || KEYWORDS.has(relTok.value)) {
        throw new Error("Expected relation identifier after 'exists'");
      }
      this.pos++;
      if (!this.matchKeyword('where')) {
        throw new Error("Expected 'where' after exists <relation>");
      }
      const predicate = this.parseOr();
      return { kind: 'exists', relation: relTok.value, predicate };
    }
    return this.parseCompare();
  }

  private matchKeyword(kw: string): boolean {
    const t = this.peek();
    if (t && t.kind === 'ident' && t.value === kw) {
      this.pos++;
      return true;
    }
    return false;
  }

  private parseCompare(): Ast {
    const left = this.parsePrimary();
    const t = this.peek();
    if (t && t.kind === 'op') {
      const op = t.value as CompareOp;
      this.pos++;
      const right = this.parsePrimary();
      return { kind: 'compare', op, left, right };
    }
    return left;
  }

  private parsePrimary(): Ast {
    const t = this.peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.kind === 'lparen') {
      this.pos++;
      const expr = this.parseOr();
      const close = this.peek();
      if (!close || close.kind !== 'rparen') throw new Error("Expected ')'");
      this.pos++;
      return expr;
    }
    if (t.kind === 'colon') {
      this.pos++;
      const next = this.peek();
      if (!next || next.kind !== 'ident') throw new Error("Expected parameter name after ':'");
      this.pos++;
      return { kind: 'param', name: next.value };
    }
    if (t.kind === 'number') {
      this.pos++;
      return { kind: 'number', value: t.value };
    }
    if (t.kind === 'string') {
      this.pos++;
      return { kind: 'string', value: t.value };
    }
    if (t.kind === 'ident') {
      this.pos++;
      if (t.value === 'true') return { kind: 'bool', value: true };
      if (t.value === 'false') return { kind: 'bool', value: false };
      return { kind: 'ident', name: t.value };
    }
    throw new Error(`Unexpected token: ${JSON.stringify(t)}`);
  }
}
