// App: deleteConnection use-case -- DELETE /structure/connections/{connectionId}
// (contracts/openapi.yaml deleteConnection). Вимога 4 (Андрій, чат,
// 2026-09-15): "можемо розєднати і перезєднати" -- тап по наявній лінії/
// стрілці на Схемі видаляє її (легша дія, ніж архівація картки -- миттєве
// видалення без діалогу підтвердження, screens.md пояснює вибір).
//
// Owner-scoped, non-disclosure (AC-03 pattern): чужий/неіснуючий зв'язок --
// той самий 404, ніколи не підтверджуємо/спростовуємо, який саме випадок.
//
// DI (ADR-0004): db приходить ззовні, use-case сам з'єднання не створює.

import { deleteConnection as deleteConnectionRow } from '../infra/postgres-repo';
import type { Db } from '../infra/postgres-repo';
import { AppError } from '../../shared/errors';

export interface DeleteConnectionInput {
  ownerUserId: string;
  connectionId: string;
}

/** Лог дій -- сигнатура збігається з agent/app/record-action.ts's `recordAction`. */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

export async function deleteConnection(db: Db, input: DeleteConnectionInput, recordAction?: RecordAction): Promise<void> {
  const deleted = await deleteConnectionRow(db, input.ownerUserId, input.connectionId);
  if (!deleted) {
    throw new AppError('structure.connection_not_found', "Зв'язок не знайдено", 404);
  }

  if (recordAction) {
    await recordAction(db, { ownerUserId: input.ownerUserId, action: "Видалено зв'язок на Схемі" });
  }
}
