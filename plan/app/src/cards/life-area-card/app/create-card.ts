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

import { randomUUID } from 'node:crypto';
import { createCard as buildCard } from '../domain/card';
import { insertCard, insertLifecycleEvent } from '../infra/postgres-repo';
import type { CardRecord, Db } from '../infra/postgres-repo';

export interface CreateCardInput {
  ownerUserId: string;
  name: string;
}

export async function createCard(db: Db, input: CreateCardInput): Promise<CardRecord> {
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

  return record;
}
