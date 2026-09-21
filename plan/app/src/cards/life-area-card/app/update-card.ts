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
//
// Синхронізація з Літописом Структури (AC-15, D-103/D-115, закриває ISS-105):
// перейменування картки -- та сама подія 'renamed', той самий DI-шаблон, що
// archive-card.ts's closeStructurePosition. life-area-card НЕ імпортує нічого
// з structure/ напряму (правило залежностей, ADR-0004) -- можливість
// інжектується ззовні. Без переданого recordRenameEvent (наприклад, у тестах
// чи поки composition root не готовий) use-case просто не робить цей крок --
// не помилка, лише "Структура поки не підключена".

import { markFilled, setTrackingModeOngoing, setTrackingModeGoals, setTrackingModeState, isCardHealthState, CardValidationError } from '../domain/card';
import type { Card, CardTrackingMode, CardHealthState } from '../domain/card';
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
  /**
   * CH-02/CH-10 (docs/features/life-area-card/changes.md): перемикає режим
   * відстеження картки. 'state' вимагає healthState у ЦЬОМУ Ж виклику
   * (domain/card.ts setTrackingModeState) -- 'ongoing'/'goals' завжди
   * скидають healthState на null (setTrackingModeOngoing/setTrackingModeGoals),
   * незалежно від того, що передано в healthState.
   */
  trackingMode?: CardTrackingMode;
  /** CH-02: обов'язкове, лише коли trackingMode === 'state' у цьому ж виклику. */
  healthState?: CardHealthState | null;
}

/** Сигнатура збігається з structure/infra/history-repo.ts recordCardRenameEvent. */
export type RecordCardRenameEvent = (db: Db, ownerUserId: string, cardId: string, newName: string) => Promise<void>;

/** Лог дій -- сигнатура збігається з agent/app/record-action.ts's `recordAction` (create-card.ts докладніше). */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

/**
 * Часткове оновлення картки: name/description незалежно одне від одного,
 * і опційний перехід у "filled" (AC-03).
 *
 * Non-disclosure (AC-04): чужа чи неіснуюча картка -- AppError('card.not_found', 404).
 * Валідація "filled потребує непорожній Опис" відбувається ДО будь-якого запису
 * в базу (domain/card.ts markFilled кидає CardValidationError раніше, ніж ми
 * встигаємо викликати repo.updateCard).
 */
export async function updateCard(
  db: Db,
  input: UpdateCardInput,
  recordRenameEvent?: RecordCardRenameEvent,
  recordAction?: RecordAction
): Promise<CardRecord> {
  const current = await findCardById(db, input.ownerUserId, input.cardId);
  if (!current) {
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  // Патч будуємо з полів, які реально передали в цьому виклику -- Опис
  // можна зберегти окремо від позначення "заповнена" (тіж поле, різні наміри).
  const patch: {
    name?: string;
    description?: string | null;
    trackingMode?: CardTrackingMode;
    healthState?: CardHealthState | null;
  } = {};
  if (input.name !== undefined) {
    patch.name = input.name;
  }
  if (input.description !== undefined) {
    patch.description = input.description;
  }

  // Поточна картка як доменний Card -- база і для markFilled() нижче, і для
  // CH-02's trackingMode-перемикання (обидва -- чисті доменні функції, що
  // повертають НОВУ копію, самі нічого в базу не пишуть).
  const domainCard: Card = {
    id: current.id,
    name: current.name,
    description: current.description,
    status: current.status,
    trackingMode: current.trackingMode,
    healthState: current.healthState,
  };

  // CH-02/CH-10: перемикання режиму ДО будь-якого запису в базу -- той самий
  // принцип, що markFilled нижче: доменна валідація (тут -- "healthState
  // обов'язковий для 'state'") кидається раніше за repo.updateCard.
  if (input.trackingMode !== undefined) {
    if (input.trackingMode === 'state') {
      if (!isCardHealthState(input.healthState)) {
        throw new CardValidationError(
          'card.health_state_required',
          'Оберіть стан картки: використовується, критично потребує відновлення чи на паузі'
        );
      }
      const switched = setTrackingModeState(domainCard, input.healthState);
      patch.trackingMode = switched.trackingMode;
      patch.healthState = switched.healthState;
    } else {
      const switched =
        input.trackingMode === 'ongoing' ? setTrackingModeOngoing(domainCard) : setTrackingModeGoals(domainCard);
      patch.trackingMode = switched.trackingMode;
      patch.healthState = switched.healthState;
    }
  }

  if (input.markFilled) {
    // Ефективний Опис для переходу -- переданий зараз, або вже збережений раніше.
    const effectiveDescription = input.description !== undefined ? input.description : current.description;
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

  // Review-fix (CH-06, docs/features/life-area-card/changes.md): guard
  // винесено з recordAction і застосовано ТУТ ТЕЖ, на сам lifecycle-запис --
  // раніше guard стояв лише на recordAction нижче (коментар, що лишився,
  // пояснює чому він узагалі з'явився), а insertLifecycleEvent (append-only
  // audit-журнал, spec.md §7 KPI) писав "filled" щоразу, коли markFilled:true
  // приходив у тілі -- рідкісний край-випадок до CH-06 (ручний чекбокс), але
  // CH-06 зробив markFilled похідним від "Опис непорожній" і шле його на
  // КОЖНЕ збереження форми, тож без guard тут повторний перехід писався б
  // при кожному перейменуванні вже заповненої картки.
  if (input.markFilled && !current.description) {
    await insertLifecycleEvent(db, { id: crypto.randomUUID(), cardId: input.cardId, transition: 'filled' });
    if (recordAction) {
      await recordAction(db, { ownerUserId: input.ownerUserId, action: `Заповнено опис картки «${updated.name}»` });
    }
  }

  // AC-15/D-115: лише СПРАВЖНЄ перейменування (нова назва відрізняється від
  // поточної) пише подію в Літопис Структури -- виклик з тим самим іменем чи
  // без поля `name` взагалі (наприклад, markFilled-лише виклик) не рахується
  // перейменуванням.
  if (input.name !== undefined && input.name !== current.name) {
    if (recordRenameEvent) {
      await recordRenameEvent(db, input.ownerUserId, input.cardId, input.name);
    }
    if (recordAction) {
      await recordAction(db, { ownerUserId: input.ownerUserId, action: `Перейменовано картку «${current.name}» на «${input.name}»` });
    }
  }

  return updated;
}
