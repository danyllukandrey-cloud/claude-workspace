// App: moveCard use-case (T12) -- оркеструє domain/layout.ts (T4:
// assertCellAvailable/resolvePositionConflict) + infra/postgres-repo.ts
// (listActiveLayoutPositionsByOwner/updateLayoutPositionCell) +
// infra/history-repo.ts (insertHistoryEvent) для перетягування картки в
// розкладці Структури (contracts/openapi.yaml, moveCard, PUT
// /structure/layout/{cardId}).
//
// Порядок перевірок (кожна ДО будь-якого запису, окрім самого запису):
// 1. AC-03 (non-disclosure): картка без активної позиції власника --
//    structure.card_not_found, 404 -- той самий шаблон, що updateStructure.ts
//    для structure.not_found.
// 2. Edge case (ADR-0002, test-plan.md): last-write-wins за
//    positionUpdatedAt -- вхідна мітка не пізніша за вже збережену --
//    тихо повертаємо поточну позицію, без помилки й без запису.
// 3. AC-02 (D-62): клітинка вже зайнята ІНШОЮ активною карткою --
//    structure.cell_occupied, 409 (domain's LayoutValidationError
//    перегорнута в AppError -- домен не знає про HTTP).
// 4. AC-08: запис нового cellIndex/positionUpdatedAt.
// 5. AC-15: та ж подія записується в Літопис Структури ('moved'), той
//    самий механізм, що closeCard (AC-12) вже використовує для 'closed'.
//
// DI (правило залежностей, ADR-0004): db приходить ззовні, use-case сам
// з'єднання не створює.

import {
  assertCellAvailable,
  resolvePositionConflict,
  LayoutValidationError,
} from '../domain/layout';
import type { TimestampedPosition } from '../domain/layout';
import { listActiveLayoutPositionsByOwner, updateLayoutPositionCell } from '../infra/postgres-repo';
import type { LayoutPositionRecord, Db } from '../infra/postgres-repo';
import { insertHistoryEvent } from '../infra/history-repo';
import { AppError } from '../../shared/errors';

export interface MoveCardInput {
  ownerUserId: string;
  cardId: string;
  cellIndex: number;
  positionUpdatedAt: string;
}

/**
 * Перетягування картки в нову клітинку розкладки Структури (AC-08),
 * захищене від колізії (AC-02/D-62) і від застарілого запису з іншого
 * пристрою (ADR-0002 last-write-wins); успішний рух записує подію
 * 'moved' у Літопис (AC-15).
 */
export async function moveCard(db: Db, input: MoveCardInput): Promise<LayoutPositionRecord> {
  const activePositions = await listActiveLayoutPositionsByOwner(db, input.ownerUserId);
  const current = activePositions.find((position) => position.cardId === input.cardId);
  if (!current) {
    throw new AppError('structure.card_not_found', 'Картку не знайдено в розкладці Структури', 404);
  }

  // Нормалізуємо обидві мітки в один формат (ISO з мілісекундами) ПЕРЕД
  // порівнянням -- рядок з мережі і Date з БД інакше можуть відрізнятись
  // лише форматом, не значенням, і зламати лексикографічне порівняння
  // всередині resolvePositionConflict.
  const currentTimestamped: TimestampedPosition = {
    cardId: current.cardId,
    cellIndex: current.cellIndex,
    positionUpdatedAt: current.positionUpdatedAt.toISOString(),
  };
  const incomingTimestamped: TimestampedPosition = {
    cardId: input.cardId,
    cellIndex: input.cellIndex,
    positionUpdatedAt: new Date(input.positionUpdatedAt).toISOString(),
  };

  const winner = resolvePositionConflict(currentTimestamped, incomingTimestamped);
  if (winner === currentTimestamped) {
    // Застарілий запис -- уже збережена позиція перемагає, тихо
    // відкидаємо, без помилки й без запису (edge case, ADR-0002).
    return current;
  }

  try {
    assertCellAvailable(activePositions, input.cellIndex, input.cardId);
  } catch (error) {
    if (error instanceof LayoutValidationError) {
      throw new AppError('structure.cell_occupied', error.message, 409);
    }
    throw error;
  }

  const moved = await updateLayoutPositionCell(
    db,
    input.ownerUserId,
    input.cardId,
    input.cellIndex,
    input.positionUpdatedAt
  );
  if (!moved) {
    throw new AppError('structure.card_not_found', 'Картку не знайдено в розкладці Структури', 404);
  }

  await insertHistoryEvent(db, {
    id: crypto.randomUUID(),
    structureId: moved.structureId,
    cardId: moved.cardId,
    eventType: 'moved',
  });

  return moved;
}
