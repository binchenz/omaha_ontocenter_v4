import { describe, it, expect } from 'vitest';
import {
  judgeNumeric,
  judgeNameVariants,
  judgeSetMembership,
  type Judgement,
} from '../drama-agent-judges';

describe('judgeNumeric', () => {
  it('passes when answer contains the exact ground-truth number', () => {
    const j = judgeNumeric('我们有 292 本书可选', 292);
    expect(j.kind).toBe('pass');
  });

  it('passes when number appears with thousands grouping (Chinese pattern not required for v1)', () => {
    const j = judgeNumeric('共 292 本', 292);
    expect(j.kind).toBe('pass');
  });

  it('fails when answer does not contain the exact number', () => {
    const j = judgeNumeric('约 300 本左右', 292);
    expect(j.kind).toBe('fail');
    if (j.kind === 'fail') expect(j.reason).toMatch(/missing|not found/i);
  });

  it('fails when answer says different number', () => {
    const j = judgeNumeric('我们有 290 本书', 292);
    expect(j.kind).toBe('fail');
  });

  it('does not match number embedded in unrelated context', () => {
    // Edge: "292" must appear as a standalone number, not part of another number
    const j = judgeNumeric('排名 12920', 292);
    expect(j.kind).toBe('fail');
  });
});

describe('judgeNameVariants', () => {
  it('passes when answer contains any of the variants', () => {
    const j = judgeNameVariants('主角是萧炎', ['萧炎', '萧炎大帝', '炎少']);
    expect(j.kind).toBe('pass');
  });

  it('passes when answer contains a longer variant', () => {
    const j = judgeNameVariants('萧炎大帝是斗破的主角', ['萧炎']);
    expect(j.kind).toBe('pass');
  });

  it('fails when none of the variants appear', () => {
    const j = judgeNameVariants('找不到这本书', ['萧炎']);
    expect(j.kind).toBe('fail');
  });
});

describe('judgeSetMembership (top-K + no-superset)', () => {
  it('passes when answer contains all top-K and no items outside ground truth', () => {
    const groundTruth = ['A', 'B', 'C', 'D', 'E', 'F'];
    const answer = 'top books: A, B, C, D';
    const j = judgeSetMembership(answer, groundTruth, 3);
    expect(j.kind).toBe('pass');
  });

  it('fails when answer omits a top-K item', () => {
    const groundTruth = ['A', 'B', 'C', 'D', 'E', 'F'];
    const answer = 'B, C, D, E'; // missing A (top-1)
    const j = judgeSetMembership(answer, groundTruth, 3);
    expect(j.kind).toBe('fail');
    if (j.kind === 'fail') expect(j.reason).toMatch(/missing top/i);
  });

  it('fails when answer mentions a name not in ground truth (superset)', () => {
    const groundTruth = ['A', 'B', 'C'];
    const answer = 'A, B, C, X'; // X is hallucinated
    const j = judgeSetMembership(answer, groundTruth, 3);
    expect(j.kind).toBe('fail');
    if (j.kind === 'fail') expect(j.reason).toMatch(/superset|hallucinated/i);
  });

  it('passes when answer is the ground truth exactly', () => {
    const groundTruth = ['A', 'B', 'C'];
    const answer = 'A, B, C';
    const j = judgeSetMembership(answer, groundTruth, 3);
    expect(j.kind).toBe('pass');
  });

  it('passes when answer is a strict subset that includes top-K', () => {
    const groundTruth = ['A', 'B', 'C', 'D', 'E'];
    const answer = 'A, B, C'; // top-3 included; missing D, E (acceptable)
    const j = judgeSetMembership(answer, groundTruth, 3);
    expect(j.kind).toBe('pass');
  });

  it('accepts prefix match when ground-truth has trailing qualifiers (作者：...)', () => {
    // Real case from drama-co A3.1: agent renders the short form in markdown
    // tables, but ground truth carries the full label.
    const groundTruth = ['斗破苍穹之至高真神 作者：落日精灵', '0005005.斗破苍穹', '诡秘之主'];
    const answer = '前 3：斗破苍穹之至高真神、0005005.斗破苍穹、诡秘之主';
    const j = judgeSetMembership(answer, groundTruth, 3);
    expect(j.kind).toBe('pass');
  });

  it('accepts prefix match when ground-truth has (公众号：...) suffix', () => {
    const groundTruth = ['谁让他修仙的 (公众号：六点书单)', '万族之劫 (公众号：六点书单)'];
    const answer = '答案是《谁让他修仙的》和《万族之劫》';
    const j = judgeSetMembership(answer, groundTruth, 2);
    expect(j.kind).toBe('pass');
  });
});

describe('judgeNameVariants prefix fallback', () => {
  it('passes when answer drops the (公众号：...) qualifier from variant', () => {
    const j = judgeNameVariants('Agent says: 谁让他修仙的', ['谁让他修仙的 (公众号：六点书单)']);
    expect(j.kind).toBe('pass');
  });

  it('still fails when the prefix itself is absent', () => {
    const j = judgeNameVariants('completely unrelated', ['谁让他修仙的 (公众号：六点书单)']);
    expect(j.kind).toBe('fail');
  });
});
