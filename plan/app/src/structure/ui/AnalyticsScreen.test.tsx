// Component test for AnalyticsScreen -- default-logic/default-no-scheme/
// empty/loading/trend-unavailable states (spec.md AC-01, AC-04, AC-05,
// AC-06, AC-06b, AC-07, AC-13), + живе тестування (Андрій, вимоги 16-18):
// три-зонна розкладка, плаваючі кнопки "Архів"/"Звіт" і заглушка "звіт за
// запитом". Селектори підлаштовані під нову верстку, сенс перевірок з
// попередньої версії файлу збережено (дані про прогрес/ранг-розрив/тренд,
// клік по "Архів", AC-06 без вердикту, AC-13 лічильник виключених).
//
// DI style (plan/app/CLAUDE.md, matches DeclarationScreen T20/CardDetailScreen):
// `loadAnalytics` is an injected prop-function, no fetch() inside the
// component. It resolves the already-computed aggregate + per-card view
// (../app/get-analytics.ts's StructureAnalyticsResult -- average/
// excludedCount/layoutMode/cards -- plus a display `cardTitle` per card,
// since the analytics use-case itself only knows `cardId`; the ports layer
// (out of scope for this task) joins it with `life-area-card`'s title) and
// a `trendAvailable` flag: `false` only when the separate
// `GET /structure/layout/history` read itself failed (sad.md §11, TBD) --
// distinct from a single card's own `trend: null` (AC-07's "not enough
// data points yet", which the domain layer already reports per card,
// domain/aggregate.ts computeGapTrend).
//
// AC-06/AC-06b: no verdict, ever -- neither state renders a "good/bad" label,
// only numbers (progress %, gap, trend arrow) or the no-scheme "declared,
// not maintained" flag text (spec.md §3 Non-goals, D-60).
// AC-13: cards excluded from the average (no computable progress) are never
// silently folded into the average or shown as zero -- their count is
// always shown separately, even in the non-empty states.

import { fireEvent, render, screen } from '@testing-library/react';
import { AnalyticsScreen } from './AnalyticsScreen';
import type { AnalyticsScreenState } from './AnalyticsScreen';

function baseState(overrides: Partial<AnalyticsScreenState> = {}): AnalyticsScreenState {
  return {
    layoutMode: 'logic',
    average: 0.62,
    excludedCount: 2,
    trendAvailable: true,
    cards: [
      { cardId: 'card-a', cardTitle: 'Картка A', progress: 0.4, gap: 0.2, trend: 'growing', unmaintained: false },
      { cardId: 'card-b', cardTitle: 'Картка B', progress: 0.71, gap: -0.1, trend: 'shrinking', unmaintained: false },
    ],
    ...overrides,
  };
}

function baseProps(stateOverrides: Partial<AnalyticsScreenState> = {}) {
  return {
    loadAnalytics: vi.fn().mockResolvedValue(baseState(stateOverrides)),
    // D-124 (живе тестування): "Архів" переїхав сюди з Колоди.
    onOpenArchive: vi.fn(),
  };
}

test('loading: показує Spinner, поки GET /structure/layout (аналітика) ще в польоті', () => {
  let resolveLoad: (value: AnalyticsScreenState) => void = () => {};
  const loadAnalytics = vi.fn(
    () => new Promise<AnalyticsScreenState>((resolve) => { resolveLoad = resolve; }),
  );

  render(<AnalyticsScreen loadAnalytics={loadAnalytics} onOpenArchive={vi.fn()} />);

  expect(screen.getByRole('status')).toBeTruthy();
  void resolveLoad;
});

test('D-124: кнопка "Архів" видима й викликає injected onOpenArchive', async () => {
  const props = baseProps();
  render(<AnalyticsScreen {...props} />);

  await screen.findByText(/62%/);
  fireEvent.click(screen.getByRole('button', { name: 'Архів' }));

  expect(props.onOpenArchive).toHaveBeenCalledTimes(1);
});

test('вимога 16/18: "Архів" і "Звіт" плавають знизу справа, поза звичайним потоком (не на всю ширину)', async () => {
  const props = baseProps();
  render(<AnalyticsScreen {...props} />);

  await screen.findByText(/62%/);

  const archiveButton = screen.getByRole('button', { name: 'Архів' });
  const reportButton = screen.getByRole('button', { name: 'Звіт' });
  const floatingWrapper = archiveButton.parentElement;

  // Обидві кнопки -- сусіди в одній плаваючій обгортці.
  expect(floatingWrapper).toBe(reportButton.parentElement);
  // "Парить" знизу зліва, поверх контенту -- absolute/z-індекс, не звичайний
  // елемент flex-колонки (там кнопка розтяглась би на всю ширину).
  expect(floatingWrapper?.className).toMatch(/\babsolute\b/);
  expect(floatingWrapper?.className).toMatch(/\bbottom-4\b/);
  expect(floatingWrapper?.className).toMatch(/\bright-4\b/);
});

test('живе тестування: кожен клік по "Звіт" ДОДАЄ новий запис у стрічку Зони 3, не замінює попередній', async () => {
  const props = baseProps();
  render(<AnalyticsScreen {...props} />);

  await screen.findByText(/62%/);

  expect(screen.queryByText(/звіт за запитом/i)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Звіт' }));
  expect(screen.getAllByText(/звіт за запитом/i)).toHaveLength(1);

  // Другий клік -- ДРУГИЙ запис поруч із першим (не приховує перший).
  fireEvent.click(screen.getByRole('button', { name: 'Звіт' }));
  expect(screen.getAllByText(/звіт за запитом/i)).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: 'Звіт' }));
  expect(screen.getAllByText(/звіт за запитом/i)).toHaveLength(3);
});

test('вимога 17: третя зона ("звіти") -- чесний порожній стан, без вигаданих записів', async () => {
  const props = baseProps();
  render(<AnalyticsScreen {...props} />);

  await screen.findByText(/62%/);
  expect(screen.getByText('Звіти')).toBeTruthy();
  expect(screen.getByText('Звітів поки немає')).toBeTruthy();
});

test('default-logic (AC-01/AC-06): показує середній прогрес і, для кожної картки, ранг-розрив без вердикту', async () => {
  const props = baseProps({
    layoutMode: 'logic',
    average: 0.62,
    excludedCount: 2,
    cards: [
      { cardId: 'card-a', cardTitle: 'Картка A', progress: 0.4, gap: 0.2, trend: 'growing', unmaintained: false },
      { cardId: 'card-b', cardTitle: 'Картка B', progress: 0.71, gap: -0.1, trend: 'shrinking', unmaintained: false },
    ],
  });
  render(<AnalyticsScreen {...props} />);

  await screen.findByText(/62%/);
  expect(screen.getByText(/2.*виключ/i)).toBeTruthy();

  // Зона 1 і зона 2 -- окремі підписи (вимога 17: дві крупні зони зверху).
  expect(screen.getByText('Загальний стан')).toBeTruthy();
  expect(screen.getByText('Показники по картках')).toBeTruthy();

  expect(screen.getByText('Картка A')).toBeTruthy();
  expect(screen.getByText(/40%/)).toBeTruthy();
  expect(screen.getByText('Картка B')).toBeTruthy();
  expect(screen.getByText(/71%/)).toBeTruthy();

  // AC-06: жодного слова-вердикту на екрані.
  expect(screen.queryByText(/добре|погано|ефективно/i)).toBeNull();
});

test('default-no-scheme (AC-06b): без рангового розриву, натомість прапорець "заявлено важливим, не підтримується"', async () => {
  const props = baseProps({
    layoutMode: 'free',
    average: 0.55,
    excludedCount: 0,
    cards: [
      { cardId: 'card-c', cardTitle: 'Картка C', progress: null, gap: null, trend: null, unmaintained: true },
      { cardId: 'card-d', cardTitle: 'Картка D', progress: 0.8, gap: null, trend: 'growing', unmaintained: false },
    ],
  });
  render(<AnalyticsScreen {...props} />);

  await screen.findByText(/55%/);

  expect(screen.getByText('Картка C')).toBeTruthy();
  expect(screen.getByText(/заявлено важлив.*не підтримується/i)).toBeTruthy();

  expect(screen.getByText('Картка D')).toBeTruthy();
  expect(screen.getByText(/80%/)).toBeTruthy();

  // AC-06b: жодного рангового розриву в цьому режимі розкладки.
  expect(screen.queryByText(/ранг/i)).toBeNull();
});

test('empty (AC-13): жодної картки з обчислюваним відсотком -- порожній стан у зоні 2 з лічильником виключених у зоні 1', async () => {
  const props = baseProps({
    layoutMode: 'free',
    average: null,
    excludedCount: 3,
    cards: [],
  });
  render(<AnalyticsScreen {...props} />);

  await screen.findByText(/3.*виключ/i);
  expect(screen.getByText('Немає карток з обчислюваним прогресом')).toBeTruthy();
  expect(screen.queryByText(/%/)).toBeNull();
});

test('trend-unavailable: GET /structure/layout/history не відповів -- прогрес показаний, тренд позначено недоступним банером', async () => {
  const props = baseProps({
    layoutMode: 'logic',
    average: 0.62,
    excludedCount: 0,
    trendAvailable: false,
    cards: [
      { cardId: 'card-a', cardTitle: 'Картка A', progress: 0.4, gap: 0.2, trend: null, unmaintained: false },
    ],
  });
  render(<AnalyticsScreen {...props} />);

  await screen.findByText(/62%/);
  const banner = await screen.findByText(/тренд.*недоступ/i);
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('info');

  // Тренд не показується, коли відповідне джерело не відповіло.
  expect(screen.queryByText(/росте|меншає/i)).toBeNull();
});
