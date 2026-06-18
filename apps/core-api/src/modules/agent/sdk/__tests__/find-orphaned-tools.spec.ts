import { findOrphanedTools, findDanglingToolRefs } from '../find-orphaned-tools';
import { AgentSkill } from '../../skills/skill.interface';

const mkSkill = (name: string, tools: string[]): AgentSkill => ({
  name,
  description: '',
  tools,
  systemPrompt: () => '',
});

describe('findOrphanedTools', () => {
  it('returns empty array when every tool is declared by at least one skill', () => {
    const tools = ['a', 'b', 'c'];
    const skills = [mkSkill('s1', ['a', 'b']), mkSkill('s2', ['c'])];
    expect(findOrphanedTools(tools, skills)).toEqual([]);
  });

  it('returns the names of tools not declared by any skill', () => {
    const tools = ['a', 'b', 'c', 'd'];
    const skills = [mkSkill('s1', ['a']), mkSkill('s2', ['b'])];
    expect(findOrphanedTools(tools, skills).sort()).toEqual(['c', 'd']);
  });

  it('returns all tools as orphaned when no skills are registered', () => {
    expect(findOrphanedTools(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('returns empty when no tools are registered', () => {
    expect(findOrphanedTools([], [mkSkill('s1', ['x'])])).toEqual([]);
  });
});

describe('findDanglingToolRefs', () => {
  it('returns empty when every declared tool is registered', () => {
    const tools = ['a', 'b', 'c'];
    const skills = [mkSkill('s1', ['a', 'b']), mkSkill('s2', ['c'])];
    expect(findDanglingToolRefs(tools, skills)).toEqual([]);
  });

  it('flags a skill that declares a tool not in AGENT_TOOLS (the render_chart bug)', () => {
    // research_qa declared render_chart while it was never registered → silently un-callable.
    const registered = ['query_objects', 'aggregate_objects'];
    const skills = [mkSkill('research_qa', ['query_objects', 'render_chart'])];
    expect(findDanglingToolRefs(registered, skills)).toEqual(['research_qa:render_chart']);
  });

  it('labels each dangling ref by skill so the culprit is obvious', () => {
    const skills = [mkSkill('s1', ['a', 'ghost']), mkSkill('s2', ['ghost'])];
    expect(findDanglingToolRefs(['a'], skills).sort()).toEqual(['s1:ghost', 's2:ghost']);
  });
});
