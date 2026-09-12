import { describe, it, expect } from 'vitest';
import { runGuardCheck, defaultRuleViolationCheck } from './guard';
import type { ImperativeRule } from './rules';

function rule(overrides: Partial<ImperativeRule>): ImperativeRule {
  return {
    id: 'rule-x',
    userId: 'user-1',
    scopeCardId: null,
    category: null,
    ruleText: null,
    ...overrides,
  };
}

describe('runGuardCheck (ADR-0004: post-hoc guard check)', () => {
  // sad.md §6 Critical flow 6 (AC-07): a draft reply that violates an active
  // rule must be flagged before it reaches the user, not shown as-is.
  it('flags a draft reply that violates an active rule', () => {
    const activeRules = [rule({ id: 'rule-1', ruleText: 'не радь, якщо не питаю' })];
    const isViolating = (draftReply: string) => draftReply.toLowerCase().includes('раджу');

    const result = runGuardCheck('Раджу спробувати щоденні пробіжки.', activeRules, isViolating);

    expect(result.passed).toBe(false);
    expect(result.violatedRuleId).toBe('rule-1');
  });

  it('passes a draft reply that follows every active rule', () => {
    const activeRules = [rule({ id: 'rule-1', ruleText: 'не радь, якщо не питаю' })];
    const isViolating = (draftReply: string) => draftReply.toLowerCase().includes('раджу');

    const result = runGuardCheck('Записав 5 км бігу.', activeRules, isViolating);

    expect(result.passed).toBe(true);
    expect(result.violatedRuleId).toBeNull();
  });

  it('reports the first violated rule id when several rules are active', () => {
    const activeRules = [
      rule({ id: 'rule-clean', ruleText: 'нагадуй щодня' }),
      rule({ id: 'rule-violated', ruleText: 'не радь, якщо не питаю' }),
    ];
    const isViolating = (_draftReply: string, candidate: ImperativeRule) => candidate.id === 'rule-violated';

    const result = runGuardCheck('щось', activeRules, isViolating);

    expect(result.passed).toBe(false);
    expect(result.violatedRuleId).toBe('rule-violated');
    expect(result.reason).toBe('не радь, якщо не питаю');
  });

  it('passes when there are no active rules at all', () => {
    const result = runGuardCheck('будь-яка відповідь', [], () => true);
    expect(result.passed).toBe(true);
  });
});

describe('defaultRuleViolationCheck (AC-07 canonical example, ADR-0004 Neutral: keyword heuristic)', () => {
  const noUnsolicitedAdviceRule = rule({ id: 'rule-advice', ruleText: 'не радь, якщо не питаю' });

  it('flags a reply that contains unsolicited advice against the "не радь" rule', () => {
    expect(defaultRuleViolationCheck('Раджу спробувати щоденні пробіжки.', noUnsolicitedAdviceRule)).toBe(true);
  });

  it('does not flag a plain factual reply against the "не радь" rule', () => {
    expect(defaultRuleViolationCheck('Записав 5 км бігу сьогодні.', noUnsolicitedAdviceRule)).toBe(false);
  });

  it('never flags a violation for a rule unrelated to unsolicited advice', () => {
    const reminderRule = rule({ id: 'rule-reminder', ruleText: 'нагадуй щодня' });
    expect(defaultRuleViolationCheck('Раджу спробувати щоденні пробіжки.', reminderRule)).toBe(false);
  });

  it('used together with runGuardCheck flags the AC-07 scenario end to end', () => {
    const result = runGuardCheck(
      'Раджу спробувати щоденні пробіжки.',
      [noUnsolicitedAdviceRule],
      defaultRuleViolationCheck,
    );
    expect(result.passed).toBe(false);
    expect(result.violatedRuleId).toBe('rule-advice');
  });
});

describe('defaultRuleViolationCheck (AC-08 fix, review finding: category rule was never guard-enforced)', () => {
  // Before the fix, `rule.ruleText != null && ...` gated the ENTIRE function
  // to `false` whenever a category-only rule (no free text) was checked --
  // AC-08 rules reached the prompt but could never be flagged as violated.
  it('flags an explicit refusal to remind against an active "reminder" category rule', () => {
    const reminderCategoryRule = rule({ id: 'rule-reminder', category: 'reminder', ruleText: null });
    expect(defaultRuleViolationCheck('Гаразд, більше не буду нагадувати про це.', reminderCategoryRule)).toBe(true);
  });

  it('does not flag a normal reminder-following reply against the "reminder" category rule', () => {
    const reminderCategoryRule = rule({ id: 'rule-reminder', category: 'reminder', ruleText: null });
    expect(defaultRuleViolationCheck('Нагадаю про це завтра.', reminderCategoryRule)).toBe(false);
  });

  // Honest scope limit (documented, not silently overclaimed): the other
  // five D-27 categories still have no dedicated heuristic here -- they
  // reach the model as a real directive (`ruleDirectiveText`, rules.ts) but
  // are not yet guard-enforced. This is the remaining gap, not a regression.
  it('still returns false for a category with no dedicated check yet (documented gap, not silently different from before)', () => {
    const dataCategoryRule = rule({ id: 'rule-data', category: 'data', ruleText: null });
    expect(defaultRuleViolationCheck('Записав 5 кг.', dataCategoryRule)).toBe(false);
  });
});
