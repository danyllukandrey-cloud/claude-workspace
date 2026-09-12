// T10 -- Infra: history repository (write + asOf read), проти РЕАЛЬНОЇ Neon.
// DoD: "repository writes an event and later reads it back via an asOf query
// against the same backend database" -- AC-07/AC-15 (test-plan.md: level
// "integration"). Same convention as migrations.integration.test.ts
// ("structure T1/T2/T26" / "migration 05_create_structure_history_event"
// blocks): plain `pg.Client` against process.env.DATABASE_URL, no ORM.
//
// Docker/Neon network access is unavailable in this sandbox -- this suite is
// expected to fail to even connect (NON-red), not to assert anything wrong.
// The locally-runnable RED for this task is ./src/structure/infra/history-repo.test.ts.
//
// Запуск: npm run test:integration

import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from 'pg';
import type { Db } from './src/structure/infra/postgres-repo';
import { insertHistoryEvent, findHistoryEventsAsOf } from './src/structure/infra/history-repo';

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено (напр. --env-file прокинутий викликачем) -- ігноруємо
  }
});

describe('history-repo -- write + asOf read (T10, AC-07/AC-15) проти реальної Neon', () => {
  it('writes a structure_history_event and later reads it back via an asOf query against the same DB', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const ownerId = crypto.randomUUID();
      const structureId = crypto.randomUUID();
      const cardId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        ownerId,
        `test-t10-${ownerId}`,
        't10@example.test',
      ]);
      try {
        await client.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [structureId, ownerId]);
        await client.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [
          cardId,
          ownerId,
          'T10 history-repo card',
        ]);

        const db: Db = client;
        const written = await insertHistoryEvent(db, {
          id: eventId,
          structureId,
          cardId,
          eventType: 'moved',
          detail: 'cell_index -> 7',
        });
        expect(written.id).toBe(eventId);

        const asOf = new Date(Date.now() + 60_000); // будь-яка мить після запису
        const readBack = await findHistoryEventsAsOf(db, structureId, asOf);

        expect(readBack.map((e) => e.id)).toContain(eventId);
        expect(readBack.find((e) => e.id === eventId)).toMatchObject({
          structureId,
          cardId,
          eventType: 'moved',
          detail: 'cell_index -> 7',
        });
      } finally {
        await client.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає structure/card/structure_history_event
      }
    } finally {
      await client.end();
    }
  });

  it('an asOf point before the event occurred does not read it back yet (trend needs the log, not a snapshot)', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const ownerId = crypto.randomUUID();
      const structureId = crypto.randomUUID();
      const cardId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      await client.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
        ownerId,
        `test-t10-before-${ownerId}`,
        't10-before@example.test',
      ]);
      try {
        await client.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [structureId, ownerId]);
        await client.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [
          cardId,
          ownerId,
          'T10 before-asOf card',
        ]);

        const db: Db = client;
        await insertHistoryEvent(db, {
          id: eventId,
          structureId,
          cardId,
          eventType: 'renamed',
          detail: 'старе -> нове',
        });

        const asOfBefore = new Date('2020-01-01T00:00:00Z');
        const readBack = await findHistoryEventsAsOf(db, structureId, asOfBefore);

        expect(readBack.find((e) => e.id === eventId)).toBeUndefined();
      } finally {
        await client.query('DELETE FROM app_user WHERE id = $1', [ownerId]);
      }
    } finally {
      await client.end();
    }
  });
});
