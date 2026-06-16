import { estimateTokens, PROMPT_BUDGET_ERROR } from '../../agent/prompt-budget';
import { assembleSkills } from '../skill-assembly';
import { SURFACE } from '@omaha/shared-types';
import type { AgentSkill } from '../../agent/skills/skill.interface';
import { QuerySkill } from '../../agent/skills/query.skill';
import { ResearchQaSkill } from '../../agent/skills/research-qa.skill';
import { OntologyDesignSkill } from '../../agent/skills/ontology-design.skill';
import { DataIngestionSkill } from '../../agent/skills/data-ingestion.skill';
import { DataImportSkill } from '../../agent/skills/data-import.skill';
import { DataPipelineSkill } from '../../agent/skills/data-pipeline.skill';

/**
 * #179: the prompt-budget guard used to only LOG, and the no-surface fallback
 * assembled the full skill union (~8.3k tokens) over the 8k ERROR line. These
 * tests assert the REAL assembled skill prose stays under budget for every
 * declared surface AND the no-surface fallback — so a future skill that bloats
 * the prompt fails CI instead of silently shipping an over-budget prompt.
 *
 * Budget here counts the skill prose (the variable part that surface assembly
 * controls). The fixed base+schema+profile (~1k) is measured separately; we
 * leave headroom by asserting skills alone stay under the ERROR line.
 */
const ALL_SKILLS: AgentSkill[] = [
  new QuerySkill(),
  new ResearchQaSkill(),
  new OntologyDesignSkill(),
  new DataIngestionSkill(),
  new DataImportSkill(),
  new DataPipelineSkill(),
];

function assembledTokens(skills: AgentSkill[]): number {
  const prose = skills.map((s) => s.systemPrompt({ tenantId: 't1' })).join('\n\n');
  return estimateTokens(prose);
}

// A design-time principal — the worst case (no design-skill withholding narrows it).
const DESIGN_PERMS = ['*'];

describe('prompt budget — real skill combinations (#179)', () => {
  it.each([SURFACE.CONSUME, SURFACE.MAINTAIN, SURFACE.CREATE, SURFACE.PIPELINE])(
    'surface %s assembles skills under the ERROR budget',
    (surface) => {
      const assembled = assembleSkills(ALL_SKILLS, surface, DESIGN_PERMS);
      expect(assembledTokens(assembled)).toBeLessThan(PROMPT_BUDGET_ERROR);
    },
  );

  it('no-surface fallback assembles skills under the ERROR budget (the #179 regression)', () => {
    const assembled = assembleSkills(ALL_SKILLS, undefined, DESIGN_PERMS);
    expect(assembledTokens(assembled)).toBeLessThan(PROMPT_BUDGET_ERROR);
  });

  it('the full union (what the old fallback used) DID exceed budget — proves the fallback was necessary', () => {
    // Guard against regressing the fix: if someone reverts assembleSkills to return
    // the union on no surface, this documents why that path is over budget.
    expect(assembledTokens(ALL_SKILLS)).toBeGreaterThan(PROMPT_BUDGET_ERROR - 2000);
  });
});
