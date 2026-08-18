-- Restricción única (userId, semanaDelDia) en planes_semana: sostiene el
-- upsert de /api/generar-semana (una fila por usuario y semana ISO).
CREATE UNIQUE INDEX "planes_semana_userId_semanaDelDia_key" ON "planes_semana"("userId", "semanaDelDia");
