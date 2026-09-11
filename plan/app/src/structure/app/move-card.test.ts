// T12 -- App: moveCard use-case.
// RED (unit level, mocked Db -- test-plan.md маркує AC-08 (drag saves immediately)
// як integration, AC-02 (колізія клітинки) як integration; Docker/Neon недоступні
// в цьому середовищі, тож `move-card.integration.test.ts` лишиться NON-red тут --
// цей файл робить задачу TDD-водимою локально без реальної БД.
//
// Той самий mocking-стиль, що й ./update-structure.test.ts: fake `Db.query`
// (vi.fn), маршрутизація за текстом SQL -- жодна з infra-функцій
// (findStructureByOwner/listActiveLayoutPositionsByOwner/updateLayoutPositionCell,
// infra/history-repo.ts insertHistoryEvent) не мокається сама, лише межа `db.query`.
//
// Contract (contracts/openapi.yaml, moveCard, PUT /structure/layout/{cardId}):
// - AC-08: перетягування на вільну позицію зберігається одразу
//   (updateLayoutPositionCell пише новий cellIndex/positionUpdatedAt).
// - AC-02 (D-62 -- одна клітинка = одна картка): клітинка вже зайнята ІНШОЮ
//   активною карткою -- 409 structure.cell_occupied, ніхто нікуди не пишеться.
// - AC-15: успішне переміщення записує подію 'moved' у Літопис Структури
//   з тим самим механізмом, що закриття (AC-12) -- structure_history_event.
// - Edge case (test-plan.md §Edge cases): конфліктуюча часова мітка з іншого
//   пристрою -- last-write-wins за positionUpdatedAt (ADR-0002,
//   domain/layout.ts resolvePositionConflict) -- пізніший запис перемагає,
//   ранішній тихо відкидається, БЕЗ помилки й без запису в Літопис.
// - Не існуюча / чужа картка (AC-03, non-disclosure) -- 404
//   structure.card_not_found, той самий код і для "не існує", і для "не моя".

import { describe, it, expect, vi } from 'vitest';
import { moveCard } from './move-card';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';
const CARD_ID = 'card-a';

function positionRow(
  cardId: string,
  cellIndex: number,
  overrides: Partial<{ positionUpdatedAt: string; status: 'active' | 'closed' }> = {},
) {
  return {
    id: `position-${cardId}`,
    structure_id: STRUCTURE_ID,
    card_id: cardId,
    cell_index: cellIndex,
    status: overrides.status ?? ('active' as const),
    position_updated_at: overrides.positionUpdatedAt
      ? new Date(overrides.positionUpdatedAt)
      : new Date('2026-01-02T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/**
 * Підроблена база -- маршрутизує за текстом SQL, той самий стиль, що
 * ./update-structure.test.ts. `activePositions` -- активні позиції всіх
 * карток власника (для перевірки колізії клітинки); `current` -- поточний
 * рядок позиції картки, що рухається (для last-write-wins); `moved` --
 * рядок, який має повернути UPDATE (симулює SQL-фільтр card_id/status).
 */
function fakeDb(opts: {
  activePositions: ReturnType<typeof positionRow>[];
  current: ReturnType<typeof positionRow> | null;
  moved?: ReturnType<typeof positionRow> | null;
}): Db {
  const historyInserts: unknown[][] = [];
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    const sql = text.trim().toUpperCase();

    if (text.includes('structure_history_event') && sql.startsWith('INSERT')) {
      historyInserts.push(params ?? []);
      return {
        rows: [
          {
            id: 'history-1',
            structure_id: STRUCTURE_ID,
            card_id: CARD_ID,
            event_type: 'moved',
            detail: null,
            occurred_at: new Date('2026-01-03T00:00:00Z'),
          },
        ],
      };
    }

    if (text.includes('structure_layout_position') && sql.startsWith('SELECT')) {
      return { rows: opts.activePositions };
    }

    if (text.includes('structure_layout_position') && sql.startsWith('UPDATE')) {
      return { rows: opts.moved ? [opts.moved] : [] };
    }

    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });

  Object.defineProperty(query, 'historyInserts', { value: historyInserts });
  return { query: query as unknown as Db['query'] };
}

function historyInsertCalls(db: Db) {
  const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
  return calls.filter(
    ([text]) => text.includes('structure_history_event') && text.trim().toUpperCase().startsWith('INSERT'),
  );
}

describe('moveCard -- AC-08: перетягування на вільну клітинку зберігається одразу', () => {
  it('persists the new cellIndex/positionUpdatedAt and returns the updated position', async () => {
    const current = positionRow(CARD_ID, 3, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const moved = positionRow(CARD_ID, 7, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [current], current, moved });

    const result = await moveCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      cellIndex: 7,
      positionUpdatedAt: '2026-01-05T00:00:00Z',
    });

    expect(result.cellIndex).toBe(7);
  });

  it('records a "moved" history event on success (AC-15)', async () => {
    const current = positionRow(CARD_ID, 3, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const moved = positionRow(CARD_ID, 7, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [current], current, moved });

    await moveCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      cellIndex: 7,
      positionUpdatedAt: '2026-01-05T00:00:00Z',
    });

    const inserts = historyInsertCalls(db);
    expect(inserts).toHaveLength(1);
    const [, params] = inserts[0] as [string, unknown[]];
    expect(params).toContain(CARD_ID);
    expect(params).toContain('moved');
  });
});

describe('moveCard -- AC-02 (D-62): клітинка вже зайнята іншою карткою блокується', () => {
  it('rejects with structure.cell_occupied and writes nothing', async () => {
    const mover = positionRow(CARD_ID, 3, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const occupant = positionRow('card-b', 7, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const db = fakeDb({ activePositions: [mover, occupant], current: mover });

    await expect(
      moveCard(db, { ownerUserId: OWNER, cardId: CARD_ID, cellIndex: 7, positionUpdatedAt: '2026-01-05T00:00:00Z' }),
    ).rejects.toMatchObject({ code: 'structure.cell_occupied', httpStatus: 409 });

    // Жодного UPDATE ані INSERT -- відхилено ДО будь-якого запису.
    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const writes = calls.filter(([text]) => /^(UPDATE|INSERT)/i.test(text.trim()));
    expect(writes).toHaveLength(0);
  });

  it('moving a card onto the cell it already occupies is a no-op, not a collision', async () => {
    const mover = positionRow(CARD_ID, 7, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const moved = positionRow(CARD_ID, 7, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [mover], current: mover, moved });

    await expect(
      moveCard(db, { ownerUserId: OWNER, cardId: CARD_ID, cellIndex: 7, positionUpdatedAt: '2026-01-05T00:00:00Z' }),
    ).resolves.toMatchObject({ cellIndex: 7 });
  });
});

describe('moveCard -- last-write-wins за positionUpdatedAt (ADR-0002, edge case з test-plan.md)', () => {
  it('a stale write (earlier positionUpdatedAt than what is already stored) is silently superseded -- no error, no write', async () => {
    const current = positionRow(CARD_ID, 3, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [current], current });

    const result = await moveCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      cellIndex: 9,
      positionUpdatedAt: '2026-01-02T00:00:00Z', // раніше за вже збережене 2026-01-05
    });

    // Переможець -- вже збережена позиція, не запит, що прийшов пізніше по мережі.
    expect(result.cellIndex).toBe(3);

    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const writes = calls.filter(([text]) => /^(UPDATE|INSERT)/i.test(text.trim()));
    expect(writes).toHaveLength(0);
  });
});

describe('moveCard -- AC-03: не існуюча / чужа картка (non-disclosure)', () => {
  it('rejects with structure.card_not_found when the card has no active position for this owner', async () => {
    const db = fakeDb({ activePositions: [], current: null });

    await expect(
      moveCard(db, { ownerUserId: OWNER, cardId: 'ghost-card', cellIndex: 1, positionUpdatedAt: '2026-01-05T00:00:00Z' }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      moveCard(db, { ownerUserId: OWNER, cardId: 'ghost-card', cellIndex: 1, positionUpdatedAt: '2026-01-05T00:00:00Z' }),
    ).rejects.toMatchObject({ code: 'structure.card_not_found', httpStatus: 404 });
  });
});
