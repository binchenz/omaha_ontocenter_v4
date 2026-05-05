import { findOrphanedTools } from '../find-orphaned-tools';
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
