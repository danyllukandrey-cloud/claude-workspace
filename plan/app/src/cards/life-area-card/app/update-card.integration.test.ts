// T28 -- App: updateCard's rename -> Structure-history 'renamed' event,
// integration level (AC-15, D-103/D-115, closes ISS-105).
//
// tracker.md T28 DoD: "life-area-card's updateCard writes a 'renamed'
// structure_history_event via an injected recordCardRenameEvent ...
// Integration-level round-trip against a real backend Postgres is NOT YET
// verified -- run npm run test:integration next session before considering
// AC-15 fully closed." Written that session; run here for the first time.
//
// Проти РЕАЛЬНОЇ Neon (server/db.ts createDb(), ADR-0006) -- та сама
// конвенція, що вже використовує ./../../../structure/app/move-card.integration.test.ts.
// Docker/DATABASE_URL_POOLED відсутні в пісочниці -- очікується NON-red
// (createDb() кине одразу в beforeAll), не GOOD red; юніт-рівневий тест
// (update-card.test.ts) лишається джерелом TDD-циклу локально.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { updateCard } from './update-card';
import { recordCardRenameEvent } from '../../../structure/infra/history-repo';
import { createDb, type DbWithTransaction } from '../../../../server/db';

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено (напр. --env-file прокинутий викликачем) -- ігноруємо
  }
});

describe('updateCard (integration) -- AC-15/D-115 проти реальної Neon', () => {
  let db: DbWithTransaction;
  let ownerId: string;
  let structureId: string;
  let renamedCardId: string;
  let unchangedCardId: string;

  beforeAll(async () => {
    db = createDb();

    ownerId = crypto.randomUUID();
    await db.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerId,
      `test-t28-${ownerId}`,
      't28@example.test',
    ]);

    structureId = crypto.randomUUID();
    await db.query('INSERT INTO structure (id, owner_user_id) VALUES ($1, $2)', [structureId, ownerId]);

    renamedCardId = crypto.randomUUID();
    await db.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [
      renamedCardId,
      ownerId,
      'T28 стара назва',
    ]);

    unchangedCardId = crypto.randomUUID();
    await db.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [
      unchangedCardId,
      ownerId,
      'T28 незмінна назва',
    ]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає card/structure/structure_history_event
    await db.end();
  });

  it('renaming a card writes a "renamed" structure_history_event with the new name as detail (AC-15)', async () => {
    const updated = await updateCard(db, { ownerUserId: ownerId, cardId: renamedCardId, name: 'T28 нова назва' }, recordCardRenameEvent);

    expect(updated.name).toBe('T28 нова назва');

    const { rows } = await db.query<{ event_type: string; card_id: string; detail: string | null }>(
      "SELECT event_type, card_id, detail FROM structure_history_event WHERE structure_id = $1 AND card_id = $2 AND event_type = 'renamed'",
      [structureId, renamedCardId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ card_id: renamedCardId, detail: 'T28 нова назва' });
  });

  it('calling updateCard with the SAME name does not write a rename event (use-case guard, not a real rename)', async () => {
    await updateCard(db, { ownerUserId: ownerId, cardId: unchangedCardId, name: 'T28 незмінна назва' }, recordCardRenameEvent);

    const { rows } = await db.query(
      "SELECT id FROM structure_history_event WHERE structure_id = $1 AND card_id = $2 AND event_type = 'renamed'",
      [structureId, unchangedCardId]
    );
    expect(rows).toHaveLength(0);
  });
});
