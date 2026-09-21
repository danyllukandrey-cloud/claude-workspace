import { act, fireEvent, render, screen } from '@testing-library/react';
import { CardBack } from './CardBack';
import type { CardBackData, EntryViewModel } from './types';
import type { MetricBlockFormValues } from './MetricBlockForm';

// screens.md SCR-03 стани -- кожен тест тригерить свій стан через результат
// (чи ще не результат) ін'єктованих loadBack/onFlagEntry/onRenameTransferredBlock,
// не лише монтування зі статичними пропами.

function makeEntry(overrides: Partial<EntryViewModel> = {}): EntryViewModel {
  return {
    id: 'e1',
    metricBlockId: 'mb1',
    amount: 1,
    status: 'confirmed',
    recordedAtLabel: '27.08',
    summary: '+1 тренування',
    ...overrides,
  };
}

// CH-07 (docs/features/life-area-card/changes.md): "Режим картки" переїхав
// за меню "..." -> "Редагування" -- більше не видимий одразу. Тести CH-02,
// написані до CH-07, відкривають цей режим тим самим шляхом, що живий
// користувач.
async function openBackEdit(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Редагування' }));
}

test('SCR-03 loading: показує спінер, поки loadBack ще не завершився', () => {
  render(<CardBack cardName="Картка" loadBack={() => new Promise<CardBackData>(() => {})} onFlip={vi.fn()} />);

  expect(screen.getByRole('status')).toBeTruthy();
});

test('SCR-03 error: показує Banner, коли loadBack відхилено', async () => {
  render(<CardBack cardName="Картка" loadBack={() => Promise.reject(new Error('Мережева помилка'))} onFlip={vi.fn()} />);

  const banner = await screen.findByText('Мережева помилка');
  expect(banner.getAttribute('data-variant')).toBe('error');
});

test('SCR-03 default: показує частку виконання по блоку й агрегат картки (AC-09)', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  // MetricBlockCard (задача 6): назва зліва, відсоток -- окремим кружечком
  // справа, тому це вже два різні DOM-вузли, не один текстовий рядок.
  expect(await screen.findByText('Тренування')).toBeTruthy();
  expect(screen.getByText('50%')).toBeTruthy();
  expect(screen.getByText(/Загальний прогрес: 50%/)).toBeTruthy();
  expect(screen.queryByText(/понад ціль/)).toBeNull();
});

test('SCR-03 capped: лічильник понад ціль показує 100% і надлишок окремо (AC-09b)', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 1, overGoal: 3 }, hasPendingEntry: false },
    ],
    aggregateProgress: 1,
    entries: [],
  };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  expect(await screen.findByText('Тренування')).toBeTruthy();
  expect(screen.getByText('100%')).toBeTruthy();
  expect(screen.getByText(/\+3 раз понад ціль/)).toBeTruthy();
});

test('SCR-03 ongoing: постійний процес показує накопичену кількість, не відсоток (AC-05)', async () => {
  const data: CardBackData = {
    metricBlocks: [{ id: 'mb2', label: 'Біг', unit: 'км', progress: { kind: 'ongoing', accumulated: 40 }, hasPendingEntry: false }],
    aggregateProgress: null,
    entries: [],
  };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  expect(await screen.findByText('Біг')).toBeTruthy();
  expect(screen.getByText('40 км')).toBeTruthy();
  expect(screen.getByText('постійний процес')).toBeTruthy();
  // Ongoing-блок не має частки -- нема жодного bounded-блоку, агрегат null, лінія не рендериться.
  expect(screen.queryByText(/Загальний прогрес/)).toBeNull();
});

// CH-10 review (живе тестування 2026-09-21): без onCreateMetricBlock/
// onUpdateTracking (жодного дозволу щось міняти) і без жодного блоку --
// метрик-секція взагалі не рендериться (нема onCreateMetricBlock -- кнопка
// "+ Додати" не рендериться, EmptyState-напис прибрано -- дублював кнопку).
test('SCR-03 declarative: без жодного блоку-метрики й без onCreateMetricBlock/onUpdateTracking -- лише "Історія записів"', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  expect(await screen.findByRole('button', { name: /Історія записів/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '+ Додати блок-метрику' })).toBeNull();
});

test('SCR-03 pending-entry: блок із записом, що очікує перевірки агента, позначений окремо (AC-06/AC-11)', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: true },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  expect(await screen.findByText('Запис очікує перевірки агента')).toBeTruthy();
});

test('SCR-03 history-expanded: розгортає історію записів по кліку (AC-13)', async () => {
  const data: CardBackData = {
    metricBlocks: [],
    aggregateProgress: null,
    entries: [makeEntry({ id: 'e1', recordedAtLabel: '27.08', summary: '+1 тренування' })],
  };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  await screen.findByRole('button', { name: /Історія записів/ });
  expect(screen.queryByText('+1 тренування')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Історія записів/ }));

  expect(await screen.findByText('+1 тренування')).toBeTruthy();
  expect(screen.getByText('27.08')).toBeTruthy();
});

// Review 2026-09-07, post-ship follow-up review (C11 remainder, RED): без
// onFlagEntry кнопка "виправити" й досі рендерилась (handleFlagEntry
// прокидався безумовно, сам рано повертався всередині) -- клік нічого не
// робив, той самий СИМПТОМ, що C11 називав "мертва", тепер лише за іншої
// причини (умовний no-op замість абсолютного).

test('C11-remainder: без onFlagEntry кнопка "виправити" НЕ рендериться (не мертва кнопка)', async () => {
  const data: CardBackData = {
    metricBlocks: [],
    aggregateProgress: null,
    entries: [makeEntry({ id: 'e1', status: 'confirmed', summary: '+1 тренування' })],
  };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: /Історія записів/ }));
  await screen.findByText('+1 тренування');

  expect(screen.queryByRole('button', { name: 'виправити' })).toBeNull();
});

test('SCR-03 AC-12: клік "виправити" в історії викликає onFlagEntry і оновлює зворот', async () => {
  const initial: CardBackData = {
    metricBlocks: [],
    aggregateProgress: null,
    entries: [makeEntry({ id: 'e1', status: 'confirmed', summary: '+1 тренування' })],
  };
  const corrected: CardBackData = {
    metricBlocks: [],
    aggregateProgress: null,
    entries: [makeEntry({ id: 'e1', status: 'rejected', summary: '+1 тренування (скасовано)' })],
  };
  const onFlagEntry = vi.fn().mockResolvedValue(corrected);

  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(initial)} onFlip={vi.fn()} onFlagEntry={onFlagEntry} />);

  fireEvent.click(await screen.findByRole('button', { name: /Історія записів/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'виправити' }));

  expect(onFlagEntry).toHaveBeenCalledWith('e1');
  expect(await screen.findByText('+1 тренування (скасовано)')).toBeTruthy();
  // Виправлений запис уже не 'confirmed' -- кнопку "виправити" вдруге не пропонуємо.
  expect(screen.queryByRole('button', { name: 'виправити' })).toBeNull();
});

// Живе тестування (Андрій): "натиснув виправити -- нічого не відбувається,
// тільки кулька червоніє" -- механізм працював як задумано (EntryHistoryList.tsx
// коментар), але без підказки це виглядало як мертва кнопка. Підказка
// з'являється одразу після успішного flag.
test('живе тестування: після успішного "виправити" з\'являється підказка йти в чат з агентом', async () => {
  const initial: CardBackData = {
    metricBlocks: [],
    aggregateProgress: null,
    entries: [makeEntry({ id: 'e1', status: 'confirmed', summary: '+1 тренування' })],
  };
  const corrected: CardBackData = {
    metricBlocks: [],
    aggregateProgress: null,
    entries: [makeEntry({ id: 'e1', status: 'rejected', summary: '+1 тренування (скасовано)' })],
  };
  const onFlagEntry = vi.fn().mockResolvedValue(corrected);

  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(initial)} onFlip={vi.fn()} onFlagEntry={onFlagEntry} />);

  fireEvent.click(await screen.findByRole('button', { name: /Історія записів/ }));
  expect(screen.queryByText(/напишіть агенту в чаті/i)).toBeNull();

  fireEvent.click(await screen.findByRole('button', { name: 'виправити' }));

  expect(await screen.findByText(/напишіть агенту в чаті/i)).toBeTruthy();
});

// Review 2026-09-07, post-ship follow-up review (AC-12/E, RED): невдале
// onFlagEntry раніше робило те саме, що невдалий ПОЧАТКОВИЙ load
// (setState('error')) -- стирало вже показані дані заради банера на весь
// екран, той самий клас багу, що refresh() (T52) вище вже виправлено, але
// пропущено саме тут.

test('T52-remainder: невдалий onFlagEntry НЕ стирає вже завантажені дані -- неблокуючий Banner замість повного екрана', async () => {
  const initial: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [makeEntry({ id: 'e1', status: 'confirmed', summary: '+1 тренування' })],
  };
  const onFlagEntry = vi.fn().mockRejectedValue(new Error('Мережа впала'));

  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(initial)} onFlip={vi.fn()} onFlagEntry={onFlagEntry} />);

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: /Історія записів/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'виправити' }));

  await screen.findByText('Мережа впала');
  // Дані й досі на екрані -- не замінені банером помилки на весь екран.
  expect(screen.getByText('Тренування')).toBeTruthy();
  expect(screen.getByText('50%')).toBeTruthy();
  expect(screen.getByText('+1 тренування')).toBeTruthy();
});

test('T52-remainder: подвійний клік "виправити" (поки onFlagEntry ще не завершився) викликає onFlagEntry лише один раз', async () => {
  let resolveFlag: (data: CardBackData) => void = () => {};
  const initial: CardBackData = {
    metricBlocks: [],
    aggregateProgress: null,
    entries: [makeEntry({ id: 'e1', status: 'confirmed', summary: '+1 тренування' })],
  };
  const onFlagEntry = vi.fn().mockReturnValue(
    new Promise<CardBackData>((resolve) => {
      resolveFlag = resolve;
    }),
  );

  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(initial)} onFlip={vi.fn()} onFlagEntry={onFlagEntry} />);

  fireEvent.click(await screen.findByRole('button', { name: /Історія записів/ }));
  const flagButton = await screen.findByRole('button', { name: 'виправити' });

  fireEvent.click(flagButton);
  fireEvent.click(flagButton);

  expect(onFlagEntry).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveFlag({ metricBlocks: [], aggregateProgress: null, entries: [] });
  });
});

test('SCR-03 transfer-collision: пропонує перейменувати блок при колізії назви (AC-15)', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb-existing', label: 'Тренування', unit: 'раз', progress: { kind: 'ongoing', accumulated: 5 }, hasPendingEntry: false },
    ],
    aggregateProgress: null,
    entries: [],
    pendingTransferCollision: { metricBlockId: 'mb9', label: 'Тренування', unit: 'раз' },
  };
  const onRenameTransferredBlock = vi.fn().mockResolvedValue({
    metricBlocks: [
      { id: 'mb-existing', label: 'Тренування', unit: 'раз', progress: { kind: 'ongoing', accumulated: 5 }, hasPendingEntry: false },
      { id: 'mb9', label: 'Тренування (перенесено)', unit: 'раз', progress: { kind: 'ongoing', accumulated: 12 }, hasPendingEntry: false },
    ],
    aggregateProgress: null,
    entries: [],
    pendingTransferCollision: null,
  } satisfies CardBackData);

  render(
    <CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onRenameTransferredBlock={onRenameTransferredBlock} />,
  );

  const input = await screen.findByLabelText('Нова назва блоку-метрики');
  expect((input as HTMLInputElement).value).toBe('Тренування');
  expect(screen.getByText('У картці вже є блок-метрика з такою назвою й одиницею')).toBeTruthy();

  fireEvent.change(input, { target: { value: 'Тренування (перенесено)' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(onRenameTransferredBlock).toHaveBeenCalledWith({ metricBlockId: 'mb9', newLabel: 'Тренування (перенесено)' });
  expect(await screen.findByText('Тренування (перенесено)')).toBeTruthy();
  expect(screen.getByText('12 раз')).toBeTruthy();
  // Колізію вирішено -- форма перейменування зникає.
  expect(screen.queryByLabelText('Нова назва блоку-метрики')).toBeNull();
});

test('SCR-03: клік "← перегорнути" викликає onFlip', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  const onFlip = vi.fn();
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={onFlip} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));

  expect(onFlip).toHaveBeenCalledTimes(1);
});

// ISS-60 (docs/ISSUES.md, план у рядку): порожній стан отримує кнопку
// "+ Додати блок-метрику" -> відкриває MetricBlockForm (T28) -> injected
// onCreateMetricBlock -> після успіху форма закривається й CardBack сам
// перевантажує зворот через loadBack (той самий "ремаунт перезавантажує"
// підхід, що вже є в App.tsx для інших мутацій) -- onCreateMetricBlock
// повертає лише Promise<void>, не свіжі дані, тому свіжість забезпечує
// повторний виклик loadBack, не повернене значення.

// D-111 (docs/DECISIONS.md): порожній стан -- "+ Додати блок-метрику"
// ПЕРЕД текстом "Ще немає...", а "← перегорнути" -- ОСТАННІМ елементом (унизу,
// перед тим, як CardDetailScreen додасть "← Назад").

test('D-111: порожній стан -- порядок "+ Додати блок-метрику" -> "Історія записів" -> "← перегорнути"', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  const { container } = render(
    <CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onCreateMetricBlock={vi.fn()} />,
  );

  await screen.findByRole('button', { name: '+ Додати блок-метрику' });
  const text = container.textContent ?? '';

  const idxCreate = text.indexOf('Додати блок-метрику');
  const idxHistory = text.indexOf('Історія записів');
  const idxFlip = text.indexOf('перегорнути');

  expect(idxCreate).toBeGreaterThan(-1);
  expect(idxCreate).toBeLessThan(idxHistory);
  expect(idxHistory).toBeLessThan(idxFlip);
});

test('ISS-60: без onCreateMetricBlock порожній стан не показує кнопку створення блоку', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  await screen.findByRole('button', { name: /Історія записів/ });
  expect(screen.queryByRole('button', { name: '+ Додати блок-метрику' })).toBeNull();
});

test('ISS-60: з onCreateMetricBlock порожній стан показує кнопку "+ Додати блок-метрику", клік відкриває MetricBlockForm', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  render(
    <CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onCreateMetricBlock={vi.fn()} />,
  );

  fireEvent.click(await screen.findByRole('button', { name: '+ Додати блок-метрику' }));

  expect(screen.getByLabelText('Що рахуємо/вимірюємо:')).toBeTruthy();
  expect(screen.getByLabelText('Одиниця:')).toBeTruthy();
});

test('ISS-60: успішне збереження форми викликає onCreateMetricBlock(values), закриває форму й перевантажує зворот (loadBack вдруге)', async () => {
  const emptyData: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  const filledData: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0,
    entries: [],
  };
  const loadBack = vi.fn().mockResolvedValueOnce(emptyData).mockResolvedValueOnce(filledData);
  const onCreateMetricBlock = vi.fn().mockResolvedValue(undefined);

  render(<CardBack cardName="Картка" loadBack={loadBack} onFlip={vi.fn()} onCreateMetricBlock={onCreateMetricBlock} />);

  fireEvent.click(await screen.findByRole('button', { name: '+ Додати блок-метрику' }));

  fireEvent.change(screen.getByLabelText('Що рахуємо/вимірюємо:'), { target: { value: 'Тренування' } });
  fireEvent.change(screen.getByLabelText('Одиниця:'), { target: { value: 'раз' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  await screen.findByText('Тренування');
  expect(screen.getByText('0%')).toBeTruthy();

  const expected: MetricBlockFormValues = {
    label: 'Тренування',
    unit: 'раз',
    targetCount: null,
    isOngoing: false,
    targetDate: null,
  };
  expect(onCreateMetricBlock).toHaveBeenCalledWith(expected);
  expect(loadBack).toHaveBeenCalledTimes(2);
  expect(screen.queryByLabelText('Що рахуємо/вимірюємо:')).toBeNull();
});

// Review 2026-09-07 A4 (RED, docs/features/life-area-card/_review/review-2026-09-07.md):
// раніше кнопка "+ Додати блок-метрику" рендерилась лише коли
// metricBlocks.length===0 -- користувач, у якого вже є хоч один блок, не мав
// способу додати другий (AC-07/AC-08 вимагають декількох блоків на картку).

test('A4: "+ Додати блок-метрику" видима і коли в картці вже є блок (review 2026-09-07 A4, AC-07/AC-08)', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onCreateMetricBlock={vi.fn()} />);

  await screen.findByText('Тренування');
  expect(screen.getByText('50%')).toBeTruthy();

  expect(screen.getByRole('button', { name: '+ Додати блок-метрику' })).toBeTruthy();
});

// Review 2026-09-07 E (RED, T52): "невдалий фоновий рефреш після успішного
// запису знищує весь екран картки, без скасування/порядку відповідей" --
// refresh() (виклик loadBack ПІСЛЯ успішної мутації) раніше на невдачі
// робив ТЕ САМЕ, що невдалий ПОЧАТКОВИЙ load (setState('error')), стираючи
// вже показані дані заради банера помилки. І не мав жодного захисту від
// out-of-order: друга (пізніше issued) відповідь, що прийшла РАНІШЕ за
// першу (застарілу), могла бути переписана, щойно перша нарешті приходила.

test('T52: невдалий фоновий refresh (після успішного запису) НЕ стирає вже завантажені дані', async () => {
  const initial: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  const loadBack = vi.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('Мережа впала'));
  const onCreateMetricBlock = vi.fn().mockResolvedValue(undefined);

  render(<CardBack cardName="Картка" loadBack={loadBack} onFlip={vi.fn()} onCreateMetricBlock={onCreateMetricBlock} />);

  await screen.findByText('Тренування');
  expect(screen.getByText('50%')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '+ Додати блок-метрику' }));
  fireEvent.change(screen.getByLabelText('Що рахуємо/вимірюємо:'), { target: { value: 'Сон' } });
  fireEvent.change(screen.getByLabelText('Одиниця:'), { target: { value: 'год' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  await vi.waitFor(() => expect(loadBack).toHaveBeenCalledTimes(2));

  // Дані й досі на екрані -- НЕ замінені банером помилки на весь екран.
  expect(screen.getByText('Тренування')).toBeTruthy();
  expect(screen.getByText('50%')).toBeTruthy();
});

// Видалення блоку-метрики: клік "×" на MetricBlockCard відкриває
// ArchiveMetricBlockDialog; підтвердження ("видалити" + Enter/галочка)
// викликає injected onArchiveMetricBlock(metricBlockId), потім
// перезавантажує зворот (refresh()) -- той самий "ремаунт перезавантажує"
// підхід, що ISS-60 тести вище для onCreateMetricBlock. Опційний, як і
// onCreateMetricBlock -- без нього кнопка "×" не рендериться взагалі.

test('без onArchiveMetricBlock кнопка "×" не рендериться на жодному блоці', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  await screen.findByText('Тренування');
  expect(screen.queryByRole('button', { name: /Видалити метрику/ })).toBeNull();
});

test('з onArchiveMetricBlock клік "×" відкриває ArchiveMetricBlockDialog з назвою блоку', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onArchiveMetricBlock={vi.fn()} />);

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: 'Видалити метрику «Тренування»' }));

  expect(screen.getByText(/Видалити метрику «Тренування»\?/)).toBeTruthy();
});

test('підтвердження видалення (ввід «видалити» + клік "Видалити") викликає onArchiveMetricBlock(metricBlockId) і перезавантажує зворот', async () => {
  const withBlock: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  const afterArchive: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  const loadBack = vi.fn().mockResolvedValueOnce(withBlock).mockResolvedValueOnce(afterArchive);
  const onArchiveMetricBlock = vi.fn().mockResolvedValue(undefined);

  render(<CardBack cardName="Картка" loadBack={loadBack} onFlip={vi.fn()} onArchiveMetricBlock={onArchiveMetricBlock} />);

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: 'Видалити метрику «Тренування»' }));

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'видалити' } });
  fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));

  expect(onArchiveMetricBlock).toHaveBeenCalledWith('mb1');
  await vi.waitFor(() => expect(loadBack).toHaveBeenCalledTimes(2));
  // Діалог закрився разом з успіхом.
  expect(screen.queryByText(/Видалити метрику/)).toBeNull();
});

test('скасування діалогу видалення НЕ викликає onArchiveMetricBlock, блок лишається', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  const onArchiveMetricBlock = vi.fn().mockResolvedValue(undefined);
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onArchiveMetricBlock={onArchiveMetricBlock} />);

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: 'Видалити метрику «Тренування»' }));
  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(onArchiveMetricBlock).not.toHaveBeenCalled();
  expect(screen.getByText('Тренування')).toBeTruthy();
  expect(screen.queryByText(/Видалити метрику/)).toBeNull();
});

test('невдалий onArchiveMetricBlock (404 card.not_found) показує Banner у діалозі, блок лишається на екрані', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  const onArchiveMetricBlock = vi.fn().mockRejectedValue(new Error('Метрику не знайдено'));
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onArchiveMetricBlock={onArchiveMetricBlock} />);

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: 'Видалити метрику «Тренування»' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'видалити' } });
  fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));

  expect(await screen.findByText('Метрику не знайдено')).toBeTruthy();
  expect(screen.getByText('Тренування')).toBeTruthy();
});

test('T52: фоновий refresh ігнорує застарілу (out-of-order) відповідь -- перемагає та, що issued пізніше', async () => {
  const block = (share: number) => ({
    id: 'mb1',
    label: 'Тренування',
    unit: 'раз',
    progress: { kind: 'bounded' as const, share, overGoal: 0 },
    hasPendingEntry: false,
  });
  const initial: CardBackData = { metricBlocks: [block(0)], aggregateProgress: 0, entries: [] };
  const freshData: CardBackData = { metricBlocks: [block(0.6)], aggregateProgress: 0.6, entries: [] };
  const staleData: CardBackData = { metricBlocks: [block(0.3)], aggregateProgress: 0.3, entries: [] };

  let resolveStaleRefresh: (data: CardBackData) => void = () => {};
  const loadBack = vi
    .fn()
    .mockResolvedValueOnce(initial) // початкове завантаження
    .mockReturnValueOnce(new Promise<CardBackData>((resolve) => (resolveStaleRefresh = resolve))) // refresh #1 -- зависає
    .mockResolvedValueOnce(freshData); // refresh #2 -- issued пізніше, резолвиться одразу
  const onCreateMetricBlock = vi.fn().mockResolvedValue(undefined);

  render(<CardBack cardName="Картка" loadBack={loadBack} onFlip={vi.fn()} onCreateMetricBlock={onCreateMetricBlock} />);
  await screen.findByText('Тренування');
  expect(screen.getByText('0%')).toBeTruthy();

  // Триггер #1 -- refresh стає "у польоті", не резолвиться.
  fireEvent.click(screen.getByRole('button', { name: '+ Додати блок-метрику' }));
  fireEvent.change(screen.getByLabelText('Що рахуємо/вимірюємо:'), { target: { value: 'Сон' } });
  fireEvent.change(screen.getByLabelText('Одиниця:'), { target: { value: 'год' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
  await vi.waitFor(() => expect(loadBack).toHaveBeenCalledTimes(2));

  // Триггер #2 -- issued ПІЗНІШЕ, резолвиться РАНІШЕ.
  fireEvent.click(screen.getByRole('button', { name: '+ Додати блок-метрику' }));
  fireEvent.change(screen.getByLabelText('Що рахуємо/вимірюємо:'), { target: { value: 'Сон' } });
  fireEvent.change(screen.getByLabelText('Одиниця:'), { target: { value: 'год' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
  await screen.findByText('60%');
  expect(screen.queryByText('30%')).toBeNull();

  // Застаріла відповідь #1 нарешті приходить -- має бути ПРОІГНОРОВАНА.
  await act(async () => {
    resolveStaleRefresh(staleData);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.getByText('60%')).toBeTruthy();
  expect(screen.queryByText('30%')).toBeNull();
});

// CH-02 (docs/features/life-area-card/changes.md): "картка: стан без
// вимірювань" -- вибір режиму НА САМОМУ ПОЧАТКУ звороту, "стан без
// вимірювань" НАД "постійний процес з метриками (без дати)".

test('CH-02: без onUpdateTracking вибір режиму не рендериться', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  await screen.findByRole('button', { name: /Історія записів/ });
  expect(screen.queryByText('Картка: стан без вимірювань')).toBeNull();
});

test('CH-10: 3 варіанти в порядку -- стан -> постійний процес -> з цілями та метриками', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [], trackingMode: 'goals', healthState: null };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateTracking={vi.fn()} />);

  await openBackEdit();
  const stateOption = await screen.findByText('Картка: стан без вимірювань');
  const ongoingOption = screen.getByText('Картка: постійний процес');
  const goalsOption = screen.getByText('Картка: з цілями та метриками');

  expect(stateOption.compareDocumentPosition(ongoingOption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(ongoingOption.compareDocumentPosition(goalsOption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('CH-02: обрання "стан без вимірювань" викликає onUpdateTracking(state, active за замовчуванням)', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [], trackingMode: 'goals', healthState: null };
  const onUpdateTracking = vi.fn().mockResolvedValue(undefined);
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateTracking={onUpdateTracking} />);

  await openBackEdit();
  await screen.findByText('Картка: стан без вимірювань');
  fireEvent.click(screen.getByRole('radio', { name: 'Картка: стан без вимірювань' }));

  expect(onUpdateTracking).toHaveBeenCalledWith({ trackingMode: 'state', healthState: 'active' });
});

test('CH-02: у режимі "стан без вимірювань" показує три варіанти й обрання іншого викликає onUpdateTracking', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [], trackingMode: 'state', healthState: 'active' };
  const onUpdateTracking = vi.fn().mockResolvedValue(undefined);
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateTracking={onUpdateTracking} />);

  await openBackEdit();
  await screen.findByText('Картка: стан без вимірювань');
  expect(screen.getByText('використовується')).toBeTruthy();
  expect(screen.getByText('критично потребує відновлення')).toBeTruthy();
  expect(screen.getByText('на паузі')).toBeTruthy();

  fireEvent.click(screen.getByRole('radio', { name: /критично потребує відновлення/ }));

  expect(onUpdateTracking).toHaveBeenCalledWith({ trackingMode: 'state', healthState: 'critical' });
});

test('CH-10: перемикання зі стану на "постійний процес" викликає onUpdateTracking(ongoing, null)', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [], trackingMode: 'state', healthState: 'paused' };
  const onUpdateTracking = vi.fn().mockResolvedValue(undefined);
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateTracking={onUpdateTracking} />);

  await openBackEdit();
  await screen.findByText('Картка: стан без вимірювань');
  fireEvent.click(screen.getByRole('radio', { name: 'Картка: постійний процес' }));

  expect(onUpdateTracking).toHaveBeenCalledWith({ trackingMode: 'ongoing', healthState: null });
});

test('CH-10: перемикання зі стану на "з цілями та метриками" викликає onUpdateTracking(goals, null)', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [], trackingMode: 'state', healthState: 'paused' };
  const onUpdateTracking = vi.fn().mockResolvedValue(undefined);
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateTracking={onUpdateTracking} />);

  await openBackEdit();
  await screen.findByText('Картка: стан без вимірювань');
  fireEvent.click(screen.getByRole('radio', { name: 'Картка: з цілями та метриками' }));

  expect(onUpdateTracking).toHaveBeenCalledWith({ trackingMode: 'goals', healthState: null });
});

test('CH-10: форма нового блоку-метрики в режимі "постійний процес" не показує чекбокс/ціль/дату', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [], trackingMode: 'ongoing', healthState: null };
  render(
    <CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onCreateMetricBlock={vi.fn()} />,
  );

  fireEvent.click(await screen.findByRole('button', { name: '+ Додати блок-метрику' }));

  expect(screen.getByLabelText('Що рахуємо/вимірюємо:')).toBeTruthy();
  expect(screen.getByLabelText('Одиниця:')).toBeTruthy();
  expect(screen.queryByLabelText('Постійний процес з метриками (без дати)')).toBeNull();
  expect(screen.queryByLabelText('Ціль:')).toBeNull();
  expect(screen.queryByLabelText('До:')).toBeNull();
});

test('CH-10: форма нового блоку в режимі "постійний процес" шле isOngoing:true/targetCount:null/targetDate:null', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [], trackingMode: 'ongoing', healthState: null };
  const onCreateMetricBlock = vi.fn().mockResolvedValue(undefined);
  render(
    <CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onCreateMetricBlock={onCreateMetricBlock} />,
  );

  fireEvent.click(await screen.findByRole('button', { name: '+ Додати блок-метрику' }));
  fireEvent.change(screen.getByLabelText('Що рахуємо/вимірюємо:'), { target: { value: 'Читання' } });
  fireEvent.change(screen.getByLabelText('Одиниця:'), { target: { value: 'книга' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  await vi.waitFor(() =>
    expect(onCreateMetricBlock).toHaveBeenCalledWith({
      label: 'Читання',
      unit: 'книга',
      targetCount: null,
      isOngoing: true,
      targetDate: null,
    }),
  );
});

// CH-10 review (живе тестування 2026-09-21): "+ Додати блок-метрику"
// приглушена-але-видима лише коли в картки ВЖЕ Є блоки (перемкнули в
// "стан" пізніше, старі блоки лишаються видимими без можливості чіпати) --
// для ПОРОЖНЬОЇ картки в режимі "стан" секція метрик не рендериться взагалі
// (окремий тест нижче), лише вибір мячика.
test('CH-02: у режимі "стан без вимірювань" з наявним блоком кнопка "+ Додати блок-метрику" стає СПРАВЖНЬО неактивною (disabled), клік нічого не робить', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
    trackingMode: 'state',
    healthState: 'active',
  };
  const onCreateMetricBlock = vi.fn();
  render(
    <CardBack
      cardName="Картка"
      loadBack={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onUpdateTracking={vi.fn()}
      onCreateMetricBlock={onCreateMetricBlock}
    />,
  );

  const addButton = await screen.findByRole('button', { name: '+ Додати блок-метрику' });
  // pointer-events-none на предку -- візуальний шар (миша/дотик).
  expect(addButton.closest('[aria-disabled="true"]')).toBeTruthy();
  // Code review 2026-09-19: СПРАВЖНІЙ HTML disabled -- блокує й
  // Enter/Space-активацію фокусованої кнопки клавіатурою, не лише клік.
  expect(addButton.hasAttribute('disabled')).toBe(true);
  fireEvent.click(addButton);
  expect(screen.queryByLabelText('Що рахуємо/вимірюємо:')).toBeNull();
  expect(onCreateMetricBlock).not.toHaveBeenCalled();
});

test('CH-10 review: у режимі "стан без вимірювань" на ПОРОЖНІЙ картці секція метрик не рендериться взагалі -- лише вибір мячика', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [], trackingMode: 'state', healthState: 'active' };
  render(
    <CardBack
      cardName="Картка"
      loadBack={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onUpdateTracking={vi.fn()}
      onCreateMetricBlock={vi.fn()}
    />,
  );

  await screen.findByText('використовується');
  expect(screen.queryByRole('button', { name: '+ Додати блок-метрику' })).toBeNull();
  expect(screen.queryByText(/метрики не використовуються/)).toBeNull();
});

test('CH-02: у режимі "стан без вимірювань" кнопки "×"/"✎" наявного блоку-метрики теж справжньо disabled', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
    trackingMode: 'state',
    healthState: 'active',
  };
  render(
    <CardBack
      cardName="Картка"
      loadBack={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onUpdateTracking={vi.fn()}
      onArchiveMetricBlock={vi.fn()}
      onUpdateMetricBlock={vi.fn()}
    />,
  );

  await screen.findByText('Тренування');
  expect(screen.getByRole('button', { name: 'Видалити метрику «Тренування»' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Редагувати метрику «Тренування»' }).hasAttribute('disabled')).toBe(true);
});

// CH-03 (docs/features/life-area-card/changes.md): олівець на блоці-метриці
// відкриває редагування -- перейменування/налаштування (MetricBlockForm
// перевикористаний) і перенесення на іншу картку (наявна transferMetricBlock).

function metricBlock(overrides: Partial<import('./types').MetricBlockViewModel> = {}) {
  return {
    id: 'mb1',
    label: 'Тренування',
    unit: 'раз',
    progress: { kind: 'bounded' as const, share: 0.5, overGoal: 0 },
    hasPendingEntry: false,
    settings: { targetCount: 10, isOngoing: false, targetDate: null },
    ...overrides,
  };
}

test('CH-03: без onUpdateMetricBlock/onTransferMetricBlock олівець на блоці не рендериться', async () => {
  const data: CardBackData = { metricBlocks: [metricBlock()], aggregateProgress: 0.5, entries: [] };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  await screen.findByText('Тренування');
  expect(screen.queryByRole('button', { name: /Редагувати метрику/ })).toBeNull();
});

test('CH-03: клік по олівцю відкриває форму з попередньо заповненими label/unit/ціль', async () => {
  const data: CardBackData = { metricBlocks: [metricBlock()], aggregateProgress: 0.5, entries: [] };
  render(
    <CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateMetricBlock={vi.fn()} />,
  );

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: 'Редагувати метрику «Тренування»' }));

  expect(screen.getByText('Редагування «Тренування»')).toBeTruthy();
  expect((screen.getByLabelText('Що рахуємо/вимірюємо:') as HTMLInputElement).value).toBe('Тренування');
  expect((screen.getByLabelText('Одиниця:') as HTMLInputElement).value).toBe('раз');
  expect((screen.getByLabelText('Ціль:') as HTMLInputElement).value).toBe('10');
});

test('CH-03: збереження форми редагування викликає onUpdateMetricBlock(blockId, values), закриває панель і перезавантажує зворот', async () => {
  const data: CardBackData = { metricBlocks: [metricBlock()], aggregateProgress: 0.5, entries: [] };
  const onUpdateMetricBlock = vi.fn().mockResolvedValue(undefined);
  const loadBack = vi.fn().mockResolvedValue(data);
  render(<CardBack cardName="Картка" loadBack={loadBack} onFlip={vi.fn()} onUpdateMetricBlock={onUpdateMetricBlock} />);

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: 'Редагувати метрику «Тренування»' }));
  fireEvent.change(screen.getByLabelText('Що рахуємо/вимірюємо:'), { target: { value: 'Біг' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  await vi.waitFor(() => expect(onUpdateMetricBlock).toHaveBeenCalledWith('mb1', expect.objectContaining({ label: 'Біг' })));
  await vi.waitFor(() => expect(loadBack).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Редагування «Тренування»')).toBeNull();
});

// CH-10 review-fix (docs/features/life-area-card/changes.md): редагування
// НАЯВНОГО блоку мусить триматись ЙОГО ВЛАСНИХ налаштувань (ціль+дата чи
// ні), а не поточного режиму картки -- інакше перемикання картки на
// "постійний процес" ПІСЛЯ того, як блок уже мав ціль, і звичайне
// виправлення одруківки в назві тихо стирали б ціль/дату блоку.
test('CH-10 review-fix: редагування блоку зі своєю ціллю/датою лишає поля видимими й ЦІЛІСНИМИ, навіть якщо картка зараз у режимі "постійний процес"', async () => {
  const goalsBlock = metricBlock({ settings: { targetCount: 10, isOngoing: false, targetDate: '2026-12-31' } });
  const data: CardBackData = {
    metricBlocks: [goalsBlock],
    aggregateProgress: 0.5,
    entries: [],
    trackingMode: 'ongoing',
    healthState: null,
  };
  const onUpdateMetricBlock = vi.fn().mockResolvedValue(undefined);
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateMetricBlock={onUpdateMetricBlock} />);

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: 'Редагувати метрику «Тренування»' }));

  // Поля цілі/дати НЕ приховані -- форма показує повний набір, як і мав блок.
  expect(screen.getByLabelText('Ціль:')).toBeTruthy();
  expect(screen.getByLabelText('До:')).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Що рахуємо/вимірюємо:'), { target: { value: 'Біг' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  await vi.waitFor(() =>
    expect(onUpdateMetricBlock).toHaveBeenCalledWith(
      'mb1',
      expect.objectContaining({ label: 'Біг', targetCount: 10, targetDate: '2026-12-31', isOngoing: false }),
    ),
  );
});

test('CH-03: без transferTargetCards секція перенесення не рендериться', async () => {
  const data: CardBackData = { metricBlocks: [metricBlock()], aggregateProgress: 0.5, entries: [] };
  render(
    <CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onTransferMetricBlock={vi.fn()} />,
  );

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: 'Редагувати метрику «Тренування»' }));

  expect(screen.queryByText('Перенести на іншу картку')).toBeNull();
});

test('CH-03: обрання картки-цілі й "Перенести" викликає onTransferMetricBlock(blockId, targetCardId)', async () => {
  const data: CardBackData = { metricBlocks: [metricBlock()], aggregateProgress: 0.5, entries: [] };
  const onTransferMetricBlock = vi.fn().mockResolvedValue(undefined);
  const loadBack = vi.fn().mockResolvedValue(data);
  render(
    <CardBack
      cardName="Картка"
      loadBack={loadBack}
      onFlip={vi.fn()}
      onTransferMetricBlock={onTransferMetricBlock}
      transferTargetCards={[{ id: 'card-2', name: 'Навчання' }]}
    />,
  );

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: 'Редагувати метрику «Тренування»' }));
  fireEvent.change(screen.getByLabelText('Перенести на іншу картку'), { target: { value: 'card-2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));

  await vi.waitFor(() => expect(onTransferMetricBlock).toHaveBeenCalledWith('mb1', 'card-2'));
  await vi.waitFor(() => expect(loadBack).toHaveBeenCalledTimes(2));
});

test('CH-03: "Перенести" неактивна, поки не обрано картку-ціль', async () => {
  const data: CardBackData = { metricBlocks: [metricBlock()], aggregateProgress: 0.5, entries: [] };
  render(
    <CardBack
      cardName="Картка"
      loadBack={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onTransferMetricBlock={vi.fn()}
      transferTargetCards={[{ id: 'card-2', name: 'Навчання' }]}
    />,
  );

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: 'Редагувати метрику «Тренування»' }));

  expect(screen.getByRole('button', { name: 'Перенести' }).hasAttribute('disabled')).toBe(true);
});

test('CH-03: "Закрити" ховає панель редагування без виклику жодної дії', async () => {
  const data: CardBackData = { metricBlocks: [metricBlock()], aggregateProgress: 0.5, entries: [] };
  const onUpdateMetricBlock = vi.fn();
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateMetricBlock={onUpdateMetricBlock} />);

  await screen.findByText('Тренування');
  fireEvent.click(screen.getByRole('button', { name: 'Редагувати метрику «Тренування»' }));
  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

  expect(screen.queryByText('Редагування «Тренування»')).toBeNull();
  expect(onUpdateMetricBlock).not.toHaveBeenCalled();
});

test('CH-02: помилка збереження режиму показує Banner і не змінює поточний вибір', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [], trackingMode: 'goals', healthState: null };
  const onUpdateTracking = vi.fn().mockRejectedValue(new Error('Не вдалося зберегти'));
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateTracking={onUpdateTracking} />);

  await openBackEdit();
  await screen.findByText('Картка: стан без вимірювань');
  fireEvent.click(screen.getByRole('radio', { name: 'Картка: стан без вимірювань' }));

  const banner = await screen.findByText('Не вдалося зберегти');
  expect(banner.getAttribute('data-variant')).toBe('error');
});

// Review-fix: успішна зміна режиму патчить дані локально (нова пара
// trackingMode/healthState з input, сервер уже підтвердив), НЕ перезапитує
// весь зворот -- раніше зайвий loadBack() на кожен клік радіо-кнопки.
test('review-fix: успішна зміна режиму НЕ викликає повторний loadBack -- лише локальний патч', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [], trackingMode: 'goals', healthState: null };
  const loadBack = vi.fn().mockResolvedValue(data);
  const onUpdateTracking = vi.fn().mockResolvedValue(undefined);
  render(<CardBack cardName="Картка" loadBack={loadBack} onFlip={vi.fn()} onUpdateTracking={onUpdateTracking} />);

  await openBackEdit();
  await screen.findByText('Картка: стан без вимірювань');
  fireEvent.click(screen.getByRole('radio', { name: 'Картка: стан без вимірювань' }));

  await vi.waitFor(() => expect(onUpdateTracking).toHaveBeenCalledWith({ trackingMode: 'state', healthState: 'active' }));
  // Радіо переключилось на новий вибір -- підтверджує, що дані оновились
  // локально (чекаємо саме на це, не лише на виклик injected-функції --
  // .then()-патч стану виконується вже ПІСЛЯ резолву промісу, окремим тіком).
  await vi.waitFor(() =>
    expect((screen.getByRole('radio', { name: 'Картка: стан без вимірювань' }) as HTMLInputElement).checked).toBe(true),
  );
  expect(loadBack).toHaveBeenCalledTimes(1);
});

// CH-07 (docs/features/life-area-card/changes.md): зворот тепер має два
// режими -- перегляд (типовий, "Режим картки" НЕ видно) і редагування (меню
// "..." -> "Редагування"/"Архівувати", той самий патерн, що CardFace.tsx).

// CH-10 review (живе тестування 2026-09-21): "не видно за замовчуванням"
// лишається правдою лише для картки, що ВЖЕ має хоч один блок -- для
// ПОРОЖНЬОЇ картки (жодного блоку) картина навпаки, окремий тест нижче.
test('CH-07: за замовчуванням (є блоки) "Режим картки" не видно, лише готові блоки й "Історія записів"', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
    trackingMode: 'goals',
    healthState: null,
  };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateTracking={vi.fn()} />);

  await screen.findByText('Тренування');
  expect(screen.queryByText('Картка: стан без вимірювань')).toBeNull();
  expect(screen.getByRole('button', { name: /Історія записів/ })).toBeTruthy();
});

test('CH-10 review: за замовчуванням (немає жодного блоку) "Режим картки" видно одразу, без меню "..."', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [], trackingMode: 'goals', healthState: null };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateTracking={vi.fn()} />);

  expect(await screen.findByText('Картка: стан без вимірювань')).toBeTruthy();
  expect(screen.getByText('Картка: постійний процес')).toBeTruthy();
  expect(screen.getByText('Картка: з цілями та метриками')).toBeTruthy();
  // Порожня картка -- нема куди "закривати" цю панель, кнопки "Закрити" тут немає.
  expect(screen.queryByRole('button', { name: 'Закрити' })).toBeNull();
});

test('CH-07: меню "..." показує "Редагування" лише коли onUpdateTracking переданий (нема чого показати без нього)', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateTracking={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));

  expect(screen.getByRole('menuitem', { name: 'Редагування' })).toBeTruthy();
});

test('CH-07 review-fix: без onUpdateTracking пункт "Редагування" не рендериться -- клік не мав би на що вплинути', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));

  expect(screen.queryByRole('menuitem', { name: 'Редагування' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'Архівувати' })).toBeNull();
});

test('CH-07: "Редагування" відкриває "Режим картки", "Закрити" ховає його назад (картка вже має блок)', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
    trackingMode: 'goals',
    healthState: null,
  };
  render(<CardBack cardName="Картка" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onUpdateTracking={vi.fn()} />);

  await openBackEdit();
  expect(await screen.findByText('Картка: стан без вимірювань')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

  expect(screen.queryByText('Картка: стан без вимірювань')).toBeNull();
});

test('CH-07: меню "..." -> "Архівувати" показує ArchiveCardDialog з назвою картки', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  render(
    <CardBack cardName="Кар'єра" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onArchive={vi.fn().mockResolvedValue(undefined)} onArchived={vi.fn()} />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Архівувати' }));

  expect(screen.getByText(/Архівувати картку «Кар'єра»\?/)).toBeTruthy();
});

test('CH-07: підтвердження архівації в діалозі викликає injected onArchive і потім onArchived', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const onArchived = vi.fn();
  render(<CardBack cardName="Кар'єра" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onArchive={onArchive} onArchived={onArchived} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Архівувати' }));
  fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }));

  expect(onArchive).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(onArchived).toHaveBeenCalledTimes(1));
});

test('CH-07: "Скасувати" в діалозі архівації закриває його без виклику onArchive/onArchived', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const onArchived = vi.fn();
  render(<CardBack cardName="Кар'єра" loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onArchive={onArchive} onArchived={onArchived} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Архівувати' }));
  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(onArchive).not.toHaveBeenCalled();
  expect(onArchived).not.toHaveBeenCalled();
  expect(screen.queryByText(/Архівувати картку/)).toBeNull();
});
