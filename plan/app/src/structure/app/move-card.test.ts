// T12 -- App: moveCard use-case.
// RED (unit level, mocked Db -- test-plan.md маркує AC-08 (drag saves
// immediately) as integration; Docker/Neon недоступні в цьому середовищі,
// тож `move-card.integration.test.ts` лишиться NON-red тут -- цей файл
// робить задачу TDD-водимою локально без реальної БД.
//
// D-131-наступне рішення (Андрій, чат, 2026-09-15): "Пропоную прибрати
// повністю оті клітинки." -- AC-02 (колізія клітинки, D-62) прибрана
// повністю. Позиція -- {x, y} відсотки канви (0-100), перекриття карток
// дозволене.
//
// Той самий mocking-стиль, що й ./update-structure.test.ts: fake `Db.query`
// (vi.fn), маршрутизація за текстом SQL -- жодна з infra-функцій
// (findStructureByOwner/listActiveLayoutPositionsByOwner/updateLayoutPositionXY,
// infra/history-repo.ts insertHistoryEvent) не мокається сама, лише межа `db.query`.
//
// Contract (contracts/openapi.yaml, moveCard, PUT /structure/layout/{cardId}):
// - AC-08: перетягування на будь-яку точку канви зберігається одразу
//   (updateLayoutPositionXY пише новий x/y/positionUpdatedAt).
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
  x: number | null,
  y: number | null,
  overrides: Partial<{ positionUpdatedAt: string; status: 'active' | 'closed' }> = {},
) {
  return {
    id: `position-${cardId}`,
    structure_id: STRUCTURE_ID,
    card_id: cardId,
    position_x: x,
    position_y: y,
    status: overrides.status ?? ('active' as const),
    position_updated_at: overrides.positionUpdatedAt
      ? new Date(overrides.positionUpdatedAt)
      : new Date('2026-01-02T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/**
 * Підроблена база -- маршрутизує за текстом SQL, той самий стиль, що
 * ./update-structure.test.ts. `activePositions` -- активні позиції власника;
 * `moved` -- рядок, який має повернути UPDATE (симулює SQL-фільтр card_id/status).
 */
function fakeDb(opts: {
  activePositions: ReturnType<typeof positionRow>[];
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

describe('moveCard -- AC-08: перетягування зберігається одразу', () => {
  it('persists the new x/y/positionUpdatedAt and returns the updated position', async () => {
    const current = positionRow(CARD_ID, 20, 30, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const moved = positionRow(CARD_ID, 65, 80, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [current], moved });

    const result = await moveCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      x: 65,
      y: 80,
      positionUpdatedAt: '2026-01-05T00:00:00Z',
    });

    expect(result.x).toBe(65);
    expect(result.y).toBe(80);
  });

  it('clamps an out-of-range x/y into 0..100 before writing (no collision left to block it)', async () => {
    const current = positionRow(CARD_ID, 20, 30, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const moved = positionRow(CARD_ID, 100, 0, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [current], moved });

    await moveCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      x: 140,
      y: -20,
      positionUpdatedAt: '2026-01-05T00:00:00Z',
    });

    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    const update = calls.find(([text]) => text.includes('structure_layout_position') && text.trim().toUpperCase().startsWith('UPDATE'))!;
    const [, params] = update;
    expect(params?.[0]).toBe(100);
    expect(params?.[1]).toBe(0);
  });

  it('records a "moved" history event on success (AC-15)', async () => {
    const current = positionRow(CARD_ID, 20, 30, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const moved = positionRow(CARD_ID, 65, 80, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [current], moved });

    await moveCard(db, { ownerUserId: OWNER, cardId: CARD_ID, x: 65, y: 80, positionUpdatedAt: '2026-01-05T00:00:00Z' });

    const inserts = historyInsertCalls(db);
    expect(inserts).toHaveLength(1);
    const [, params] = inserts[0] as [string, unknown[]];
    expect(params).toContain(CARD_ID);
    expect(params).toContain('moved');
  });

  it('writes a `detail` carrying both the destination and the origin x/y', async () => {
    const current = positionRow(CARD_ID, 20, 30, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const moved = positionRow(CARD_ID, 65, 80, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [current], moved });

    await moveCard(db, { ownerUserId: OWNER, cardId: CARD_ID, x: 65, y: 80, positionUpdatedAt: '2026-01-05T00:00:00Z' });

    const [, params] = historyInsertCalls(db)[0] as [string, unknown[]];
    const detail = params[4] as string;

    expect(detail).toMatch(/pos_x\s*->\s*65/);
    expect(detail).toMatch(/pos_y\s*->\s*80/);
    expect(detail).toMatch(/prev_x\s*->\s*20/);
    expect(detail).toMatch(/prev_y\s*->\s*30/);
  });

  it('never invents a previous position for a card coming from the unplaced tray (x/y NULL)', async () => {
    const fromTray = positionRow(CARD_ID, null, null, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const moved = positionRow(CARD_ID, 40, 40, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [fromTray], moved });

    await moveCard(db, { ownerUserId: OWNER, cardId: CARD_ID, x: 40, y: 40, positionUpdatedAt: '2026-01-05T00:00:00Z' });

    const [, params] = historyInsertCalls(db)[0] as [string, unknown[]];
    const detail = params[4] as string;

    expect(detail).toMatch(/pos_x\s*->\s*40/);
    expect(detail).toMatch(/prev_x\s*->\s*none/);
    expect(detail).toMatch(/prev_y\s*->\s*none/);
  });
});

describe('moveCard -- last-write-wins за positionUpdatedAt (ADR-0002, edge case з test-plan.md)', () => {
  it('a stale write (earlier positionUpdatedAt than what is already stored) is silently superseded -- no error, no write', async () => {
    const current = positionRow(CARD_ID, 20, 30, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [current] });

    const result = await moveCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      x: 90,
      y: 10,
      positionUpdatedAt: '2026-01-02T00:00:00Z', // раніше за вже збережене 2026-01-05
    });

    // Переможець -- вже збережена позиція, не запит, що прийшов пізніше по мережі.
    expect(result.x).toBe(20);
    expect(result.y).toBe(30);

    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const writes = calls.filter(([text]) => /^(UPDATE|INSERT)/i.test(text.trim()));
    expect(writes).toHaveLength(0);
  });
});

describe('moveCard -- AC-03: не існуюча / чужа картка (non-disclosure)', () => {
  it('rejects with structure.card_not_found when the card has no active position for this owner', async () => {
    const db = fakeDb({ activePositions: [] });

    await expect(
      moveCard(db, { ownerUserId: OWNER, cardId: 'ghost-card', x: 10, y: 10, positionUpdatedAt: '2026-01-05T00:00:00Z' }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      moveCard(db, { ownerUserId: OWNER, cardId: 'ghost-card', x: 10, y: 10, positionUpdatedAt: '2026-01-05T00:00:00Z' }),
    ).rejects.toMatchObject({ code: 'structure.card_not_found', httpStatus: 404 });
  });
});
