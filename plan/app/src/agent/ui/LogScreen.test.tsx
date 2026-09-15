import { render, screen } from '@testing-library/react';
import { LogScreen } from './LogScreen';
import type { LogEntryViewModel } from './LogScreen';

// Простий хронологічний список -- "час — опис дії", найновіші зверху. Дані
// приходять через ін'єктовану loadActionLog() (DI, plan/app/CLAUDE.md), уже
// приведені до view model (occurredAtLabel попередньо відформатований -- той
// самий підхід, що ReportsScreen.test.tsx мав для periodLabel).

const firstEntry: LogEntryViewModel = {
  id: 'log-2',
  occurredAtLabel: '15.09 14:32',
  action: 'Заархівовано блок-метрику «Читання»',
};

const secondEntry: LogEntryViewModel = {
  id: 'log-1',
  occurredAtLabel: '15.09 10:00',
  action: 'Створено картку «Спорт»',
};

test('loading: показує Spinner одразу після монтування, поки loadActionLog ще не резолвнувся', () => {
  const pending = new Promise<never>(() => {});
  const loadActionLog = vi.fn().mockReturnValue(pending);

  render(<LogScreen loadActionLog={loadActionLog} />);

  expect(screen.getByRole('status')).toBeTruthy();
  expect(loadActionLog).toHaveBeenCalledTimes(1);
});

test('default: після резолву loadActionLog рендерить список "час — опис дії", найновіші зверху', async () => {
  const loadActionLog = vi.fn().mockResolvedValue([firstEntry, secondEntry]);

  render(<LogScreen loadActionLog={loadActionLog} />);

  expect(await screen.findByText(firstEntry.action)).toBeTruthy();
  expect(screen.getByText(firstEntry.occurredAtLabel)).toBeTruthy();
  expect(screen.getByText(secondEntry.action)).toBeTruthy();

  // Порядок DOM відповідає порядку масиву (найновіші зверху -- викликач,
  // GET /api/v1/action-log, уже віддає найновіші перші).
  const items = screen.getAllByRole('listitem');
  expect(items[0].textContent).toContain(firstEntry.action);
  expect(items[1].textContent).toContain(secondEntry.action);
});

test('empty: після резолву loadActionLog порожнім масивом рендерить EmptyState', async () => {
  const loadActionLog = vi.fn().mockResolvedValue([]);

  render(<LogScreen loadActionLog={loadActionLog} />);

  expect(await screen.findByText('Ще немає жодної дії')).toBeTruthy();
});

test('error: після реджекту loadActionLog рендерить Banner із текстом помилки', async () => {
  const loadActionLog = vi.fn().mockRejectedValue(new Error('Мережа недоступна'));

  render(<LogScreen loadActionLog={loadActionLog} />);

  expect(await screen.findByText('Мережа недоступна')).toBeTruthy();
});

test('error: реджект без Error-повідомлення (наприклад 401) падає назад на дефолтний текст', async () => {
  const loadActionLog = vi.fn().mockRejectedValue('unauthorized');

  render(<LogScreen loadActionLog={loadActionLog} />);

  expect(await screen.findByText('Не вдалося завантажити Лог дій')).toBeTruthy();
});
