import { fireEvent, render, screen } from '@testing-library/react';
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

test('SCR-03 loading: показує спінер, поки loadBack ще не завершився', () => {
  render(<CardBack loadBack={() => new Promise<CardBackData>(() => {})} onFlip={vi.fn()} />);

  expect(screen.getByRole('status')).toBeTruthy();
});

test('SCR-03 error: показує Banner, коли loadBack відхилено', async () => {
  render(<CardBack loadBack={() => Promise.reject(new Error('Мережева помилка'))} onFlip={vi.fn()} />);

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
  render(<CardBack loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  expect(await screen.findByText(/Тренування: 50%/)).toBeTruthy();
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
  render(<CardBack loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  expect(await screen.findByText(/Тренування: 100%/)).toBeTruthy();
  expect(screen.getByText(/\+3 раз понад ціль/)).toBeTruthy();
});

test('SCR-03 ongoing: постійний процес показує накопичену кількість, не відсоток (AC-05)', async () => {
  const data: CardBackData = {
    metricBlocks: [{ id: 'mb2', label: 'Біг', unit: 'км', progress: { kind: 'ongoing', accumulated: 40 }, hasPendingEntry: false }],
    aggregateProgress: null,
    entries: [],
  };
  render(<CardBack loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  expect(await screen.findByText(/Біг: постійний процес — 40 км/)).toBeTruthy();
  // Ongoing-блок не має частки -- нема жодного bounded-блоку, агрегат null, лінія не рендериться.
  expect(screen.queryByText(/Загальний прогрес/)).toBeNull();
});

test('SCR-03 declarative: без жодного блоку-метрики показує порожній стан', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  render(<CardBack loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  expect(await screen.findByText('Ще немає жодної активної метрики')).toBeTruthy();
  expect(screen.getByText('Додайте блок-метрику, щоб почати відстежувати прогрес')).toBeTruthy();
});

test('SCR-03 pending-entry: блок із записом, що очікує перевірки агента, позначений окремо (AC-06/AC-11)', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: true },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  render(<CardBack loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  expect(await screen.findByText('Запис очікує перевірки агента')).toBeTruthy();
});

test('SCR-03 history-expanded: розгортає історію записів по кліку (AC-13)', async () => {
  const data: CardBackData = {
    metricBlocks: [],
    aggregateProgress: null,
    entries: [makeEntry({ id: 'e1', recordedAtLabel: '27.08', summary: '+1 тренування' })],
  };
  render(<CardBack loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  await screen.findByText('Ще немає жодної активної метрики');
  expect(screen.queryByText('+1 тренування')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Історія записів/ }));

  expect(await screen.findByText('+1 тренування')).toBeTruthy();
  expect(screen.getByText('27.08')).toBeTruthy();
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

  render(<CardBack loadBack={() => Promise.resolve(initial)} onFlip={vi.fn()} onFlagEntry={onFlagEntry} />);

  fireEvent.click(await screen.findByRole('button', { name: /Історія записів/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'виправити' }));

  expect(onFlagEntry).toHaveBeenCalledWith('e1');
  expect(await screen.findByText('+1 тренування (скасовано)')).toBeTruthy();
  // Виправлений запис уже не 'confirmed' -- кнопку "виправити" вдруге не пропонуємо.
  expect(screen.queryByRole('button', { name: 'виправити' })).toBeNull();
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
    <CardBack loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onRenameTransferredBlock={onRenameTransferredBlock} />,
  );

  const input = await screen.findByLabelText('Нова назва блоку-метрики');
  expect((input as HTMLInputElement).value).toBe('Тренування');
  expect(screen.getByText('У картці вже є блок-метрика з такою назвою й одиницею')).toBeTruthy();

  fireEvent.change(input, { target: { value: 'Тренування (перенесено)' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(onRenameTransferredBlock).toHaveBeenCalledWith({ metricBlockId: 'mb9', newLabel: 'Тренування (перенесено)' });
  expect(await screen.findByText(/Тренування \(перенесено\): постійний процес — 12 раз/)).toBeTruthy();
  // Колізію вирішено -- форма перейменування зникає.
  expect(screen.queryByLabelText('Нова назва блоку-метрики')).toBeNull();
});

test('SCR-03: клік "← лицьова" викликає onFlip', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  const onFlip = vi.fn();
  render(<CardBack loadBack={() => Promise.resolve(data)} onFlip={onFlip} />);

  fireEvent.click(await screen.findByRole('button', { name: /лицьова/ }));

  expect(onFlip).toHaveBeenCalledTimes(1);
});

// ISS-60 (docs/ISSUES.md, план у рядку): порожній стан отримує кнопку
// "+ Додати блок-метрику" -> відкриває MetricBlockForm (T28) -> injected
// onCreateMetricBlock -> після успіху форма закривається й CardBack сам
// перевантажує зворот через loadBack (той самий "ремаунт перезавантажує"
// підхід, що вже є в App.tsx для інших мутацій) -- onCreateMetricBlock
// повертає лише Promise<void>, не свіжі дані, тому свіжість забезпечує
// повторний виклик loadBack, не повернене значення.

test('ISS-60: без onCreateMetricBlock порожній стан не показує кнопку створення блоку', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  render(<CardBack loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  await screen.findByText('Ще немає жодної активної метрики');
  expect(screen.queryByRole('button', { name: '+ Додати блок-метрику' })).toBeNull();
});

test('ISS-60: з onCreateMetricBlock порожній стан показує кнопку "+ Додати блок-метрику", клік відкриває MetricBlockForm', async () => {
  const data: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };
  render(
    <CardBack loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onCreateMetricBlock={vi.fn()} />,
  );

  await screen.findByText('Ще немає жодної активної метрики');
  fireEvent.click(screen.getByRole('button', { name: '+ Додати блок-метрику' }));

  expect(screen.getByLabelText('Що рахуємо:')).toBeTruthy();
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

  render(<CardBack loadBack={loadBack} onFlip={vi.fn()} onCreateMetricBlock={onCreateMetricBlock} />);

  await screen.findByText('Ще немає жодної активної метрики');
  fireEvent.click(screen.getByRole('button', { name: '+ Додати блок-метрику' }));

  fireEvent.change(screen.getByLabelText('Що рахуємо:'), { target: { value: 'Тренування' } });
  fireEvent.change(screen.getByLabelText('Одиниця:'), { target: { value: 'раз' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  await screen.findByText(/Тренування: 0%/);

  const expected: MetricBlockFormValues = {
    label: 'Тренування',
    unit: 'раз',
    targetCount: null,
    isOngoing: false,
    targetDate: null,
  };
  expect(onCreateMetricBlock).toHaveBeenCalledWith(expected);
  expect(loadBack).toHaveBeenCalledTimes(2);
  expect(screen.queryByLabelText('Що рахуємо:')).toBeNull();
});

// D-110 (docs/DECISIONS.md, ТИМЧАСОВЕ): onAddEntry прокидається з CardBack
// у КОЖЕН MetricBlockCard, замкнутий над block.id -- MetricBlockCard сам
// нічого не знає про metricBlockId (лише amount), тому саме CardBack додає
// його при передачі.

test('D-110: onAddEntry, якщо переданий, прокидається в MetricBlockCard замкнутим над id блоку', async () => {
  const data: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  const onAddEntry = vi.fn().mockResolvedValue(undefined);
  render(<CardBack loadBack={() => Promise.resolve(data)} onFlip={vi.fn()} onAddEntry={onAddEntry} />);

  await screen.findByText(/Тренування: 50%/);
  fireEvent.click(screen.getByRole('button', { name: '+' }));
  fireEvent.change(screen.getByLabelText('Кількість'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

  expect(onAddEntry).toHaveBeenCalledWith('mb1', 3);
});
