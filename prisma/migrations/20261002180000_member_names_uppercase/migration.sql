-- Nomes de associados, responsáveis e titulares de conta em MAIÚSCULAS (sem espaços sobrando).
-- translate() cobre letras acentuadas mesmo em bancos com LC_CTYPE "C", onde upper() só trata ASCII.
UPDATE "members"
SET "name" = translate(
  upper(regexp_replace(btrim("name"), '\s+', ' ', 'g')),
  'áàâãäéèêëíìîïóòôõöúùûüçñý',
  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ'
)
WHERE "name" IS DISTINCT FROM translate(
  upper(regexp_replace(btrim("name"), '\s+', ' ', 'g')),
  'áàâãäéèêëíìîïóòôõöúùûüçñý',
  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ'
);

UPDATE "member_guardians"
SET "name" = translate(
  upper(regexp_replace(btrim("name"), '\s+', ' ', 'g')),
  'áàâãäéèêëíìîïóòôõöúùûüçñý',
  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ'
)
WHERE "name" IS DISTINCT FROM translate(
  upper(regexp_replace(btrim("name"), '\s+', ' ', 'g')),
  'áàâãäéèêëíìîïóòôõöúùûüçñý',
  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ'
);

UPDATE "member_accounts"
SET "holder_name" = translate(
  upper(regexp_replace(btrim("holder_name"), '\s+', ' ', 'g')),
  'áàâãäéèêëíìîïóòôõöúùûüçñý',
  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ'
)
WHERE "holder_name" IS DISTINCT FROM translate(
  upper(regexp_replace(btrim("holder_name"), '\s+', ' ', 'g')),
  'áàâãäéèêëíìîïóòôõöúùûüçñý',
  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ'
);
