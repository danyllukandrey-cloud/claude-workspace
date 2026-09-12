// Доменна логіка "Агента" -- імперативні правила користувача (T9).
// Чиста функція, без I/O (plan/app/CLAUDE.md, "domain -> НІЧОГО"): id
// генерується викликачем (app-шар, `randomUUID()`), той самий підхід, що й
// life-area-card/domain/card.ts createCard.
//
// Дві форми правила (data-model.md `imperative_rule`, ADR-0004):
// - куратоване меню категорій (D-27, AC-08) -- `category` заповнено;
// - власний вільний текст (D-35, AC-03/AC-14) -- `rule_text` заповнено.
// CHECK у базі -- `category IS NOT NULL OR rule_text IS NOT NULL` (OR, не
// XOR): обидва поля можуть бути заповнені одночасно, порожні -- ніколи.
//
// `scopeCardId` (AC-12): NULL -- глобальне правило, заповнено -- перевизначення
// саме на цій картці. Перевизначення свідомо переважає глобальне на цій
// картці -- це очікуваний намір (spec.md AC-12), не суперечність.
//
// Sentinel Result (docs/features/agent/adr/0006-domain-sentinel-for-expected-errors.md,
// Accepted): валідація нижче -- очікуваний доменний результат (невідома
// категорія, порожнє правило), не аварія -- тому `Result<T, E>`
// (`shared/result.ts`), не `throw` (вирівняно з `proposal.ts`, T8).

import type { Result } from '../../shared/result';
import { ok, err } from '../../shared/result';

export type ImperativeRuleCategory =
  | 'data'
  | 'correction'
  | 'survey'
  | 'context_clarification'
  | 'owner_impact'
  | 'reminder';

// 6 категорій D-27, остаточний склад v1 (sad.md §5): дані/корекція/опитування/
// уточнення контексту/вплив на власника/нагадування.
const VALID_CATEGORIES: readonly ImperativeRuleCategory[] = [
  'data',
  'correction',
  'survey',
  'context_clarification',
  'owner_impact',
  'reminder',
];

// AC-08 fix (review finding): раніше категорійне правило (без власного
// `ruleText`) доходило до системного промпту як голий enum-слаг
// (`rule.ruleText ?? rule.category`, напр. "reminder") -- це не інструкція,
// яку модель здатна виконати, а просто назва категорії. Один опис на
// категорію тут -- єдине джерело правди (D-19): і промпт (ask-agent.ts), і
// guard (guard.ts) читають ту саму мапу через `ruleDirectiveText` нижче,
// замість кожен по-своєму вирішувати, що показати замість `ruleText`.
export const CATEGORY_DIRECTIVES: Record<ImperativeRuleCategory, string> = {
  data: 'Перш ніж записати значення, уточнюй одиниці виміру та деталі даних, якщо вони неочевидні.',
  correction: 'Дозволяй користувачу виправляти вже записані дані без заперечень; не наполягай на початковому значенні.',
  survey: 'Час від часу став короткі уточнюючі запитання щодо цієї теми, а не лише пасивно фіксуй.',
  context_clarification: 'Якщо повідомлення користувача неоднозначне, спершу уточни контекст, а не здогадуйся.',
  owner_impact: 'Перш ніж пропонувати запис, зваж, як він вплине на власника картки.',
  reminder: 'Регулярно нагадуй користувачу про цю тему, не перериваючи занадто часто.',
};

// AC-08: людський текст правила для промпту й guard-перевірки -- власний
// `ruleText`, якщо він є (CHECK у БД -- OR, не XOR, тож обидва поля можуть
// бути заповнені одночасно, і власне формулювання тоді має пріоритет), інакше
// -- директива категорії з мапи вище. Порожній рядок неможливий: домен не
// пускає рядок, де і категорія, і `ruleText` -- null (`createImperativeRule`).
export function ruleDirectiveText(rule: Pick<ImperativeRule, 'category' | 'ruleText'>): string {
  if (rule.ruleText !== null) {
    return rule.ruleText;
  }
  if (rule.category !== null) {
    return CATEGORY_DIRECTIVES[rule.category];
  }
  return '';
}

export interface ImperativeRule {
  id: string;
  userId: string;
  scopeCardId: string | null;
  category: ImperativeRuleCategory | null;
  ruleText: string | null;
}

export interface RuleError {
  code: string;
  message: string;
}

function normalizeRuleText(value: string | null | undefined): string | null {
  if (value == null || !value.trim()) {
    return null;
  }
  return value.trim();
}

export interface CreateImperativeRuleInput {
  id: string;
  userId: string;
  scopeCardId?: string | null;
  category?: ImperativeRuleCategory | null;
  ruleText?: string | null;
}

export function createImperativeRule(input: CreateImperativeRuleInput): Result<ImperativeRule, RuleError> {
  const category = input.category ?? null;
  const ruleText = normalizeRuleText(input.ruleText);

  if (category !== null && !VALID_CATEGORIES.includes(category)) {
    return err({
      code: 'imperative_rule.category_invalid',
      message: `Невідома категорія правила: ${String(category)}`,
    });
  }

  if (category === null && ruleText === null) {
    return err({
      code: 'imperative_rule.empty',
      message: 'Правило має містити або категорію з готового меню, або власний текст',
    });
  }

  return ok({
    id: input.id,
    userId: input.userId,
    scopeCardId: input.scopeCardId ?? null,
    category,
    ruleText,
  });
}

// AC-08 -- готове меню категорій, без вільного тексту користувача.
export function createCategoryRule(input: {
  id: string;
  userId: string;
  category: ImperativeRuleCategory;
  scopeCardId?: string | null;
}): Result<ImperativeRule, RuleError> {
  return createImperativeRule({ ...input, ruleText: null });
}

// AC-03/AC-14 (D-35) -- власне сформульоване правило, без категорії з меню.
export function createFreeTextRule(input: {
  id: string;
  userId: string;
  ruleText: string;
  scopeCardId?: string | null;
}): Result<ImperativeRule, RuleError> {
  return createImperativeRule({ ...input, category: null });
}

// AC-12 -- чи це перевизначення на конкретній картці (а не глобальне правило).
export function isCardOverride(rule: ImperativeRule): boolean {
  return rule.scopeCardId !== null;
}

// AC-12 fix (review finding: precedence inversion): визначає, чи `override`
// (card-override, `isCardOverride(override)` вже true в кожному виклику
// нижче) і `candidateGlobal` (глобальне правило) -- "той самий топік", тобто
// override свідомо ПЕРЕВИЗНАЧАЄ саме це глобальне правило (AC-12), а не
// просто ще одне незалежне правило поруч. Як і `RuleConflictPredicate`
// (AC-14) вище, сама семантика "той самий топік" для довільного вільного
// тексту -- не предмет domain-шару (ADR-0004 Neutral), тож викликач може
// підставити власний предикат; тут лише дефолт.
export type RuleShadowPredicate = (
  override: Pick<ImperativeRule, 'category' | 'ruleText'>,
  candidateGlobal: ImperativeRule,
) => boolean;

// Дефолт свідомо консервативний і однозначний: збіг категорії з D-27
// закритого меню (шість фіксованих значень -- жодної потреби в семантиці,
// щоб знати, що "reminder" перевизначає "reminder") АБО точний збіг
// вільного тексту (без урахування регістру/пробілів по краях). Він НЕ
// розпізнає, що два по-різному сформульовані вільнотекстові правила -- про
// один і той самий топік (той самий Neutral-розрив, що й `findConflictingRule`
// вище) -- викликач підставляє власний предикат, коли це потрібно.
export function defaultRuleShadowPredicate(
  override: Pick<ImperativeRule, 'category' | 'ruleText'>,
  candidateGlobal: ImperativeRule,
): boolean {
  if (override.category !== null && candidateGlobal.category !== null) {
    return override.category === candidateGlobal.category;
  }
  if (override.ruleText !== null && candidateGlobal.ruleText !== null) {
    return override.ruleText.trim().toLowerCase() === candidateGlobal.ruleText.trim().toLowerCase();
  }
  return false;
}

// AC-12: набір правил, що РЕАЛЬНО діють на відповідь (промпт + guard), а не
// лише "показані поруч". Раніше викликач (ask-agent.ts) брав список
// глобальні+card-override як є і прогонив guard проти КОЖНОГО -- порушення
// глобального правила проваляло guard, навіть коли саме на цій картці
// користувач свідомо задав протилежне (spec.md AC-12: "перевизначення
// свідомо переважає глобальне... це очікуваний намір, а не суперечність").
// Тут override завжди виграє: глобальне правило, яке він перевизначає
// (`isShadowing`), відкидається з ефективного набору повністю -- не просто
// переставляється в списку. Вхідний `rules` -- вже скоуплений викликачем
// список (глобальні + ЦІЄЇ картки override, `listEffectiveRulesForCard`,
// T13) -- тут не перевіряється належність override саме "цій" картці
// (isCardOverride бачить лише "не null"), бо той вхідний інваріант
// встановлює викликач, не ця чиста функція.
export function computeEffectiveRules(
  rules: ImperativeRule[],
  isShadowing: RuleShadowPredicate = defaultRuleShadowPredicate,
): ImperativeRule[] {
  const overrides = rules.filter(isCardOverride);
  const globals = rules.filter((rule) => !isCardOverride(rule));

  const survivingGlobals = globals.filter(
    (global) => !overrides.some((override) => isShadowing(override, global)),
  );

  return [...survivingGlobals, ...overrides];
}

// AC-14 -- перевірка на несуперечливість звіряє нове формулювання ЛИШЕ з
// правилами тієї самої області дії: глобальне правило звіряється лише з
// глобальними, перевизначення картки -- лише з іншими правилами тієї самої
// картки. Точна межа (`scopeCardId === candidateScopeCardId`) навмисно НЕ
// пропускає перевизначення картки в перевірку глобального правила (і
// навпаки) -- саме це і є "scope-isolated" з DoD T9: AC-12 вже й так
// свідомо суперечить глобальному правилу за задумом (spec.md AC-14), тож
// ця пара ніколи не повинна потрапити в conflict-перевірку.
export function rulesInSameScope(
  candidateScopeCardId: string | null,
  existingRules: ImperativeRule[],
): ImperativeRule[] {
  return existingRules.filter((rule) => rule.scopeCardId === candidateScopeCardId);
}

// Сама семантика "суперечності" (природна мова, D-35) -- не предмет
// domain-шару: ADR-0004 Neutral-наслідок явно лишає механізм перевірки
// (keyword/regex чи LLM-виклик) деталлю реалізації, не зафіксованою цим
// рішенням. Тому предикат приймається параметром від викликача (той самий
// підхід DI, що й `db`-параметр у app-шарі, plan/app/CLAUDE.md) -- домен
// відповідає лише за те, ЯКІ правила взагалі йдуть у порівняння
// (scope-isolation), не за те, ЯК визначається сама суперечність.
export type RuleConflictPredicate = (
  candidate: Pick<ImperativeRule, 'scopeCardId' | 'category' | 'ruleText'>,
  existing: ImperativeRule,
) => boolean;

function normalizeRuleTextForComparison(value: string): string {
  return value.trim().toLowerCase();
}

// AC-14 (review 2026-09-13, D-19 single-source-of-truth): moved here from
// ../ports/rules-handler.ts, where it lived as a private `isDuplicateInScope`
// const -- ../app/handle-message.ts (AC-14's chat-drafting path) needs the
// SAME definition of "conflict" as the settings-screen REST path
// (POST /api/v1/rules), and an app-layer file importing from ports/ would
// invert ADR-0005's layering (ports depends on app/domain, never the
// reverse). Exporting a default HERE -- alongside `defaultRuleShadowPredicate`
// above, the same pattern -- keeps ADR-0004 §Neutral intact (a caller may
// still supply its own predicate to `findConflictingRule`; this is a
// convenience default, not a domain requirement) while giving both callers
// one place to agree on what counts as a duplicate: the same category twice
// in the same scope, or a literal (case/whitespace-insensitive) repeat of
// free text. Real semantic (LLM-based) conflict detection remains the
// explicitly open design question ADR-0004 already names -- not decided here.
export const defaultRuleConflictPredicate: RuleConflictPredicate = (candidate, existing) => {
  if (candidate.category !== null && candidate.category === existing.category) {
    return true;
  }
  if (candidate.ruleText !== null && existing.ruleText !== null) {
    return normalizeRuleTextForComparison(candidate.ruleText) === normalizeRuleTextForComparison(existing.ruleText);
  }
  return false;
};

export interface RuleConflictCheckInput {
  scopeCardId: string | null;
  category: ImperativeRuleCategory | null;
  ruleText: string | null;
}

export function findConflictingRule(
  candidate: RuleConflictCheckInput,
  existingRules: ImperativeRule[],
  isConflicting: RuleConflictPredicate,
): ImperativeRule | null {
  const sameScope = rulesInSameScope(candidate.scopeCardId, existingRules);
  return sameScope.find((existing) => isConflicting(candidate, existing)) ?? null;
}
