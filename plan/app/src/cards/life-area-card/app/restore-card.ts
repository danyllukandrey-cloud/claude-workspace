// Use-case розархівації картки (T33) -- дзеркало archiveCard (T15),
// spec.md AC-17: status archived -> active + подія 'restored' у Літописі.
//
// Позиція в розкладці Структури НЕ відновлюється тут (D-69, AC-17) -- це
// відповідальність картки `structure`, не life-area-card. Цей use-case
// торкається лише самої картки (status) і її Літопису (card_lifecycle_event).
//
// DI (ADR-0004): db приймається параметром, use-case сам зʼєднання не створює.
//
// Non-disclosure (AC-04): findCardById завжди отримує ownerUserId -- чужа й
// неіснуюча картка повертають однаковий null, власної перевірки власника
// тут не винаходимо.

import { AppError } from '../../../shared/errors';
import { findCardById, insertLifecycleEvent, updateCard } from '../infra/postgres-repo';
import type { CardRecord, Db } from '../infra/postgres-repo';

export async function restoreCard(db: Db, ownerUserId: string, cardId: string): Promise<CardRecord> {
  const card = await findCardById(db, ownerUserId, cardId);
  if (!card) {
    // Non-disclosure (AC-04): чужа й неіснуюча картка -- та сама відповідь.
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  if (card.status !== 'archived') {
    // Інша помилка, ніж "не знайдено" -- картка існує й належить користувачу,
    // просто вже активна. Нічого не пишеться (ні UPDATE, ні lifecycle event).
    throw new AppError('card.not_archived', 'Картка не в архіві', 409);
  }

  const restored = await updateCard(db, ownerUserId, cardId, { status: 'active' });
  if (!restored) {
    // Захист від рейс-кондишн (картку видалили/перепризначили між SELECT і
    // UPDATE) -- та сама non-disclosure відповідь, що й на старті.
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  await insertLifecycleEvent(db, { id: crypto.randomUUID(), cardId, transition: 'restored' });

  return restored;
}
