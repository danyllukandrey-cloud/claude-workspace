// T11 -- App: updateStructure use-case.
// RED (unit level, mocked Db -- test-plan.md маркує AC-10 як unit,
// AC-11/AC-11b як integration; Docker/Neon недоступні в цьому середовищі,
// тож `update-structure.integration.test.ts` лишиться NON-red тут -- цей файл
// робить задачу TDD-водимою локально без реальної БД).
//
// D-131-наступне рішення (Андрій, чат, 2026-09-15): зміна layoutMode більше
// НЕ скидає позиції в трей (switchLayoutMode прибраний) -- запускає реальний
// авто-розклад (app/apply-layout-mode.ts). Той окремий модуль має свій
// власний тест (./apply-layout-mode.test.ts, формули там же перевірені через
// domain/layout.test.ts) -- тут мокаємо його межу, щоб перевірити лише
// ЦЕЙ use-case: коли саме він викликається (layoutMode РЕАЛЬНО змінився), і з
// якими аргументами, не переобчислювати математику розкладу вдруге.
//
// Contract (contracts/openapi.yaml, updateMyStructure):
// - AC-10: declaration/layoutMode -- незалежні поля одного PATCH.
// - AC-11/AC-11b: layoutMode -> НОВЕ значення -> applyLayoutMode викликається
//   рівно раз, з ownerUserId/structureId/layoutMode цього запиту.
// - Запис, що не змінює layoutMode -- applyLayoutMode не викликається.

import { describe, it, expect, vi } from 'vitest';

vi.mock('./apply-layout-mode', () => ({
  applyLayoutMode: vi.fn().mockResolvedValue(undefined),
}));

import { updateStructure } from './update-structure';
import { applyLayoutMode } from './apply-layout-mode';
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

/** Підроблена база -- маршрутизує запит за текстом SQL до потрібного канонічного рядка. */
function fakeDb(opts: { current: ReturnType<typeof structureRow> | null; updated?: ReturnType<typeof structureRow> }): Db {
  const query = vi.fn(async (text: string, _params?: unknown[]) => {
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

describe('updateStructure -- AC-10: декларація окремо від layoutMode', () => {
  it('saves declaration alone -- layoutMode is not touched and no auto-layout fires', async () => {
    vi.mocked(applyLayoutMode).mockClear();
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'free', declaration: 'картина світу' }),
    });

    const result = await updateStructure(db, { ownerUserId: OWNER, declaration: 'картина світу' });

    expect(result.declaration).toBe('картина світу');
    expect(result.layoutMode).toBe('free');
    expect(applyLayoutMode).not.toHaveBeenCalled();
  });
});

describe('updateStructure -- AC-11: обрати режим розкладки застосовує його надалі', () => {
  it('persists the chosen layoutMode', async () => {
    vi.mocked(applyLayoutMode).mockClear();
    const db = fakeDb({
      current: structureRow({ layout_mode: null }),
      updated: structureRow({ layout_mode: 'free' }),
    });

    const result = await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'free' });

    expect(result.layoutMode).toBe('free');
  });

  it('a PATCH repeating the already-stored layoutMode does not trigger the auto-layout', async () => {
    vi.mocked(applyLayoutMode).mockClear();
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'free' }),
    });

    await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'free' });

    expect(applyLayoutMode).not.toHaveBeenCalled();
  });
});

describe('updateStructure -- AC-11b: зміна layoutMode на НОВЕ значення запускає авто-розклад', () => {
  it('calls applyLayoutMode exactly once with this owner/structure/new mode', async () => {
    vi.mocked(applyLayoutMode).mockClear();
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'balance' }),
    });

    const result = await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'balance' });

    expect(result.layoutMode).toBe('balance');
    expect(applyLayoutMode).toHaveBeenCalledTimes(1);
    expect(applyLayoutMode).toHaveBeenCalledWith(db, {
      ownerUserId: OWNER,
      structureId: STRUCTURE_ID,
      layoutMode: 'balance',
    });
  });

  it('switching between former "за логікою" subvariants directly still triggers the auto-layout', async () => {
    vi.mocked(applyLayoutMode).mockClear();
    const db = fakeDb({
      current: structureRow({ layout_mode: 'balance' }),
      updated: structureRow({ layout_mode: 'focus' }),
    });

    await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'focus' });

    expect(applyLayoutMode).toHaveBeenCalledWith(db, {
      ownerUserId: OWNER,
      structureId: STRUCTURE_ID,
      layoutMode: 'focus',
    });
  });

  it('switching into "staging" still calls applyLayoutMode -- the no-op decision lives inside that module, not here', async () => {
    vi.mocked(applyLayoutMode).mockClear();
    const db = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'staging' }),
    });

    await updateStructure(db, { ownerUserId: OWNER, layoutMode: 'staging' });

    expect(applyLayoutMode).toHaveBeenCalledWith(db, {
      ownerUserId: OWNER,
      structureId: STRUCTURE_ID,
      layoutMode: 'staging',
    });
  });
});

// DoD T11 ("в одній транзакції"): сам use-case транзакцію НЕ відкриває -- він
// мусить виконати ВСІ запити через той самий переданий `db`.
describe('updateStructure -- усі записи через ОДИН переданий db', () => {
  it('issues its own queries through the transaction db handed in, never through the pool behind it', async () => {
    vi.mocked(applyLayoutMode).mockClear();
    const txDb = fakeDb({
      current: structureRow({ layout_mode: 'free' }),
      updated: structureRow({ layout_mode: 'balance' }),
    });
    const poolQuery = vi.fn();
    const poolDb = {
      query: poolQuery as unknown as Db['query'],
      withTransaction: async <T>(fn: (db: Db) => Promise<T>): Promise<T> => fn(txDb),
    };

    await poolDb.withTransaction((db) => updateStructure(db, { ownerUserId: OWNER, layoutMode: 'balance' }));

    expect(poolQuery).not.toHaveBeenCalled();
    expect(applyLayoutMode).toHaveBeenCalledWith(txDb, expect.anything());
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
