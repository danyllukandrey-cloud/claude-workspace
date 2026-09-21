// CH-15 (docs/features/life-area-card/changes.md): "Видалити" в Архіві
// карток -- назавжди, не архівація. Лише для вже архівованої картки (той
// самий "тільки з архіву" вхід, що restoreCard) -- захист від випадкового
// permanent delete активної картки повз архівний екран.
//
// Non-disclosure (AC-04): findCardById завжди отримує ownerUserId -- чужа й
// неіснуюча картка повертають однакову помилку, власної перевірки власника
// тут не винаходимо.
//
// DI (ADR-0004): db приймається параметром, use-case сам зʼєднання не створює.

import { AppError } from '../../../shared/errors';
import { findCardById, deleteCard as deleteCardRow } from '../infra/postgres-repo';
import type { Db } from '../infra/postgres-repo';

/** Лог дій -- сигнатура збігається з agent/app/record-action.ts's `recordAction` (create-card.ts докладніше). */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

export async function deleteCard(db: Db, ownerUserId: string, cardId: string, recordAction?: RecordAction): Promise<void> {
  const card = await findCardById(db, ownerUserId, cardId);
  if (!card) {
    // Non-disclosure (AC-04): чужа й неіснуюча картка -- та сама відповідь.
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  if (card.status !== 'archived') {
    // Дзеркало restoreCard's card.not_archived -- permanent delete лише з
    // архіву, не з активної колоди повз цей екран.
    throw new AppError('card.not_archived', 'Картка не в архіві', 409);
  }

  const deleted = await deleteCardRow(db, ownerUserId, cardId);
  if (!deleted) {
    // Захист від рейс-кондишн (картку вже видалили між SELECT і DELETE) --
    // та сама non-disclosure відповідь, що й на старті.
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  // recordAction -- ПІСЛЯ deleteCardRow, не до: сам запис лога (action_log)
  // не посилається на card_id (не FK), тож порядок тут не про каскад, лише
  // про "не логувати дію, що не відбулась" при провалі DELETE вище.
  if (recordAction) {
    await recordAction(db, { ownerUserId, action: `Видалено назавжди картку «${card.name}»` });
  }
}
