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
import { ruleDirectiveText } from './rules';

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
    // AC-08 fix: той самий `ruleDirectiveText`, що йде в промпт (ask-agent.ts)
    // -- раніше тут був голий `rule.category` (enum-слаг, напр. "reminder")
    // для категорійного правила без власного `ruleText`; тепер `reason`
    // (аудит-лог + текст повторної спроби, `buildRetryDirective`) теж бачить
    // людський опис, не слаг.
    reason: ruleDirectiveText(violatedRule),
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

// AC-08 fix (review finding): категорійне правило (`ruleText === null`)
// раніше НІКОЛИ не потрапляло в жодну перевірку нижче -- `rule.ruleText !=
// null && ...` гарантовано `false` для нього, і функція одразу поверталась
// `false`, тобто правило "діяло" лише в теорії (в UI/промпті), а на
// відповідь guard не впливало взагалі. Категорія 'reminder' D-27 отримує тут
// мінімальну, чесно ЧАСТКОВУ перевірку -- явну відмову агента нагадувати.
// Це НЕ повне семантичне покриття категорії (regex не знає, чи агент
// дійсно мав нагадати саме зараз) -- лишається відкритим питанням (див.
// open_questions у супровідному звіті рев'ю), так само як ADR-0004 Neutral
// заздалегідь визнає keyword-евристику лише стартовою точкою.
const REMINDER_REFUSAL_PATTERN =
  /не\s+буду\s+нагадувати|нагадуванн\w*\s+(вимкнен[оі]|скасован[оі]|вимкнено)|won'?t\s+remind|will\s+not\s+remind/iu;

export function defaultRuleViolationCheck(draftReply: string, rule: ImperativeRule): boolean {
  const directive = ruleDirectiveText(rule);

  if (NO_UNSOLICITED_ADVICE_RULE_PATTERN.test(directive)) {
    return UNSOLICITED_ADVICE_PATTERN.test(draftReply);
  }

  if (rule.category === 'reminder' && REMINDER_REFUSAL_PATTERN.test(draftReply)) {
    return true;
  }

  // Інші п'ять категорій D-27 (data/correction/survey/context_clarification/
  // owner_impact) без власного `ruleText` досі не мають виділеної перевірки
  // тут -- вони доходять до моделі як реальна інструкція (`ruleDirectiveText`,
  // rules.ts), але guard їх поки не розпізнає як порушені; чесно
  // задокументовано як залишковий розрив, не замовчано.
  return false;
}
