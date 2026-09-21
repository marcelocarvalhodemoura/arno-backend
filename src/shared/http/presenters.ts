import { listUsers } from '../../identity/users';
import type { AppUser } from '../types';

export function authorOf(users: Map<string, AppUser>, userId?: string) {
  if (!userId) return null;
  const user = users.get(userId);
  return {
    id: userId,
    name: user?.name ?? 'Usuário removido',
    username: user?.username ?? '',
  };
}

export function withAuthors<T extends { createdBy?: string; updatedBy?: string }>(
  record: T,
  users: Map<string, AppUser>,
) {
  return {
    ...record,
    createdByUser: authorOf(users, record.createdBy),
    updatedByUser: authorOf(users, record.updatedBy),
  };
}

export async function usersById() {
  return new Map((await listUsers()).map((user) => [user.id, user]));
}
