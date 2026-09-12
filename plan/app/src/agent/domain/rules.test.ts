import { describe, it, expect } from 'vitest';
import {
  createCategoryRule,
  createFreeTextRule,
  createImperativeRule,
  isCardOverride,
  rulesInSameScope,
  findConflictingRule,
  computeEffectiveRules,
  defaultRuleShadowPredicate,
  ruleDirectiveText,
  CATEGORY_DIRECTIVES,
} from './rules';
import type { ImperativeRule } from './rules';

/** Розпаковує `Result<ImperativeRule, RuleError>` для happy-path тестів, де очікується `ok`. */
function unwrap(result: ReturnType<typeof createImperativeRule>): ImperativeRule {
  if (!result.ok) {
    throw new Error(`очікувалось ok, отримано err: ${result.error.code}`);
  }
  return result.value;
}

describe('createCategoryRule', () => {
  // AC-08: Given the user opened rule settings, when they pick one or more
  // categories from the curated menu (no free text), then the system stores
  // the chosen categories as active rules.
  it('creates a global rule from a curated category, without free text', () => {
    const rule = unwrap(createCategoryRule({ id: 'rule-1', userId: 'user-1', category: 'reminder' }));
    expect(rule).toMatchObject({
      id: 'rule-1',
      userId: 'user-1',
      scopeCardId: null,
      category: 'reminder',
      ruleText: null,
    });
  });

  it('rejects an unknown category not in the D-27 curated menu -- ADR-0006 sentinel, not a throw', () => {
    const result = createCategoryRule({ id: 'rule-1', userId: 'user-1', category: 'not_a_real_category' as never });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('imperative_rule.category_invalid');
  });
});

describe('createFreeTextRule', () => {
  // AC-03/AC-14 (D-35): Given the user wants to set their own imperative
  // rule, when it is created as free text, then the system stores it without
  // a curated category.
  it('creates a global rule from free text, without a category', () => {
    const rule = unwrap(createFreeTextRule({ id: 'rule-2', userId: 'user-1', ruleText: 'не радь, якщо не питаю' }));
    expect(rule).toMatchObject({
      id: 'rule-2',
      userId: 'user-1',
      scopeCardId: null,
      category: null,
      ruleText: 'не радь, якщо не питаю',
    });
  });

  it('trims surrounding whitespace from the rule text', () => {
    const rule = unwrap(createFreeTextRule({ id: 'rule-2', userId: 'user-1', ruleText: '  не радь, якщо не питаю  ' }));
    expect(rule.ruleText).toBe('не радь, якщо не питаю');
  });

  it('rejects empty/whitespace-only free text -- ADR-0006 sentinel, not a throw', () => {
    const result = createFreeTextRule({ id: 'rule-2', userId: 'user-1', ruleText: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('imperative_rule.empty');
  });
});

describe('createImperativeRule', () => {
  // data-model.md CHECK (`category IS NOT NULL OR rule_text IS NOT NULL`):
  // a rule can never be empty on both sides at once.
  it('rejects a rule with neither category nor free text -- ADR-0006 sentinel, not a throw', () => {
    const result = createImperativeRule({ id: 'rule-3', userId: 'user-1', category: null, ruleText: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('imperative_rule.empty');
  });

  it('allows both a category and free text on the same rule (CHECK is OR, not XOR)', () => {
    const rule = unwrap(
      createImperativeRule({
        id: 'rule-4',
        userId: 'user-1',
        category: 'data',
        ruleText: 'уточнюй, якщо не знаєш одиниці виміру',
      }),
    );
    expect(rule.category).toBe('data');
    expect(rule.ruleText).toBe('уточнюй, якщо не знаєш одиниці виміру');
  });
});

describe('isCardOverride (AC-12)', () => {
  it('reports false for a global rule (scopeCardId null)', () => {
    const rule = unwrap(createCategoryRule({ id: 'rule-1', userId: 'user-1', category: 'reminder' }));
    expect(isCardOverride(rule)).toBe(false);
  });

  it('reports true for a card-scoped override', () => {
    const rule = unwrap(
      createCategoryRule({ id: 'rule-1', userId: 'user-1', category: 'reminder', scopeCardId: 'card-1' }),
    );
    expect(isCardOverride(rule)).toBe(true);
  });
});

function rule(overrides: Partial<ImperativeRule>): ImperativeRule {
  return {
    id: 'rule-x',
    userId: 'user-1',
    scopeCardId: null,
    category: null,
    ruleText: 'placeholder',
    ...overrides,
  };
}

describe('rulesInSameScope (AC-14 scope isolation)', () => {
  it('returns only global rules when the candidate scope is global', () => {
    const rules = [
      rule({ id: 'global-1', scopeCardId: null }),
      rule({ id: 'card-a-1', scopeCardId: 'card-a' }),
      rule({ id: 'global-2', scopeCardId: null }),
    ];
    const result = rulesInSameScope(null, rules);
    expect(result.map((r) => r.id).sort()).toEqual(['global-1', 'global-2']);
  });

  it('returns only rules scoped to the same card, excluding global and other cards', () => {
    const rules = [
      rule({ id: 'global-1', scopeCardId: null }),
      rule({ id: 'card-a-1', scopeCardId: 'card-a' }),
      rule({ id: 'card-b-1', scopeCardId: 'card-b' }),
      rule({ id: 'card-a-2', scopeCardId: 'card-a' }),
    ];
    const result = rulesInSameScope('card-a', rules);
    expect(result.map((r) => r.id).sort()).toEqual(['card-a-1', 'card-a-2']);
  });
});

describe('findConflictingRule (AC-14: scope-isolated conflict check, ADR-0004)', () => {
  // AC-14: a new global formulation is checked only against existing global
  // rules -- a contradicting card-override must never block it, because
  // AC-12's override is a deliberate, expected divergence, not a
  // contradiction to resolve.
  it('does not flag a conflict with a contradicting card-override when the candidate is global', () => {
    const existing = [rule({ id: 'card-a-override', scopeCardId: 'card-a', ruleText: 'радь завжди' })];
    const alwaysConflicts = () => true;

    const conflict = findConflictingRule(
      { scopeCardId: null, category: null, ruleText: 'не радь, якщо не питаю' },
      existing,
      alwaysConflicts,
    );

    expect(conflict).toBeNull();
  });

  // Mirror case: a card-override candidate is checked only against other
  // rules scoped to that SAME card, never against the global rule it is
  // deliberately overriding (AC-12), and never against a different card.
  it('does not flag a conflict with the global rule or another card when the candidate is a card-override', () => {
    const existing = [
      rule({ id: 'global', scopeCardId: null, ruleText: 'не радь, якщо не питаю' }),
      rule({ id: 'other-card', scopeCardId: 'card-b', ruleText: 'радь завжди' }),
    ];
    const alwaysConflicts = () => true;

    const conflict = findConflictingRule(
      { scopeCardId: 'card-a', category: null, ruleText: 'радь завжди' },
      existing,
      alwaysConflicts,
    );

    expect(conflict).toBeNull();
  });

  it('flags a conflict found within the same scope', () => {
    const existing = [
      rule({ id: 'global-existing', scopeCardId: null, ruleText: 'не радь, якщо не питаю' }),
      rule({ id: 'card-a-existing', scopeCardId: 'card-a', ruleText: 'радь завжди' }),
    ];
    const conflictsOnExactOpposite: import('./rules').RuleConflictPredicate = (candidate, other) =>
      candidate.ruleText === 'радь завжди' && other.ruleText === 'не радь, якщо не питаю';

    const conflict = findConflictingRule(
      { scopeCardId: null, category: null, ruleText: 'радь завжди' },
      existing,
      conflictsOnExactOpposite,
    );

    expect(conflict?.id).toBe('global-existing');
  });

  it('returns null when no rule in the same scope conflicts', () => {
    const existing = [rule({ id: 'global-existing', scopeCardId: null, ruleText: 'нагадуй щодня' })];
    const neverConflicts = () => false;

    const conflict = findConflictingRule(
      { scopeCardId: null, category: null, ruleText: 'нагадуй щотижня' },
      existing,
      neverConflicts,
    );

    expect(conflict).toBeNull();
  });
});

describe('ruleDirectiveText (AC-08 fix: category rule must reach the model as a real directive)', () => {
  it("returns the rule's own free text when set", () => {
    const freeTextRule = rule({ ruleText: 'не радь, якщо не питаю', category: null });
    expect(ruleDirectiveText(freeTextRule)).toBe('не радь, якщо не питаю');
  });

  it('falls back to the category directive when ruleText is null -- never a bare slug', () => {
    const categoryRule = rule({ ruleText: null, category: 'reminder' });
    expect(ruleDirectiveText(categoryRule)).toBe(CATEGORY_DIRECTIVES.reminder);
    expect(ruleDirectiveText(categoryRule)).not.toBe('reminder');
  });

  it('prefers the free text over the category directive when both are set (CHECK is OR, not XOR)', () => {
    const bothRule = rule({ ruleText: 'уточнюй одиниці виміру', category: 'data' });
    expect(ruleDirectiveText(bothRule)).toBe('уточнюй одиниці виміру');
  });
});

describe('computeEffectiveRules (AC-12 fix, review finding: precedence inversion)', () => {
  // spec.md AC-12: "перевизначення картки свідомо переважає глобальне
  // правило... це очікуваний намір користувача, а не суперечність". The
  // global rule an override shadows must be excluded from the effective
  // set entirely, not merely reordered alongside it.
  it('drops a global rule shadowed by a same-category card override', () => {
    const globalRule = rule({ id: 'global-reminder', scopeCardId: null, category: 'reminder', ruleText: null });
    const cardOverride = rule({
      id: 'override-reminder',
      scopeCardId: 'card-1',
      category: 'reminder',
      ruleText: 'на цій картці не нагадуй',
    });

    const effective = computeEffectiveRules([globalRule, cardOverride]);

    expect(effective.map((r) => r.id)).toEqual(['override-reminder']);
  });

  it('keeps a global rule that no override shadows (different category)', () => {
    const globalRule = rule({ id: 'global-data', scopeCardId: null, category: 'data', ruleText: null });
    const cardOverride = rule({ id: 'override-reminder', scopeCardId: 'card-1', category: 'reminder', ruleText: null });

    const effective = computeEffectiveRules([globalRule, cardOverride]);

    expect(effective.map((r) => r.id).sort()).toEqual(['global-data', 'override-reminder']);
  });

  it('keeps every rule unchanged when there is no card override at all', () => {
    const rules = [
      rule({ id: 'global-1', scopeCardId: null, ruleText: 'не радь, якщо не питаю' }),
      rule({ id: 'global-2', scopeCardId: null, ruleText: 'нагадуй щодня' }),
    ];

    expect(computeEffectiveRules(rules).map((r) => r.id).sort()).toEqual(['global-1', 'global-2']);
  });

  it('accepts a custom isShadowing predicate (DI, same convention as isConflicting/isViolating)', () => {
    const globalRule = rule({ id: 'global-free', scopeCardId: null, ruleText: 'не радь, якщо не питаю' });
    const cardOverride = rule({ id: 'override-free', scopeCardId: 'card-1', ruleText: 'радь щодня' });
    const sameTopicOpposite = (override: Pick<ImperativeRule, 'category' | 'ruleText'>, global: ImperativeRule) =>
      override.ruleText === 'радь щодня' && global.ruleText === 'не радь, якщо не питаю';

    const effective = computeEffectiveRules([globalRule, cardOverride], sameTopicOpposite);

    expect(effective.map((r) => r.id)).toEqual(['override-free']);
  });
});

describe('defaultRuleShadowPredicate (AC-12 default topic match)', () => {
  it('matches on exact category equality', () => {
    const override = { category: 'reminder' as const, ruleText: null };
    const global = rule({ category: 'reminder', ruleText: null });
    expect(defaultRuleShadowPredicate(override, global)).toBe(true);
  });

  it('matches on exact free-text equality (trimmed, case-insensitive)', () => {
    const override = { category: null, ruleText: '  Не Радь, Якщо Не Питаю  ' };
    const global = rule({ category: null, ruleText: 'не радь, якщо не питаю' });
    expect(defaultRuleShadowPredicate(override, global)).toBe(true);
  });

  it('does not match two unrelated free-text rules', () => {
    const override = { category: null, ruleText: 'радь щодня' };
    const global = rule({ category: null, ruleText: 'не радь, якщо не питаю' });
    expect(defaultRuleShadowPredicate(override, global)).toBe(false);
  });

  it('does not match different categories', () => {
    const override = { category: 'reminder' as const, ruleText: null };
    const global = rule({ category: 'data', ruleText: null });
    expect(defaultRuleShadowPredicate(override, global)).toBe(false);
  });
});
