// SCR-04 — Архівування (CH-05/CH-06, docs/features/structure/changes.md).
// Раніше T23 "Закрити напрямок" (CloseCardDialog.test.tsx) -- переписано
// разом із компонентом: CH-05 прибирає структуроспецифічний close-флоу
// повністю, CH-06 змінює саму МОДЕЛЬ взаємодії -- кожна метрика переноситься
// ОКРЕМИМ кліком "Перенести" одразу (не пакетно перед архівацією), а сама
// архівація ("Архівувати без перенесення") більше не носить metricTransfers.
//
// DI style (plan/app/CLAUDE.md, matches LayoutBoard/DeclarationScreen):
// onTransferMetricBlock/onArchive -- ін'єктовані пропи-функції, жодного
// fetch() у компоненті.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LayoutBoardArchiveDialog } from './LayoutBoardArchiveDialog';
import type { LayoutBoardArchiveDialogProps } from './LayoutBoardArchiveDialog';

function baseProps(overrides: Partial<LayoutBoardArchiveDialogProps> = {}): LayoutBoardArchiveDialogProps {
  return {
    cardTitle: 'Навчання (дубль)',
    metricBlocks: [
      { metricBlockId: 'mb-1', label: 'книги' },
      { metricBlockId: 'mb-2', label: 'курси' },
    ],
    targetCards: [
      { cardId: 'card-navchannia', cardTitle: 'Навчання' },
      { cardId: 'card-sport', cardTitle: 'Спорт' },
    ],
    onTransferMetricBlock: vi.fn().mockResolvedValue(undefined),
    onArchive: vi.fn().mockResolvedValue(undefined),
    onArchived: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

test('default: показує чекбокс на кожну метрику й обидві кнопки дій', () => {
  const props = baseProps();
  render(<LayoutBoardArchiveDialog {...props} />);

  expect(screen.getByText(/книги/)).toBeTruthy();
  expect(screen.getByText(/курси/)).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Архівувати без перенесення' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Скасувати' })).toBeTruthy();
});

test('CH-06 п.2/3: чекбокс -> вибір картки-цілі -> "Перенести" зʼявляється лише після вибору й переносить ОДРАЗУ', async () => {
  const props = baseProps();
  render(<LayoutBoardArchiveDialog {...props} />);

  const toggles = screen.getAllByRole('checkbox');
  fireEvent.click(toggles[1]); // "курси" -> хочу перенести

  expect(screen.queryByRole('button', { name: 'Перенести' })).toBeNull(); // ще без обраної цілі

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'card-navchannia' } });
  expect(screen.getByRole('button', { name: 'Перенести' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));

  await waitFor(() =>
    expect(props.onTransferMetricBlock).toHaveBeenCalledWith({ metricBlockId: 'mb-2', targetCardId: 'card-navchannia' }),
  );
  // Архівація НЕ викликана -- це окрема, незалежна дія (CH-06 п.5).
  expect(props.onArchive).not.toHaveBeenCalled();
  await screen.findByText('Перенесено');
});

test('CH-06 п.4: зняв чекбокс -- форма скидається до вибору картки (select/кнопка зникають, обраний target очищається)', async () => {
  const props = baseProps();
  render(<LayoutBoardArchiveDialog {...props} />);

  const toggles = screen.getAllByRole('checkbox');
  fireEvent.click(toggles[0]); // "книги"
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'card-sport' } });
  expect(screen.getByRole('button', { name: 'Перенести' })).toBeTruthy();

  fireEvent.click(toggles[0]); // знімаю чекбокс

  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Перенести' })).toBeNull();

  // Позначив знову -- select порожній ("--"), не пам'ятає стару картку.
  fireEvent.click(toggles[0]);
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
});

test('перенесена метрика показує "Перенесено", чекбокс блокується, повторний "Перенести" неможливий', async () => {
  const props = baseProps();
  render(<LayoutBoardArchiveDialog {...props} />);

  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'card-sport' } });
  fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));

  await screen.findByText('Перенесено');
  expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByRole('combobox')).toBeNull();
});

// code-review 2026-09-21 (correctness, підтверджено двома незалежними
// перевірками): поки перенесення метрики ще в польоті, ні чекбокс ЦЬОГО
// рядка, ні "Архівувати без перенесення" не мають бути клікабельними --
// інакше можна або скасувати чекбокс так, що "Перенесено" все одно
// зʼявиться пізніше (плутанина), або відправити архівацію картки, поки
// перенесення метрики з неї ще летить (гонка запитів на сервер).
test('CH-06 review-fix: під час перенесення в польоті чекбокс і "Архівувати без перенесення" заблоковані', async () => {
  let resolveTransfer: (() => void) | undefined;
  const onTransferMetricBlock = vi.fn(() => new Promise<void>((resolve) => { resolveTransfer = resolve; }));
  const props = baseProps({ onTransferMetricBlock });
  render(<LayoutBoardArchiveDialog {...props} />);

  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'card-sport' } });
  fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));

  await screen.findByRole('button', { name: 'Переноситься…' });
  expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Архівувати без перенесення' }).hasAttribute('disabled')).toBe(true);

  resolveTransfer?.();
  await screen.findByText('Перенесено');
  expect(screen.getByRole('button', { name: 'Архівувати без перенесення' }).hasAttribute('disabled')).toBe(false);
});

test('помилка перенесення -- inline Banner у рядку, метрика лишається неперенесеною (можна повторити)', async () => {
  const onTransferMetricBlock = vi.fn().mockRejectedValue(new Error('Не вдалося перенести'));
  const props = baseProps({ onTransferMetricBlock });
  render(<LayoutBoardArchiveDialog {...props} />);

  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'card-sport' } });
  fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));

  const banner = await screen.findByText('Не вдалося перенести');
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
  expect(screen.getByRole('button', { name: 'Перенести' })).toBeTruthy(); // можна спробувати ще раз
  expect(screen.queryByText('Перенесено')).toBeNull();
});

test('empty: жодного блоку-метрики -- лише "Архівувати без перенесення" й "Скасувати", жодного рядка з чекбоксом', () => {
  const props = baseProps({ metricBlocks: [] });
  render(<LayoutBoardArchiveDialog {...props} />);

  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: 'Архівувати без перенесення' })).toBeTruthy();
});

test('CH-06 п.5: "Архівувати без перенесення" викликає onArchive без метрик-логіки, потім onArchived', async () => {
  const props = baseProps();
  render(<LayoutBoardArchiveDialog {...props} />);

  fireEvent.click(screen.getByRole('button', { name: 'Архівувати без перенесення' }));

  await waitFor(() => expect(props.onArchive).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(props.onArchived).toHaveBeenCalledTimes(1));
});

test('помилка архівації -- Banner variant="error", форма лишається доступною (не toast/alert)', async () => {
  const onArchive = vi.fn().mockRejectedValue(new Error('Не вдалося архівувати картку'));
  const props = baseProps({ onArchive });
  render(<LayoutBoardArchiveDialog {...props} />);

  fireEvent.click(screen.getByRole('button', { name: 'Архівувати без перенесення' }));

  const banner = await screen.findByText('Не вдалося архівувати картку');
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
  expect(props.onArchived).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Архівувати без перенесення' })).toBeTruthy();
});

test('скасування викликає onCancel і НЕ викликає onArchive', () => {
  const props = baseProps();
  render(<LayoutBoardArchiveDialog {...props} />);

  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(props.onCancel).toHaveBeenCalledTimes(1);
  expect(props.onArchive).not.toHaveBeenCalled();
});

test('без injected onTransferMetricBlock -- жодного чекбокса, лише назви метрик', () => {
  const props = baseProps({ onTransferMetricBlock: undefined });
  render(<LayoutBoardArchiveDialog {...props} />);

  expect(screen.getByText(/книги/)).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: 'Архівувати без перенесення' })).toBeTruthy();
});

test('без жодної картки-цілі (targetCards порожній) -- теж жодного чекбокса', () => {
  const props = baseProps({ targetCards: [] });
  render(<LayoutBoardArchiveDialog {...props} />);

  expect(screen.queryByRole('checkbox')).toBeNull();
});
