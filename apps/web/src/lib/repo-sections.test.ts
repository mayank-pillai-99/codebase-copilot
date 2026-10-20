import { describe, expect, it } from 'vitest';
import { activeSection, repoSections } from './repo-sections';

const id = '11111111-2222-3333-4444-555555555555';

describe('repoSections', () => {
  it('starts with the guide at the repository root', () => {
    const [first] = repoSections(id);
    expect(first).toEqual({ id: 'guide', href: `/repos/${id}`, label: 'Guide' });
  });
});

describe('activeSection', () => {
  it('matches the guide only on the repository root', () => {
    expect(activeSection(id, `/repos/${id}`)).toBe('guide');
    expect(activeSection(id, `/repos/${id}/`)).toBe('guide');
    expect(activeSection(id, `/repos/${id}/code`)).not.toBe('guide');
  });

  it('matches a section and anything below it', () => {
    expect(activeSection(id, `/repos/${id}/code`)).toBe('code');
    expect(activeSection(id, `/repos/${id}/routes/abc`)).toBe('routes');
    expect(activeSection(id, `/repos/${id}/chat`)).toBe('chat');
  });

  it('does not match a section whose name is only a prefix', () => {
    expect(activeSection(id, `/repos/${id}/codex`)).toBeNull();
    expect(activeSection(id, `/repos/other/code`)).toBeNull();
  });
});
