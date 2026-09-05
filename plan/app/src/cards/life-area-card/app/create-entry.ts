// Use-case "записати подію в метрику" (T18) -- оркеструє domain/entry.ts
// (T7, статус confirmed/pending) + domain/conflict.ts (T8, виявлення
// конфлікту "близько за часом з іншого пристрою") + infra/postgres-repo.ts
// (T10, збереження) -- sad.md §6 Flow 3/7. Викликається agent's confirm, не
// напряму користувачем (tasks/t18-app-create-entry.md §Why).
//
// DI (ADR-0004): `db` приймається параметром, use-case сам жодного з'єднання
// не створює -- композицію робить викликач (ports/composition root), той
// самий підхід, що в archive-card.ts/update-card.ts.
//
// Non-disclosure (AC-04): і картка, і блок-метрика в її межах перевіряються
// перед будь-яким записом. Контракт (contracts/openapi.yaml, ендпоінт
// POST /cards/{cardId}/metric-blocks/{metricBlockId}/entries, зафіксовано
// 2026-08-27) документує ОДИН код 404 на обидві причини -- "картка чи
// блок-метрика не знайдені/не належать користувачу" -> 'metric_block.not_found' --
// тож обидві гілки нижче кидають саме цей код, не два різних вигаданих тут.
//
// Друга перевірка (блок належить САМЕ цій картці) обов'язкова, не косметична:
// без неї власник валідної картки міг би підсунути чужий/довільний
// metricBlockId і отримати запис, чий card_id і реальний власник блоку
// розходяться -- діра в межі авторизації AC-04, а не лише в non-disclosure.
//
// AC-06 + AC-11 -- один прапорець на вхід у createEntry (T7): needsReview
// стає true, коли агент недоступний (AC-11, спрацьовує завжди -- незалежно
// від конфлікту) АБО коли detectConflict (T8) знайшов близький за часом
// запис з іншого пристрою (AC-06). Обидва випадки ведуть до того самого
// статусу pending -- домен (T7) не розрізняє причину, лише результат.
//
// До порівняння (AC-06) беруться лише 'pending'/'confirmed' існуючі записи
// (tasks/t8-domain-conflict.md §What) -- вже вирішений 'rejected' запис не
// повинен знову спричиняти pending для нового, незалежного запису.
//
// Той самий предикат detectConflict (T8) застосовується по одному кандидату
// за раз, щоб "чи є конфлікт" і "який САМЕ рядок конфліктує" ніколи не
// розходились у двох окремих реалізаціях однієї перевірки.
//
// AC-06 вимагає ОБИДВА записи pending, не лише новий: якщо конфлікт
// спричинив pending, і існуючий конфліктний запис зараз 'confirmed',
// переводимо і його в pending -- інакше один із двох суперечливих записів
// мовчки продовжував би рахуватись у прогрес.
//
// windowMs -- те саме "вікно близькості за часом", що й у detectConflict
// (T8): точне число ще не узгоджене з Андрієм (sad.md §11, відкрите
// питання, "перед /sdd:data-model life-area-card"), тому це параметр
// use-case з дефолтом-заглушкою, а не захардкоджена бізнес-константа.

import { randomUUID } from 'node:crypto';
import { createEntry as createDomainEntry } from '../domain/entry';
import { detectConflict } from '../domain/conflict';
import { findCardById, listMetricBlocksByCard, listEntriesByMetricBlock, insertEntry, updateEntryStatus } from '../infra/postgres-repo';
import type { EntryRecord, Db } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

/** Дефолт-заглушка, не узгоджене з Андрієм число -- див. коментар вище щодо windowMs. */
const DEFAULT_CONFLICT_WINDOW_MS = 60_000;

export interface CreateEntryInput {
  ownerUserId: string;
  cardId: string;
  metricBlockId: string;
  amount: number;
  rawText?: string | null;
  sourceDeviceId?: string | null;
  recordedAt: number;
  /** За замовчуванням true -- AC-11: коли агент недоступний, запис завжди йде як pending. */
  agentAvailable?: boolean;
  /** "Вікно близькості за часом" для detectConflict (T8) -- ще не узгоджене число, див. коментар вгорі файлу. */
  windowMs?: number;
}

export async function createEntry(db: Db, input: CreateEntryInput): Promise<EntryRecord> {
  // Non-disclosure (AC-04): чужа й неіснуюча картка -- однаковий null, той
  // самий контрактний код 404, що й для чужого/неіснуючого блоку нижче.
  const card = await findCardById(db, input.ownerUserId, input.cardId);
  if (!card) {
    throw new AppError('metric_block.not_found', 'Картку не знайдено', 404);
  }

  // Блок має належати САМЕ цій картці -- без цього чужий/довільний
  // metricBlockId міг би отримати запис через власну картку виклику
  // (AC-04 boundary, не лише non-disclosure).
  const blocks = await listMetricBlocksByCard(db, input.cardId);
  const metricBlock = blocks.find((block) => block.id === input.metricBlockId);
  if (!metricBlock) {
    throw new AppError('metric_block.not_found', 'Блок-метрику не знайдено', 404);
  }

  const existingEntries = await listEntriesByMetricBlock(db, input.metricBlockId);
  // AC-06: лише pending/confirmed записи беруть участь у виявленні конфлікту --
  // вже вирішений 'rejected' запис не повинен знову спричиняти pending.
  const candidateEntries = existingEntries.filter((existing) => existing.status !== 'rejected');

  const newTiming = {
    sourceDeviceId: input.sourceDeviceId ?? null,
    recordedAt: input.recordedAt,
  };
  const windowMs = input.windowMs ?? DEFAULT_CONFLICT_WINDOW_MS;
  const agentAvailable = input.agentAvailable ?? true;

  // Той самий предикат (T8, detectConflict), застосований по одному
  // кандидату за раз -- так "чи є конфлікт" і "який САМЕ рядок конфліктує"
  // виходять з одного джерела правди, не двох окремих реалізацій.
  const conflicting = candidateEntries.find((existing) =>
    detectConflict(newTiming, [{ sourceDeviceId: existing.sourceDeviceId, recordedAt: existing.recordedAt.getTime() }], windowMs)
  );
  const hasConflict = Boolean(conflicting);
  // AC-11 (агент недоступний) і AC-06 (конфлікт) -- один і той самий прапорець
  // на вхід у createEntry (T7), обидва ведуть до pending.
  const needsReview = !agentAvailable || hasConflict;

  const domainEntry = createDomainEntry({
    id: randomUUID(),
    metricBlockId: input.metricBlockId,
    amount: input.amount,
    needsReview,
  });

  const inserted = await insertEntry(db, {
    id: domainEntry.id,
    metricBlockId: input.metricBlockId,
    cardId: input.cardId,
    amount: input.amount,
    rawText: input.rawText ?? null,
    status: domainEntry.status,
    sourceDeviceId: input.sourceDeviceId ?? null,
  });

  // AC-06 вимагає ОБИДВА pending -- лише коли pending спричинений САМЕ
  // конфліктом (не лише недоступністю агента), і лише якщо існуючий
  // конфліктний запис зараз 'confirmed' -- інакше один із двох суперечливих
  // записів мовчки продовжував би рахуватись у прогрес.
  if (conflicting && conflicting.status === 'confirmed') {
    await updateEntryStatus(db, conflicting.id, 'pending');
  }

  return inserted;
}
