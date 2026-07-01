import type { AgentSkill } from '../agent/skills/skill.interface';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PUBLIC EXTENSION API (ADR-0062) — versioned, semver-stable.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A `Vertical` is an industry-specific capability bundle contributed to the core
 * as a pluggable unit. The load-bearing rule: **core depends on zero Verticals;
 * every Vertical depends on core.** A community OPC adds a vertical by writing a
 * package that exports a `Vertical` object — never by editing core.
 *
 * It is a DISPLAY-EXPLICIT manifest (chosen over a NestJS-submodule convention,
 * ADR-0062 grill): one interface enumerates everything a vertical can contribute,
 * so the contract is centralized, documentable, and version-controllable.
 *
 * Contribution kinds currently CONSUMED by core (pure values, used as-is):
 *   - `skills` — Skills, flattened into AGENT_SKILLS.
 *
 * NOTE: DI-class contributions (tool classes, stateful connector services) are
 * deliberately NOT on this interface yet. They require core to register classes
 * with the Tool Registry (ADR-0052) and the DI container, which is coupled to the
 * physical package extraction in #209. They will be ADDED (a non-breaking, additive
 * change) when #209 wires them — keeping this API honest: every declared field is
 * actually consumed, none silently dropped.
 */
export interface Vertical {
  /** Stable logical id for the vertical (e.g. 'sales-records', 'avc'). */
  name: string;
  /** Pure-value Skills, flattened into AGENT_SKILLS. */
  skills?: AgentSkill[];
}

/** The flattened result of fanning a set of Verticals into the core's seams. */
export interface VerticalContributions {
  skills: AgentSkill[];
}

/**
 * Fan a set of registered Verticals into the core's collection seams. Pure: it only
 * flattens the manifests' value arrays. With no verticals it returns all-empty — core
 * runs vertical-free.
 */
export function collectVerticalContributions(verticals: Vertical[]): VerticalContributions {
  return {
    skills: verticals.flatMap(v => v.skills ?? []),
  };
}
