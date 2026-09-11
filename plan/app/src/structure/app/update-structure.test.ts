// T11 -- App: updateStructure use-case.
// RED (unit level, mocked Db -- test-plan.md маркує AC-10 як unit,
// AC-11/AC-11b/AC-16/AC-16b як integration; Docker/Neon недоступні в цьому
// середовищі, тож `update-structure.integration.test.ts` лишиться NON-red
// тут -- цей файл робить задачу TDD-водимою локально без реальної БД).
//
// Той самий mocking-стиль, що й ../../cards/life-area-card/app/update-card.test.ts:
// fake `Db.query` (vi.fn), маршрутизація за текстом SQL -- postgres-repo.ts
// (findStructureByOwner/updateStructure/listActiveLayoutPositionsByOwner) не
// мокається сам, лише межа `db.query`.
//
// Contract (contracts/openapi.yaml, updateMyStructure):
// - AC-10: declaration/layoutMode/logicVariant -- незалежні поля одного PATCH.
// - AC-11/AC-11b: layoutMode -> НОВЕ значення -> кожна активна позиція
//   скидається в базовий порядок (той самий запис, той самий викорінений
//   patch, у тій самій дії use-case -- реальна атомарність транзакції
//   перевіряється лише на integration-рівні, тут -- сам факт, що use-case
//   видає ці записи, коли й лише коли режим реально змінився).
// - AC-16/AC-16b: logicVariant -> НОВЕ значення при layoutMode='logic' -- та
//   сама побічна дія; logicVariant без layoutMode='logic' (ні збереженого,
//   ні цим-таки запитом) -- 422 structure.logic_variant_requires_logic_mode,
//   ДО будь-якого запису.
// - Запис, що не змінює жодне з двох полів -- жодного reset-запиту.

import { describe, it, expect, vi } from 'vitest';
import { updateStructure } from './update-structure';
import { AppError } from '../../shared/errors';
import { LayoutValidationError } from '../domain/layout';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';

function structureRow(
  overrides: Partial<{
    declaration: string | null;
    layout_mode: 'single' | 'free' | 'logic' | null;
    logic_variant: 'balance' | 'focus' | 'cause_effect' | null;
  }> = {}
) {
  return {
    id: STRUCTURE_ID,
    owner_user_id: OWNER,
    declaration: overrides.declaration ?? null,
    layout_mode: overrides.layout_mode ?? null,
    logic_variant: overrides.logic_variant ?? null,
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

describe('updateStructure -- AC-10: декларація окремо від layoutMode/logicVariant', () => {
  it('saves declaration alone -- layoutMode/logicVariant are not touched and no reset fires', async () => {
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
      updated: structureRow({ layout_mode: 'logic' }),
      activePositions,
    });

    const result = await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'logic' });

    expect(result.layoutMode).toBe('logic');
    const resetCalls = layoutResetCalls(db);
    expect(resetCalls.length).toBeGreaterThan(0);

    // Кожна з трьох активних позицій має бути присутня серед параметрів
    // reset-запитів (усі три картки скидаються в тій самій дії, не лише одна).
    const touchedCardIds = new Set(resetCalls.flatMap(([, params]) => (params ?? []) as unknown[]));
    for (const position of activePositions) {
      expect(touchedCardIds.has(position.card_id)).toBe(true);
    }
  });
});

// Рев'ю 2026-09-11, Частина 2 [critical] (AC-11b/AC-16b): домен віддає
// cellIndex: null ("картка без клітинки"), а use-case писав у БД
// position.baseOrder -- реальну клітинку 0..N-1. Стан "без клітинки" був
// неспостережуваний, тож AC-11b/AC-16b/AC-17 не існували фізично (колонка ще й
// була NOT NULL -- міграція 06 це зняла).
describe('updateStructure -- AC-11b: reset пише "клітинки немає" (SQL NULL), не черговий номер', () => {
  it('binds a real SQL NULL for every reset position -- ні baseOrder, ні рядок "null"', async () => {
    const activePositions = [positionRow('card-1', 5), positionRow('card-2', 0), positionRow('card-3', 2)];
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'logic' }),
      activePositions,
    });

    await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'logic' });

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
      updated: structureRow({ layout_mode: 'logic' }),
      activePositions: [positionRow('card-1', 0)],
    });

    await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'logic' });

    const [sql, params] = layoutResetCalls(db)[0];
    expect(sql).toMatch(/owner_user_id/);
    expect(params).toContain(OWNER);
  });
});

// Рев'ю 2026-09-11, Частини 1 і 2 [major] (AC-16): інваріант "logic_variant має
// сенс лише при layoutMode = 'logic'" не тримав ніхто -- вихід із режиму лишав
// у БД підвид, якого в новому режимі не існує.
describe('updateStructure -- AC-16: вихід із режиму "за логікою" обнуляє підвид', () => {
  it('writes logic_variant = NULL when layoutMode switches away from logic, though the body carries no logicVariant', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'logic', logic_variant: 'balance' }),
      updated: structureRow({ layout_mode: 'free' }),
      activePositions: [positionRow('card-1', 0)],
    });

    await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'free' });

    const [sql, params] = structureUpdateCall(db);
    expect(sql).toMatch(/logic_variant\s*=\s*\$\d/);
    expect(params).toContain(null);
  });

  it('clears a stale logic_variant even when layoutMode repeats the already-stored non-logic value -- and that alone resets nothing', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free', logic_variant: 'balance' }),
      updated: structureRow({ layout_mode: 'free' }),
      activePositions: [positionRow('card-1', 0)],
    });

    await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'free' });

    const [sql, params] = structureUpdateCall(db);
    expect(sql).toMatch(/logic_variant\s*=\s*\$\d/);
    expect(params).toContain(null);
    // Режим не змінився -- розкладку не торкаємось (AC-11b -- лише про реальну зміну).
    expect(layoutResetCalls(db)).toHaveLength(0);
  });

  it('accepts an explicit {layoutMode: "free", logicVariant: null} reconciliation -- clears the variant, resets nothing, throws nothing', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free', logic_variant: 'balance' }),
      updated: structureRow({ layout_mode: 'free' }),
      activePositions: [positionRow('card-1', 0)],
    });

    await expect(
      updateStructure(db, { ownerUserId: OWNER, layoutMode: 'free', logicVariant: null })
    ).resolves.toMatchObject({ layoutMode: 'free', logicVariant: null });

    const [sql, params] = structureUpdateCall(db);
    expect(sql).toMatch(/logic_variant\s*=\s*\$\d/);
    expect(params).toContain(null);
    // Режим не змінився, а підвид у режимі 'free' ні на що не впливає --
    // розкладку не чіпаємо (AC-11b -- лише про реальну зміну режиму).
    expect(layoutResetCalls(db)).toHaveLength(0);
  });

  it('leaves logic_variant out of the patch entirely while the resulting mode stays logic', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'logic', logic_variant: 'balance' }),
      updated: structureRow({ layout_mode: 'logic', logic_variant: 'balance' }),
      activePositions: [positionRow('card-1', 0)],
    });

    await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'logic' });

    // Саме SET-частина: logic_variant згадується ще й у RETURNING, це не запис.
    const [sql] = structureUpdateCall(db);
    expect(sql).not.toMatch(/logic_variant\s*=\s*\$\d/);
  });

  it('does not touch logic_variant on a declaration-only PATCH (AC-10 -- декларація без побічних дій)', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free', logic_variant: 'balance' }),
      updated: structureRow({ layout_mode: 'free', declaration: 'текст' }),
      activePositions: [positionRow('card-1', 0)],
    });

    await updateStructure(db, { ownerUserId: OWNER, declaration: 'текст' });

    const [sql] = structureUpdateCall(db);
    expect(sql).not.toMatch(/logic_variant\s*=\s*\$\d/);
  });
});

// Рев'ю 2026-09-11, Частина 2 [major], похідний дефект AC-16: PATCH
// {logicVariant: null} на Структурі, що вже НЕ в режимі 'logic', кидав доменну
// помилку з середини reset-циклу -- ПІСЛЯ того, як рядок структури вже
// записаний, і сервер бачив її як невідому (500 замість 422).
describe('updateStructure -- перемикання підвиду поза режимом "за логікою"', () => {
  it('rejects {logicVariant: null} on a non-logic Structure with the typed domain error, before any write', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free', logic_variant: 'balance' }),
      updated: structureRow({ layout_mode: 'free' }),
      activePositions: [positionRow('card-1', 0)],
    });

    await expect(updateStructure(db, { ownerUserId: OWNER, logicVariant: null })).rejects.toBeInstanceOf(
      LayoutValidationError
    );

    // Жодного запису: пішло лише перше SELECT (findStructureByOwner).
    expect((db.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('a {logicVariant: null} that changes nothing on a non-logic Structure stays a no-op', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free', logic_variant: null }),
      updated: structureRow({ layout_mode: 'free', logic_variant: null }),
      activePositions: [positionRow('card-1', 0)],
    });

    await expect(updateStructure(db, { ownerUserId: OWNER, logicVariant: null })).resolves.toMatchObject({
      layoutMode: 'free',
      logicVariant: null,
    });
    expect(layoutResetCalls(db)).toHaveLength(0);
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
      updated: structureRow({ layout_mode: 'logic' }),
      activePositions: [positionRow('card-1', 0), positionRow('card-2', 1)],
    });
    const poolQuery = vi.fn();
    const poolDb = {
      query: poolQuery as unknown as Db['query'],
      withTransaction: async <T>(fn: (db: Db) => Promise<T>): Promise<T> => fn(txDb),
    };

    await poolDb.withTransaction((db) => updateStructure(db, { ownerUserId: OWNER, layoutMode: 'logic' }));

    expect(poolQuery).not.toHaveBeenCalled();
    expect(layoutResetCalls(txDb)).toHaveLength(2);
    expect(structureUpdateCall(txDb)[0]).toMatch(/UPDATE structure SET/);
  });
});

describe('updateStructure -- AC-16 / AC-16b: підвид "за логікою"', () => {
  it('rejects logicVariant when the resulting layoutMode (stored or in this same call) is not "logic"', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      activePositions: [],
    });

    await expect(
      updateStructure(db, { ownerUserId: OWNER, logicVariant: 'focus' })
    ).rejects.toMatchObject({ code: 'structure.logic_variant_requires_logic_mode', httpStatus: 422 });

    // Помилка -- ДО будь-якого запису: лише перше SELECT (findStructureByOwner) пішло.
    expect((db.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('rejects logicVariant as AppError specifically', async () => {
    const db = fakeDb({ current: structureRow({ layout_mode: 'free' }), activePositions: [] });

    await expect(
      updateStructure(db, { ownerUserId: OWNER, logicVariant: 'focus' })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('applies a new logicVariant while layoutMode stays "logic" and resets active positions (same mechanism as AC-11b)', async () => {
    const activePositions = [positionRow('card-1', 0), positionRow('card-2', 1)];
    const db = fakeDb({
      current: structureRow({ layout_mode: 'logic', logic_variant: 'balance' }),
      updated: structureRow({ layout_mode: 'logic', logic_variant: 'focus' }),
      activePositions,
    });

    const result = await updateStructure(db, { ownerUserId: OWNER, logicVariant: 'focus' });

    expect(result.logicVariant).toBe('focus');
    expect(layoutResetCalls(db).length).toBeGreaterThan(0);
  });

  it('a PATCH repeating the already-stored logicVariant does not trigger a reset', async () => {
    const db = fakeDb({
      current: structureRow({ layout_mode: 'logic', logic_variant: 'balance' }),
      updated: structureRow({ layout_mode: 'logic', logic_variant: 'balance' }),
      activePositions: [positionRow('card-1', 0)],
    });

    await updateStructure(db, { ownerUserId: OWNER, logicVariant: 'balance' });

    expect(layoutResetCalls(db)).toHaveLength(0);
  });
});
