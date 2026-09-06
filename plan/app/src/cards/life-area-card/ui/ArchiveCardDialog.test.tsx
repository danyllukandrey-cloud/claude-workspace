import { fireEvent, render, screen } from '@testing-library/react';
import { ArchiveCardDialog } from './ArchiveCardDialog';

// AC-16 (spec.md §5) + screens.md SCR-06: обидва перелічені стани мусять
// бути покриті тестом-тригером, не лише монтуванням.

test('default: рендерить підтвердження з назвою картки і двома діями', () => {
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();

  render(<ArchiveCardDialog cardName="Спорт" onArchive={onArchive} onCancel={onCancel} />);

  expect(screen.getByText(/Архівувати картку «Спорт»\?/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Архівувати' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Скасувати' })).toBeTruthy();
  // Default стан -- жодного Banner (error ще не траплялась).
  expect(screen.queryByText(/Не вдалося/)).toBeNull();
});

test('error: 404 card.not_found з onArchive рендерить Banner з помилкою', async () => {
  const onArchive = vi.fn().mockRejectedValue(new Error('Картку не знайдено'));
  const onCancel = vi.fn();

  render(<ArchiveCardDialog cardName="Спорт" onArchive={onArchive} onCancel={onCancel} />);

  fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }));

  expect(await screen.findByText('Картку не знайдено')).toBeTruthy();
  expect(onArchive).toHaveBeenCalledTimes(1);
});

test('error: мережева помилка (не Error-інстанс) рендерить Banner з дефолтним текстом', async () => {
  const onArchive = vi.fn().mockRejectedValue('network down');
  const onCancel = vi.fn();

  render(<ArchiveCardDialog cardName="Спорт" onArchive={onArchive} onCancel={onCancel} />);

  fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }));

  expect(await screen.findByText('Не вдалося архівувати картку')).toBeTruthy();
});

test('скасування викликає onCancel і НЕ викликає onArchive (DELETE)', () => {
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();

  render(<ArchiveCardDialog cardName="Спорт" onArchive={onArchive} onCancel={onCancel} />);

  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onArchive).not.toHaveBeenCalled();
});
