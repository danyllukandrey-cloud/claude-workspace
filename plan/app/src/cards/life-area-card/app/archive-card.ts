// Use-case "архівувати картку" (T15) -- мʼяка архівація, sad.md §6 Critical
// flow 13: картка позначається status='archived' через repo.updateCard і
// зникає з колоди (listActiveCardsByOwner), але лишається читомою напряму
// (findCardById) і відновлюваною -- НІКОЛИ фізичне видалення (AC-16).
//
// DI (ADR-0004): `db` приймається параметром, use-case сам жодного зʼєднання
// не створює -- композицію робить викликач (ports/composition root).
//
// Non-disclosure (AC-04): ownerUserId завжди йде в updateCard, репозиторій
// сам повертає null і для чужої, і для неіснуючої картки -- власної перевірки
// власника тут не винаходимо. AppError('card.not_found', 404) -- та сама форма,
// що й у T14/T33 (вирівняно за ревʼю критика хвилі 5: ports-шар (T21) отримує
// один шаблон обробки non-disclosure на всі три use-case, не два різних).
//
// Синхронізація з structure_layout_position (D-69/D-103, закриває ISS-26):
// та сама транзакція, той самий запит -- архівація картки закриває її активну
// позицію в розкладці Структури, якщо вона є. life-area-card НЕ імпортує
// нічого з structure/ напряму (правило залежностей, ADR-0004) -- можливість
// інжектується ззовні, той самий підхід, що й StoragePort/callClaude в цьому
// проєкті. Без переданого closeStructurePosition (наприклад, у тестах чи
// поки composition root не готовий) use-case просто не робить цей крок --
// не помилка, лише "структура поки не підключена".

import { randomUUID } from 'node:crypto';
import { insertLifecycleEvent, updateCard } from '../infra/postgres-repo';
import type { CardRecord, Db } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

export interface ArchiveCardInput {
  ownerUserId: string;
  cardId: string;
}

/** Сигнатура збігається з structure/infra/postgres-repo.ts closeActiveLayoutPositionForCard. */
export type CloseStructurePositionForCard = (db: Db, cardId: string) => Promise<void>;

/** Лог дій -- сигнатура збігається з agent/app/record-action.ts's `recordAction` (create-card.ts докладніше). */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

export async function archiveCard(
  db: Db,
  input: ArchiveCardInput,
  closeStructurePosition?: CloseStructurePositionForCard,
  recordAction?: RecordAction
): Promise<CardRecord> {
  const record = await updateCard(db, input.ownerUserId, input.cardId, { status: 'archived' });
  if (!record) {
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  // Журнал життєвого циклу -- append-only (data-model.md Notes), подія
  // "archived" пишеться одразу після успішного updateCard у межах цього ж use-case.
  await insertLifecycleEvent(db, {
    id: randomUUID(),
    cardId: record.id,
    transition: 'archived',
  });

  // D-69/D-103: та сама транзакція (той самий db -- виклик composition root
  // обгортає обидва кроки в BEGIN/COMMIT, use-case сам транзакцій не відкриває).
  if (closeStructurePosition) {
    await closeStructurePosition(db, record.id);
  }

  if (recordAction) {
    await recordAction(db, { ownerUserId: input.ownerUserId, action: `Заархівовано картку «${record.name}»` });
  }

  return record;
}
