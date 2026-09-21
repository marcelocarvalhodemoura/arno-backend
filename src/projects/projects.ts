import { createdAudit, updatedAudit } from '../shared/audit';
import { id } from '../shared/id';
import type { BranchId, DatabaseShape, FinancialProject } from '../shared/types';
import { roundMoney } from '../shared/types';
import { projectActuals } from '../reports/finance';

export type ProjectItemInput = {
  id?: string;
  category: string;
  description: string;
  planned: number;
  movementTypeId?: string;
};

export function listProjects(db: DatabaseShape, filters: { year?: number; branch?: BranchId }) {
  let list = db.projects;
  if (filters.year) list = list.filter((item) => item.year === filters.year);
  if (filters.branch) list = list.filter((item) => item.branch === filters.branch);
  return list.map((project) => ({
    project,
    actuals: projectActuals(db, project.id),
    plannedTotal: roundMoney(project.items.reduce((sum, item) => sum + item.planned, 0)),
  }));
}

export function createProject(
  db: DatabaseShape,
  input: {
    branch: BranchId;
    year: number;
    name: string;
    description: string;
    items: ProjectItemInput[];
  },
  userId: string,
): FinancialProject {
  const project: FinancialProject = {
    id: id(),
    ...input,
    items: input.items.map((item) => ({ ...item, id: id() })),
    ...createdAudit(userId),
  };
  db.projects.push(project);
  return project;
}

export function updateProject(
  db: DatabaseShape,
  projectId: string,
  input: { name?: string; description?: string; items?: ProjectItemInput[] },
  userId: string,
): FinancialProject | null {
  const project = db.projects.find((item) => item.id === projectId);
  if (!project) return null;
  if (input.name) project.name = input.name;
  if (input.description) project.description = input.description;
  if (input.items) {
    project.items = input.items.map((item) => ({
      id: item.id || id(),
      category: item.category,
      description: item.description,
      planned: roundMoney(item.planned),
      movementTypeId: item.movementTypeId,
    }));
  }
  Object.assign(project, updatedAudit(userId));
  return project;
}
