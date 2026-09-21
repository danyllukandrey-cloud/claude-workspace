// Use-case розархівації картки (T33) -- дзеркало archiveCard (T15),
// spec.md AC-17: status archived -> active + подія 'restored' у Літописі.
//
// Стара позиція в розкладці Структури НЕ ВІДНОВЛЮЄТЬСЯ автоматично (D-69,
// AC-17 -- "жодна стара позиція не мапиться автоматично", користувач
// розкладає картку заново вручну).
//
// Fix 2026-09-21 (живе тестування, картка "Філософія" застрягла в
// «Картку не знайдено в розкладці Структури» після циклу архів/розархів):
// "заново вручну" вимагає, щоб ПОЗИЦІЯ ВЗАГАЛІ ІСНУВАЛА (нехай і без x/y) --
// archiveCard закриває активну позицію (D-69/D-103), а нічого її НЕ
// відкривало назад, тож moveCard/createConnection (обидва фільтрують на
// status='active') назавжди відповідали card_not_found для будь-якої
// розархівованої картки. Той самий DI-підхід, що closeStructurePosition в
// archive-card.ts -- life-area-card НЕ імпортує нічого з structure/ напряму
// (правило залежностей, ADR-0004), можливість інжектується ззовні. Без
// переданого reopenStructurePosition (тести, чи поки composition root не
// готовий) use-case просто не робить цей крок -- не помилка.
//
// DI (ADR-0004): db приймається параметром, use-case сам зʼєднання не створює.
//
// Non-disclosure (AC-04): findCardById завжди отримує ownerUserId -- чужа й
// неіснуюча картка повертають однаковий null, власної перевірки власника
// тут не винаходимо.

import { AppError } from '../../../shared/errors';
import { findCardById, insertLifecycleEvent, updateCard } from '../infra/postgres-repo';
import type { CardRecord, Db } from '../infra/postgres-repo';

/** Сигнатура збігається з structure/infra/postgres-repo.ts reopenClosedLayoutPositionForCard. */
export type ReopenStructurePositionForCard = (db: Db, cardId: string) => Promise<void>;

/** Лог дій -- сигнатура збігається з agent/app/record-action.ts's `recordAction` (create-card.ts докладніше). */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

export async function restoreCard(
  db: Db,
  ownerUserId: string,
  cardId: string,
  reopenStructurePosition?: ReopenStructurePositionForCard,
  recordAction?: RecordAction
): Promise<CardRecord> {
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

  // Fix 2026-09-21: та сама транзакція (той самий db -- виклик composition
  // root обгортає всі кроки в BEGIN/COMMIT, use-case сам транзакцій не
  // відкриває) -- дзеркало closeStructurePosition в archive-card.ts.
  if (reopenStructurePosition) {
    await reopenStructurePosition(db, cardId);
  }

  if (recordAction) {
    await recordAction(db, { ownerUserId, action: `Відновлено картку «${restored.name}»` });
  }

  return restored;
}
