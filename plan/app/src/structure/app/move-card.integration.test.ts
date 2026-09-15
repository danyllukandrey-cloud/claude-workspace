// T12 -- App: moveCard use-case, integration level (test-plan.md: AC-02/AC-08
// -- "integration"; AC-15's history-event write goes through the same real
// dependency here too, since it is part of moveCard's observable outcome).
//
// Проти РЕАЛЬНОЇ Neon (server/db.ts createDb(), ADR-0006) -- та сама
// конвенція, що вже використовує ./update-structure.integration.test.ts.
// Docker відсутній у цьому середовищі, DATABASE_URL_POOLED/.env теж (root
// .env недоступний тут) -- очікується NON-red (createDb() кине одразу в
// beforeAll, чи запит впаде на мережі), не GOOD red; unit-рівневий тест
// поруч (./move-card.test.ts) лишається джерелом TDD-циклу локально.
//
// DoD (tracker.md T12): move succeeds and records a moved history event;
// collision in logic layout rejected; conflicting timestamp resolves
// last-write-wins.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { moveCard } from './move-card';
import { insertLayoutPosition } from '../infra/postgres-repo';
import { createDb, type DbWithTransaction } from '../../../server/db';

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено (напр. --env-file прокинутий викликачем) -- ігноруємо
  }
});

describe('moveCard (integration) -- AC-02/AC-08/AC-15 проти реальної Neon', () => {
  let db: DbWithTransaction;
  let ownerId: string;
  let structureId: string;
  let cardOneId: string;
  let cardTwoId: string;

  beforeAll(async () => {
    db = createDb();

    ownerId = crypto.randomUUID();
    await db.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      ownerId,
      `test-t12-${ownerId}`,
      't12@example.test',
    ]);

    structureId = crypto.randomUUID();
    // 'logic' скасований разом із logic_variant (вимоги 14/15, плоска
    // модель) -- 'balance' є одним з 5 нових значень, той самий грід-режим.
    await db.query(
      "INSERT INTO structure (id, owner_user_id, layout_mode) VALUES ($1, $2, 'balance')",
      [structureId, ownerId]
    );

    cardOneId = crypto.randomUUID();
    cardTwoId = crypto.randomUUID();
    await db.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [cardOneId, ownerId, 'T12 card one']);
    await db.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [cardTwoId, ownerId, 'T12 card two']);

    // cardOne: insertLayoutPosition (не голий SQL) -- пише сентинел-час
    // (D-117), не дефолт колонки now(). ISS-114: раніше тут був прямий INSERT
    // без position_updated_at, тож щойно створена позиція мала час "зараз" --
    // перший move нижче (тест "moves a card to a free cell") теж рухається з
    // positionUpdatedAt "зараз", і залежно від розбіжності годинників
    // клієнт/Neon (resolvePositionConflict -- `>=`, при рівності перемагає
    // СТАРА позиція) рух міг тихо програти. Той самий клас бага, що D-117 вже
    // виправив у production-коді -- цей тест просто обходив фікс власним
    // прямим INSERT.
    await insertLayoutPosition(db, { id: crypto.randomUUID(), structureId, cardId: cardOneId, cellIndex: 1 });
    // cardTwo: лишається голим INSERT (дефолт now()) -- НАВМИСНО, не той самий
    // фікс. Тест "stale positionUpdatedAt" нижче звіряється з датою 2000 рік,
    // яка мусить бути СТАРІШОЮ за поточну позицію -- сентинел-час (1970) був
    // би СТАРІШИЙ за 2000 рік і зламав би саме цей тест (застарілий запис
    // виглядав би новішим за вже збережену позицію). "now()" тут завжди
    // новіший за рік 2000 незалежно від будь-якої розбіжності годинників.
    await db.query(
      'INSERT INTO structure_layout_position (id, structure_id, card_id, cell_index) VALUES ($1, $2, $3, 2)',
      [crypto.randomUUID(), structureId, cardTwoId]
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM app_user WHERE id = $1', [ownerId]); // каскадно прибирає structure/positions/history
    await db.end();
  });

  it('moves a card to a free cell, persists it, and records a "moved" history event (AC-08, AC-15)', async () => {
    const positionUpdatedAt = new Date().toISOString();

    const result = await moveCard(db, {
      ownerUserId: ownerId,
      cardId: cardOneId,
      cellIndex: 9,
      positionUpdatedAt,
    });

    expect(result.cellIndex).toBe(9);

    const { rows: positionRows } = await db.query<{ cell_index: number }>(
      "SELECT cell_index FROM structure_layout_position WHERE card_id = $1 AND status = 'active'",
      [cardOneId]
    );
    expect(positionRows[0]?.cell_index).toBe(9);

    const { rows: historyRows } = await db.query<{ event_type: string; card_id: string }>(
      "SELECT event_type, card_id FROM structure_history_event WHERE structure_id = $1 AND card_id = $2 AND event_type = 'moved'",
      [structureId, cardOneId]
    );
    expect(historyRows).toHaveLength(1);
  });

  it('rejects moving a card onto a cell already occupied by a different active card (AC-02, D-62)', async () => {
    await expect(
      moveCard(db, { ownerUserId: ownerId, cardId: cardOneId, cellIndex: 2, positionUpdatedAt: new Date().toISOString() })
    ).rejects.toMatchObject({ code: 'structure.cell_occupied' });

    const { rows } = await db.query<{ cell_index: number }>(
      "SELECT cell_index FROM structure_layout_position WHERE card_id = $1 AND status = 'active'",
      [cardTwoId]
    );
    // card-two's position -- незмінена, колізія відхилена до будь-якого запису.
    expect(rows[0]?.cell_index).toBe(2);
  });

  it('a stale positionUpdatedAt (earlier than what is already stored) is superseded silently -- last-write-wins', async () => {
    const staleTimestamp = '2000-01-01T00:00:00.000Z';

    const result = await moveCard(db, {
      ownerUserId: ownerId,
      cardId: cardTwoId,
      cellIndex: 15,
      positionUpdatedAt: staleTimestamp,
    });

    // Переможець лишається вже збереженою позицією (cellIndex 2) -- запит,
    // датований раніше за неї, тихо відкидається, без помилки.
    expect(result.cellIndex).toBe(2);

    const { rows } = await db.query<{ cell_index: number }>(
      "SELECT cell_index FROM structure_layout_position WHERE card_id = $1 AND status = 'active'",
      [cardTwoId]
    );
    expect(rows[0]?.cell_index).toBe(2);
  });

  // D-117 (postgres-repo.ts NEVER_MOVED_SENTINEL comment references THIS file
  // by name): a real client/server clock skew (~54ms measured against dev
  // Neon) made a just-created position look "newer" than the user's very
  // first real move, which was then silently ignored -- fixed by writing an
  // epoch sentinel instead of relying on the column's `now()` default.
  it('a freshly created (never-moved) position can be moved immediately, even with near-zero elapsed time (D-117)', async () => {
    const freshCardId = crypto.randomUUID();
    await db.query('INSERT INTO card (id, owner_user_id, name) VALUES ($1, $2, $3)', [freshCardId, ownerId, 'T12 fresh card (D-117)']);
    // insertLayoutPosition -- the real function D-117 fixed, not a raw SQL
    // INSERT with an unspecified position_updated_at default.
    await insertLayoutPosition(db, { id: crypto.randomUUID(), structureId, cardId: freshCardId, cellIndex: 20 });

    const result = await moveCard(db, {
      ownerUserId: ownerId,
      cardId: freshCardId,
      cellIndex: 21,
      positionUpdatedAt: new Date().toISOString(), // "now", same as the real client would send
    });

    expect(result.cellIndex).toBe(21);

    const { rows } = await db.query<{ cell_index: number }>(
      "SELECT cell_index FROM structure_layout_position WHERE card_id = $1 AND status = 'active'",
      [freshCardId]
    );
    expect(rows[0]?.cell_index).toBe(21);
  });
});
