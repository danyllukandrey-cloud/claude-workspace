// Ports: HTTP-хендлери картки (T21 + T35 -- той самий файл, tracker.md
// files_hint, ISS-38) -- contracts/openapi.yaml `/api/v1/cards*`.
//
// Framework-agnostic (ADR-0005/сесійний бриф): у репо ще немає жодного HTTP-
// фреймворку (Express/Fastify) -- це навмисно, T30 підключить конкретний
// транспорт пізніше. Кожен хендлер тут -- звичайна async-функція виду
// (db, ownerUserId, ...параметри шляху/query, тіло) -> об'єкт відповідної
// схеми контракту. Помилки (AppError чи доменний CardValidationError) НЕ
// перехоплюються тут -- пропускаються нагору як є, майбутній транспортний шар
// (T30) відповідає .code/.message/.httpStatus за контрактом.
//
// Non-disclosure (AC-04): use-case шар (T13-T20) уже гарантує однаковий
// card.not_found для чужої й неіснуючої картки -- цей шар нічого зверху не
// додає й не забирає, лише мапить успішний результат у форму контракту.
//
// card.metricBlocks НЕ входить у схему Card (additionalProperties: false,
// лише aggregateProgress/dataWarning) -- відома нестиковка ISS-39, вирішується
// окремо перед хвилею 7. Детальний список по блоках тут навмисно не додається.

import { listCards as listCardsUseCase } from '../app/list-cards';
import { createCard as createCardUseCase } from '../app/create-card';
import { getCardWithProgress } from '../app/get-card';
import type { CallClaude } from '../app/get-card';
import { updateCard as updateCardUseCase } from '../app/update-card';
import type { RecordCardRenameEvent } from '../app/update-card';
import { archiveCard as archiveCardUseCase } from '../app/archive-card';
import type { CloseStructurePositionForCard } from '../app/archive-card';
import { restoreCard as restoreCardUseCase } from '../app/restore-card';
import type { CardRecord, CardStatusRow, Db } from '../infra/postgres-repo';

// --- DTO -- форма відповіді, camelCase, точно як у схемах контракту --------
// ownerUserId навмисно НЕ входить у жодну публічну схему -- відсіюємо тут.

export interface CardDto {
  id: string;
  name: string;
  description: string | null;
  status: CardStatusRow;
  /**
   * Присутнє лише там, де відповідний use-case реально рахує прогрес (getCard,
   * T20) -- createCard/updateCard/archiveCard/listCards повертають CardRecord
   * без обчисленого прогресу, і додавати сюди `null` було б хибним сигналом
   * ("прогресу немає"), а не чесним "тут його не рахували".
   */
  aggregateProgress?: number | null;
  dataWarning?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CardPageDto {
  items: CardDto[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

function toCardDto(record: CardRecord): CardDto {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

// --- listCards -- GET /api/v1/cards ----------------------------------------

export interface ListCardsQuery {
  /** default 'active' -- прокидається як є в use-case, чий власний параметр за замовчуванням теж 'active'. */
  status?: CardStatusRow;
  /** uuid курсор попередньої сторінки (id останньої картки). */
  after?: string;
  /** 1..100, default 50. */
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit)));
}

/**
 * listActiveCardsByOwner (postgres-repo.ts) не має ORDER BY -- сортуємо тут,
 * САМІ, перед різанням на сторінки. Обираємо "найновіша картка створена
 * першою" (createdAt DESC, id як тай-брейк для повної визначеності при
 * однаковому createdAt) -- та сама логіка застосована й до архівної гілки
 * (навіть попри те, що listArchivedCardsByOwner вже сортує на рівні SQL за
 * updated_at DESC): курсор пагінації ("after") має спиратись на ОДИН
 * послідовний порядок для обох статусів, інакше перемикання active/archived
 * дає непередбачувану позицію курсора.
 */
function sortCardsForPaging(records: CardRecord[]): CardRecord[] {
  return [...records].sort((a, b) => {
    const byCreatedAt = b.createdAt.getTime() - a.createdAt.getTime();
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export async function listCards(db: Db, ownerUserId: string, query: ListCardsQuery = {}): Promise<CardPageDto> {
  const records = sortCardsForPaging(await listCardsUseCase(db, ownerUserId, query.status));
  const limit = clampLimit(query.limit);

  let startIndex = 0;
  if (query.after) {
    const afterIndex = records.findIndex((record) => record.id === query.after);
    // Курсор не знайдено (картку могли видалити/переархівувати між запитами) --
    // контракт не визначає код помилки для цього випадку, тож трактуємо як
    // "невалідний курсор" і читаємо з початку списку (лінієнтна поведінка).
    if (afterIndex !== -1) {
      startIndex = afterIndex + 1;
    }
  }

  const page = records.slice(startIndex, startIndex + limit);
  const hasNext = startIndex + limit < records.length;

  return {
    items: page.map(toCardDto),
    has_next: hasNext,
    has_prev: startIndex > 0,
    next_cursor: hasNext ? page[page.length - 1].id : null,
  };
}

// --- createCard -- POST /api/v1/cards --------------------------------------

export interface CreateCardBody {
  name: string;
}

/**
 * 422 card.name_required: домен (CardValidationError, domain/card.ts) кидає
 * це САМ, ДО будь-якого запису в базу -- пропускаємо як є, не обгортаємо в
 * AppError (той самий формат {code, message}, лише інший клас помилки).
 */
export async function createCard(db: Db, ownerUserId: string, body: CreateCardBody): Promise<CardDto> {
  const record = await createCardUseCase(db, { ownerUserId, name: body.name });
  return toCardDto(record);
}

// --- getCard -- GET /api/v1/cards/{cardId} ---------------------------------

/**
 * 404 card.not_found: AppError, кидає use-case (T20) сам -- та сама форма для
 * чужої й неіснуючої картки (non-disclosure, AC-04), пропускаємо як є.
 */
export async function getCard(db: Db, ownerUserId: string, cardId: string, callClaude?: CallClaude): Promise<CardDto> {
  const result = await getCardWithProgress(db, { ownerUserId, cardId }, callClaude);
  return {
    ...toCardDto(result.card),
    aggregateProgress: result.aggregateProgress,
    dataWarning: result.dataWarning,
  };
}

// --- updateCard -- PATCH /api/v1/cards/{cardId} ----------------------------

export interface UpdateCardBody {
  name?: string;
  description?: string | null;
  markFilled?: boolean;
}

/**
 * Часткове оновлення -- лише поля, реально передані в тілі, ідуть у
 * use-case (undefined != "скинути на null", `description: null` -- явне
 * очищення). 404 card.not_found і 422 card.description_required кидає
 * use-case/домен самі -- пропускаємо як є.
 *
 * recordRenameEvent (D-103/D-115) -- опційна ін'єкція, той самий підхід, що
 * archiveCard/closeStructurePosition: без неї (поки composition root не
 * підключив) use-case просто не пише подію в Літопис Структури. Порт лише
 * прокидає параметр далі, сам нічого про Структуру не знає (ADR-0004).
 */
export async function updateCard(
  db: Db,
  ownerUserId: string,
  cardId: string,
  body: UpdateCardBody,
  recordRenameEvent?: RecordCardRenameEvent
): Promise<CardDto> {
  const input: { ownerUserId: string; cardId: string; name?: string; description?: string | null; markFilled?: boolean } = {
    ownerUserId,
    cardId,
  };
  if (body.name !== undefined) {
    input.name = body.name;
  }
  if (body.description !== undefined) {
    input.description = body.description;
  }
  if (body.markFilled !== undefined) {
    input.markFilled = body.markFilled;
  }

  const record = await updateCardUseCase(db, input, recordRenameEvent);
  return toCardDto(record);
}

// --- archiveCard -- DELETE /api/v1/cards/{cardId} --------------------------

/**
 * М'яка архівація (AC-16) -- 404 card.not_found кидає use-case сам.
 * closeStructurePosition (D-69/D-103) -- опційна ін'єкція, той самий підхід,
 * що callClaude в getCard: без неї (наприклад, поки composition root T30 не
 * підключив реальну implementation) use-case просто не робить цей крок --
 * не помилка, лише "Структура поки не підключена". Порт лише прокидає
 * параметр далі, сам нічого про Структуру не знає (ADR-0004).
 */
export async function archiveCard(
  db: Db,
  ownerUserId: string,
  cardId: string,
  closeStructurePosition?: CloseStructurePositionForCard
): Promise<CardDto> {
  const record = await archiveCardUseCase(db, { ownerUserId, cardId }, closeStructurePosition);
  return toCardDto(record);
}

// --- restoreCard -- POST /api/v1/cards/{cardId}/restore --------------------
// T35 -- dзеркало archiveCard (AC-17). 404 card.not_found (non-disclosure,
// AC-04) і 409 card.not_archived (картка вже активна) кидає use-case (T33)
// сам -- пропускаємо як є, той самий підхід, що решта хендлерів цього файлу.
//
// AC-18 (перегляд архіву) НЕ потребує окремого хендлера -- listCards вище
// (T21) уже приймає status='archived' і повертає ту саму CardPage, той самий
// ендпоінт GET /cards, лише інший query-параметр (contracts/openapi.yaml).

export async function restoreCard(db: Db, ownerUserId: string, cardId: string): Promise<CardDto> {
  const record = await restoreCardUseCase(db, ownerUserId, cardId);
  return toCardDto(record);
}
