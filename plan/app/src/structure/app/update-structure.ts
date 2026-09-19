// App: updateStructure use-case (T11) -- оркеструє domain/layout.ts (T5) +
// infra/postgres-repo.ts (T9's structure-CRUD зріз) для часткового PATCH
// Структури (AC-10, AC-11/AC-11b), sad.md §6, contracts/openapi.yaml
// updateMyStructure.
//
// Два поля патчаться незалежно (AC-10): declaration завжди можна зберегти
// саму по собі, без побічних ефектів на розкладку.
//
// Побічна дія (AC-11b, D-131-наступне рішення): layoutMode -> НОВЕ значення
// (будь-яке з 5) запускає авто-розклад нового режиму (app/apply-layout-mode.ts
// computeAutoLayout) -- реальні координати x/y (+ за потреби зв'язки), НЕ
// скидання в трей, як було раніше (switchLayoutMode прибраний повністю,
// Андрій у чаті: "Кожен з варіантів конфігурації потрібно просто розташувати
// за логікою"). Той самий запит, що не змінює layoutMode -- жодного
// перерахунку. Реальна атомарність (BEGIN/COMMIT навколо обох кроків) --
// composition root (T15, ADR-0006 withTransaction); тут лише послідовність
// кроків use-case-у.
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

import type { LayoutMode } from '../domain/layout';
import { applyLayoutMode } from './apply-layout-mode';
import { findStructureByOwner, updateStructure as updateStructureRow } from '../infra/postgres-repo';
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
 * (AC-10). Зміна layoutMode на нове значення запускає авто-розклад нового
 * режиму (D-132, applyLayoutMode нижче): рахує й записує реальні x/y для
 * КОЖНОЇ активної картки власника (і вже розкладених, і з купки
 * нерозкладених) -- не скидання в трей, як було до D-132 (AC-11b).
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

  // AC-11b: авто-розклад лише коли layoutMode РЕАЛЬНО змінився на нове
  // значення (не при повторі того, що вже збережене) -- той самий guard, що
  // раніше вмикав reset. Через owner-scoped репозиторій і ТОЙ САМИЙ переданий
  // `db` -- use-case не відкриває власних з'єднань, composition root
  // (withTransaction, ADR-0006) обгортає і UPDATE структури, і весь
  // авто-розклад в ОДНУ транзакцію (DoD T11).
  if (layoutModeChanged) {
    await applyLayoutMode(db, { ownerUserId: input.ownerUserId, structureId: updated.id, layoutMode: input.layoutMode ?? null });
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
