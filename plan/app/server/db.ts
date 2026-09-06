// Реальний pg.Pool для composition root (T30, ADR-0006 §Обґрунтування,
// "Підключення до Neon розділяється навмисно").
//
// Застосунок ходить ПУЛЬОВАНИМ DATABASE_URL_POOLED (PgBouncer transaction-режим,
// Neon) -- НЕ тим самим непульованим DATABASE_URL, яким ходять міграції
// (scripts/promote-migrations.mjs + node-pg-migrate, package.json). Змішувати
// не можна: pooled-ендпоінт ламає сесійні блокування, потрібні мігратору.
//
// Задовольняє мінімальний контракт Db з postgres-repo.ts (лише .query) --
// pg.Pool підходить без додаткової обгортки.

import { Pool } from 'pg';
import type { Db } from '../src/cards/life-area-card/infra/postgres-repo';

export function createDb(): Db & { end: () => Promise<void> } {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) {
    throw new Error('DATABASE_URL_POOLED не задано (.env, ADR-0006 §Обґрунтування)');
  }

  const pool = new Pool({ connectionString });
  return {
    query: (text, params) => pool.query(text, params),
    end: () => pool.end(),
  };
}
