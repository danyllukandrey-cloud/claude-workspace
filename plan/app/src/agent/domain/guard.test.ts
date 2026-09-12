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
