import { render, screen } from '@testing-library/react';
import { ReportsScreen } from './ReportsScreen';
import type { ReportViewModel } from './ReportsScreen';

// screens.md SCR-03: усі 5 перелічених станів (default / empty / loading /
// dead-letter-flagged / error) мусять бути покриті тестом-тригером, не лише
// монтуванням -- той самий підхід, що ArchiveScreen.test.tsx (SCR-07).
//
// Read-only (T28 Notes): екран лише читає GET /reports (T23) -- жодної дії
// користувача, що запускає формування звіту. Дані приходять через ін'єктовану
// loadReports() (DI, plan/app/CLAUDE.md), уже приведені до view model
// (periodLabel/summary попередньо відформатовані -- той самий підхід, що
// EntryViewModel.recordedAtLabel у life-area-card/ui/types.ts, а не
// локаль-залежне форматування дат усередині компонента).

const weeklyReport: ReportViewModel = {
  id: 'report-1',
  periodLabel: "Тижневий, 18-24 серпня",
  summary: 'П\'ять записів на "Спорт"',
  status: 'generated',
};

const quarterlyDeadLetterReport: ReportViewModel = {
  id: 'report-2',
  periodLabel: 'Квартальний, Q3',
  summary: 'Загалом 40% прогресу',
  status: 'dead_letter',
};

test('loading: показує Spinner одразу після монтування, поки loadReports ще не резолвнувся', () => {
  const pending = new Promise<never>(() => {});
  const loadReports = vi.fn().mockReturnValue(pending);

  render(<ReportsScreen loadReports={loadReports} />);

  expect(screen.getByRole('status')).toBeTruthy();
  expect(loadReports).toHaveBeenCalledTimes(1);
});

test('default: після резолву loadReports зі звітами рендерить список (AC-11)', async () => {
  const loadReports = vi.fn().mockResolvedValue([weeklyReport]);

  render(<ReportsScreen loadReports={loadReports} />);

  expect(await screen.findByText(weeklyReport.periodLabel)).toBeTruthy();
  expect(screen.getByText(weeklyReport.summary)).toBeTruthy();
});

test('empty: після резолву loadReports порожнім масивом рендерить EmptyState', async () => {
  const loadReports = vi.fn().mockResolvedValue([]);

  render(<ReportsScreen loadReports={loadReports} />);

  expect(await screen.findByText('Ще немає жодного звіту')).toBeTruthy();
});

test('dead-letter-flagged: звіт зі status dead_letter показує Banner "потребує перевірки"', async () => {
  const loadReports = vi.fn().mockResolvedValue([weeklyReport, quarterlyDeadLetterReport]);

  render(<ReportsScreen loadReports={loadReports} />);

  expect(await screen.findByText(quarterlyDeadLetterReport.periodLabel)).toBeTruthy();
  expect(screen.getByText(/потребує перевірки/)).toBeTruthy();
  // Звичайний звіт поруч не позначений -- позначка стосується лише цього запису.
  expect(screen.getAllByText(/потребує перевірки/)).toHaveLength(1);
});

test('error: після реджекту loadReports рендерить Banner із текстом помилки', async () => {
  const loadReports = vi.fn().mockRejectedValue(new Error('Мережа недоступна'));

  render(<ReportsScreen loadReports={loadReports} />);

  expect(await screen.findByText('Мережа недоступна')).toBeTruthy();
});

test('error: реджект без Error-повідомлення (наприклад 401) падає назад на дефолтний текст', async () => {
  const loadReports = vi.fn().mockRejectedValue('unauthorized');

  render(<ReportsScreen loadReports={loadReports} />);

  expect(await screen.findByText('Не вдалося завантажити звіти активності')).toBeTruthy();
});
