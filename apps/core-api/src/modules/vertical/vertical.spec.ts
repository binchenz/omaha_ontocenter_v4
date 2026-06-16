import { collectVerticalContributions, Vertical } from './vertical';
import type { AgentSkill } from '../agent/skills/skill.interface';
import type { DrillGate } from '../orchestrator/orchestrator.service';

const skillA: AgentSkill = { name: 'a', description: '', tools: ['t1'], systemPrompt: () => 'A' };
const skillB: AgentSkill = { name: 'b', description: '', tools: ['t2'], systemPrompt: () => 'B' };
const gateA: DrillGate = { broadLayer: new Set(['x']), drillTarget: 'y', confirmMessage: '?' };

describe('collectVerticalContributions — pure-value fan-out (ADR-0062)', () => {
  it('flattens skills from every vertical into one array', () => {
    const v1: Vertical = { name: 'v1', skills: [skillA] };
    const v2: Vertical = { name: 'v2', skills: [skillB] };
    const { skills } = collectVerticalContributions([v1, v2]);
    expect(skills).toEqual([skillA, skillB]);
  });

  it('flattens drillGates from every vertical', () => {
    const v: Vertical = { name: 'v', drillGates: [gateA] };
    expect(collectVerticalContributions([v]).drillGates).toEqual([gateA]);
  });

  it('treats missing contribution arrays as empty (a vertical may contribute only some kinds)', () => {
    const v: Vertical = { name: 'minimal' };
    const out = collectVerticalContributions([v]);
    expect(out.skills).toEqual([]);
    expect(out.drillGates).toEqual([]);
  });

  it('returns empty contributions when no verticals are registered (core runs vertical-free)', () => {
    const out = collectVerticalContributions([]);
    expect(out).toEqual({ skills: [], drillGates: [] });
  });
});
