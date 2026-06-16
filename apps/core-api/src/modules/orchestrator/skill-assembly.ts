import { AgentSkill } from '../agent/skills/skill.interface';
import { SURFACE, isDesignTimeUser } from '@omaha/shared-types';

/**
 * Surface-driven Skill assembly (ADR-0039 / ADR-0041 §2). A relevance + least-privilege
 * layer, NOT the security gate (that is the service-layer guard, ADR-0040 #89) — it
 * narrows the Skills the LLM sees so its tool set matches the declared task. Consults the
 * shared `isDesignTimeUser` so it can never disagree with the guard.
 */

const SURFACE_SKILLS: Record<string, string[]> = {
  [SURFACE.CONSUME]: ['query', 'research_qa'],
  [SURFACE.MAINTAIN]: ['ontology_design'],
  [SURFACE.CREATE]: ['ontology_design', 'data_ingestion'],
  [SURFACE.PIPELINE]: ['data_ingestion'],
};

/** Skills that require design-time authorization; withheld from a non-design-time user
 * even when the surface would otherwise load them (least-privilege over relevance). */
const DESIGN_TIME_SKILLS = ['ontology_design', 'data_ingestion'];

/**
 * The skill set used when no surface is declared (or it is unknown). #179: the
 * former "all-active union" fallback (ADR-0010) assembled all six skills, whose
 * concatenated prompt blows PROMPT_BUDGET_ERROR (~8.3k > 8k) and silently shipped.
 * A no-surface conversation is read-only by nature, so the safe default is the
 * CONSUME set — it stays well under budget and never withholds anything a query
 * user is entitled to. A declared surface still narrows precisely as before.
 */
const FALLBACK_SKILLS = SURFACE_SKILLS[SURFACE.CONSUME];

/** A surface that declares a known Skill set. Absent/unknown → budget-safe fallback applies. */
function declaredSurface(surface: string | undefined): surface is string {
  return surface !== undefined && surface in SURFACE_SKILLS;
}

export function assembleSkills(
  allSkills: AgentSkill[],
  surface: string | undefined,
  permissions: string[],
): AgentSkill[] {
  // A declared surface narrows precisely (ADR-0039/0041); no/unknown surface falls
  // back to the budget-safe CONSUME set rather than the full union (#179).
  const wantedNames = declaredSurface(surface) ? SURFACE_SKILLS[surface] : FALLBACK_SKILLS;
  const designTime = isDesignTimeUser(permissions);
  const wanted = wantedNames.filter(
    (name) => designTime || !DESIGN_TIME_SKILLS.includes(name),
  );
  return allSkills.filter((s) => wanted.includes(s.name));
}

/**
 * When the current surface would load a design-time Skill the user is not authorized for,
 * return a one-line note injected into the system prompt so the Agent says up front it
 * cannot perform design-time work and redirects — honest guidance instead of a late
 * ForbiddenException (ADR-0041 §2). Returns null when no capability is withheld.
 */
export function openingGuidanceFor(surface: string | undefined, permissions: string[]): string | null {
  if (!declaredSurface(surface)) return null;
  const withheld = SURFACE_SKILLS[surface].some(
    (name) => DESIGN_TIME_SKILLS.includes(name) && !isDesignTimeUser(permissions),
  );
  if (!withheld) return null;
  return '当前用户没有设计期（建模/数据维护）权限。若用户请求建模、修改本体或导入数据，直接说明这是设计期能力、需要相应角色授权，并引导用户使用可用的查询能力，不要尝试调用相关工具。';
}
