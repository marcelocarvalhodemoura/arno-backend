import { createProject, listProjects, updateProject } from './projects';
import type { DatabaseShape } from '../shared/types';

function emptyDb(): DatabaseShape {
  return {
    members: [],
    memberGuardians: [],
    memberAccounts: [],
    movementTypes: [],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: 'Arno' },
  };
}

describe('projects', () => {
  it('creates a project with generated item ids and lists by year', () => {
    const db = emptyDb();
    const created = createProject(
      db,
      {
        branch: 'escoteiro',
        year: 2026,
        name: 'Jamboree',
        description: 'Orçamento da tropa',
        items: [{ category: 'Inscrição', description: 'Taxa', planned: 2000 }],
      },
      'u1',
    );
    expect(created.items[0].id).toBeTruthy();
    expect(listProjects(db, { year: 2026 })).toHaveLength(1);
    expect(listProjects(db, { year: 2025 })).toHaveLength(0);
    const updated = updateProject(db, created.id, { name: 'Jamboree revisão' }, 'u1');
    expect(updated?.name).toBe('Jamboree revisão');
    expect(updateProject(db, 'missing', { name: 'x' }, 'u1')).toBeNull();
  });
});
