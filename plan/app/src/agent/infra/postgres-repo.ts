// T13 -- Infra: Postgres repo over 5 of the agent's tables: agent_proposal,
// imperative_rule, long_term_memory_fact, chat_message, agent_audit_event --
// data-model.md, ADR-0005 (layered domain/app/infra/ports backend).
//
// DI (ADR-0004/ADR-0005), same `Db` contract as ../../structure/infra/postgres-repo.ts
// and ../../cards/life-area-card/infra/postgres-repo.ts (query(text, params) ->
// {rows}) -- this file never opens its own connection; the composition root
// injects pg.Pool/pg.Client.
//
// Non-disclosure / DoD ("a mismatched user_id is never returned"): every read
// and write below is scoped by user_id in the SQL itself -- a row that belongs
// to a different user is physically absent from the result set, not filtered
// out afterwards. Same pattern as findCardById/updateStructure in the sibling
// repos (AC-03/AC-04/AC-06 elsewhere in the product; this task's own ACs --
// AC-01/AC-02/AC-07/AC-08/AC-09/AC-12/AC-14/AC-15 -- all read or write exactly
// one user's rows).
//
// `app_user` (migration 01) and `card`/`metric_block` (life-area-card) are
// referenced by FK but not repository targets of this file -- T13's files_hint
// is postgres-repo.ts for THIS module's own 5 tables only.
//
// agent_audit_event.event_type/subject_type below use the base check-constraint
// set from migration 06 (T6, this task's only audit-table dependency) --
// 'account_deleted'/'resource_sync_failed'/'account'/'sync_resource' are added
// later by migration 10 (T33, a later task, not a T13 dependency).
//
// NUMERIC (`proposed_amount`) comes back from `pg` as a string (to not lose
// precision) -- converted to `number` at this boundary, same as
// life-area-card's entry.amount/metric_block.target_count.

import type { QueryResultRow } from 'pg';

/** Мінімальний контракт до бази, який потрібен цьому репозиторію. */
export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export type ProposalStatusRow = 'active' | 'confirmed' | 'dropped';
export type ProposalSourceTypeRow = 'text' | 'attachment';

export interface ProposalRecord {
  id: string;
  userId: string;
  cardId: string | null;
  metricBlockId: string | null;
  status: ProposalStatusRow;
  sourceType: ProposalSourceTypeRow;
  rawInput: string;
  proposedAmount: number | null;
  proposedSummary: string;
  createdAt: Date;
  updatedAt: Date;
}

export type RuleCategoryRow = 'data' | 'correction' | 'survey' | 'context_clarification' | 'owner_impact' | 'reminder';

export interface RuleRecord {
  id: string;
  userId: string;
  scopeCardId: string | null;
  category: RuleCategoryRow | null;
  ruleText: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type FactStatusRow = 'active' | 'deleted';

export interface FactRecord {
  id: string;
  userId: string;
  factText: string;
  topic: string | null;
  status: FactStatusRow;
  createdAt: Date;
  updatedAt: Date;
}

export type ChatRoleRow = 'user' | 'agent';

export interface ChatMessageRecord {
  id: string;
  userId: string;
  role: ChatRoleRow;
  content: string;
  sessionDate: string;
  createdAt: Date;
}

// Base (migration 06 / T6) event_type set, widened by migration 10 (T33,
// 1789151864598_extend-audit-event-types.sql) -- 'account_deleted'/
// 'resource_sync_failed' and 'account'/'sync_resource' added there to the DB
// CHECK constraint. This TS union is widened here, by T39 (the first
// consumer that actually writes an 'account_deleted'/'account' row --
// AC-17, deleteAccount use-case) rather than by T33 itself, which only
// carried the migration.
export type AuditEventTypeRow =
  | 'proposal_created'
  | 'proposal_updated'
  | 'proposal_confirmed'
  | 'proposal_dropped'
  | 'guard_passed'
  | 'guard_failed'
  | 'memory_fact_edited'
  | 'memory_fact_deleted'
  | 'account_deleted'
  | 'resource_sync_failed';

export type AuditSubjectTypeRow = 'proposal' | 'guard' | 'memory_fact' | 'account' | 'sync_resource';

export interface AuditEventRecord {
  id: string;
  userId: string;
  eventType: AuditEventTypeRow;
  subjectType: AuditSubjectTypeRow;
  subjectId: string | null;
  detail: string | null;
  occurredAt: Date;
}

// --- agent_proposal (AC-01/AC-02) ------------------------------------------

interface RawProposalRow extends QueryResultRow {
  id: string;
  user_id: string;
  card_id: string | null;
  metric_block_id: string | null;
  status: ProposalStatusRow;
  source_type: ProposalSourceTypeRow;
  raw_input: string;
  proposed_amount: string | null;
  proposed_summary: string;
  created_at: Date;
  updated_at: Date;
}

function toProposalRecord(row: RawProposalRow): ProposalRecord {
  return {
    id: row.id,
    userId: row.user_id,
    cardId: row.card_id,
    metricBlockId: row.metric_block_id,
    status: row.status,
    sourceType: row.source_type,
    rawInput: row.raw_input,
    proposedAmount: row.proposed_amount == null ? null : Number(row.proposed_amount),
    proposedSummary: row.proposed_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PROPOSAL_COLUMNS =
  'id, user_id, card_id, metric_block_id, status, source_type, raw_input, proposed_amount, proposed_summary, created_at, updated_at';

/** AC-01: нова пропозиція завжди створюється зі status 'active' (колонковий default). */
export async function insertProposal(
  db: Db,
  input: {
    id: string;
    userId: string;
    cardId?: string | null;
    metricBlockId?: string | null;
    sourceType: ProposalSourceTypeRow;
    rawInput: string;
    proposedAmount?: number | null;
    proposedSummary: string;
  }
): Promise<ProposalRecord> {
  const { rows } = await db.query<RawProposalRow>(
    `INSERT INTO agent_proposal (id, user_id, card_id, metric_block_id, source_type, raw_input, proposed_amount, proposed_summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${PROPOSAL_COLUMNS}`,
    [
      input.id,
      input.userId,
      input.cardId ?? null,
      input.metricBlockId ?? null,
      input.sourceType,
      input.rawInput,
      input.proposedAmount ?? null,
      input.proposedSummary,
    ]
  );
  return toProposalRecord(rows[0]);
}

/**
 * AC-02/AC-03: одна активна пропозиція на користувача (унікальний частковий
 * індекс `uq_agent_proposal_active_user`, data-model.md) -- запит завжди
 * повертає щонайбільше один рядок.
 */
export async function findActiveProposalByUser(db: Db, userId: string): Promise<ProposalRecord | null> {
  const { rows } = await db.query<RawProposalRow>(
    `SELECT ${PROPOSAL_COLUMNS} FROM agent_proposal WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );
  return rows[0] ? toProposalRecord(rows[0]) : null;
}

/**
 * Часткове оновлення пропозиції -- уточнення деталі (AC-02b) чи перехід
 * статусу (AC-02 confirm / AC-03 drop). Non-disclosure (DoD): чужий user_id
 * повертає null, нічого не пишеться.
 */
export async function updateProposal(
  db: Db,
  userId: string,
  proposalId: string,
  patch: {
    cardId?: string | null;
    metricBlockId?: string | null;
    proposedAmount?: number | null;
    proposedSummary?: string;
    status?: ProposalStatusRow;
  }
): Promise<ProposalRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  const assign = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.cardId !== undefined) assign('card_id', patch.cardId);
  if (patch.metricBlockId !== undefined) assign('metric_block_id', patch.metricBlockId);
  if (patch.proposedAmount !== undefined) assign('proposed_amount', patch.proposedAmount);
  if (patch.proposedSummary !== undefined) assign('proposed_summary', patch.proposedSummary);
  if (patch.status !== undefined) assign('status', patch.status);

  if (sets.length === 0) {
    const { rows } = await db.query<RawProposalRow>(
      `SELECT ${PROPOSAL_COLUMNS} FROM agent_proposal WHERE id = $1 AND user_id = $2`,
      [proposalId, userId]
    );
    return rows[0] ? toProposalRecord(rows[0]) : null;
  }
  sets.push('updated_at = now()');

  values.push(proposalId, userId);
  const { rows } = await db.query<RawProposalRow>(
    `UPDATE agent_proposal SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND user_id = $${values.length} RETURNING ${PROPOSAL_COLUMNS}`,
    values
  );
  return rows[0] ? toProposalRecord(rows[0]) : null;
}

/**
 * Review 2026-09-12 (double-confirm race, AC-02/AC-03): `updateProposal`'s
 * unconditional status write let two concurrent confirms (or a client retry)
 * both pass an in-memory `status === 'active'` check and both proceed --
 * ../../app/confirm.ts called this ONLY after that check, with no predicate
 * tying the write to the state it was read from. This is the narrowly-scoped
 * fix: the transition itself is the atomic compare-and-swap, `status = 'active'`
 * in the WHERE clause alongside id/user_id, same non-disclosure shape as
 * `updateProposal` above. Whichever caller's UPDATE actually flips the row
 * gets it back; a caller that loses the race (row already 'confirmed' or
 * 'dropped' by the time this runs) gets zero rows back, indistinguishable at
 * the SQL level from "not found" or "foreign" -- confirm.ts is the one that
 * turns that into the existing 409 `agent.proposal_not_active`, using its
 * own earlier plain read to already know the row exists and belongs to this
 * user.
 */
export async function confirmActiveProposal(db: Db, userId: string, proposalId: string): Promise<ProposalRecord | null> {
  const { rows } = await db.query<RawProposalRow>(
    `UPDATE agent_proposal SET status = 'confirmed', updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING ${PROPOSAL_COLUMNS}`,
    [proposalId, userId]
  );
  return rows[0] ? toProposalRecord(rows[0]) : null;
}

// --- imperative_rule (AC-07/AC-08/AC-12/AC-14) -----------------------------

interface RawRuleRow extends QueryResultRow {
  id: string;
  user_id: string;
  scope_card_id: string | null;
  category: RuleCategoryRow | null;
  rule_text: string | null;
  created_at: Date;
  updated_at: Date;
}

function toRuleRecord(row: RawRuleRow): RuleRecord {
  return {
    id: row.id,
    userId: row.user_id,
    scopeCardId: row.scope_card_id,
    category: row.category,
    ruleText: row.rule_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const RULE_COLUMNS = 'id, user_id, scope_card_id, category, rule_text, created_at, updated_at';

/**
 * AC-08 (готове меню категорій) і/або AC-14 (власний текст) -- `scopeCardId`
 * відсутній/null = глобальне правило, заповнений = перевизначення на картці
 * (AC-12). Колонковий CHECK гарантує, що категорія й текст не порожні обидва.
 */
export async function insertRule(
  db: Db,
  input: { id: string; userId: string; scopeCardId?: string | null; category?: RuleCategoryRow | null; ruleText?: string | null }
): Promise<RuleRecord> {
  const { rows } = await db.query<RawRuleRow>(
    `INSERT INTO imperative_rule (id, user_id, scope_card_id, category, rule_text)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${RULE_COLUMNS}`,
    [input.id, input.userId, input.scopeCardId ?? null, input.category ?? null, input.ruleText ?? null]
  );
  return toRuleRecord(rows[0]);
}

/**
 * AC-14: перевірка на несуперечливість "тієї самої області дії" -- глобальне
 * звіряється ЛИШЕ з глобальними (`scopeCardId: null`), перевизначення картки
 * ЛИШЕ з іншими правилами тієї самої картки (`scopeCardId: cardId`). Точний
 * збіг області (не merge з глобальними) -- `IS NOT DISTINCT FROM` порівнює
 * NULL з NULL як рівні (звичайний `=` цього не робить у SQL).
 */
export async function listRulesByScope(db: Db, userId: string, scopeCardId: string | null): Promise<RuleRecord[]> {
  const { rows } = await db.query<RawRuleRow>(
    `SELECT ${RULE_COLUMNS} FROM imperative_rule WHERE user_id = $1 AND scope_card_id IS NOT DISTINCT FROM $2`,
    [userId, scopeCardId]
  );
  return rows.map(toRuleRecord);
}

/**
 * AC-07/AC-12: набір правил, що реально діють на відповідь агента у контексті
 * конкретної картки (чи без картки) -- глобальні ЗАВЖДИ + перевизначення саме
 * цієї картки, якщо є (Flow 6 sad.md §6, idx_imperative_rule_user_scope).
 * Без картки в контексті (`cardId: null`) діють лише глобальні правила.
 */
export async function listEffectiveRulesForCard(db: Db, userId: string, cardId: string | null): Promise<RuleRecord[]> {
  const { rows } = await db.query<RawRuleRow>(
    `SELECT ${RULE_COLUMNS} FROM imperative_rule WHERE user_id = $1 AND (scope_card_id IS NULL OR scope_card_id = $2)`,
    [userId, cardId]
  );
  return rows.map(toRuleRecord);
}

// --- long_term_memory_fact (AC-09) -----------------------------------------

interface RawFactRow extends QueryResultRow {
  id: string;
  user_id: string;
  fact_text: string;
  topic: string | null;
  status: FactStatusRow;
  created_at: Date;
  updated_at: Date;
}

function toFactRecord(row: RawFactRow): FactRecord {
  return {
    id: row.id,
    userId: row.user_id,
    factText: row.fact_text,
    topic: row.topic,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const FACT_COLUMNS = 'id, user_id, fact_text, topic, status, created_at, updated_at';

export async function insertFact(
  db: Db,
  input: { id: string; userId: string; factText: string; topic?: string | null }
): Promise<FactRecord> {
  const { rows } = await db.query<RawFactRow>(
    `INSERT INTO long_term_memory_fact (id, user_id, fact_text, topic) VALUES ($1, $2, $3, $4) RETURNING ${FACT_COLUMNS}`,
    [input.id, input.userId, input.factText, input.topic ?? null]
  );
  return toFactRecord(rows[0]);
}

/** AC-09: пізніша сесія на ту саму тему бачить факт без повторного пояснення від користувача. */
export async function findActiveFactsByTopic(db: Db, userId: string, topic: string): Promise<FactRecord[]> {
  const { rows } = await db.query<RawFactRow>(
    `SELECT ${FACT_COLUMNS} FROM long_term_memory_fact WHERE user_id = $1 AND topic = $2 AND status = 'active'`,
    [userId, topic]
  );
  return rows.map(toFactRecord);
}

/**
 * Review 2026-09-12 (AC-09 write path): факт правиться на місці (не
 * append-only, на відміну від `agent_audit_event`) -- data-model.md
 * `updated_at` "редагування факту". Non-disclosure: чужий/неіснуючий факт --
 * `null`, нічого не пишеться.
 */
export async function updateFact(
  db: Db,
  userId: string,
  factId: string,
  patch: { factText?: string; topic?: string | null }
): Promise<FactRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  const assign = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.factText !== undefined) assign('fact_text', patch.factText);
  if (patch.topic !== undefined) assign('topic', patch.topic);

  if (sets.length === 0) {
    const { rows } = await db.query<RawFactRow>(
      `SELECT ${FACT_COLUMNS} FROM long_term_memory_fact WHERE id = $1 AND user_id = $2`,
      [factId, userId]
    );
    return rows[0] ? toFactRecord(rows[0]) : null;
  }
  sets.push('updated_at = now()');
  values.push(factId, userId);

  const { rows } = await db.query<RawFactRow>(
    `UPDATE long_term_memory_fact SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND user_id = $${values.length} RETURNING ${FACT_COLUMNS}`,
    values
  );
  return rows[0] ? toFactRecord(rows[0]) : null;
}

/**
 * Review 2026-09-12 (AC-09 "забудь, що..."): м'яке видалення -- `status =
 * 'deleted'` (data-model.md, той самий підхід, що `card.status`), НІКОЛИ
 * фізичне видалення. Non-disclosure: чужий/неіснуючий факт -- `null`.
 */
export async function softDeleteFact(db: Db, userId: string, factId: string): Promise<FactRecord | null> {
  const { rows } = await db.query<RawFactRow>(
    `UPDATE long_term_memory_fact SET status = 'deleted', updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING ${FACT_COLUMNS}`,
    [factId, userId]
  );
  return rows[0] ? toFactRecord(rows[0]) : null;
}

// --- chat_message (AC-15) --------------------------------------------------

interface RawChatMessageRow extends QueryResultRow {
  id: string;
  user_id: string;
  role: ChatRoleRow;
  content: string;
  // node-pg parses a DATE column into a JS Date object by default (no
  // `pg.types.setTypeParser` configured) -- the type here reflects that
  // runtime reality, not the wished-for string.
  session_date: string | Date;
  created_at: Date;
}

function toChatMessageRecord(row: RawChatMessageRow): ChatMessageRecord {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    // Fix 2026-09-22: node-pg parses a DATE column into a JS Date object by
    // default (no `pg.types.setTypeParser`), even though RawChatMessageRow
    // declares it `string` -- normalize here so domain's `sessionDate ===`
    // comparisons (AC-15 short-term window) don't silently always fail.
    sessionDate:
      row.session_date instanceof Date ? row.session_date.toISOString().slice(0, 10) : row.session_date,
    createdAt: row.created_at,
  };
}

const CHAT_MESSAGE_COLUMNS = 'id, user_id, role, content, session_date, created_at';

export async function insertChatMessage(
  db: Db,
  input: { id: string; userId: string; role: ChatRoleRow; content: string; sessionDate: string }
): Promise<ChatMessageRecord> {
  const { rows } = await db.query<RawChatMessageRow>(
    `INSERT INTO chat_message (id, user_id, role, content, session_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${CHAT_MESSAGE_COLUMNS}`,
    [input.id, input.userId, input.role, input.content, input.sessionDate]
  );
  return toChatMessageRecord(rows[0]);
}

/**
 * AC-15: коротке вікно поточної сесії -- одиниця "сесія" = календарний день
 * (D-26). ORDER BY created_at зберігає порядок реплік у межах дня.
 */
export async function listMessagesForSession(db: Db, userId: string, sessionDate: string): Promise<ChatMessageRecord[]> {
  const { rows } = await db.query<RawChatMessageRow>(
    `SELECT ${CHAT_MESSAGE_COLUMNS} FROM chat_message WHERE user_id = $1 AND session_date = $2 ORDER BY created_at`,
    [userId, sessionDate]
  );
  return rows.map(toChatMessageRecord);
}

/**
 * AC-13 (onboarding-handler.ts, T24): чи для user_id уже є хоч ОДИН
 * chat_message, незалежно від session_date -- на відміну від
 * listMessagesForSession вище (scopeована одним календарним днем, AC-15),
 * тут перевіряється "чи це взагалі перший виклик користувача" за весь час.
 * `LIMIT 1` -- питання лише про існування, а не про кількість чи вміст.
 *
 * Review 2026-09-12: більше НЕ використовується onboarding-handler.ts
 * (замінено на insertWelcomeMessageIfFirst нижче -- check-then-insert із
 * цієї функції й insertChatMessage окремими round trip'ами мав вікно гонки).
 * Лишається тут як самостійна, окремо протестована перевірка існування --
 * postgres-repo.test.ts продовжує її покривати.
 */
export async function hasAnyChatMessage(db: Db, userId: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM chat_message WHERE user_id = $1 LIMIT 1', [userId]);
  return rows.length > 0;
}

/**
 * Review 2026-09-12 (AC-13 race fix): onboarding-handler.ts (T24) раніше
 * складав hasAnyChatMessage + insertChatMessage як два окремі round trip --
 * ChatPanel.tsx викликає GET /onboarding у тому самому Promise.all, що й
 * loadHistory/loadActiveProposal на кожному монтуванні екрана (і React
 * StrictMode монтує двічі в dev), тож два одночасні виклики могли обидва
 * побачити "повідомлень ще нема" між своїми SELECT і INSERT і обидва
 * вставити вітальний рядок.
 *
 * INSERT ... SELECT ... WHERE NOT EXISTS -- перевірка-і-запис усередині
 * ОДНОГО SQL-запиту (атомарно на рівні бази, не двох round trip з вікном
 * між ними): друга одночасна спроба виконує той самий запит і бачить
 * рядок конкурента, щойно вставлений першою -- тому нічого не вставляє й
 * повертає нуль рядків.
 *
 * `null` тут означає одне з двох, і виклику (onboarding-handler.ts) різниця
 * байдужа -- обидва трактуються як `welcomeShown: true, message: null`, не
 * як помилка:
 * 1) користувач уже мав хоч один chat_message (перший виклик колись раніше);
 * 2) щойно програв гонку конкурентному виклику (сценарій вище).
 */
export async function insertWelcomeMessageIfFirst(
  db: Db,
  input: { id: string; userId: string; role: ChatRoleRow; content: string; sessionDate: string }
): Promise<ChatMessageRecord | null> {
  const { rows } = await db.query<RawChatMessageRow>(
    `INSERT INTO chat_message (id, user_id, role, content, session_date)
     SELECT $1, $2, $3, $4, $5
     WHERE NOT EXISTS (SELECT 1 FROM chat_message WHERE user_id = $2)
     RETURNING ${CHAT_MESSAGE_COLUMNS}`,
    [input.id, input.userId, input.role, input.content, input.sessionDate]
  );
  return rows[0] ? toChatMessageRecord(rows[0]) : null;
}

/**
 * Review 2026-09-12: ports-шар (chat-handler.ts) не пише SQL сам (ADR-0005)
 * -- виносить сюди підрахунок для 60/год rate-limit (§8 SAD). `role='user'`
 * -- лише спроби користувача рахуються, не відповіді агента.
 */
export async function countRecentUserMessages(db: Db, userId: string, sinceIso: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM chat_message WHERE user_id = $1 AND role = 'user' AND created_at >= $2`,
    [userId, sinceIso]
  );
  return Number(rows[0]?.count ?? '0');
}

/**
 * Review 2026-09-12: GET /messages (T20) без пагінаційного репозиторного
 * читання -- та сама причина, що countRecentUserMessages вище. Повна
 * історія користувача хронологічно; сторінкування -- відповідальність
 * ports-шару (той самий підхід, що вже listActiveLayoutPositionsByOwner +
 * сортування на боці порту в structure).
 */
export async function findAllMessagesByUser(db: Db, userId: string): Promise<ChatMessageRecord[]> {
  const { rows } = await db.query<RawChatMessageRow>(
    `SELECT ${CHAT_MESSAGE_COLUMNS} FROM chat_message WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  );
  return rows.map(toChatMessageRecord);
}

// --- agent_audit_event -------------------------------------------------
// Append-only (data-model.md Aggregate root note) -- жодного update/delete
// нижче навмисно.

interface RawAuditEventRow extends QueryResultRow {
  id: string;
  user_id: string;
  event_type: AuditEventTypeRow;
  subject_type: AuditSubjectTypeRow;
  subject_id: string | null;
  detail: string | null;
  occurred_at: Date;
}

function toAuditEventRecord(row: RawAuditEventRow): AuditEventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    detail: row.detail,
    occurredAt: row.occurred_at,
  };
}

const AUDIT_EVENT_COLUMNS = 'id, user_id, event_type, subject_type, subject_id, detail, occurred_at';

export async function insertAuditEvent(
  db: Db,
  input: {
    id: string;
    userId: string;
    eventType: AuditEventTypeRow;
    subjectType: AuditSubjectTypeRow;
    subjectId?: string | null;
    detail?: string | null;
  }
): Promise<AuditEventRecord> {
  const { rows } = await db.query<RawAuditEventRow>(
    `INSERT INTO agent_audit_event (id, user_id, event_type, subject_type, subject_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${AUDIT_EVENT_COLUMNS}`,
    [input.id, input.userId, input.eventType, input.subjectType, input.subjectId ?? null, input.detail ?? null]
  );
  return toAuditEventRecord(rows[0]);
}

/** QG-1 (sad.md §10): аудит-слід користувача хронологічно, найновіші зверху. */
export async function listAuditEventsByUser(db: Db, userId: string): Promise<AuditEventRecord[]> {
  const { rows } = await db.query<RawAuditEventRow>(
    `SELECT ${AUDIT_EVENT_COLUMNS} FROM agent_audit_event WHERE user_id = $1 ORDER BY occurred_at DESC`,
    [userId]
  );
  return rows.map(toAuditEventRecord);
}
