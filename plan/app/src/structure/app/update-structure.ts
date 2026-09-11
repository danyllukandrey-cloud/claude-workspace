// App: updateStructure use-case (T11) -- оркеструє domain/layout.ts (T5) +
// infra/postgres-repo.ts (T9's structure-CRUD зріз) для часткового PATCH
// Структури (AC-10, AC-11/AC-11b, AC-16/AC-16b), sad.md §6, contracts/openapi.yaml
// updateMyStructure.
//
// Три поля патчаться незалежно (AC-10): declaration завжди можна зберегти
// саму по собі, без побічних ефектів на розкладку.
//
// Побічна дія (AC-11b/AC-16b): layoutMode -> НОВЕ значення, АБО logicVariant
// -> НОВЕ значення при (збереженому чи цим-таки запитом установленому)
// layoutMode = 'logic' -- скидає кожну активну позицію в базовий (фіксований)
// порядок (domain/layout.ts switchLayoutMode/switchLogicVariant). Той самий
// запис, що не змінює жодне з двох полів -- жодного reset-запиту. Реальна
// атомарність (BEGIN/COMMIT навколо обох кроків) -- composition root (T15,
// ADR-0006 withTransaction); тут лише послідовність кроків use-case-у.
//
// AC-16: logicVariant валідний лише коли результуючий layoutMode = 'logic' --
// перевірка ДО будь-якого запису (structure.logic_variant_requires_logic_mode,
// 422), як домен (assertLogicVariantAllowed) уже виражає для чистих значень.
//
// Non-disclosure (AC-03): Структура -- singleton на ownerUserId, findStructureByOwner
// сам скопує вибірку; чужа/неіснуюча Структура тут виглядають як structure.not_found,
// той самий шаблон, що update-card.ts для card.not_found.
//
// DI (правило залежностей, ADR-0004): db приходить ззовні, use-case сам
// з'єднання не створює.

import { switchLayoutMode, switchLogicVariant } from '../domain/layout';
import type { LayoutMode, LogicVariant } from '../domain/layout';
import {
  findStructureByOwner,
  updateStructure as updateStructureRow,
  listActiveLayoutPositionsByOwner,
} from '../infra/postgres-repo';
import type { StructureRecord, Db } from '../infra/postgres-repo';
import { AppError } from '../../shared/errors';

export interface UpdateStructureInput {
  ownerUserId: string;
  declaration?: string | null;
  layoutMode?: LayoutMode;
  logicVariant?: LogicVariant;
}

/**
 * Часткове оновлення Структури -- declaration/layoutMode/logicVariant кожен
 * незалежний (AC-10). Зміна layoutMode чи logicVariant на нове значення
 * скидає активні позиції розкладки в базовий порядок (AC-11b/AC-16b).
 */
export async function updateStructure(db: Db, input: UpdateStructureInput): Promise<StructureRecord> {
  const current = await findStructureByOwner(db, input.ownerUserId);
  if (!current) {
    throw new AppError('structure.not_found', 'Структуру не знайдено', 404);
  }

  const layoutModeChanged = input.layoutMode !== undefined && input.layoutMode !== current.layoutMode;
  const logicVariantChanged = input.logicVariant !== undefined && input.logicVariant !== current.logicVariant;
  const effectiveLayoutMode: LayoutMode = input.layoutMode !== undefined ? input.layoutMode : current.layoutMode;

  // AC-16: ДО будь-якого запису -- лише findStructureByOwner вище встиг піти.
  if (input.logicVariant !== undefined && input.logicVariant !== null && effectiveLayoutMode !== 'logic') {
    throw new AppError(
      'structure.logic_variant_requires_logic_mode',
      'logicVariant is only allowed when the resulting layoutMode is "logic"',
      422
    );
  }

  const patch: { declaration?: string | null; layoutMode?: LayoutMode; logicVariant?: LogicVariant } = {};
  if (input.declaration !== undefined) patch.declaration = input.declaration;
  if (input.layoutMode !== undefined) patch.layoutMode = input.layoutMode;
  if (input.logicVariant !== undefined) patch.logicVariant = input.logicVariant;

  const updated = await updateStructureRow(db, input.ownerUserId, patch);
  if (!updated) {
    throw new AppError('structure.not_found', 'Структуру не знайдено', 404);
  }

  // AC-11b/AC-16b: той самий reset-механізм в обох випадках -- лише коли
  // режим чи підвид реально ЗМІНИЛИСЬ на нове значення (не при повторі того,
  // що вже збережене).
  const resetTriggered = layoutModeChanged || logicVariantChanged;
  if (resetTriggered) {
    const activePositions = await listActiveLayoutPositionsByOwner(db, input.ownerUserId);
    const positions = activePositions.map((position) => ({ cardId: position.cardId, cellIndex: position.cellIndex }));

    const plan = layoutModeChanged
      ? switchLayoutMode(positions, effectiveLayoutMode)
      : switchLogicVariant(current.layoutMode, positions, input.logicVariant ?? null);

    for (const position of plan.positions) {
      await db.query(
        `UPDATE structure_layout_position
         SET cell_index = $1, position_updated_at = now()
         WHERE card_id = $2 AND status = 'active'`,
        [position.baseOrder, position.cardId]
      );
    }
  }

  return updated;
}
