import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  createFee,
  createMovementType,
  deleteFee,
  ensureFees,
  patchSettings,
  updateFee,
  updateMovementType,
} from './catalog';
import { fail, parseDto } from '../shared/http/api';
import { errorMessage } from '../shared/http/errors';
import { usersById, withAuthors } from '../shared/http/presenters';
import { branch, direction } from '../shared/http/schemas';
import { loadDb, mutate } from '../shared/persistence/finance-store';
import { ALL_BRANCHES, resolveMensalidadeDueDay, YOUTH_BRANCHES } from '../shared/types';
import type { AuthPayload } from '../shared/auth/token';

const settingsBody = z.object({
  openingBalance: z.number().optional(),
  groupName: z.string().min(2).optional(),
  mensalidadeDueDay: z.number().int().min(1).max(31).optional(),
});

const createMovementTypeBody = z.object({
  name: z.string().min(2),
  direction,
  description: z.string().optional().default(''),
  pixKey: z.string().optional().default(''),
  branch: branch.optional().default('grupo'),
});

const patchMovementTypeBody = z.object({
  name: z.string().min(2).optional(),
  direction: direction.optional(),
  description: z.string().optional(),
  pixKey: z.string().optional(),
  branch: branch.optional(),
  active: z.boolean().optional(),
});

const createFeeBody = z.object({
  name: z.string().min(2),
  amount: z.number().positive(),
});

const patchFeeBody = z.object({
  name: z.string().min(2).optional(),
  amount: z.number().positive().optional(),
});

@Injectable()
export class CatalogService {
  async getSettings() {
    const settings = (await loadDb()).settings;
    return {
      ...settings,
      mensalidadeDueDay: resolveMensalidadeDueDay(settings.mensalidadeDueDay),
    };
  }

  async updateSettings(body: unknown, auth: AuthPayload) {
    const data = parseDto(settingsBody, body);
    if (auth.role !== 'admin' && (data.openingBalance !== undefined || data.groupName !== undefined)) {
      fail('Só a administração altera o nome do grupo e o saldo inicial', HttpStatus.FORBIDDEN);
    }
    const settings = await mutate((db) => patchSettings(db, data, auth.userId));
    return {
      ...settings,
      mensalidadeDueDay: resolveMensalidadeDueDay(settings.mensalidadeDueDay),
    };
  }

  async listMovementTypes() {
    const users = await usersById();
    return (await loadDb()).movementTypes.map((type) => withAuthors(type, users));
  }

  async createMovementType(body: unknown, userId: string) {
    const data = parseDto(createMovementTypeBody, body);
    try {
      return await mutate((db) => createMovementType(db, data, userId));
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível criar'), HttpStatus.CONFLICT);
    }
  }

  async updateMovementType(id: string, body: unknown, userId: string) {
    const data = parseDto(patchMovementTypeBody, body);
    try {
      const updated = await mutate((db) => updateMovementType(db, id, data, userId));
      if (!updated) fail('Tipo não encontrado', HttpStatus.NOT_FOUND);
      return updated;
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível alterar'), HttpStatus.CONFLICT);
    }
  }

  async listFees(userId: string) {
    await mutate((db) => {
      ensureFees(db, userId);
    });
    const users = await usersById();
    return (await loadDb()).fees.map((fee) => withAuthors(fee, users));
  }

  async createFee(body: unknown, userId: string) {
    const data = parseDto(createFeeBody, body);
    try {
      return await mutate((db) => createFee(db, data, userId));
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível criar'), HttpStatus.CONFLICT);
    }
  }

  async updateFee(id: string, body: unknown, userId: string) {
    const data = parseDto(patchFeeBody, body);
    try {
      const updated = await mutate((db) => updateFee(db, id, data, userId));
      if (!updated) fail('Taxa não encontrada', HttpStatus.NOT_FOUND);
      return updated;
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível alterar'), HttpStatus.CONFLICT);
    }
  }

  async deleteFee(id: string) {
    const removed = await mutate((db) => deleteFee(db, id));
    if (!removed) fail('Taxa não encontrada', HttpStatus.NOT_FOUND);
  }

  meta() {
    return {
      branches: YOUTH_BRANCHES,
      allBranches: ALL_BRANCHES,
    };
  }
}
