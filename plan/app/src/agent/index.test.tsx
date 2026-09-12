// Публічний вхід агента (index.ts) -- правило залежностей (plan/app/CLAUDE.md):
// решта проєкту імпортує агента ТІЛЬКИ звідси, ніколи напряму з ui/. Той самий
// підхід, що ../structure/index.test.tsx.
//
// Review 2026-09-11 (структура, MUST-FIX 4/5) -- урок застосований тут:
// пінимо саме ДОСЯЖНІСТЬ (реальний рендер кожного з 4 екранів SCR-01..SCR-04
// через публічні двері модуля), не лише факт, що символ експортується.

import { render, screen, waitFor } from '@testing-library/react';
import { ChatScreen, RuleSettingsScreen, ReportsScreen, AccountScreen } from './index';

test('публічний вхід агента віддає робочий ChatScreen (SCR-01)', async () => {
  render(
    <ChatScreen
      loadHistory={vi.fn().mockResolvedValue([])}
      loadOnboarding={vi.fn().mockResolvedValue({ welcomeShown: true, message: null })}
      loadActiveProposal={vi.fn().mockResolvedValue(null)}
      sendMessage={vi.fn()}
      confirmProposal={vi.fn()}
    />,
  );

  expect(await screen.findByRole('heading', { name: 'Чат' })).toBeTruthy();
});

test('публічний вхід агента віддає робочий RuleSettingsScreen (SCR-02)', async () => {
  render(
    <RuleSettingsScreen
      targetCards={[]}
      loadRules={vi.fn().mockResolvedValue([])}
      onSave={vi.fn()}
    />,
  );

  expect(await screen.findByRole('heading', { name: 'Налаштування правил' })).toBeTruthy();
});

test('публічний вхід агента віддає робочий ReportsScreen (SCR-03)', async () => {
  render(<ReportsScreen loadReports={vi.fn().mockResolvedValue([])} />);

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Звіти активності' })).toBeTruthy());
});

test('публічний вхід агента віддає робочий AccountScreen (SCR-04)', async () => {
  render(
    <AccountScreen
      loadResources={vi.fn().mockResolvedValue([])}
      onAddResource={vi.fn()}
      onRemoveResource={vi.fn()}
      onDeleteAccount={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );

  expect(await screen.findByRole('heading', { name: 'Обліковий запис і дані' })).toBeTruthy();
});
