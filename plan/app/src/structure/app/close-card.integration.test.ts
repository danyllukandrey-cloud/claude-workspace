// T13 -- App: closeCard use-case, integration level (test-plan.md: AC-12 --
// "integration", DoD tracker.md T13; unit level covered in
// ./close-card.test.ts).
//
// Проти РЕАЛЬНОЇ Neon (server/db.ts createDb(), ADR-0006) -- та сама
// конвенція, що ../update-structure.integration.test.ts уже використовує.
// Docker відсутній у цьому середовищі, DATABASE_URL_POOLED/.env теж (root
// .env недоступний тут) -- очікується NON-red (createDb() кине одразу в
// beforeAll, чи запит впаде на мережі), не GOOD red; unit-рівневий тест
// поруч (close-card.test.ts) лишається джерелом TDD-циклу локально.
//
// DoD (tracker.md T13): close marks the position closed, records a closed
// history event; optional metric transfers delegate to life-area-card
// without touching Structure's own tables.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closeCard } from './close-card';
import { createDb, type DbWithTransaction } from '../../../server/db';

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено (напр. --env-file прокинутий викликачем) -- ігноруємо
  }
});

describe('closeCard (integration) -- AC-12/AC-15 проти реальної Neon', () => {
  let db: DbWithTransaction;
  let ownerId: string;
  let structureId: string;
  let cardId: string;

  beforeAll(async () => {
    db = createDb();

    ownerId = crypto.randomUUID();
    await db.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerId,
      `test-t13-${ownerId}`,
      't13@example.test',
    ]);

    structureId = crypto.randomUUID();
    await db.query(
      "INSERT INTO structure (id, owner_user_id, layout_mode) VALUES ($1, $2, 'free')",
      [structureId, ownerId]
    );

    cardId = crypto.randomUUID();
    await db.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [
      cardId,
      ownerId,
      'T13 card',
    ]);
    await db.query(
      'INSERT INTO structure_layout_position (id, structure_id, card_id, cell_index) VALUES ($1, $2, $3, 0)',
      [crypto.randomUUID(), structureId, cardId]
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає structure/structure_layout_position/structure_history_event
    await db.end();
  });

  it('marks the position closed and records a "closed" history event', async () => {
    await closeCard(db, { ownerUserId: ownerId, cardId });

    const { rows: positions } = await db.query<{ status: string }>(
      'SELECT status FROM structure_layout_position WHERE structure_id = $1 AND card_id = $2',
      [structureId, cardId]
    );
    expect(positions[0].status).toBe('closed');

    const { rows: events } = await db.query<{ event_type: string; card_id: string }>(
      "SELECT event_type, card_id FROM structure_history_event WHERE structure_id = $1 AND card_id = $2 AND event_type = 'closed'",
      [structureId, cardId]
    );
    expect(events).toHaveLength(1);
  });
});
