// App: updateCard use-case (T14) -- оркеструє domain/card.ts (T9) +
// infra/postgres-repo.ts (T10) для часткового оновлення картки й переходу
// в "filled" -- sad.md §6 Critical flow 2 (AC-03).
//
// Часткове оновлення: name/description можна зберігати окремо в будь-який
// момент -- це НЕ те саме, що позначення "заповнена". Позначення "заповнена"
// (markFilled: true) вимагає непорожній Опис (AC-03) -- або вже збережений
// раніше, або переданий у цьому ж виклику. Перевірку виконує domain/card.ts
// markFilled(), тут ми лише готуємо вхід (поточна картка + ефективний Опис)
// і фіксуємо результат: repo.updateCard + lifecycle-подія "filled".
//
// DI (правило залежностей, ADR-0004): use-case приймає `db` ззовні, сам
// зʼєднання ніколи не створює -- той самий принцип, що в local-cache.ts/
// claude-client.ts.
//
// Non-disclosure (AC-04): чужа й неіснуюча картка виглядають однаково зовні.
// findCardById/updateCard самі фільтрують за ownerUserId (repo вже гарантує
// це), тут власної перевірки власника не винаходимо -- лише перетворюємо
// їхній null на AppError('card.not_found', ..., 404), як і задекларовано в
// shared/errors/index.ts (ADR-0006 §Обґрунтування: "app-шар кидає той самий
// AppError('card.not_found', 404)").

import { markFilled } from '../domain/card';
import type { Card } from '../domain/card';
import { findCardById, updateCard as updateCardRow, insertLifecycleEvent } from '../infra/postgres-repo';
import type { CardRecord, Db } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

export interface UpdateCardInput {
  ownerUserId: string;
  cardId: string;
  /** Нова назва картки, якщо змінюється в цьому виклику. */
  name?: string;
  /** Новий Опис («навіщо»), якщо змінюється в цьому виклику -- незалежно від markFilled. */
  description?: string | null;
  /** true -- спробувати позначити картку "заповненою" (AC-03) у цьому ж виклику. */
  markFilled?: boolean;
}

/**
 * Часткове оновлення картки: name/description незалежно одне від одного,
 * і опційний перехід у "filled" (AC-03).
 *
 * Non-disclosure (AC-04): чужа чи неіснуюча картка -- AppError('card.not_found', 404).
 * Валідація "filled потребує непорожній Опис" відбувається ДО будь-якого запису
 * в базу (domain/card.ts markFilled кидає CardValidationError раніше, ніж ми
 * встигаємо викликати repo.updateCard).
 */
export async function updateCard(db: Db, input: UpdateCardInput): Promise<CardRecord> {
  const current = await findCardById(db, input.ownerUserId, input.cardId);
  if (!current) {
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  // Патч будуємо з полів, які реально передали в цьому виклику -- Опис
  // можна зберегти окремо від позначення "заповнена" (тіж поле, різні наміри).
  const patch: { name?: string; description?: string | null } = {};
  if (input.name !== undefined) {
    patch.name = input.name;
  }
  if (input.description !== undefined) {
    patch.description = input.description;
  }

  if (input.markFilled) {
    // Ефективний Опис для переходу -- переданий зараз, або вже збережений раніше.
    const effectiveDescription = input.description !== undefined ? input.description : current.description;
    const domainCard: Card = {
      id: current.id,
      name: current.name,
      description: current.description,
      status: current.status,
    };
    // Пропускаємо CardValidationError як є (не обгортаємо в AppError): код і
    // повідомлення вже у форматі "card.xxx", домен -- єдине джерело правди
    // для цього правила (AC-03). Кидається раніше за будь-який виклик
    // repo.updateCard нижче -- жодного UPDATE до успішної валідації.
    markFilled(domainCard, effectiveDescription ?? '');
  }

  const updated = await updateCardRow(db, input.ownerUserId, input.cardId, patch);
  if (!updated) {
    // Теоретично недосяжно одразу після успішного findCardById вище, але
    // non-disclosure дотримуємось і тут -- жодних припущень назовні про причину null.
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  if (input.markFilled) {
    await insertLifecycleEvent(db, { id: crypto.randomUUID(), cardId: input.cardId, transition: 'filled' });
  }

  return updated;
}
