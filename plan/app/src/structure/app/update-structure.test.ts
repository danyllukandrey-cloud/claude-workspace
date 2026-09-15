// T11 -- App: updateStructure use-case.
// RED (unit level, mocked Db -- test-plan.md маркує AC-10 як unit,
// AC-11/AC-11b як integration; Docker/Neon недоступні в цьому середовищі,
// тож `update-structure.integration.test.ts` лишиться NON-red тут -- цей файл
// робить задачу TDD-водимою локально без реальної БД).
//
// Той самий mocking-стиль, що й ../../cards/life-area-card/app/update-card.test.ts:
// fake `Db.query` (vi.fn), маршрутизація за текстом SQL -- postgres-repo.ts
// (findStructureByOwner/updateStructure/listActiveLayoutPositionsByOwner) не
// мокається сам, лише межа `db.query`.
//
// Contract (contracts/openapi.yaml, updateMyStructure):
// - AC-10: declaration/layoutMode -- незалежні поля одного PATCH.
// - AC-11/AC-11b: layoutMode -> НОВЕ значення (будь-яке з 5 плоских значень,
//   вимоги 14/15) -> кожна активна позиція скидається в базовий порядок (той
//   самий запис, той самий викорінений patch, у тій самій дії use-case --
//   реальна атомарність транзакції перевіряється лише на integration-рівні,
//   тут -- сам факт, що use-case видає ці записи, коли й лише коли режим
//   реально змінився).
// - Запис, що не змінює layoutMode -- жодного reset-запиту.
// - Плоска модель прибрала logicVariant і обидва колишні інваріанти AC-16/
//   AC-16b разом з ним -- перемикання між колишніми підвидами тепер звичайна
//   зміна layoutMode.

import { describe, it, expect, vi } from 'vitest';
import { updateStructure } from './update-structure';
import type { Db } from '../infra/postgres-repo';
import type { LayoutModeRow } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';

function structureRow(
  overrides: Partial<{
    declaration: string | null;
    layout_mode: LayoutModeRow | null;
  }> = {}
) {
  return {
    id: STRUCTURE_ID,
    owner_user_id: OWNER,
    declaration: overrides.declaration ?? null,
    layout_mode: overrides.layout_mode ?? null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

function positionRow(cardId: string, cellIndex: number) {
  return {
    id: `position-${cardId}`,
    structure_id: STRUCTURE_ID,
    card_id: cardId,
    cell_index: cellIndex,
    status: 'active' as const,
    position_updated_at: new Date('2026-01-02T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/**
 * Підроблена база -- маршрутизує запит за текстом SQL до потрібного
 * канонічного рядка, як і update-card.test.ts. Розрізняє SELECT/UPDATE над
 * `structure` від SELECT/UPDATE над `structure_layout_position` за
 * підрядком таблиці, не лише префіксом дієслова.
 */
function fakeDb(opts: {
  current: ReturnType<typeof structureRow> | null;
  updated?: ReturnType<typeof structureRow>;
  activePositions?: ReturnType<typeof positionRow>[];
}): Db {
  const query = vi.fn(async (text: string, _params?: unknown[]) => {
    if (text.includes('structure_layout_position') && text.trim().toUpperCase().startsWith('SELECT')) {
      return { rows: opts.activePositions ?? [] };
    }
    if (text.includes('structure_layout_position') && text.trim().toUpperCase().startsWith('UPDATE')) {
      return { rows: [] };
    }
    if (text.trim().toUpperCase().startsWith('SELECT')) {
      return { rows: opts.current ? [opts.current] : [] };
    }
    if (text.trim().toUpperCase().startsWith('UPDATE')) {
      return { rows: opts.updated ? [opts.updated] : [] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

/** Усі виклики db.query, чий SQL торкається structure_layout_position. */
function layoutResetCalls(db: Db) {
  const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
  return calls.filter(([text]) => text.includes('structure_layout_position') && text.trim().toUpperCase().startsWith('UPDATE'));
}

/** Єдиний UPDATE самого рядка `structure` (не позицій розкладки). */
function structureUpdateCall(db: Db): [string, unknown[]?] {
  const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
  const found = calls.filter(
    ([text]) => text.trim().toUpperCase().startsWith('UPDATE') && !text.includes('structure_layout_position')
  );
  expect(found).toHaveLength(1);
  return found[0];
}

describe('updateStructure -- AC-10: декларація окремо від layoutMode', () => {
  it('saves declaration alone -- layoutMode is not touched and no reset fires', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'free', declaration: "картина світу" }),
      activePositions: [positionRow('card-1', 0)],
    });

    const result = await updateStructure(db, { ownerUserId: OWNER, declaration: "картина світу" });

    expect(result.declaration).toBe("картина світу");
    expect(result.layoutMode).toBe('free');
    // Жодного запиту, що читає/чіпає розкладку -- decl-only patch не рухає позиції.
    expect(layoutResetCalls(db)).toHaveLength(0);
  });
});

describe('updateStructure -- AC-11: обрати режим розкладки застосовує його надалі', () => {
  it('persists the chosen layoutMode', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: null }),
      updated: structureRow({ layout_mode: 'free' }),
      activePositions: [],
    });

    const result = await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'free' });

    expect(result.layoutMode).toBe('free');
  });

  it('a PATCH repeating the already-stored layoutMode does not trigger a reset', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'free' }),
      activePositions: [positionRow('card-1', 0), positionRow('card-2', 1)],
    });

    await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'free' });

    expect(layoutResetCalls(db)).toHaveLength(0);
  });
});

describe('updateStructure -- AC-11b: зміна layoutMode на НОВЕ значення скидає активні позиції в базовий порядок', () => {
  it('resets every active position when layoutMode changes to a different value', async () => {
    const activePositions = [positionRow('card-1', 5), positionRow('card-2', 0), positionRow('card-3', 2)];
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'balance' }),
      activePositions,
    });

    const result = await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'balance' });

    expect(result.layoutMode).toBe('balance');
    const resetCalls = layoutResetCalls(db);
    expect(resetCalls.length).toBeGreaterThan(0);

    // Кожна з трьох активних позицій має бути присутня серед параметрів
    // reset-запитів (усі три картки скидаються в тій самій дії, не лише одна).
    const touchedCardIds = new Set(resetCalls.flatMap(([, params]) => (params ?? []) as unknown[]));
    for (const position of activePositions) {
      expect(touchedCardIds.has(position.card_id)).toBe(true);
    }
  });

  // Плоска модель (вимоги 14/15): перемикання МІЖ колишніми підвидами
  // ('balance' <-> 'focus' <-> 'cause_effect') -- тепер звичайна зміна
  // layoutMode, той самий reset-механізм, без окремого AC-16b-шляху.
  it('resets active positions the same way when switching between the former "за логікою" subvariants directly', async () => {
    const activePositions = [positionRow('card-1', 0), positionRow('card-2', 1)];
    const db = fakeDb({
      current: structureRow({ layout_mode: 'balance' }),
      updated: structureRow({ layout_mode: 'focus' }),
      activePositions,
    });

    const result = await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'focus' });

    expect(result.layoutMode).toBe('focus');
    expect(layoutResetCalls(db)).toHaveLength(2);
  });

  // Вимога 15: перехід У 'staging' теж скидає кожну активну позицію в трей --
  // сенс режиму саме в тому, що все стартує внизу екрана без клітинки.
  it('resets active positions when switching into "staging"', async () => {
    const activePositions = [positionRow('card-1', 0), positionRow('card-2', 1)];
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'staging' }),
      activePositions,
    });

    const result = await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'staging' });

    expect(result.layoutMode).toBe('staging');
    expect(layoutResetCalls(db)).toHaveLength(2);
  });
});

// Рев'ю 2026-09-11, Частина 2 [critical] (AC-11b): домен віддає cellIndex:
// null ("картка без клітинки"), а use-case писав у БД position.baseOrder --
// реальну клітинку 0..N-1. Стан "без клітинки" був неспостережуваний, тож
// AC-11b/AC-17 не існували фізично (колонка ще й була NOT NULL -- міграція 06
// це зняла).
describe('updateStructure -- AC-11b: reset пише "клітинки немає" (SQL NULL), не черговий номер', () => {
  it('binds a real SQL NULL for every reset position -- ні baseOrder, ні рядок "null"', async () => {
    const activePositions = [positionRow('card-1', 5), positionRow('card-2', 0), positionRow('card-3', 2)];
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'balance' }),
      activePositions,
    });

    await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'balance' });

    const resetCalls = layoutResetCalls(db);
    expect(resetCalls).toHaveLength(activePositions.length);

    for (const [sql, params] of resetCalls) {
      const bound = (params ?? []) as unknown[];
      expect(sql).toMatch(/cell_index\s*=\s*\$\d/);
      // Справжній SQL NULL серед зв'язаних значень...
      expect(bound).toContain(null);
      // ...і ЖОДНОГО числа: саме числом (baseOrder) клітинка й протікала.
      expect(bound.filter((value) => typeof value === 'number')).toEqual([]);
      // ...і не текстові підробки NULL, які в INTEGER-колонку не лягли б.
      expect(bound).not.toContain('null');
      expect(bound).not.toContain('0');
    }
  });

  it('scopes each reset write by owner (AC-03) instead of touching a card id alone', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'balance' }),
      activePositions: [positionRow('card-1', 0)],
    });

    await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'balance' });

    const [sql, params] = layoutResetCalls(db)[0];
    expect(sql).toMatch(/owner_user_id/);
    expect(params).toContain(OWNER);
  });
});

// DoD T11 ("в одній транзакції"): сам use-case транзакцію НЕ відкриває -- він
// мусить виконати ВСІ запити через той самий переданий `db`, щоб обгортка
// composition root (withTransaction, ADR-0006) справді покрила і UPDATE
// структури, і всі N UPDATE позицій. Тест пильнує саме це: жодного побічного
// з'єднання в обхід транзакційного db.
describe('updateStructure -- усі записи через ОДИН переданий db', () => {
  it('issues every query through the transaction db handed in, never through the pool behind it', async () => {
    const txDb = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'balance' }),
      activePositions: [positionRow('card-1', 0), positionRow('card-2', 1)],
    });
    const poolQuery = vi.fn();
    const poolDb = {
      query: poolQuery as unknown as Db['query'],
      withTransaction: async <T>(fn: (db: Db) => Promise<T>): Promise<T> => fn(txDb),
    };

    await poolDb.withTransaction((db) => updateStructure(db, { ownerUserId: OWNER, layoutMode: 'balance' }));

    expect(poolQuery).not.toHaveBeenCalled();
    expect(layoutResetCalls(txDb)).toHaveLength(2);
    expect(structureUpdateCall(txDb)[0]).toMatch(/UPDATE structure SET/);
  });
});

describe('updateStructure -- structure.not_found (AC-03 non-disclosure)', () => {
  it('rejects with structure.not_found when the owner has no Structure yet', async () => {
    const db = fakeDb({ current: null });

    await expect(
      updateStructure(db, { ownerUserId: OWNER, declaration: 'текст' })
    ).rejects.toMatchObject({ code: 'structure.not_found', httpStatus: 404 });
  });
});
