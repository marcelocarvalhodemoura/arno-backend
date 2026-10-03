-- Novo perfil: super admin (tudo do admin + auditoria de uso).
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('superadmin', 'admin', 'tesoureiro'));
