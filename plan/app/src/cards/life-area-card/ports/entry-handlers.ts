// HTTP-хендлери записів (T23) -- контракт docs/features/life-area-card/contracts/openapi.yaml,
// шляхи POST /cards/{cardId}/metric-blocks/{metricBlockId}/entries, PATCH /entries/{entryId},
// GET /cards/{cardId}/entries.
//
// Порт-шар (framework-agnostic, ADR-0004): жоден HTTP-фреймворк ще не підключений
// (T30 підключить конкретний транспорт пізніше) -- кожен хендлер це звичайна
// async-функція (db, ownerUserId, ...параметри шляху/query, тіло) -> Promise<...>,
// що повертає ТОЧНО форму відповідної схеми контракту (Entry/EntryPage) при
// успіху, або дає AppError пройти нагору при помилці (не глушить). Той самий
// патерн, що app/*.ts use-case-шар уже задає для AppError (ADR-0006).
//
// Мапінг полів: EntryRecord (postgres-repo.ts) уже camelCase, майже прямий
// map у контрактну схему Entry -- лише Date-поля переводяться в ISO-рядок
// (date-time за контрактом), а не в мілісекунди. ownerUserId у EntryRecord
// відсутній узагалі (на відміну від CardRecord) -- жодного відсіювання поля
// тут не потрібно, але саме тому Card-мапінг (T21) і Entry-мапінг виглядають
// не зовсім однаково.
//
// createEntry -- рішення щодо recordedAt (контракт EntryCreate НЕ документує
// це поле, хоча use-case (T18) вимагає recordedAt: number): хендлер сам
// підставляє Date.now() у момент прийому HTTP-запиту -- це і є "коли подія
// зафіксована сервером", розумний дефолт для звичайного шляху виклику
// (agent's confirm, sad.md §6 Flow 3/7, не форма з довільним минулим часом
// від користувача). EntryCreate.additionalProperties: false в контракті
// теж не лишає місця для клієнтського recordedAt у тілі -- тож тут це
// свідомо НЕ параметр хендлера, а внутрішня деталь виклику use-case.
//
// listEntries -- non-disclosure (AC-04): findCardById перевіряється ПЕРЕД
// будь-яким читанням записів (чужа й неіснуюча картка дають однаковий
// card.not_found, contracts CardNotFound). Сама історія читається НАПРЯМУ
// через infra listEntriesByCard (готовий ORDER BY recorded_at DESC у SQL,
// AC-13) -- use-case-обгортки для цього читання немає, задача явно каже
// викликати репозиторій напряму.
//
// Пагінація (after/limit) -- SQL-запит без OFFSET/LIMIT (repo повертає всю
// історію картки за раз), тож сторінкування in-memory тут, у порт-шарі:
// `after` -- id останнього запису попередньої сторінки (уже DESC-сортований
// масив), `limit` затиснутий у межі контракту [1,100], дефолт 50. Прострочений
// чи вигаданий cursor (id не знайдено в масиві) не вважається помилкою --
// падає на першу сторінку, той самий підхід, що "просто ігноруємо невалидний
// query-параметр", а не 404/400 на саму пагінацію.

import {
  createEntry as createEntryUseCase,
  type CreateEntryInput,
  type RecordAction,
} from '../app/create-entry';
import { resolveEntry as resolveEntryUseCase, type EntryResolutionStatus } from '../app/resolve-entry';
import { findCardById, listEntriesByCard } from '../infra/postgres-repo';
import type { Db, EntryRecord } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

/** Точно форма схеми Entry контракту -- camelCase, Date-поля вже ISO-рядком. */
export interface EntryResponse {
  id: string;
  metricBlockId: string;
  cardId: string;
  amount: number;
  rawText: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  sourceDeviceId: string | null;
  recordedAt: string;
  confirmedAt: string | null;
  createdAt: string;
}

/** Точно форма схеми EntryPage контракту. */
export interface EntryPageResponse {
  items: EntryResponse[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

function toEntryResponse(record: EntryRecord): EntryResponse {
  return {
    id: record.id,
    metricBlockId: record.metricBlockId,
    cardId: record.cardId,
    amount: record.amount,
    rawText: record.rawText,
    status: record.status,
    sourceDeviceId: record.sourceDeviceId,
    recordedAt: record.recordedAt.toISOString(),
    confirmedAt: record.confirmedAt ? record.confirmedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

/** Точно форма тіла EntryCreate контракту (additionalProperties: false -- жодного recordedAt звідси, див. коментар вгорі файлу). */
export interface CreateEntryBody {
  amount: number;
  rawText?: string | null;
  sourceDeviceId?: string | null;
}

/**
 * POST /cards/{cardId}/metric-blocks/{metricBlockId}/entries (AC-01 happy;
 * AC-06/AC-11 конфлікт -> pending). Non-disclosure (AC-04) і саму перевірку
 * власника картки/блоку робить use-case (T18) -- тут лише виклик + мапінг.
 */
export async function createEntry(
  db: Db,
  ownerUserId: string,
  cardId: string,
  metricBlockId: string,
  body: CreateEntryBody,
  recordAction?: RecordAction
): Promise<EntryResponse> {
  const input: CreateEntryInput = {
    ownerUserId,
    cardId,
    metricBlockId,
    amount: body.amount,
    rawText: body.rawText ?? null,
    sourceDeviceId: body.sourceDeviceId ?? null,
    // Рішення (комент вгорі файлу): контракт мовчить про recordedAt у
    // EntryCreate -- сервер підставляє момент прийому запиту.
    recordedAt: Date.now(),
  };
  const record = await createEntryUseCase(db, input, recordAction);
  return toEntryResponse(record);
}

/** Точно форма тіла EntryResolve контракту. */
export interface ResolveEntryBody {
  status: EntryResolutionStatus;
}

/**
 * PATCH /entries/{entryId} (AC-06/AC-11/AC-12). Non-disclosure (AC-04) і
 * визначення власної картки запису робить use-case (T19, ISS-32) -- контракт
 * навмисно НЕ передає cardId, лише entryId + status.
 */
export async function resolveEntry(
  db: Db,
  ownerUserId: string,
  entryId: string,
  body: ResolveEntryBody,
  recordAction?: RecordAction
): Promise<EntryResponse> {
  const record = await resolveEntryUseCase(db, { ownerUserId, entryId, status: body.status }, recordAction);
  return toEntryResponse(record);
}

export interface ListEntriesQuery {
  after?: string;
  limit?: number;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)));
}

/** Сторінкування in-memory над уже DESC-сортованим масивом -- див. коментар вгорі файлу. */
function paginate(entries: EntryRecord[], after: string | undefined, limit: number): EntryPageResponse {
  let startIndex = 0;
  if (after) {
    const cursorIndex = entries.findIndex((entry) => entry.id === after);
    // Прострочений/невалидний cursor -- падаємо на першу сторінку, не помилка.
    startIndex = cursorIndex === -1 ? 0 : cursorIndex + 1;
  }

  const page = entries.slice(startIndex, startIndex + limit);
  const hasNext = startIndex + limit < entries.length;

  return {
    items: page.map(toEntryResponse),
    has_next: hasNext,
    has_prev: startIndex > 0,
    next_cursor: hasNext ? page[page.length - 1].id : null,
  };
}

/**
 * GET /cards/{cardId}/entries (AC-13) -- історія, найновіші зверху.
 * Non-disclosure (AC-04): findCardById перевіряється ПЕРЕД читанням історії --
 * чужа й неіснуюча картка дають однаковий card.not_found (CardNotFound).
 */
export async function listEntries(db: Db, ownerUserId: string, cardId: string, query: ListEntriesQuery = {}): Promise<EntryPageResponse> {
  const card = await findCardById(db, ownerUserId, cardId);
  if (!card) {
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  const entries = await listEntriesByCard(db, cardId);
  return paginate(entries, query.after, clampLimit(query.limit));
}
