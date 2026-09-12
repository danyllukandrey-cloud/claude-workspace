// Доменна логіка "Агента" -- post-hoc guard-перевірка дотримання правил
// (T9, ADR-0004). Чиста функція, без I/O (plan/app/CLAUDE.md, "domain ->
// НІЧОГО"): backend (app-шар, sad.md §6 Critical flow 6) читає активні
// правила користувача (глобальні + card override, вже вирішений набір
// зовні -- саме читання з БД лишається за app/infra шаром) і чернетку
// відповіді Claude, після чого прогонить її через `runGuardCheck` ДО показу
// користувачу.
//
// AC-07/AC-08/AC-12/AC-14: правило має діяти на КОЖНІЙ відповіді, а не як
// побажання -- ADR-0004 фіксує саме факт перевірки (prompt + post-hoc
// guard), не конкретний механізм визначення "порушення". Той механізм
// (regex/keyword для типових категорій меню чи дешевший LLM-виклик для
// вільного тексту, D-35) ADR лишає деталлю реалізації (Neutral consequence)
// -- тому `runGuardCheck` приймає його параметром (`isViolating`), той самий
// підхід DI, що й `db`-параметр у app-шарі.

import type { ImperativeRule } from './rules';

export interface GuardResult {
  passed: boolean;
  violatedRuleId: string | null;
  reason: string | null;
}

export type RuleViolationCheck = (draftReply: string, rule: ImperativeRule) => boolean;

/**
 * Перевіряє чернетку відповіді проти кожного активного правила по черзі й
 * зупиняється на першому порушенні (Flow 6: "guard-перевірка -- чи відповідь
 * порушує правило"). Порожній список активних правил завжди проходить --
 * нема чого порушувати.
 */
export function runGuardCheck(
  draftReply: string,
  activeRules: ImperativeRule[],
  isViolating: RuleViolationCheck,
): GuardResult {
  const violatedRule = activeRules.find((rule) => isViolating(draftReply, rule));

  if (!violatedRule) {
    return { passed: true, violatedRuleId: null, reason: null };
  }

  return {
    passed: false,
    violatedRuleId: violatedRule.id,
    reason: violatedRule.ruleText ?? violatedRule.category,
  };
}

// ADR-0004 Neutral: "guard-перевірка може почати як проста (keyword/regex
// для типових категорій меню, D-27) і рости до LLM-based лише там, де
// правило вільного тексту (D-35) складніше формалізувати". Канонічний
// приклад самого spec.md/D-37 для вільного тексту -- "не радь, якщо не
// питаю" (AC-07) -- саме його ця перевірка й розпізнає. Це НЕ покриває
// довільний вільний текст правила: для решти формулювань викликач підставляє
// власну (LLM-based) перевірку, `runGuardCheck` від конкретного механізму
// не залежить.
const NO_UNSOLICITED_ADVICE_RULE_PATTERN = /не\s+рад(ь|ити)|без\s+непрохан\w*\s+порад|no unsolicited advice/iu;
const UNSOLICITED_ADVICE_PATTERN =
  /раджу|порад\w*|варт(о|ує)\s+спробувати|рекоменд\w*|you should|i'd suggest|i recommend/iu;

export function defaultRuleViolationCheck(draftReply: string, rule: ImperativeRule): boolean {
  const isNoUnsolicitedAdviceRule = rule.ruleText != null && NO_UNSOLICITED_ADVICE_RULE_PATTERN.test(rule.ruleText);

  if (!isNoUnsolicitedAdviceRule) {
    return false;
  }

  return UNSOLICITED_ADVICE_PATTERN.test(draftReply);
}
