import { act, fireEvent, render, screen } from '@testing-library/react';
import { ArchiveMetricBlockDialog } from './ArchiveMetricBlockDialog';

function typeConfirmWord(): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'видалити' } });
}

test('default: рендерить підтвердження з назвою блоку, полем вводу й двома діями', () => {
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();

  render(<ArchiveMetricBlockDialog metricBlockLabel="Тренування" onArchive={onArchive} onCancel={onCancel} />);

  expect(screen.getByText(/Видалити метрику «Тренування»\?/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Видалити' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Скасувати' })).toBeTruthy();
  expect(screen.getByRole('textbox')).toBeTruthy();
  expect(screen.queryByText(/Не вдалося/)).toBeNull();
});

test('кнопка "Видалити" вимкнена, поки не введено точне слово «видалити»', () => {
  const onArchive = vi.fn().mockResolvedValue(undefined);
  render(<ArchiveMetricBlockDialog metricBlockLabel="Тренування" onArchive={onArchive} onCancel={vi.fn()} />);

  const confirmButton = screen.getByRole('button', { name: 'Видалити' });
  expect(confirmButton.hasAttribute('disabled')).toBe(true);

  fireEvent.click(confirmButton);
  expect(onArchive).not.toHaveBeenCalled();
});

test('після вводу «видалити» клік "Видалити" викликає onArchive', () => {
  const onArchive = vi.fn().mockResolvedValue(undefined);
  render(<ArchiveMetricBlockDialog metricBlockLabel="Тренування" onArchive={onArchive} onCancel={vi.fn()} />);

  typeConfirmWord();
  fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));

  expect(onArchive).toHaveBeenCalledTimes(1);
});

test('Enter у полі після вводу «видалити» теж викликає onArchive', () => {
  const onArchive = vi.fn().mockResolvedValue(undefined);
  render(<ArchiveMetricBlockDialog metricBlockLabel="Тренування" onArchive={onArchive} onCancel={vi.fn()} />);

  typeConfirmWord();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

  expect(onArchive).toHaveBeenCalledTimes(1);
});

test('error: 404 card.not_found з onArchive рендерить Banner з помилкою', async () => {
  const onArchive = vi.fn().mockRejectedValue(new Error('Метрику не знайдено'));
  render(<ArchiveMetricBlockDialog metricBlockLabel="Тренування" onArchive={onArchive} onCancel={vi.fn()} />);

  typeConfirmWord();
  fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));

  expect(await screen.findByText('Метрику не знайдено')).toBeTruthy();
  expect(onArchive).toHaveBeenCalledTimes(1);
});

test('error: мережева помилка (не Error-інстанс) рендерить Banner з дефолтним текстом', async () => {
  const onArchive = vi.fn().mockRejectedValue('network down');
  render(<ArchiveMetricBlockDialog metricBlockLabel="Тренування" onArchive={onArchive} onCancel={vi.fn()} />);

  typeConfirmWord();
  fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));

  expect(await screen.findByText('Не вдалося видалити метрику')).toBeTruthy();
});

test('подвійний клік "Видалити" (onArchive ще не завершився) викликає onArchive лише один раз, кнопка вимкнена на час очікування', async () => {
  let resolveArchive: () => void = () => {};
  const onArchive = vi.fn().mockReturnValue(
    new Promise<void>((resolve) => {
      resolveArchive = resolve;
    }),
  );

  render(<ArchiveMetricBlockDialog metricBlockLabel="Тренування" onArchive={onArchive} onCancel={vi.fn()} />);

  typeConfirmWord();
  const confirmButton = screen.getByRole('button', { name: 'Видалити' });
  fireEvent.click(confirmButton);
  expect(confirmButton.hasAttribute('disabled')).toBe(true);

  fireEvent.click(confirmButton);
  expect(onArchive).toHaveBeenCalledTimes(1);

  await act(async () => resolveArchive());
  expect(confirmButton.hasAttribute('disabled')).toBe(false);
});

test('після невдалого onArchive кнопка знову доступна для повторної спроби', async () => {
  const onArchive = vi.fn().mockRejectedValue(new Error('Мережева помилка'));
  render(<ArchiveMetricBlockDialog metricBlockLabel="Тренування" onArchive={onArchive} onCancel={vi.fn()} />);

  typeConfirmWord();
  const confirmButton = screen.getByRole('button', { name: 'Видалити' });
  fireEvent.click(confirmButton);

  await screen.findByText('Мережева помилка');
  expect(confirmButton.hasAttribute('disabled')).toBe(false);
});

test('скасування викликає onCancel і НЕ викликає onArchive (DELETE)', () => {
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();

  render(<ArchiveMetricBlockDialog metricBlockLabel="Тренування" onArchive={onArchive} onCancel={onCancel} />);

  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onArchive).not.toHaveBeenCalled();
});
