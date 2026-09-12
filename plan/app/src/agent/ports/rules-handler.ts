// Ports-шар (T22): HTTP-хендлери правил користувача -- контракт
// (docs/features/agent/contracts/openapi.yaml, шлях /api/v1/rules, GET+POST).
//
// Framework-agnostic (той самий підхід, що cards/life-area-card/ports/*):
// жоден HTTP-фреймворк ще не підключений у репо (T29/T30 підключать
// конкретний транспорт пізніше) -- кожен хендлер тут звичайна async-функція
// (db, ownerUserId, ...параметри) -> Promise<...> точно контрактної форми
// при успіху, або дає AppError пройти нагору при помилці.
//
// Немає app/-шару для правил (tasks.json T22 deps: лише T9 domain + T13
// infra, жодного app-таску для /rules) -- на відміну від messages/proposals
// (T16/T17 app-шар), цей ports-файл сам виконує оркестрацію: валідація через
// domain/rules.ts (Result sentinel, ADR-0006) + конфлікт-перевірка (домен
// каже ЯКІ правила порівнювати -- scope isolation, T9; предикат "ЩО таке
// суперечність" залишається деталлю реалізації, ADR-0004 §Neutral) + запис
// через infra/postgres-repo.ts.
//
// Конфлікт-предикат (defaultRuleConflictPredicate, ../domain/rules.ts) -- КОНСЕРВАТИВНЕ читання
// незакритого design-питання ADR-0004 §Neutral ("guard-перевірка може
// почати як проста keyword/regex... це деталь реалізації, не предмет цього
// ADR"): T22 не має в залежностях ані Claude-клієнта (T12), ані ask-agent
// (T18) -- лише T9 (domain) + T13 (infra) -- тож справжнє природномовне
// виявлення суперечності (LLM-виклик) НЕ реалізоване тут. Натомість --
// детермінований дубль-чек у межах тієї самої області дії (scope): та сама
// категорія вдруге, або дослівний повтор вільного тексту (без урахування
// регістру/пробілів). Це відкрите питання для людини -- справжня семантична
// перевірка суперечності лишається за майбутнім проходом (можливо T18/Claude),
// не вирішується мовчки цим комітом.
//
// 422 agent.rule_empty -- контракт документує лише цей код для 422 на цьому
// ендпоінті; тому будь-яка доменна помилка валідації (`createImperativeRule`
// повертає Result, ADR-0006) мапиться сюди, включно з "невідома категорія"
// (data-model.md CHECK сам по собі гарантує лише "не порожньо", але жодного
// окремого 422-коду для "невідома категорія" контракт не називає -- також
// консервативне читання, не мовчазний вигад нового коду).
//
// Мапінг полів: RuleRecord (postgres-repo.ts) уже camelCase, прямий у Rule-
// схему контракту -- лише Date-поля (createdAt/updatedAt) серіалізуються в
// ISO-рядок на межі порту (той самий підхід, що metric-block-handlers.ts).

import { randomUUID } from 'node:crypto';
import { createImperativeRule, findConflictingRule, defaultRuleConflictPredicate } from '../domain/rules';
import type { ImperativeRule, ImperativeRuleCategory } from '../domain/rules';
import { insertRule, listRulesByScope } from '../infra/postgres-repo';
import type { Db, RuleRecord } from '../infra/postgres-repo';
import { AppError } from '../../shared/errors';

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

/** Точно форма схеми Rule контракту (openapi.yaml). */
export interface RuleResponse {
  id: string;
  scopeCardId: string | null;
  category: ImperativeRuleCategory | null;
  ruleText: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Точно форма схеми RulePage контракту. */
export interface RulePageResponse {
  items: RuleResponse[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

function toRuleResponse(record: RuleRecord): RuleResponse {
  return {
    id: record.id,
    scopeCardId: record.scopeCardId,
    category: record.category,
    ruleText: record.ruleText,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)));
}

/** In-memory сторінкування над уже завантаженим масивом -- той самий підхід, що entry-handlers.ts listEntries. */
function paginate(rules: RuleRecord[], after: string | undefined, limit: number): RulePageResponse {
  let startIndex = 0;
  if (after) {
    const cursorIndex = rules.findIndex((rule) => rule.id === after);
    // Прострочений/невалидний cursor -- падаємо на першу сторінку, не помилка.
    startIndex = cursorIndex === -1 ? 0 : cursorIndex + 1;
  }

  const page = rules.slice(startIndex, startIndex + limit);
  const hasNext = startIndex + limit < rules.length;

  return {
    items: page.map(toRuleResponse),
    has_next: hasNext,
    has_prev: startIndex > 0,
    next_cursor: hasNext ? page[page.length - 1].id : null,
  };
}

export interface ListRulesQuery {
  /** Відсутній параметр = лише глобальні правила (openapi.yaml listRules). */
  scopeCardId?: string | null;
  after?: string;
  limit?: number;
}

/**
 * GET /api/v1/rules (AC-08 "відкрив налаштування правил") -- точний
 * scope-match (не merge з глобальними, той самий запит, що конфлікт-
 * перевірка нижче використовує для AC-14 scope isolation).
 */
export async function listRules(db: Db, ownerUserId: string, query: ListRulesQuery = {}): Promise<RulePageResponse> {
  const rules = await listRulesByScope(db, ownerUserId, query.scopeCardId ?? null);
  return paginate(rules, query.after, clampLimit(query.limit));
}

/** Точно форма тіла RuleCreate контракту. */
export interface RuleCreateBody {
  scopeCardId?: string | null;
  category?: ImperativeRuleCategory | null;
  ruleText?: string | null;
}

/**
 * POST /api/v1/rules (AC-07/AC-08/AC-12/AC-14) -- зберігає правило (з меню
 * категорій, власним текстом, чи обома -- CHECK у базі: OR, не XOR) і
 * повторно звіряє на несуперечливість із наявними правилами ТІЄЇ САМОЇ
 * області дії (AC-14) перед записом.
 *
 * 422 agent.rule_empty -- ні category, ні ruleText не задано (domain
 * `createImperativeRule`, Result sentinel ADR-0006).
 * 409 agent.rule_conflict -- нове правило дублює наявне тієї самої області
 * (`defaultRuleConflictPredicate`, ../domain/rules.ts -- moved there
 * 2026-09-13 so ../app/handle-message.ts's AC-14 chat-drafting path can
 * share the same definition, D-19).
 */
export async function createRule(db: Db, ownerUserId: string, body: RuleCreateBody): Promise<RuleResponse> {
  const scopeCardId = body.scopeCardId ?? null;

  const validated = createImperativeRule({
    id: randomUUID(),
    userId: ownerUserId,
    scopeCardId,
    category: body.category ?? null,
    ruleText: body.ruleText ?? null,
  });

  if (!validated.ok) {
    throw new AppError('agent.rule_empty', 'A rule needs a category, free text, or both', 422);
  }

  const rule = validated.value;
  const existingInScope: ImperativeRule[] = await listRulesByScope(db, ownerUserId, scopeCardId);

  const conflict = findConflictingRule(
    { scopeCardId: rule.scopeCardId, category: rule.category, ruleText: rule.ruleText },
    existingInScope,
    defaultRuleConflictPredicate
  );
  if (conflict) {
    throw new AppError('agent.rule_conflict', 'This rule contradicts an existing rule in the same scope', 409);
  }

  const record = await insertRule(db, {
    id: rule.id,
    userId: rule.userId,
    scopeCardId: rule.scopeCardId,
    category: rule.category,
    ruleText: rule.ruleText,
  });
  return toRuleResponse(record);
}
