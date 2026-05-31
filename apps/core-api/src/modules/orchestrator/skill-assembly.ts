import { AgentSkill } from '../agent/skills/skill.interface';
import { SURFACE, isDesignTimeUser } from '@omaha/shared-types';

/**
 * Surface-driven Skill assembly (ADR-0039 / ADR-0041 §2). A relevance + least-privilege
 * layer, NOT the security gate (that is the service-layer guard, ADR-0040 #89) — it
 * narrows the Skills the LLM sees so its tool set matches the declared task. Consults the
 * shared `isDesignTimeUser` so it can never disagree with the guard.
 */

const SURFACE_SKILLS: Record<string, string[]> = {
  [SURFACE.CONSUME]: ['query'],
  [SURFACE.MAINTAIN]: ['ontology_design'],
  [SURFACE.CREATE]: ['ontology_design', 'data_ingestion'],
  [SURFACE.PIPELINE]: ['data_ingestion'],
};

/** Skills that require design-time authorization; withheld from a non-design-time user
 * even when the surface would otherwise load them (least-privilege over relevance). */
const DESIGN_TIME_SKILLS = ['ontology_design', 'data_ingestion'];

function wantedSkillNames(surface: string | undefined, permissions: string[]): string[] {
  const key = surface && surface in SURFACE_SKILLS ? surface : SURFACE.CONSUME;
  const designTime = isDesignTimeUser(permissions);
  return SURFACE_SKILLS[key].filter((name) => designTime || !DESIGN_TIME_SKILLS.includes(name));
}

export function assembleSkills(
  allSkills: AgentSkill[],
  surface: string | undefined,
  permissions: string[],
): AgentSkill[] {
  // No declared surface → preserve the all-active union (ADR-0010). Surface narrows
  // the Skill set only when the user has actually declared one (ADR-0039/0041).
  if (!surface || !(surface in SURFACE_SKILLS)) return allSkills;
  const wanted = wantedSkillNames(surface, permissions);
  return allSkills.filter((s) => wanted.includes(s.name));
}

/**
 * When the current surface would load a design-time Skill the user is not authorized for,
 * return a one-line note injected into the system prompt so the Agent says up front it
 * cannot perform design-time work and redirects — honest guidance instead of a late
 * ForbiddenException (ADR-0041 §2). Returns null when no capability is withheld.
 */
export function openingGuidanceFor(surface: string | undefined, permissions: string[]): string | null {
  if (!surface || !(surface in SURFACE_SKILLS)) return null;
  const withheld = SURFACE_SKILLS[surface].some(
    (name) => DESIGN_TIME_SKILLS.includes(name) && !isDesignTimeUser(permissions),
  );
  if (!withheld) return null;
  return '当前用户没有设计期（建模/数据维护）权限。若用户请求建模、修改本体或导入数据，直接说明这是设计期能力、需要相应角色授权，并引导用户使用可用的查询能力，不要尝试调用相关工具。';
}
