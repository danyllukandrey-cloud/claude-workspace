// T20 -- Ports: GET/POST /messages handlers (docs/features/agent/contracts/openapi.yaml,
// operationId listMessages / createMessage; spec.md AC-01/AC-02b/AC-03/AC-04/AC-05/AC-09/
// AC-10/AC-10b/AC-15/AC-19/AC-19b).
//
// Framework-agnostic (той самий підхід, що ../../structure/ports/layout-handlers.ts і
// ./proposal-handler.ts) -- жоден HTTP-фреймворк ще не підключений у репо (T29/T30
// підключать конкретний транспорт пізніше); кожен хендлер тут звичайна async-функція
// (db, ..., params) -> Promise<...> точно контрактної форми при успіху, або дає
// AppError пройти нагору при помилці (transport-шар мапить AppError.httpStatus на
// реальну HTTP-відповідь, той самий патерн, що вже задокументований
// ../app/confirm.ts/../ports/proposal-handler.ts). "Вже декодоване" вкладення
// (`mediaType`+`base64Data`, ClaudeAttachment, ../infra/claude-client.ts) -- multipart
// декодування самих байтів лишається транспортному шару, тут воно поза межами.
//
// createMessage -- ЦІЛКОМ делегує розбір повідомлення/вкладення в ../app/handle-message.ts
// (T16, вже повністю юніт-тестований: AC-01/AC-04/AC-05/AC-09/AC-10/AC-10b/AC-15/AC-19/
// AC-19b). Цей файл лише: (1) rate-limit перевірка ДО виклику handleMessage (§8 SAD "60
// повідомлень/годину" -- захист проти спаму й економіки важкого вводу, spec.md §6.1; жоден
// domain/infra/app-таск не володіє цим інваріантом, тому лічильник -- пряме SQL тут, той
// самий підхід, що ../ports/reports-handler.ts вже застосовує для власного читання поза
// ../infra/postgres-repo.ts), (2) переклад параметрів у HandleMessageInput, (3) запис ОБОХ
// реплік ходу в chat_message ПІСЛЯ успішного виклику (AC-15 -- майбутні сесії/ходи бачать
// їх через getShortTermWindow, T10; той самий insertChatMessage, T13, що вже
// ../ports/onboarding-handler.ts використовує для вітальної репліки), (4) мапінг
// HandleMessageResult -> контрактний MessageTurn DTO, (5) НЕ ловить AppError -- 422
// (`agent.attachment_unrecognized`) і 503 (`agent.llm_unavailable`), кинуті всередині
// handleMessage/askAgent (T18) ДО будь-якого запису, проходять нагору без змін; жодного
// insertChatMessage не виконується в цих гілках, бо виклик нижче в цій функції просто не
// доходить (не спеціальний catch, а природний наслідок порядку: спершу handleMessage,
// потім запис).
//
// "attachment field accepts document/spreadsheet MIME types, not just photo" (DoD) -- цей
// файл НЕ накладає власного MIME-фільтра на вхідне вкладення: `body.attachment` передається
// в handleMessage як є (той самий ClaudeAttachment, T12), реальна перевірка підтримуваних
// типів (фото + документ/таблиця, AC-19) уже живе в ../infra/claude-client.ts
// (isSupportedAttachment) -- дублювати її тут окремим списком означало б два джерела правди
// (D-19 root CLAUDE.md).
//
// ВІДКРИТЕ ДИЗАЙН-ПИТАННЯ 1 (успадковане з ../app/handle-message.ts): контракт
// MessageCreate (openapi.yaml, additionalProperties: false) не несе жодного поля "тема" --
// тому AC-09 topic-хінт (HandleMessageInput.topic) із цієї точки інтеграції НІКОЛИ не
// передається (завжди відсутній/undefined). Автоматичне визначення теми з вільного тексту
// не описане жодним артефактом вище -- не вирішується мовчки тут, лишається відкритим для
// людини, той самий запис, що вже стоїть у ../app/handle-message.ts.
//
// ВІДКРИТЕ ДИЗАЙН-ПИТАННЯ 2 (listMessages): openapi.yaml сам документує ендпоінт як "не
// прив'язаний до жодного окремого AC напряму" -- ні порядок видачі (найновіші спершу чи
// найстаріші спершу), ні точна семантика двох незалежних курсорів (`after`/`before`) не
// зафіксовані жодним артефактом. Консервативне прочитання нижче: перший виклик (без
// курсора) повертає ХВІСТ історії (найновіші `limit` повідомлень, у хронологічному порядку
// в самому масиві `items`) -- природне для "відновлення екрана при відкритті" (опис
// ендпоінта); `after` рухається вперед (новіші за курсор), `before` -- назад (старіші за
// курсор), обидва повертають сторінку в тому самому хронологічному порядку. Це practical
// вибір ЦЬОГО файлу, не задокументоване рішення -- предмет перегляду людиною, якщо UI
// (T26) очікує іншу семантику.

import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { AskClaude, ClaudeAttachment } from '../infra/claude-client';
import { handleMessage } from '../app/handle-message';
import { insertChatMessage } from '../infra/postgres-repo';
import type { Db, ProposalRecord, ChatMessageRecord, ChatRoleRow } from '../infra/postgres-repo';
import { AppError } from '../../shared/errors';

// --- DTOs -- точно форма відповідних схем контракту (openapi.yaml) --------

/** Точно форма схеми Proposal контракту -- та сама форма, що ./proposal-handler.ts's ProposalResponse (окремий файл, окрема відповідальність -- не імпортується звідти, D-19 однак не порушується: обидва мапляться з ОДНОГО джерела правди, ProposalRecord). */
export interface ProposalResponse {
  id: string;
  cardId: string | null;
  metricBlockId: string | null;
  status: 'active' | 'confirmed' | 'dropped';
  sourceType: 'text' | 'attachment';
  rawInput: string;
  proposedAmount: number | null;
  proposedSummary: string;
  createdAt: string;
  updatedAt: string;
}

/** Точно форма схеми MessageTurn контракту. */
export interface MessageTurnDto {
  reply: string;
  proposal: ProposalResponse | null;
}

/** Точно форма схеми Message контракту. */
export interface MessageDto {
  id: string;
  role: ChatRoleRow;
  content: string;
  createdAt: string;
}

/** Точно форма схеми MessagePage контракту. */
export interface MessagePageDto {
  items: MessageDto[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

function toProposalResponse(record: ProposalRecord): ProposalResponse {
  return {
    id: record.id,
    cardId: record.cardId,
    metricBlockId: record.metricBlockId,
    status: record.status,
    sourceType: record.sourceType,
    rawInput: record.rawInput,
    proposedAmount: record.proposedAmount,
    proposedSummary: record.proposedSummary,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toMessageDto(record: ChatMessageRecord): MessageDto {
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    createdAt: record.createdAt.toISOString(),
  };
}

/** Календарний день = одиниця "сесія" (D-26) -- той самий формат, що ../app/handle-message.ts і ../ports/onboarding-handler.ts. */
function toSessionDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// --- rate limiting (§8 SAD "60 повідомлень/годину") ------------------------

const RATE_LIMIT_PER_HOUR = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

interface CountRow extends QueryResultRow {
  count: string | number;
}

async function countRecentUserMessages(db: Db, userId: string, since: Date): Promise<number> {
  const { rows } = await db.query<CountRow>(
    `SELECT COUNT(*) AS count FROM chat_message WHERE user_id = $1 AND role = 'user' AND created_at > $2`,
    [userId, since]
  );
  const raw = rows[0]?.count ?? 0;
  return typeof raw === 'string' ? parseInt(raw, 10) : raw;
}

/**
 * 429 `agent.rate_limited` -- перевіряється ДО виклику handleMessage (не витрачаємо
 * виклик Claude на повідомлення, яке однаково відхилиться, spec.md §6.1 "економіка
 * важкого вводу"). Ліміт -- ковзне вікно останньої години, а не календарна година
 * (§8 SAD не уточнює межу вікна -- ковзне вікно консервативніше: не дозволяє сплеск
 * рівно на межі календарної години).
 */
async function assertNotRateLimited(db: Db, userId: string, now: Date): Promise<void> {
  const since = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);
  const count = await countRecentUserMessages(db, userId, since);
  if (count >= RATE_LIMIT_PER_HOUR) {
    throw new AppError('agent.rate_limited', 'Too many messages — try again later', 429);
  }
}

/** DoD T16: rawInput-заглушка для чистого вкладення без тексту -- той самий вираз, що ../app/handle-message.ts's `rawInput`, повторно застосований тут для chat_message.content (NOT NULL, data-model.md), який окремо від rawInput пропозиції. */
function contentForLog(text: string | null, attachment: ClaudeAttachment | null): string {
  return text ?? `[вкладення: ${attachment?.mediaType ?? 'невідомий тип'}]`;
}

// --- createMessage -- POST /api/v1/messages ---------------------------------

export interface MessageCreateBody {
  /** Текст користувача (AC-01) -- null/відсутнє, якщо передано лише вкладення (AC-10/AC-19). */
  content?: string | null;
  /** Вкладення -- фото (AC-10) чи документ/таблиця (AC-19, розширено 2026-08-29) -- жодного власного MIME-фільтра тут, дивись коментар файлу вище. */
  attachment?: ClaudeAttachment | null;
}

export interface CreateMessageOptions {
  /** Injectable "зараз" -- узгодженість сесії з handleMessage (той самий `now`) і тестова керованість. */
  now?: Date;
}

export async function createMessage(
  db: Db,
  askClaude: AskClaude,
  ownerUserId: string,
  body: MessageCreateBody,
  options: CreateMessageOptions = {}
): Promise<MessageTurnDto> {
  const now = options.now ?? new Date();

  await assertNotRateLimited(db, ownerUserId, now);

  const text = body.content ?? null;
  const attachment = body.attachment ?? null;

  // AC-10b/AC-19b (422) і Critical flow 2 (503) -- AppError кинуто всередині
  // handleMessage/askAgent (T18) ДО будь-якого запису; пропускаємо нагору незмінно.
  // Нічого нижче в цій функції не виконується в цій гілці -- природний наслідок
  // порядку виклику, не окремий catch.
  const result = await handleMessage(db, askClaude, { userId: ownerUserId, text, attachment, now });

  // AC-15: обидві репліки цього ходу лягають у chat_message ПІСЛЯ успішного виклику --
  // майбутні ходи (getShortTermWindow, T10, читане всередині НАСТУПНОГО виклику
  // handleMessage) побачать їх; поточний хід уже мав власний текст, переданий напряму
  // вище, тому не потребує самопрочитання з БД.
  const sessionDate = toSessionDate(now);
  await insertChatMessage(db, {
    id: randomUUID(),
    userId: ownerUserId,
    role: 'user',
    content: contentForLog(text, attachment),
    sessionDate,
  });
  await insertChatMessage(db, {
    id: randomUUID(),
    userId: ownerUserId,
    role: 'agent',
    content: result.reply,
    sessionDate,
  });

  return {
    reply: result.reply,
    proposal: result.proposal ? toProposalResponse(result.proposal) : null,
  };
}

// --- listMessages -- GET /api/v1/messages -----------------------------------

export interface ListMessagesQuery {
  /** cursor -- id останнього побаченого повідомлення (рухається вперед, до новіших). */
  after?: string;
  /** cursor -- id найстарішого побаченого повідомлення (рухається назад, до старіших). */
  before?: string;
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

interface RawMessageRow extends QueryResultRow {
  id: string;
  user_id: string;
  role: ChatRoleRow;
  content: string;
  session_date: string;
  created_at: Date;
}

function toChatMessageRecordLocal(row: RawMessageRow): ChatMessageRecord {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    sessionDate: row.session_date,
    createdAt: row.created_at,
  };
}

/** Усі повідомлення користувача (немає окремого T13-репозиторного читання поза сесією) -- той самий "порт сам пише SQL, коли немає готового репозиторного читання" підхід, що ../ports/reports-handler.ts. Non-disclosure: `WHERE user_id = $1` у самому SQL. */
async function findAllMessagesByUser(db: Db, userId: string): Promise<ChatMessageRecord[]> {
  const { rows } = await db.query<RawMessageRow>(
    'SELECT id, user_id, role, content, session_date, created_at FROM chat_message WHERE user_id = $1 ORDER BY created_at, id',
    [userId]
  );
  return rows.map(toChatMessageRecordLocal);
}

/** Хронологічно (найстаріше спершу), id як тай-брейк при однаковому часі -- детермінований порядок незалежно від того, що саме повернув мокований `Db.query` у тестах (той самий підхід, що ../ports/reports-handler.ts's sortReportsForPaging). */
function sortMessagesAscending(records: ChatMessageRecord[]): ChatMessageRecord[] {
  return [...records].sort((a, b) => {
    const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function pageMessages(records: ChatMessageRecord[], query: ListMessagesQuery): MessagePageDto {
  const limit = clampLimit(query.limit);
  let page: ChatMessageRecord[];
  let hasNext: boolean;
  let hasPrev: boolean;

  if (query.after) {
    const afterIndex = records.findIndex((record) => record.id === query.after);
    // Прострочений/невалідний cursor -- падаємо на початок, не помилка (той самий
    // підхід, що ../ports/reports-handler.ts's pageReports).
    const start = afterIndex === -1 ? 0 : afterIndex + 1;
    page = records.slice(start, start + limit);
    hasNext = start + limit < records.length;
    hasPrev = start > 0;
  } else if (query.before) {
    const beforeIndex = records.findIndex((record) => record.id === query.before);
    const end = beforeIndex === -1 ? records.length : beforeIndex;
    const start = Math.max(0, end - limit);
    page = records.slice(start, end);
    hasNext = end < records.length;
    hasPrev = start > 0;
  } else {
    // Без курсора -- хвіст історії (найновіші `limit`), для відновлення екрана при
    // відкритті (openapi.yaml опис ендпоінта) -- дивись "ВІДКРИТЕ ДИЗАЙН-ПИТАННЯ 2" у
    // заголовку файлу.
    const start = Math.max(0, records.length - limit);
    page = records.slice(start);
    hasNext = false;
    hasPrev = start > 0;
  }

  return {
    items: page.map(toMessageDto),
    has_next: hasNext,
    has_prev: hasPrev,
    next_cursor: hasNext && page.length > 0 ? page[page.length - 1].id : null,
  };
}

export async function listMessages(db: Db, ownerUserId: string, query: ListMessagesQuery = {}): Promise<MessagePageDto> {
  const records = sortMessagesAscending(await findAllMessagesByUser(db, ownerUserId));
  return pageMessages(records, query);
}
