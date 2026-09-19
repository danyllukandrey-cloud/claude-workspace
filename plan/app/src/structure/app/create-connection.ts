// App: createConnection use-case -- POST /structure/connections
// (contracts/openapi.yaml createConnection). Вимоги 4/5 (Андрій, чат,
// 2026-09-15): "Між блоками потрібно створити звязки... якщо ми робимо
// стрілки то нам потрібно буде додати їх як інструментарій можливого
// з'єднання" -- інструмент "Зв'язати" створює звичайну лінію (directed:
// false) чи стрілку (directed: true, cardIdA -> cardIdB) між двома картками
// власника.
//
// Owner-scoped, non-disclosure (AC-03 pattern, той самий, що moveCard/
// closeCard усюди в цій фічі): обидві картки мусять мати активну позицію
// цього власника -- інакше structure.card_not_found, той самий код, що
// решта Структури кидає на чужу/неіснуючу картку.
//
// DI (ADR-0004): db приходить ззовні, use-case сам з'єднання не створює.

import { listActiveLayoutPositionsByOwner, insertConnection } from '../infra/postgres-repo';
import type { ConnectionRecord, Db } from '../infra/postgres-repo';
import { AppError } from '../../shared/errors';

export interface CreateConnectionInput {
  ownerUserId: string;
  cardIdA: string;
  cardIdB: string;
  directed: boolean;
}

/** Лог дій -- сигнатура збігається з agent/app/record-action.ts's `recordAction`. */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

export async function createConnection(
  db: Db,
  input: CreateConnectionInput,
  recordAction?: RecordAction
): Promise<ConnectionRecord> {
  if (input.cardIdA === input.cardIdB) {
    throw new AppError('structure.connection_requires_two_cards', "Не можна з'єднати картку саму із собою", 422);
  }

  const activePositions = await listActiveLayoutPositionsByOwner(db, input.ownerUserId);
  const ownedCardIds = new Set(activePositions.map((position) => position.cardId));
  if (!ownedCardIds.has(input.cardIdA) || !ownedCardIds.has(input.cardIdB)) {
    throw new AppError('structure.card_not_found', 'Картку не знайдено в розкладці Структури', 404);
  }

  // Обидва cardId уже підтверджені належними цьому власнику (перевірка
  // вище) -- бере structureId з будь-якої з їхніх позицій, вони завжди в
  // ОДНІЙ Структурі (singleton на власника).
  const structureId = activePositions.find((position) => position.cardId === input.cardIdA)!.structureId;

  const created = await insertConnection(db, {
    id: crypto.randomUUID(),
    structureId,
    cardIdA: input.cardIdA,
    cardIdB: input.cardIdB,
    directed: input.directed,
  });

  if (recordAction) {
    await recordAction(db, {
      ownerUserId: input.ownerUserId,
      action: input.directed ? 'Додано стрілку між картками на Схемі' : 'Додано лінію між картками на Схемі',
    });
  }

  return created;
}
