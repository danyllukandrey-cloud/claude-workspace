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
