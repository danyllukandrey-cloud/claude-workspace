// App: updateStructure use-case (T11) -- оркеструє domain/layout.ts (T5) +
// infra/postgres-repo.ts (T9's structure-CRUD зріз) для часткового PATCH
// Структури (AC-10, AC-11/AC-11b), sad.md §6, contracts/openapi.yaml
// updateMyStructure.
//
// Два поля патчаться незалежно (AC-10): declaration завжди можна зберегти
// саму по собі, без побічних ефектів на розкладку.
//
// Побічна дія (AC-11b): layoutMode -> НОВЕ значення (будь-яке з 5 -- вимоги
// 14/15, плоска модель) скидає кожну активну позицію в базовий (фіксований)
// порядок (domain/layout.ts switchLayoutMode). Той самий запит, що не змінює
// layoutMode -- жодного reset-запиту. Реальна атомарність (BEGIN/COMMIT
// навколо обох кроків) -- composition root (T15, ADR-0006 withTransaction);
// тут лише послідовність кроків use-case-у.
//
// Плоска модель прибрала колишній logicVariant і разом з ним обидва
// інваріанти AC-16/AC-16b (logicVariant лише в 'logic', підвид перемикають
// лише всередині 'logic') -- нема більше вкладеного поля, нема що звіряти
// ДО запису. Перемикання між колишніми підвидами ('balance' <-> 'focus' <->
// 'cause_effect') тепер звичайна зміна layoutMode, без спеціального шляху.
//
// Non-disclosure (AC-03): Структура -- singleton на ownerUserId, findStructureByOwner
// сам скопує вибірку; чужа/неіснуюча Структура тут виглядають як structure.not_found,
// той самий шаблон, що update-card.ts для card.not_found.
//
// DI (правило залежностей, ADR-0004): db приходить ззовні, use-case сам
// з'єднання не створює.

import { switchLayoutMode } from '../domain/layout';
import type { LayoutMode } from '../domain/layout';
import {
  findStructureByOwner,
  updateStructure as updateStructureRow,
  listActiveLayoutPositionsByOwner,
  updateLayoutPositionCell,
} from '../infra/postgres-repo';
import type { StructureRecord, Db } from '../infra/postgres-repo';
import { AppError } from '../../shared/errors';

export interface UpdateStructureInput {
  ownerUserId: string;
  declaration?: string | null;
  layoutMode?: LayoutMode;
}

/** Лог дій -- сигнатура збігається з agent/app/record-action.ts's `recordAction` (life-area-card/app/create-card.ts докладніше). */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

/**
 * Часткове оновлення Структури -- declaration/layoutMode кожен незалежний
 * (AC-10). Зміна layoutMode на нове значення знімає клітинку з КОЖНОЇ
 * активної позиції (cell_index -> NULL, "картка без клітинки" у треї
 * нерозкладених) -- користувач розкладає картки під новий режим сам (AC-11b).
 */
export async function updateStructure(db: Db, input: UpdateStructureInput, recordAction?: RecordAction): Promise<StructureRecord> {
  const current = await findStructureByOwner(db, input.ownerUserId);
  if (!current) {
    throw new AppError('structure.not_found', 'Структуру не знайдено', 404);
  }

  const layoutModeChanged = input.layoutMode !== undefined && input.layoutMode !== current.layoutMode;

  const patch: { declaration?: string | null; layoutMode?: LayoutMode } = {};
  if (input.declaration !== undefined) patch.declaration = input.declaration;
  if (input.layoutMode !== undefined) patch.layoutMode = input.layoutMode;

  const updated = await updateStructureRow(db, input.ownerUserId, patch);
  if (!updated) {
    throw new AppError('structure.not_found', 'Структуру не знайдено', 404);
  }

  // AC-11b: reset лише коли layoutMode РЕАЛЬНО змінився на нове значення (не
  // при повторі того, що вже збережене).
  if (layoutModeChanged) {
    const activePositions = await listActiveLayoutPositionsByOwner(db, input.ownerUserId);
    const positions = activePositions.map((position) => ({ cardId: position.cardId, cellIndex: position.cellIndex }));

    const plan = switchLayoutMode(positions, input.layoutMode ?? null);

    // Одна мітка часу на весь reset -- це ОДНА дія користувача, не N окремих
    // перетягувань (LWW, ADR-0002).
    const resetAt = new Date();

    for (const position of plan.positions) {
      // `position.cellIndex` домен завжди віддає null -- "картка без клітинки"
      // (AC-11b), і саме NULL має лягти в БД. Рев'ю 2026-09-11: тут писався
      // `position.baseOrder`, тобто реальна клітинка 0..N-1 -- стан "без
      // клітинки" був неспостережуваний, а послідовні UPDATE ще й могли
      // тимчасово зіткнутись із частковим UNIQUE на зайняту клітинку.
      // `baseOrder` -- порядок у треї нерозкладених, не номер клітинки; власної
      // колонки під нього в схемі немає (лишається на боці UI).
      //
      // Через owner-scoped репозиторій, не сирим SQL, і через ТОЙ САМИЙ
      // переданий `db` -- use-case не відкриває власних з'єднань, тому
      // composition root (withTransaction, ADR-0006) обгортає і UPDATE
      // структури, і всі N UPDATE позицій в ОДНУ транзакцію (DoD T11).
      await updateLayoutPositionCell(db, input.ownerUserId, position.cardId, position.cellIndex, resetAt);
    }
  }

  if (recordAction) {
    if (input.declaration !== undefined) {
      await recordAction(db, { ownerUserId: input.ownerUserId, action: 'Оновлено декларацію Структури' });
    }
    if (layoutModeChanged) {
      await recordAction(db, { ownerUserId: input.ownerUserId, action: `Змінено режим розкладки Структури на «${input.layoutMode}»` });
    }
  }

  return updated;
}
