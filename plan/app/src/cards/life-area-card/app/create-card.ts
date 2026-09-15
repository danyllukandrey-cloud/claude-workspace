// Use-case "створити картку" (T13) -- оркеструє T9 (доменна валідація назви) +
// T10 (запис у базу) рівно так, як описано у sad.md §6 Critical flow 1: порожня
// назва блокується ДО будь-якого запиту, валідна назва створює картку в стані
// "created" і одразу лишає слід у журналі життєвого циклу (card_lifecycle_event).
//
// DI (ADR-0004): `db` приймається параметром, use-case сам жодного зʼєднання
// не створює -- композицію робить викликач (ports/composition root).
//
// id картки генерується ТУТ, усередині use-case, а не приймається ззовні:
// це внутрішній ідентифікатор сутності, і саме use-case шар відповідає за
// його існування (той самий підхід нижче застосований і до id самої події
// життєвого циклу). Природний альтернативний варіант -- прийняти id як
// параметр від викликача (ports/HTTP-шар) -- відкладений: клієнт (AC-02)
// оперує лише назвою, генерація id на межі системи (ports) не додає жодної
// цінності, лише зайвий параметр, який довелось би прокидати з UI.
//
// CardValidationError (T9) навмисно НЕ перехоплюється й не перетворюється на
// AppError -- вона вже несе свій код (card.name_required) і має пройти нагору
// як є, порожня назва падає ДО insertCard: жодного запису в базу не станеться.
//
// Клітинка в розкладці Структури за замовчуванням (AC-09, sad.md §6 Critical
// flow 8): нова картка одразу отримує місце, і вибір способу розкладки
// користувача НЕ блокує. Так само, як archive-card.ts закриває позицію через
// інжектований closeStructurePosition, цей use-case приймає можливість
// `assignDefaultLayoutPosition` ЗЗОВНІ: life-area-card не імпортує нічого з
// structure/ напряму (правило залежностей, ADR-0004), конкретну реалізацію
// (structure/domain defaultPositionForNewCard + structure/infra
// insertLayoutPosition) підставляє composition root. Без переданої можливості
// (наявні викликачі й тести) крок просто не виконується -- не помилка, лише
// "структура поки не підключена". Збій присвоєння НЕ глушиться: обидва кроки
// йдуть у тій самій транзакції, тож помилка має відкотити й сам INSERT картки --
// інакше AC-09 виконано наполовину (картка є, клітинки немає).

import { randomUUID } from 'node:crypto';
import { createCard as buildCard } from '../domain/card';
import { insertCard, insertLifecycleEvent } from '../infra/postgres-repo';
import type { CardRecord, Db } from '../infra/postgres-repo';

export interface CreateCardInput {
  ownerUserId: string;
  name: string;
}

/**
 * Присвоїти новій картці клітинку в розкладці Структури за замовчуванням (AC-09).
 * Реалізація на стороні structure: прочитати активні позиції власника,
 * порахувати `defaultPositionForNewCard`, записати `insertLayoutPosition`.
 * `ownerUserId` потрібен реалізації, щоб знайти саму Структуру власника
 * (owner_user_id живе на `structure`, не на `structure_layout_position`).
 */
export type AssignDefaultLayoutPosition = (
  db: Db,
  ownerUserId: string,
  cardId: string
) => Promise<void>;

/**
 * Лог дій (Андрій: "тупо пишемо кожну дію -- час, дія, все.") -- сигнатура
 * збігається з agent/app/record-action.ts's `recordAction`, той самий DI-стиль,
 * що AssignDefaultLayoutPosition вище/CloseStructurePositionForCard
 * (archive-card.ts): опційний колаборатор, composition root підставляє
 * реальну реалізацію один раз для всіх use-case-ів.
 */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

export async function createCard(
  db: Db,
  input: CreateCardInput,
  assignDefaultLayoutPosition?: AssignDefaultLayoutPosition,
  recordAction?: RecordAction
): Promise<CardRecord> {
  // Доменна валідація (T9) -- кидає CardValidationError на порожню/пробільну
  // назву раніше за будь-який виклик db.query. buildCard також повертає назву
  // вже без зайвих пробілів по краях (trim), її й записуємо в базу.
  const card = buildCard({ id: randomUUID(), name: input.name });

  const record = await insertCard(db, {
    id: card.id,
    ownerUserId: input.ownerUserId,
    name: card.name,
    description: card.description,
  });

  // Журнал життєвого циклу -- append-only (data-model.md Notes), подія
  // "created" пишеться одразу після успішного insertCard у межах цього ж use-case.
  await insertLifecycleEvent(db, {
    id: randomUUID(),
    cardId: record.id,
    transition: 'created',
  });

  // AC-09: та сама транзакція (той самий db -- BEGIN/COMMIT відкриває
  // composition root, use-case транзакцій сам не відкриває), і лише ПІСЛЯ
  // успішного insertCard -- позиція посилається на картку по FK.
  if (assignDefaultLayoutPosition) {
    await assignDefaultLayoutPosition(db, input.ownerUserId, record.id);
  }

  if (recordAction) {
    await recordAction(db, { ownerUserId: input.ownerUserId, action: `Створено картку «${record.name}»` });
  }

  return record;
}
