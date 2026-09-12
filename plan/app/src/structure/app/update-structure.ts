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
// Зворотний бік того самого інваріанта (рев'ю 2026-09-11): вихід із режиму
// 'logic' ОБНУЛЯЄ збережений підвид -- інакше в БД лишається logic_variant,
// якого в поточному режимі не існує. Спроба перемкнути лише підвид поза
// режимом 'logic' -- доменна помилка (assertLogicVariantSwitchable), теж до
// будь-якого запису.
//
// Non-disclosure (AC-03): Структура -- singleton на ownerUserId, findStructureByOwner
// сам скопує вибірку; чужа/неіснуюча Структура тут виглядають як structure.not_found,
// той самий шаблон, що update-card.ts для card.not_found.
//
// DI (правило залежностей, ADR-0004): db приходить ззовні, use-case сам
// з'єднання не створює.

import { assertLogicVariantSwitchable, switchLayoutMode, switchLogicVariant } from '../domain/layout';
import type { LayoutMode, LogicVariant } from '../domain/layout';
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
  logicVariant?: LogicVariant;
}

/**
 * Часткове оновлення Структури -- declaration/layoutMode/logicVariant кожен
 * незалежний (AC-10). Зміна layoutMode чи logicVariant на нове значення знімає
 * клітинку з КОЖНОЇ активної позиції (cell_index -> NULL, "картка без клітинки"
 * у треї нерозкладених) -- користувач розкладає картки під новий режим сам
 * (AC-11b/AC-16b). Вихід із режиму 'logic' до того ж обнуляє збережений підвид.
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

  // AC-16b, теж ДО будь-якого запису (рев'ю 2026-09-11): PATCH, що перемикає
  // ЛИШЕ підвид (layoutMode у тілі немає), поза режимом 'logic' неможливий --
  // зокрема {logicVariant: null} на вже-'free' Структурі зі залишковим підвидом.
  // Раніше ця сама доменна помилка вилітала ПІСЛЯ запису, з середини reset-циклу,
  // і сервер бачив її як невідому -> 500. Клас помилки доменний
  // (LayoutValidationError), use-case його не підміняє: мапінг на 422 -- у
  // error-middleware, там же, де решта доменних помилок.
  //
  // Запит, що НАЗИВАЄ режим, — інша річ: він описує цільовий стан розкладки
  // цілком (режим + підвид), тому {layoutMode: 'free', logicVariant: null} --
  // легальне приведення до інваріанта, не "перемикання підвиду".
  if (logicVariantChanged && input.layoutMode === undefined) {
    assertLogicVariantSwitchable(current.layoutMode);
  }

  // AC-16 (інваріант): logic_variant має сенс ЛИШЕ при layoutMode = 'logic'.
  // Коли PATCH ставить режим, відмінний від 'logic', залишок підвиду в БД
  // обнуляється тим самим запитом -- навіть якщо logicVariant у тілі не
  // приходив, і навіть якщо режим повторює вже збережений (рев'ю 2026-09-11:
  // інваріант не тримав ніхто, Структура лишалась із підвидом, якого в її
  // режимі не існує). Декларацію саму по собі це не чіпає (AC-10): тригер --
  // наявність layoutMode у запиті, не будь-який PATCH.
  const clearsStaleLogicVariant =
    input.logicVariant === undefined &&
    input.layoutMode !== undefined &&
    input.layoutMode !== 'logic' &&
    current.logicVariant !== null;

  const patch: { declaration?: string | null; layoutMode?: LayoutMode; logicVariant?: LogicVariant } = {};
  if (input.declaration !== undefined) patch.declaration = input.declaration;
  if (input.layoutMode !== undefined) patch.layoutMode = input.layoutMode;
  if (input.logicVariant !== undefined) patch.logicVariant = input.logicVariant;
  else if (clearsStaleLogicVariant) patch.logicVariant = null;

  const updated = await updateStructureRow(db, input.ownerUserId, patch);
  if (!updated) {
    throw new AppError('structure.not_found', 'Структуру не знайдено', 404);
  }

  // AC-11b/AC-16b: той самий reset-механізм в обох випадках -- лише коли
  // режим чи підвид реально ЗМІНИЛИСЬ на нове значення (не при повторі того,
  // що вже збережене). Обнулення залишкового підвиду при виході з режиму
  // 'logic' -- НЕ перемикання підвиду: розкладка від нього вже не залежить,
  // тож сам цей запит нічого не скидає (а reset, якщо треба, дає зміна режиму).
  const logicVariantSwitched = logicVariantChanged && effectiveLayoutMode === 'logic';
  const resetTriggered = layoutModeChanged || logicVariantSwitched;
  if (resetTriggered) {
    const activePositions = await listActiveLayoutPositionsByOwner(db, input.ownerUserId);
    const positions = activePositions.map((position) => ({ cardId: position.cardId, cellIndex: position.cellIndex }));

    const plan = layoutModeChanged
      ? switchLayoutMode(positions, effectiveLayoutMode)
      : switchLogicVariant(current.layoutMode, positions, input.logicVariant ?? null);

    // Одна мітка часу на весь reset -- це ОДНА дія користувача, не N окремих
    // перетягувань (LWW, ADR-0002).
    const resetAt = new Date();

    for (const position of plan.positions) {
      // `position.cellIndex` домен завжди віддає null -- "картка без клітинки"
      // (AC-11b/AC-16b), і саме NULL має лягти в БД. Рев'ю 2026-09-11: тут
      // писався `position.baseOrder`, тобто реальна клітинка 0..N-1 -- стан
      // "без клітинки" був неспостережуваний, а послідовні UPDATE ще й могли
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

  return updated;
}
