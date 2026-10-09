import type { DatabaseShape } from '../shared/types';

/** E-mails do associado e dos responsáveis, sem repetição. */
export function emailsOf(db: DatabaseShape, memberId?: string) {
  if (!memberId) return [];
  const member = db.members.find((item) => item.id === memberId);
  const list: { name: string; email: string }[] = [];
  const seen = new Set<string>();
  function add(name: string, email: string) {
    const key = email.trim().toLowerCase();
    if (!key || !key.includes('@') || seen.has(key)) return;
    seen.add(key);
    list.push({ name: name.trim() || member?.name || 'Família', email: key });
  }
  for (const guardian of db.memberGuardians ?? []) {
    if (guardian.memberId === memberId && guardian.email) add(guardian.name, guardian.email);
  }
  if (member?.email) add(member.name, member.email);
  return list;
}

/** Telefones do associado e dos responsáveis, sem repetição. */
export function phonesOf(db: DatabaseShape, memberId?: string) {
  if (!memberId) return [];
  const member = db.members.find((item) => item.id === memberId);
  const list: { name: string; phone: string }[] = [];
  const seen = new Set<string>();
  function add(name: string, phone: string) {
    const digits = phone.replace(/\D/g, '');
    if (!digits || seen.has(digits)) return;
    seen.add(digits);
    list.push({ name: name.trim() || member?.name || 'Família', phone });
  }
  if (member?.phone) add(member.name, member.phone);
  for (const guardian of db.memberGuardians ?? []) {
    if (guardian.memberId === memberId && guardian.phone) add(guardian.name, guardian.phone);
  }
  return list;
}
