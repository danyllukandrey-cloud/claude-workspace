import { act, fireEvent, render, screen } from '@testing-library/react';
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

// Review 2026-09-07 E (RED, T52): "ConfirmDialog ... без захисту від
// подвійного сабміту при архівації" -- ArchiveCardDialog передає
// ConfirmDialog.confirmDisabled=true, поки onArchive ще не завершився,
// щоб швидкий подвійний клік не викликав DELETE двічі.

test('подвійний клік "Архівувати" (onArchive ще не завершився) викликає onArchive лише один раз, кнопка вимкнена на час очікування', async () => {
  let resolveArchive: () => void = () => {};
  const onArchive = vi.fn().mockReturnValue(
    new Promise<void>((resolve) => {
      resolveArchive = resolve;
    }),
  );
  const onCancel = vi.fn();

  render(<ArchiveCardDialog cardName="Спорт" onArchive={onArchive} onCancel={onCancel} />);

  const confirmButton = screen.getByRole('button', { name: 'Архівувати' });
  fireEvent.click(confirmButton);
  expect(confirmButton.hasAttribute('disabled')).toBe(true);

  fireEvent.click(confirmButton);
  expect(onArchive).toHaveBeenCalledTimes(1);

  await act(async () => resolveArchive());
  expect(confirmButton.hasAttribute('disabled')).toBe(false);
});

// Той самий guard, коли onArchive зрештою провалюється -- кнопка має знову
// стати доступною (retry), не лишитись назавжди вимкненою.
test('після невдалого onArchive кнопка знову доступна для повторної спроби', async () => {
  const onArchive = vi.fn().mockRejectedValue(new Error('Мережева помилка'));
  const onCancel = vi.fn();

  render(<ArchiveCardDialog cardName="Спорт" onArchive={onArchive} onCancel={onCancel} />);

  const confirmButton = screen.getByRole('button', { name: 'Архівувати' });
  fireEvent.click(confirmButton);

  await screen.findByText('Мережева помилка');
  expect(confirmButton.hasAttribute('disabled')).toBe(false);
});

test('скасування викликає onCancel і НЕ викликає onArchive (DELETE)', () => {
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();

  render(<ArchiveCardDialog cardName="Спорт" onArchive={onArchive} onCancel={onCancel} />);

  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onArchive).not.toHaveBeenCalled();
});
