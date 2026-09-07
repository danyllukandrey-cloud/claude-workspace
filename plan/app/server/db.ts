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

export interface DbWithTransaction extends Db {
  end: () => Promise<void>;
  /**
   * Review 2026-09-07 B5: archiveCard's коментар стверджував "та сама
   * транзакція", але жодного BEGIN/COMMIT ніде не було -- composition root
   * (server/app.ts) отримує тут реальну атомарність для багатокрокових
   * use-case (card status + structure_layout_position, T40/T41).
   *
   * pool.connect() бере ОКРЕМЕ зʼєднання з пулу (не той самий query(), яким
   * ходять прості одноразові запити) -- усередині транзакції всі write мусять
   * іти через ОДНЕ й те саме зʼєднання, інакше Postgres бачить їх як окремі
   * сесії й BEGIN/COMMIT нічого не гарантує. release() -- у finally, тому
   * повертається в пул завжди, і при успіху, і при відкоті.
   */
  withTransaction: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
}

export function createDb(): DbWithTransaction {
  const connectionString = process.env.DATABASE_URL_POOLED;
  if (!connectionString) {
    throw new Error('DATABASE_URL_POOLED не задано (.env, ADR-0006 §Обґрунтування)');
  }

  const pool = new Pool({ connectionString });
  return {
    query: (text, params) => pool.query(text, params),
    end: () => pool.end(),
    withTransaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
