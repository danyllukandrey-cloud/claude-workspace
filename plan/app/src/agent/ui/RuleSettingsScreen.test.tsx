// T27 -- SCR-02 Налаштування правил (screens.md): component test for
// RuleSettingsScreen -- default/card-scope/empty/loading/saved/conflict/
// validation states (spec.md AC-07/AC-08/AC-12/AC-14). Component does not
// exist yet -- this is the RED step (test-author role), same convention as
// CloseCardDialog.test.tsx (T23) / DeclarationScreen.test.tsx: RED imports
// the not-yet-written module directly, the module-not-found failure IS the
// expected first-run outcome.
//
// DI style (plan/app/CLAUDE.md, matches DeclarationScreen/CloseCardDialog):
// loadRules/onSave are injected prop-functions -- no fetch() inside the
// component. Real HTTP transport is ports/rules-handler.ts (T22, already
// implemented: GET/POST /api/v1/rules), wired by a future caller (T29).
//
// CardPicker (screens.md: "reused, той самий компонент, що вже запропонував
// structure/screens.md") is rendered inline as a plain <select
// aria-label="Картка">, same convention as CloseCardDialog.tsx's inline
// <select aria-label={...}> -- no separate component file exists for it
// anywhere in the repo yet (files_hint for T27 lists only
// RuleSettingsScreen.tsx).
//
// Backend semantics this test relies on (rules-handler.ts, T22): POST
// /rules accepts exactly ONE category and/or ONE ruleText per call --
// multi-select in RuleCategoryMenu (AC-08 "одну чи кілька категорій") is
// therefore submitted as one onSave call per newly-selected category, plus
// one more call if free text is filled in.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RuleSettingsScreen } from './RuleSettingsScreen';
import type { RuleSettingsScreenProps, RuleSettingsScreenRule } from './RuleSettingsScreen';

function rule(overrides: Partial<RuleSettingsScreenRule> = {}): RuleSettingsScreenRule {
  return {
    id: 'rule-1',
    scopeCardId: null,
    category: 'reminder',
    ruleText: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<RuleSettingsScreenProps> = {}): RuleSettingsScreenProps {
  return {
    targetCards: [
      { cardId: 'card-sport', cardTitle: 'Спорт' },
      { cardId: 'card-navchannia', cardTitle: 'Навчання' },
    ],
    loadRules: vi.fn().mockResolvedValue([rule()]),
    onSave: vi.fn().mockResolvedValue(rule({ id: 'rule-new', category: 'data' })),
    ...overrides,
  };
}

test('loading: перед резолвом loadRules показує Spinner', () => {
  const neverResolves: RuleSettingsScreenProps['loadRules'] = () => new Promise<RuleSettingsScreenRule[]>(() => {});
  const props = baseProps({ loadRules: vi.fn(neverResolves) });
  render(<RuleSettingsScreen {...props} />);

  expect(screen.getByRole('status')).toBeTruthy();
});

test('default: показує готове меню з 6 категорій (D-27), TextField і кнопку "Зберегти" (AC-08)', async () => {
  const props = baseProps();
  render(<RuleSettingsScreen {...props} />);

  await screen.findByText('Дані');
  expect(screen.getByText('Корекція')).toBeTruthy();
  expect(screen.getByText('Опитування')).toBeTruthy();
  expect(screen.getByText('Уточнення контексту')).toBeTruthy();
  expect(screen.getByText('Вплив на власника')).toBeTruthy();
  expect(screen.getByText('Нагадування')).toBeTruthy();
  expect(screen.getByLabelText(/власне правило/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Зберегти' })).toBeTruthy();

  // Категорія, вже активна з loadRules ('reminder') -- показана позначеною й недоступною для повторного вибору.
  const reminderCheckbox = screen.getByRole('checkbox', { name: 'Нагадування' }) as HTMLInputElement;
  expect(reminderCheckbox.checked).toBe(true);
  expect(reminderCheckbox.disabled).toBe(true);

  // Глобальний режим -- CardPicker прихований (DoD: "перемикання на card-scope
  // показує CardPicker, приховує його у глобальному режимі").
  expect(screen.queryByLabelText('Картка')).toBeNull();
});

test('card-scope: перемикання показує CardPicker і перезавантажує правила саме для цієї картки (AC-12)', async () => {
  const loadRules = vi.fn().mockResolvedValue([]);
  const props = baseProps({ loadRules });
  render(<RuleSettingsScreen {...props} />);

  await screen.findByText('Дані');
  expect(loadRules).toHaveBeenCalledWith(null);

  fireEvent.click(screen.getByRole('checkbox', { name: /перевизначити/i }));

  await waitFor(() => expect(loadRules).toHaveBeenLastCalledWith('card-sport'));
  expect(screen.getByLabelText('Картка')).toBeTruthy();
  expect(screen.getByText(/для картки/i)).toBeTruthy();
  expect(screen.getByText(/лише на цій картці/i)).toBeTruthy();

  // Вимкнення перевизначення ховає CardPicker і повертає глобальний scope.
  fireEvent.click(screen.getByRole('checkbox', { name: /перевизначити/i }));
  await waitFor(() => expect(loadRules).toHaveBeenLastCalledWith(null));
  expect(screen.queryByLabelText('Картка')).toBeNull();
});

test('empty: жодного правила ще не задано -- EmptyState, форма лишається доступною для першого правила', async () => {
  const props = baseProps({ loadRules: vi.fn().mockResolvedValue([]) });
  render(<RuleSettingsScreen {...props} />);

  expect(await screen.findByText(/жодного правила не задано/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Зберегти' })).toBeTruthy();
});

test('saved: успішний POST показує Banner variant="success" і надсилає рівно одну нову категорію (AC-08)', async () => {
  const onSave = vi.fn().mockResolvedValue(rule({ id: 'rule-new', category: 'data' }));
  const props = baseProps({ loadRules: vi.fn().mockResolvedValue([]), onSave });
  render(<RuleSettingsScreen {...props} />);

  await screen.findByText('Дані');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Дані' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  const banner = await screen.findByText('Збережено');
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('success');
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith({ scopeCardId: null, category: 'data', ruleText: null });
});

test('conflict: 409 agent.rule_conflict показує Banner variant="error" з текстом помилки (AC-14)', async () => {
  const onSave = vi.fn().mockRejectedValue({
    name: 'AppError',
    message: 'This rule contradicts an existing rule in the same scope',
    code: 'agent.rule_conflict',
    httpStatus: 409,
  });
  const props = baseProps({ loadRules: vi.fn().mockResolvedValue([]), onSave });
  render(<RuleSettingsScreen {...props} />);

  await screen.findByText('Дані');
  fireEvent.change(screen.getByLabelText(/власне правило/i), { target: { value: 'не радь, якщо не питаю' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  const banner = await screen.findByText(/contradicts/i);
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
});

test('validation: без обраної категорії і без власного тексту -- inline-помилка під формою, onSave не викликається (422 agent.rule_empty)', async () => {
  const onSave = vi.fn();
  const props = baseProps({ loadRules: vi.fn().mockResolvedValue([]), onSave });
  render(<RuleSettingsScreen {...props} />);

  await screen.findByText('Дані');
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(onSave).not.toHaveBeenCalled();
});
