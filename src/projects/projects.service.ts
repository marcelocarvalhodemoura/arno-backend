import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { createProject, listProjects, updateProject } from './projects';
import { fail, parseDto } from '../shared/http/api';
import { usersById, withAuthors } from '../shared/http/presenters';
import { branch } from '../shared/http/schemas';
import { loadDb, mutate } from '../shared/persistence/finance-store';
import type { BranchId } from '../shared/types';

const projectItemBody = z.object({
  category: z.string(),
  description: z.string(),
  planned: z.number().min(0),
  movementTypeId: z.string().optional(),
});

const createProjectBody = z.object({
  branch,
  year: z.number().int(),
  name: z.string().min(2),
  description: z.string().min(2),
  items: z.array(projectItemBody).default([]),
});

const patchProjectBody = z.object({
  name: z.string().min(2).optional(),
  description: z.string().min(2).optional(),
  items: z
    .array(
      projectItemBody.extend({
        id: z.string().optional(),
      }),
    )
    .optional(),
});

@Injectable()
export class ProjectsService {
  async list(year?: string, branchFilter?: string) {
    const db = await loadDb();
    const users = await usersById();
    const listed = listProjects(db, {
      year: year ? Number(year) : undefined,
      branch: branchFilter as BranchId | undefined,
    });
    return listed.map(({ project, actuals, plannedTotal }) => ({
      ...withAuthors(project, users),
      actuals,
      plannedTotal,
    }));
  }

  async create(body: unknown, userId: string) {
    const data = parseDto(createProjectBody, body);
    return mutate((db) => createProject(db, data, userId));
  }

  async update(id: string, body: unknown, userId: string) {
    const data = parseDto(patchProjectBody, body);
    const updated = await mutate((db) => updateProject(db, id, data, userId));
    if (!updated) fail('Projeto não encontrado', HttpStatus.NOT_FOUND);
    return updated;
  }
}
