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

  // Review 2026-09-11, MUST-FIX 2: подія 'moved' писалась БЕЗ detail (завжди
  // null), а обидва читачі цього поля -- ../app/get-analytics.ts (тренд
  // розриву, AC-07) і ../ports/layout-handlers.ts (GET /structure/layout/
  // history) -- шукають у ньому клітинку регуляркою. Без detail тренд
  // назавжди null, а історія розкладки назавжди порожня: фіча зелена в
  // тестах (вони підкладали detail рукою) і мертва на реальних даних.
  // Регулярки нижче СКОПІЙОВАНІ з обох читачів дослівно -- саме вони, а не
  // наша уява про формат, визначають, чи рядок сумісний.
  const READER_CELL_INDEX_PATTERN = /cell_index\s*->\s*(-?\d+)/;
  const FROM_CELL_INDEX_PATTERN = /from_cell_index\s*->\s*(-?\d+)/;

  it('writes a `detail` the real readers can parse -- the cell the card moved TO, plus where it came FROM', async () => {
    const current = positionRow(CARD_ID, 3, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const moved = positionRow(CARD_ID, 7, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [current], current, moved });

    await moveCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      cellIndex: 7,
      positionUpdatedAt: '2026-01-05T00:00:00Z',
    });

    const [, params] = historyInsertCalls(db)[0] as [string, unknown[]];
    // insertHistoryEvent: (id, structure_id, card_id, event_type, detail)
    const detail = params[4] as string | null;

    expect(detail).not.toBeNull();
    // Перше входження шаблону читачів мусить дати КУДИ картка стала (7) --
    // саме це означає "якою була розкладка на цей момент" для
    // GET /structure/layout/history.
    expect(detail!.match(READER_CELL_INDEX_PATTERN)?.[1]).toBe('7');
    // І звідки вона прийшла (3) -- окремим, власним токеном, щоб тренд
    // (AC-07) мав ДРУГУ точку, відмінну від поточної позиції.
    expect(detail!.match(FROM_CELL_INDEX_PATTERN)?.[1]).toBe('3');
  });

  it('keeps the destination token FIRST -- `from_cell_index` contains the substring `cell_index`', async () => {
    // Пастка порядку: шаблон читачів не має межі слова, тож якби "звідки"
    // стояло першим, регулярка прочитала б його як "куди" і історія показала
    // б картку в клітинці, яку вона вже залишила.
    const current = positionRow(CARD_ID, 0, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const moved = positionRow(CARD_ID, 12, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [current], current, moved });

    await moveCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      cellIndex: 12,
      positionUpdatedAt: '2026-01-05T00:00:00Z',
    });

    const [, params] = historyInsertCalls(db)[0] as [string, unknown[]];
    const detail = params[4] as string;

    expect(detail.indexOf('cell_index')).toBeLessThan(detail.indexOf('from_cell_index'));
    expect(detail.match(READER_CELL_INDEX_PATTERN)?.[1]).toBe('12');
    expect(detail.match(FROM_CELL_INDEX_PATTERN)?.[1]).toBe('0');
  });

  it('never invents a previous cell for a card coming from the unplaced tray (cell_index NULL)', async () => {
    // Міграція 06 зробила cell_index nullable ("картка без клітинки", трей
    // нерозкладених -- AC-11b/AC-16b/AC-17), тож перший рух картки з треї не
    // має "звідки". Нуль тут був би не просто неточністю, а брехнею: нуль --
    // це найвищий пріоритет у розкладці.
    // `null as unknown as number` -- бо LayoutPositionRecord.cellIndex поки
    // типізований як number, хоч колонка вже nullable (явно відкрите питання
    // в infra/postgres-repo.ts, WP2).
    const fromTray = positionRow(CARD_ID, null as unknown as number, { positionUpdatedAt: '2026-01-02T00:00:00Z' });
    const moved = positionRow(CARD_ID, 5, { positionUpdatedAt: '2026-01-05T00:00:00Z' });
    const db = fakeDb({ activePositions: [fromTray], current: fromTray, moved });

    await moveCard(db, {
      ownerUserId: OWNER,
      cardId: CARD_ID,
      cellIndex: 5,
      positionUpdatedAt: '2026-01-05T00:00:00Z',
    });

    const [, params] = historyInsertCalls(db)[0] as [string, unknown[]];
    const detail = params[4] as string;

    expect(detail.match(READER_CELL_INDEX_PATTERN)?.[1]).toBe('5'); // куди -- відомо
    expect(detail.match(FROM_CELL_INDEX_PATTERN)).toBeNull(); // звідки -- числа немає
    expect(detail).not.toMatch(/from_cell_index\s*->\s*0/);
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
