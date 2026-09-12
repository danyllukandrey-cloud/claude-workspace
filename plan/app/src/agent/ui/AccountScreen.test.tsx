// T45 -- SCR-04 Обліковий запис і дані (screens.md): component test for
// AccountScreen -- default/add-resource/sync-error/confirm-delete/deleted
// states (spec.md AC-17/AC-17b/AC-18/AC-18b). Component does not exist yet
// -- this is the RED step (test-author role), same convention as
// RuleSettingsScreen.test.tsx (T27): RED imports the not-yet-written module
// directly, the module-not-found failure IS the expected first-run outcome.
//
// DI style (plan/app/CLAUDE.md, matches RuleSettingsScreen/DeclarationScreen):
// loadResources/onAddResource/onRemoveResource/onDeleteAccount/onDeleted are
// injected prop-functions -- no fetch() inside the component. Real HTTP
// transport is ports/sync-resource-handler.ts + ports/account-handler.ts
// (T44/T43, already done), wired by a future caller (T29).
//
// onDeleteAccount receives an explicit `confirmed: boolean` -- mirrors
// account-handler.ts's own documented ambiguity note (openapi.yaml doesn't
// say where the transport reads confirmation from; the app-layer use-case
// (T39) requires an explicit `confirmed` flag as defense-in-depth). This
// screen is the UI-level gate (AC-17b) -- it only ever calls
// onDeleteAccount(true), and only once the typed word matches exactly, but
// passes the flag explicitly rather than hard-coding it away inside a
// no-arg wrapper, so the defense-in-depth stays visible end-to-end.
//
// Confirmation word "ВИДАЛИТИ" is the literal wireframe text (screens.md
// SCR-04 confirm-delete wireframe: `Введи "ВИДАЛИТИ", щоб підтвердити:`).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountScreen } from './AccountScreen';
import type { AccountScreenProps, AccountScreenResource } from './AccountScreen';

function resource(overrides: Partial<AccountScreenResource> = {}): AccountScreenResource {
  return {
    id: 'res-1',
    url: 'https://docs.google.com/document/d/abc',
    status: 'active',
    lastError: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<AccountScreenProps> = {}): AccountScreenProps {
  return {
    loadResources: vi.fn().mockResolvedValue([resource()]),
    onAddResource: vi.fn().mockResolvedValue(resource({ id: 'res-2', url: 'https://docs.google.com/spreadsheets/d/xyz' })),
    onRemoveResource: vi.fn().mockResolvedValue(undefined),
    onDeleteAccount: vi.fn().mockResolvedValue(undefined),
    onDeleted: vi.fn(),
    ...overrides,
  };
}

test('loading: перед резолвом loadResources показує Spinner', () => {
  const neverResolves: AccountScreenProps['loadResources'] = () => new Promise<AccountScreenResource[]>(() => {});
  const props = baseProps({ loadResources: vi.fn(neverResolves) });
  render(<AccountScreen {...props} />);

  expect(screen.getByRole('status')).toBeTruthy();
});

test('error: відхилений loadResources -- Banner variant="error", не вічний Spinner', async () => {
  const props = baseProps({ loadResources: vi.fn().mockRejectedValue(new Error('мережа недоступна')) });
  render(<AccountScreen {...props} />);

  const banner = await screen.findByText('мережа недоступна');
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
  expect(screen.queryByRole('status')).toBeNull();
});

test('default: відхилений onRemoveResource -- Banner variant="error", ресурс лишається у списку', async () => {
  const onRemoveResource = vi.fn().mockRejectedValue(new Error('не вдалося прибрати'));
  const props = baseProps({ onRemoveResource });
  render(<AccountScreen {...props} />);

  await screen.findByText(/docs.google.com\/document\/d\/abc/);
  fireEvent.click(screen.getByRole('button', { name: /Прибрати/i }));

  const banner = await screen.findByText('не вдалося прибрати');
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
  expect(screen.getByText(/docs.google.com\/document\/d\/abc/)).toBeTruthy();
});

test('default: показує список ресурсів синхронізації, кнопку "Додати ресурс" і небезпечну зону (AC-18)', async () => {
  const props = baseProps();
  render(<AccountScreen {...props} />);

  await screen.findByText(/docs.google.com\/document\/d\/abc/);
  expect(screen.getByRole('button', { name: /Додати ресурс/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Видалити акаунт/i })).toBeTruthy();
});

test('default: порожній список ресурсів -- EmptyState, кнопка "Додати ресурс" лишається доступною (AC-18)', async () => {
  const props = baseProps({ loadResources: vi.fn().mockResolvedValue([]) });
  render(<AccountScreen {...props} />);

  expect(await screen.findByText(/жодного ресурсу/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /Додати ресурс/i })).toBeTruthy();
});

test('add-resource: клік "Додати ресурс" показує форму (TextField + Button), успішне додавання повертає у default зі свіжим списком', async () => {
  const onAddResource = vi.fn().mockResolvedValue(resource({ id: 'res-2', url: 'https://docs.google.com/spreadsheets/d/xyz' }));
  const props = baseProps({ loadResources: vi.fn().mockResolvedValue([]), onAddResource });
  render(<AccountScreen {...props} />);

  await screen.findByText(/жодного ресурсу/i);
  fireEvent.click(screen.getByRole('button', { name: /Додати ресурс/i }));

  const urlField = screen.getByLabelText(/посилання/i);
  fireEvent.change(urlField, { target: { value: 'https://docs.google.com/spreadsheets/d/xyz' } });
  fireEvent.click(screen.getByRole('button', { name: /^Додати$/i }));

  await waitFor(() => expect(onAddResource).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/xyz'));
  expect(await screen.findByText(/docs.google.com\/spreadsheets\/d\/xyz/)).toBeTruthy();
  // Форма закрилась -- повернулись у default, поле вводу більше не показане.
  expect(screen.queryByLabelText(/посилання/i)).toBeNull();
});

test('add-resource: невалідне посилання (422 sync_resource.url_invalid) -- inline-помилка під формою, форма лишається відкритою', async () => {
  const onAddResource = vi.fn().mockRejectedValue({
    name: 'AppError',
    message: 'A valid resource URL is required',
    code: 'sync_resource.url_invalid',
    httpStatus: 422,
  });
  const props = baseProps({ loadResources: vi.fn().mockResolvedValue([]), onAddResource });
  render(<AccountScreen {...props} />);

  await screen.findByText(/жодного ресурсу/i);
  fireEvent.click(screen.getByRole('button', { name: /Додати ресурс/i }));
  fireEvent.change(screen.getByLabelText(/посилання/i), { target: { value: 'not-a-url' } });
  fireEvent.click(screen.getByRole('button', { name: /^Додати$/i }));

  expect(await screen.findByText(/A valid resource URL is required/i)).toBeTruthy();
  // Форма лишається відкритою -- поле вводу все ще на екрані.
  expect(screen.getByLabelText(/посилання/i)).toBeTruthy();
});

test('sync-error: ресурс зі status="error" -- Banner variant="error" з текстом lastError (AC-18b)', async () => {
  const props = baseProps({
    loadResources: vi.fn().mockResolvedValue([
      resource({ id: 'res-err', status: 'error', lastError: 'Доступ до документа втрачено' }),
    ]),
  });
  render(<AccountScreen {...props} />);

  const banner = await screen.findByText('Доступ до документа втрачено');
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
});

test('confirm-delete: кнопка "Видалити" вимкнена, поки введене слово не збігається точно з "ВИДАЛИТИ" (AC-17b)', async () => {
  const props = baseProps();
  render(<AccountScreen {...props} />);

  await screen.findByText(/docs.google.com\/document\/d\/abc/);
  fireEvent.click(screen.getByRole('button', { name: /Видалити акаунт/i }));

  const confirmField = screen.getByLabelText(/слово підтвердження|введи/i);
  const deleteButton = screen.getByRole('button', { name: /^Видалити$/i });
  expect((deleteButton as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(confirmField, { target: { value: 'видалити' } });
  expect((deleteButton as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(confirmField, { target: { value: 'ВИДАЛ' } });
  expect((deleteButton as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(confirmField, { target: { value: 'ВИДАЛИТИ' } });
  expect((deleteButton as HTMLButtonElement).disabled).toBe(false);
});

test('confirm-delete: "Скасувати" повертає у default без виклику onDeleteAccount', async () => {
  const onDeleteAccount = vi.fn();
  const props = baseProps({ onDeleteAccount });
  render(<AccountScreen {...props} />);

  await screen.findByText(/docs.google.com\/document\/d\/abc/);
  fireEvent.click(screen.getByRole('button', { name: /Видалити акаунт/i }));
  fireEvent.click(screen.getByRole('button', { name: /Скасувати/i }));

  expect(screen.getByRole('button', { name: /Додати ресурс/i })).toBeTruthy();
  expect(onDeleteAccount).not.toHaveBeenCalled();
});

test('deleted: підтверджене видалення викликає onDeleteAccount(true), показує deleted-стан і викликає onDeleted (AC-17)', async () => {
  const onDeleteAccount = vi.fn().mockResolvedValue(undefined);
  const onDeleted = vi.fn();
  const props = baseProps({ onDeleteAccount, onDeleted });
  render(<AccountScreen {...props} />);

  await screen.findByText(/docs.google.com\/document\/d\/abc/);
  fireEvent.click(screen.getByRole('button', { name: /Видалити акаунт/i }));
  fireEvent.change(screen.getByLabelText(/слово підтвердження|введи/i), { target: { value: 'ВИДАЛИТИ' } });
  fireEvent.click(screen.getByRole('button', { name: /^Видалити$/i }));

  await waitFor(() => expect(onDeleteAccount).toHaveBeenCalledWith(true));
  expect(await screen.findByText(/акаунт видалено/i)).toBeTruthy();
  expect(onDeleted).toHaveBeenCalledTimes(1);
});
