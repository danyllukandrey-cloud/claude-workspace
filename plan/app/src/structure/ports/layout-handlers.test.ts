// T16 -- Ports: GET /structure/layout + GET /structure/layout/history handlers.
// RED (unit level, mocked Db -- test-plan.md маркує AC-01 і AC-07 як integration
// (справжній Postgres); Docker/Neon недоступні в цьому середовищі, тож
// повноцінний integration-рівень лишається NON-red тут -- цей файл робить
// задачу TDD-водимою локально без реальної БД, той самий підхід, що
// ../../cards/life-area-card/ports/card-handlers.test.ts (fake `Db.query`,
// маршрутизація за текстом SQL, use-case/domain-шар лишається справжнім) і
// ./structure-handlers.test.ts (T15, той самий модуль ports/).
//
// Contract (contracts/openapi.yaml):
// - GET /api/v1/structure/layout (listLayoutPositions): LayoutPositionPage
//   (items + has_next + has_prev + next_cursor), cursor `after` + `limit`
//   (1..100, default 50) -- той самий пагінаційний контракт, що
//   card-handlers.ts's listCards (T21), лише інший ресурс.
// - GET /api/v1/structure/layout/history (getLayoutHistoryAsOf): те саме
//   LayoutPositionPage, реконструйоване "на момент часу" з
//   structure_history_event (AC-07, той самий `parsePastCellIndex`-підхід,
//   що вже встановлений у ../app/get-analytics.ts). 422
//   structure.invalid_as_of -- asOf відсутній, невалідний ISO 8601, або в
//   майбутньому -- перевірено ДО будь-якого запиту в базу (той самий
//   validate-first підхід, що structure-handlers.ts's updateStructure).

import { describe, it, expect, vi } from 'vitest';
import { listLayoutPositions, getLayoutHistoryAsOf } from './layout-handlers';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';

function positionRow(
  overrides: Partial<{
    id: string;
    structure_id: string;
    card_id: string;
    cell_index: number;
    status: 'active' | 'closed';
    position_updated_at: Date;
    created_at: Date;
  }> = {}
) {
  return {
    id: overrides.id ?? 'position-1',
    structure_id: overrides.structure_id ?? STRUCTURE_ID,
    card_id: overrides.card_id ?? 'card-1',
    cell_index: overrides.cell_index ?? 0,
    status: overrides.status ?? 'active',
    position_updated_at: overrides.position_updated_at ?? new Date('2026-01-01T00:00:00Z'),
    created_at: overrides.created_at ?? new Date('2026-01-01T00:00:00Z'),
  };
}

// --- listLayoutPositions -- GET /api/v1/structure/layout -------------------

function fakeListLayoutDb(rows: ReturnType<typeof positionRow>[]): Db {
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    if (text.includes('structure_layout_position')) {
      expect(params).toContain(OWNER);
      return { rows };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('listLayoutPositions handler', () => {
  // Happy path -- контракт LayoutPositionPage, форма кожного елемента точно
  // components.schemas.LayoutPosition (camelCase, positionUpdatedAt як ISO-рядок).
  it('returns every active position as a LayoutPositionPage matching the contract shape', async () => {
    const db = fakeListLayoutDb([
      positionRow({ card_id: 'card-1', cell_index: 0 }),
      positionRow({ id: 'position-2', card_id: 'card-2', cell_index: 1 }),
    ]);

    const page = await listLayoutPositions(db, OWNER, {});

    expect(page).toEqual({
      items: [
        { cardId: 'card-1', cellIndex: 0, status: 'active', positionUpdatedAt: expect.any(String) },
        { cardId: 'card-2', cellIndex: 1, status: 'active', positionUpdatedAt: expect.any(String) },
      ],
      has_next: false,
      has_prev: false,
      next_cursor: null,
    });
  });

  // Cursor pagination -- `limit` обмежує сторінку, `has_next`/`next_cursor`
  // сигналізують, що є ще, той самий контракт, що CardPage (card-handlers.ts).
  it('paginates with limit and reports has_next + next_cursor when more remain', async () => {
    const db = fakeListLayoutDb([
      positionRow({ card_id: 'card-1', cell_index: 0 }),
      positionRow({ id: 'position-2', card_id: 'card-2', cell_index: 1 }),
      positionRow({ id: 'position-3', card_id: 'card-3', cell_index: 2 }),
    ]);

    const page = await listLayoutPositions(db, OWNER, { limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].cardId).toBe('card-1');
    expect(page.has_next).toBe(true);
    expect(page.has_prev).toBe(false);
    expect(page.next_cursor).not.toBeNull();
  });

  // `after` продовжує з наступного елемента за курсором -- не з початку.
  it('resumes after the given cursor instead of restarting from the top', async () => {
    const db = fakeListLayoutDb([
      positionRow({ card_id: 'card-1', cell_index: 0 }),
      positionRow({ id: 'position-2', card_id: 'card-2', cell_index: 1 }),
      positionRow({ id: 'position-3', card_id: 'card-3', cell_index: 2 }),
    ]);

    const firstPage = await listLayoutPositions(db, OWNER, { limit: 1 });
    const secondPage = await listLayoutPositions(db, OWNER, { after: firstPage.next_cursor!, limit: 1 });

    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].cardId).toBe('card-2');
    expect(secondPage.has_prev).toBe(true);
  });
});

// --- getLayoutHistoryAsOf -- GET /api/v1/structure/layout/history ----------

function fakeHistoryDb(opts: {
  structure?: ReturnType<typeof positionRow> extends never ? never : { id: string; owner_user_id: string } | null;
  historyRows?: unknown[];
}): Db {
  const query = vi.fn(async (text: string) => {
    if (text.trim().toUpperCase().startsWith('SELECT') && text.includes('FROM structure') && !text.includes('structure_history_event') && !text.includes('structure_layout_position')) {
      return { rows: opts.structure === null || opts.structure === undefined ? [] : [opts.structure] };
    }
    if (text.includes('structure_history_event')) {
      return { rows: opts.historyRows ?? [] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('getLayoutHistoryAsOf handler', () => {
  // 422 structure.invalid_as_of -- майбутня мітка часу, перевірено ДО
  // будь-якого запиту в базу (AC-07's DoD: "validates asOf is a past timestamp").
  it('rejects a future asOf with 422 structure.invalid_as_of before any query', async () => {
    const db = fakeHistoryDb({ historyRows: [] });
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const error = await getLayoutHistoryAsOf(db, OWNER, future).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'structure.invalid_as_of', httpStatus: 422 });
    expect(db.query).not.toHaveBeenCalled();
  });

  // 422 structure.invalid_as_of -- невалідний ISO 8601, той самий код і
  // статус, той самий validate-first порядок.
  it('rejects a malformed asOf with 422 structure.invalid_as_of before any query', async () => {
    const db = fakeHistoryDb({ historyRows: [] });

    const error = await getLayoutHistoryAsOf(db, OWNER, 'not-a-timestamp').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'structure.invalid_as_of', httpStatus: 422 });
    expect(db.query).not.toHaveBeenCalled();
  });

  // Happy path (AC-07) -- реконструює розкладку на минулий момент з Літопису,
  // той самий "cell_index -> N" формат `detail`, що ../app/get-analytics.ts
  // (T14) уже використовує для тренду розриву.
  it('reconstructs positions from the history log as of a valid past timestamp', async () => {
    const past = '2026-01-15T00:00:00Z';
    const db = fakeHistoryDb({
      structure: { id: STRUCTURE_ID, owner_user_id: OWNER },
      historyRows: [
        {
          id: 'event-1',
          structure_id: STRUCTURE_ID,
          card_id: 'card-1',
          event_type: 'moved',
          detail: 'cell_index -> 5',
          occurred_at: new Date('2026-01-10T00:00:00Z'),
        },
      ],
    });

    const page = await getLayoutHistoryAsOf(db, OWNER, past);

    expect(page.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ cardId: 'card-1', cellIndex: 5 })])
    );
  });
});
