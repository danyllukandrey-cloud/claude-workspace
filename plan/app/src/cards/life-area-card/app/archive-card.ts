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
// Синхронізація з structure_layout_position -- НЕ відповідальність цього
// use-case. Задокументована прогалина: ISS-26 (docs/ISSUES.md) -- заявлена
// "окрема вже спроєктована логіка structure" (D-69) насправді не існує.

import { randomUUID } from 'node:crypto';
import { insertLifecycleEvent, updateCard } from '../infra/postgres-repo';
import type { CardRecord, Db } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

export interface ArchiveCardInput {
  ownerUserId: string;
  cardId: string;
}

export async function archiveCard(db: Db, input: ArchiveCardInput): Promise<CardRecord> {
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

  return record;
}
