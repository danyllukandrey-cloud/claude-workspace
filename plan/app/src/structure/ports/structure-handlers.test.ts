// T15 -- Ports: GET/PATCH /structure handlers.
// RED (unit level, mocked Db -- test-plan.md маркує AC-11/AC-16 як integration,
// AC-10 як unit; Docker/Neon недоступні в цьому середовищі, тож повноцінний
// integration-рівень (реальний Postgres, contracts/openapi.yaml повний цикл)
// лишається NON-red тут -- цей файл робить задачу TDD-водимою локально без
// реальної БД, той самий підхід, що app/update-structure.test.ts і
// ../../cards/life-area-card/ports/card-handlers.test.ts (fake `Db.query`,
// маршрутизація за текстом SQL, use-case-шар лишається справжнім).
//
// Contract (contracts/openapi.yaml `/api/v1/structure`):
// - GET getMyStructure: 200 завжди -- Структура лениво (lazy) створюється
//   на перший вхід, з `declaration: null`, `layoutMode: null` (AC-09/AC-10).
// - PATCH updateMyStructure: 200 happy path (AC-10 декларація незалежна,
//   AC-11 обраний layoutMode застосовується надалі); 422
//   structure.invalid_layout_mode / structure.invalid_logic_variant --
//   значення поза допустимим enum'ом контракту, ПЕРЕВІРЕНО ДО будь-якого
//   запису (той самий підхід, що app/update-structure.ts -- validate-first);
//   422 structure.logic_variant_requires_logic_mode -- пропускається як є з
//   use-case-шару (T11), порт нічого зверху не додає й не ховає.
// - AC-03 (non-disclosure): Структура -- singleton, адресується лише через
//   ownerUserId з Bearer-токена (openapi.yaml `info.description`) -- немає
//   параметра "чужий id", тому тест перевіряє, що читання/запис завжди
//   строго прив'язані до переданого ownerUserId, ніколи до глобального
//   першого рядка таблиці.

import { describe, it, expect, vi } from 'vitest';
import { getStructure, updateStructure } from './structure-handlers';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';

function structureRow(
  overrides: Partial<{
    id: string;
    owner_user_id: string;
    declaration: string | null;
    layout_mode: 'single' | 'free' | 'logic' | null;
    logic_variant: 'balance' | 'focus' | 'cause_effect' | null;
    created_at: Date;
    updated_at: Date;
  }> = {}
) {
  return {
    id: overrides.id ?? STRUCTURE_ID,
    owner_user_id: overrides.owner_user_id ?? OWNER,
    declaration: overrides.declaration ?? null,
    layout_mode: overrides.layout_mode ?? null,
    logic_variant: overrides.logic_variant ?? null,
    created_at: overrides.created_at ?? new Date('2026-01-01T00:00:00Z'),
    updated_at: overrides.updated_at ?? new Date('2026-01-01T00:00:00Z'),
  };
}

// --- getStructure -- GET /api/v1/structure ---------------------------------

/**
 * Маршрутизує запит за текстом SQL -- SELECT над `structure` спершу шукає,
 * INSERT провіснує лениво, якщо не знайшлось. Той самий підхід, що
 * fakeGetCardDb в card-handlers.test.ts.
 */
function fakeGetStructureDb(opts: { existing: ReturnType<typeof structureRow> | null; inserted?: ReturnType<typeof structureRow> }): Db {
  const query = vi.fn(async (text: string, _params?: unknown[]) => {
    if (text.trim().toUpperCase().startsWith('SELECT')) {
      return { rows: opts.existing ? [opts.existing] : [] };
    }
    if (text.trim().toUpperCase().startsWith('INSERT')) {
      return { rows: [opts.inserted ?? structureRow()] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('getStructure handler', () => {
  // 200, lazy-provisioning на перший вхід (AC-09/AC-10) -- нема жодного
  // рядка для owner, хендлер має сам створити один з порожньою декларацією
  // й layoutMode: null, а не 404/500.
  it('lazily provisions a Structure on the first GET and returns it as the DTO', async () => {
    const db = fakeGetStructureDb({ existing: null, inserted: structureRow() });

    const result = await getStructure(db, OWNER);

    expect(result).toEqual({
      id: STRUCTURE_ID,
      declaration: null,
      layoutMode: null,
      logicVariant: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const insertCalls = (db.query as ReturnType<typeof vi.fn>).mock.calls.filter(([text]) => text.trim().toUpperCase().startsWith('INSERT'));
    expect(insertCalls).toHaveLength(1);
  });

  // Другий вхід -- рядок уже існує, жодного повторного INSERT (інакше
  // singleton-інваріант "одна Структура на користувача" порушено).
  it('returns the already-existing Structure without inserting again', async () => {
    const db = fakeGetStructureDb({ existing: structureRow({ declaration: 'моя картина світу', layout_mode: 'free' }) });

    const result = await getStructure(db, OWNER);

    expect(result.declaration).toBe('моя картина світу');
    expect(result.layoutMode).toBe('free');
    const insertCalls = (db.query as ReturnType<typeof vi.fn>).mock.calls.filter(([text]) => text.trim().toUpperCase().startsWith('INSERT'));
    expect(insertCalls).toHaveLength(0);
  });

  // AC-03: singleton, адресується лише через ownerUserId -- перевіряємо, що
  // рядок ІНШОГО власника ніколи не потрапляє у відповідь, навіть якщо він
  // єдиний у "таблиці" (non-disclosure -- чужа Структура не підтверджує й не
  // спростовує своє існування, тут це виявляється як "лениво створено нову
  // порожню", не як помилка й не як чужі дані).
  it('never returns another owner\'s row -- scopes strictly by the given ownerUserId', async () => {
    const foreignRow = structureRow({ owner_user_id: 'someone-else', declaration: 'чужа декларація' });
    // Підроблена "БД", що (навмисно неправильно) ігнорує ownerUserId і завжди
    // повертає чужий рядок -- порт МАЄ передавати ownerUserId у запит; тест
    // ловить регресію, де хендлер забув прокинути параметр і отримав би чужі
    // дані.
    const query = vi.fn(async (text: string, params?: unknown[]) => {
      if (text.trim().toUpperCase().startsWith('SELECT')) {
        expect(params).toContain(OWNER);
        return { rows: [] };
      }
      if (text.trim().toUpperCase().startsWith('INSERT')) {
        expect(params).toContain(OWNER);
        return { rows: [structureRow()] };
      }
      throw new Error(`Непередбачений запит у тесті: ${text}`);
    });
    const db: Db = { query: query as unknown as Db['query'] };
    void foreignRow;

    const result = await getStructure(db, OWNER);

    expect(result.declaration).not.toBe('чужа декларація');
  });
});

// --- updateStructure -- PATCH /api/v1/structure ----------------------------

function fakeUpdateStructureDb(opts: { current: ReturnType<typeof structureRow> | null; updated?: ReturnType<typeof structureRow>; activePositions?: unknown[] }): Db {
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

describe('updateStructure handler', () => {
  // 200 happy path -- AC-10 (декларація) + AC-11 (layoutMode застосовано).
  it('patches declaration and layoutMode together and returns the updated DTO', async () => {
    const db = fakeUpdateStructureDb({
      current: structureRow({ layout_mode: null }),
      updated: structureRow({ layout_mode: 'free', declaration: 'нова декларація' }),
      activePositions: [],
    });

    const result = await updateStructure(db, OWNER, { declaration: 'нова декларація', layoutMode: 'free' });

    expect(result.declaration).toBe('нова декларація');
    expect(result.layoutMode).toBe('free');
  });

  // 422 structure.invalid_layout_mode -- значення поза enum'ом контракту
  // (single/free/logic/null), перевірено ДО будь-якого запиту в базу.
  it('rejects an out-of-enum layoutMode with 422 structure.invalid_layout_mode before any query', async () => {
    const db = fakeUpdateStructureDb({ current: structureRow() });

    const error = await updateStructure(db, OWNER, { layoutMode: 'not-a-real-mode' as never }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'structure.invalid_layout_mode', httpStatus: 422 });
    expect(db.query).not.toHaveBeenCalled();
  });

  // 422 structure.invalid_logic_variant -- значення поза enum'ом контракту
  // (balance/focus/cause_effect/null), перевірено ДО будь-якого запиту.
  it('rejects an out-of-enum logicVariant with 422 structure.invalid_logic_variant before any query', async () => {
    const db = fakeUpdateStructureDb({ current: structureRow({ layout_mode: 'logic' }) });

    const error = await updateStructure(db, OWNER, { logicVariant: 'not-a-real-variant' as never }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'structure.invalid_logic_variant', httpStatus: 422 });
    expect(db.query).not.toHaveBeenCalled();
  });

  // 422 structure.logic_variant_requires_logic_mode (AC-16) -- валідний enum,
  // але layoutMode (збережений чи цим-таки запитом) не 'logic'. Порт нічого
  // зверху не додає -- пропускає помилку use-case-шару (T11) як є.
  it('propagates structure.logic_variant_requires_logic_mode from the use-case as-is', async () => {
    const db = fakeUpdateStructureDb({ current: structureRow({ layout_mode: 'free' }) });

    const error = await updateStructure(db, OWNER, { logicVariant: 'focus' }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'structure.logic_variant_requires_logic_mode', httpStatus: 422 });
  });
});
