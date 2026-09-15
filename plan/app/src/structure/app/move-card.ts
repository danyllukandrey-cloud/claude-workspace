// App: moveCard use-case (T12) -- оркеструє domain/layout.ts (resolvePositionConflict)
// + infra/postgres-repo.ts (listActiveLayoutPositionsByOwner/updateLayoutPositionXY)
// + infra/history-repo.ts (insertHistoryEvent) для перетягування картки на
// вільному полотні Структури (contracts/openapi.yaml, moveCard, PUT
// /structure/layout/{cardId}).
//
// D-131-наступне рішення (Андрій, чат, 2026-09-15): "Схема не працює і вона
// жахлива. Пропоную прибрати повністю оті клітинки." + "Блоки мають
// пересуватись вільно... мишкою чи пальцем" -- cellIndex/фіксована сітка/
// AC-02 (колізія клітинки, D-62) прибрані ПОВНІСТЮ. Позиція -- {x, y}
// відсотки канви (0-100), перекриття карток дозволене, нічого не блокує.
//
// Порядок перевірок (кожна ДО будь-якого запису, окрім самого запису):
// 1. AC-03 (non-disclosure): картка без активної позиції власника --
//    structure.card_not_found, 404 -- той самий шаблон, що updateStructure.ts
//    для structure.not_found.
// 2. Edge case (ADR-0002, test-plan.md): last-write-wins за
//    positionUpdatedAt -- вхідна мітка не пізніша за вже збережену --
//    тихо повертаємо поточну позицію, без помилки й без запису.
// 3. Клемп x/y у межі 0..100 (clampPercent, domain/layout.ts) -- вільне
//    позиціювання не має колізії, лише діапазон.
// 4. Запис нового x/y/positionUpdatedAt.
// 5. AC-15: та ж подія записується в Літопис Структури ('moved'), той
//    самий механізм, що closeCard (AC-12) вже використовує для 'closed'.
//
// DI (правило залежностей, ADR-0004): db приходить ззовні, use-case сам
// з'єднання не створює.

import { resolvePositionConflict, clampPercent } from '../domain/layout';
import type { TimestampedPosition } from '../domain/layout';
import { listActiveLayoutPositionsByOwner, updateLayoutPositionXY } from '../infra/postgres-repo';
import type { LayoutPositionRecord, Db } from '../infra/postgres-repo';
import { insertHistoryEvent } from '../infra/history-repo';
import { AppError } from '../../shared/errors';

export interface MoveCardInput {
  ownerUserId: string;
  cardId: string;
  x: number;
  y: number;
  positionUpdatedAt: string;
}

/** Лог дій -- сигнатура збігається з agent/app/record-action.ts's `recordAction` (life-area-card/app/create-card.ts докладніше). */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

/**
 * Перетягування картки на нову позицію вільного полотна Структури (AC-08),
 * захищене від застарілого запису з іншого пристрою (ADR-0002
 * last-write-wins); успішний рух записує подію 'moved' у Літопис (AC-15).
 */
export async function moveCard(db: Db, input: MoveCardInput, recordAction?: RecordAction): Promise<LayoutPositionRecord> {
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
    x: current.x,
    y: current.y,
    positionUpdatedAt: current.positionUpdatedAt.toISOString(),
  };
  const clampedX = clampPercent(input.x);
  const clampedY = clampPercent(input.y);
  const incomingTimestamped: TimestampedPosition = {
    cardId: input.cardId,
    x: clampedX,
    y: clampedY,
    positionUpdatedAt: new Date(input.positionUpdatedAt).toISOString(),
  };

  const winner = resolvePositionConflict(currentTimestamped, incomingTimestamped);
  if (winner === currentTimestamped) {
    // Застарілий запис -- уже збережена позиція перемагає, тихо
    // відкидаємо, без помилки й без запису (edge case, ADR-0002).
    return current;
  }

  const moved = await updateLayoutPositionXY(
    db,
    input.ownerUserId,
    input.cardId,
    clampedX,
    clampedY,
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
    detail: formatMovedDetail(current.x, current.y, moved.x, moved.y),
  });

  if (recordAction) {
    await recordAction(db, { ownerUserId: input.ownerUserId, action: 'Переміщено картку на Схемі' });
  }

  return moved;
}

/**
 * Рядок `detail` події 'moved' (data-model.md лишає точну форму TBD, тож
 * форму диктують ЧИТАЧІ цього поля, не навпаки).
 *
 * D-131-наступне рішення: cellIndex-версія цього рядка ("cell_index -> N,
 * from_cell_index -> M") мала пастку порядку токенів (`from_cell_index`
 * містить підрядок `cell_index`, тож токени мусили йти в конкретному
 * порядку). Нові токени (`pos_x`/`pos_y`/`prev_x`/`prev_y`) НЕ є підрядками
 * одне одного -- та сама пастка тут фізично неможлива, порядок токенів
 * більше не має значення для читачів.
 *
 * Обидва читачі (../ports/layout-handlers.ts GET /structure/layout/history,
 * ../../app/main.tsx's loadAnalytics AC-07) потребують лише X (ранг
 * пріоритету за позицією) -- Y пишемо теж, для майбутнього повного
 * відтворення минулої розкладки (поза v1, spec.md §3 Non-goals).
 *
 * "Звідки" може не існувати: картка з купки нерозкладених (x/y NULL)
 * розкладається вперше. Тоді пишемо `prev_x -> none, prev_y -> none`, а не
 * число: нуль -- це крайня ліва позиція, і видати його ненавмисно означало
 * б приписати картці розташування, якого вона ніколи не мала.
 */
function formatMovedDetail(
  fromX: number | null,
  fromY: number | null,
  // `updateLayoutPositionXY` завжди пише реальні числа тут (clampPercent
  // ужито ДО запису, moveCard вище) -- тип лишається `number | null`, а не
  // звужується до `number`, лише тому, що LayoutPositionRecord.x/y є
  // nullable ЗАГАЛОМ (та сама колонка несе й "картка без позиції"); TS не
  // може вивести звуження через SQL round-trip. `none`-гілка нижче лишається
  // мертвою за нормальних обставин, але чесно описує тип, а не приховує його castʼом.
  toX: number | null,
  toY: number | null
): string {
  const prevX = fromX === null || fromX === undefined ? 'none' : String(fromX);
  const prevY = fromY === null || fromY === undefined ? 'none' : String(fromY);
  const nextX = toX === null || toX === undefined ? 'none' : String(toX);
  const nextY = toY === null || toY === undefined ? 'none' : String(toY);
  return `pos_x -> ${nextX}, pos_y -> ${nextY}, prev_x -> ${prevX}, prev_y -> ${prevY}`;
}
