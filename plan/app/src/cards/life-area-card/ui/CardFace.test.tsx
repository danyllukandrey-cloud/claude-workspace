import { fireEvent, render, screen } from '@testing-library/react';
import { CardFace } from './CardFace';
import type { CardFaceData } from './types';

// screens.md SCR-02 стани -- кожен тест тригерить свій стан через результат
// (чи ще не результат) ін'єктованого loadCard, не лише монтування зі
// статичними пропами.

test('SCR-02 loading: показує спінер, поки loadCard ще не завершився', () => {
  render(<CardFace loadCard={() => new Promise<CardFaceData>(() => {})} onFlip={vi.fn()} />);

  expect(screen.getByRole('status')).toBeTruthy();
});

test('SCR-02 default: показує назву й Опис, коли обидва заповнені', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'Регулярні тренування для форми й енергії', dataWarning: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  expect(await screen.findByText('Спорт')).toBeTruthy();
  expect(screen.getByText('Регулярні тренування для форми й енергії')).toBeTruthy();
  expect(screen.queryByText(/некоректно/)).toBeNull();
});

test('SCR-02 empty-description: показує підказку, коли Опис ще не заповнено', async () => {
  const data: CardFaceData = { name: 'Спорт', description: null, dataWarning: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  expect(await screen.findByText('Опис ще не заповнено')).toBeTruthy();
});

test('SCR-02 warning: показує Banner, коли агент позначив дані підозрілими (AC-10)', async () => {
  const data: CardFaceData = {
    name: 'Спорт',
    description: 'Регулярні тренування',
    dataWarning: 'Щось на цій картці виглядає некоректно — розберемось разом?',
  };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} />);

  const warning = await screen.findByText('Щось на цій картці виглядає некоректно — розберемось разом?');
  expect(warning.getAttribute('data-variant')).toBe('info');
  // Опис лишається видимим -- AC-10: попередження не блокує решту картки.
  expect(screen.getByText('Регулярні тренування')).toBeTruthy();
});

test('SCR-02 error: показує Banner помилки, коли loadCard відхилено (404 card.not_found)', async () => {
  render(<CardFace loadCard={() => Promise.reject(new Error('Картку не знайдено'))} onFlip={vi.fn()} />);

  const banner = await screen.findByText('Картку не знайдено');
  expect(banner.getAttribute('data-variant')).toBe('error');
});

test('SCR-02: клік "перегорнути" викликає onFlip', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  const onFlip = vi.fn();
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={onFlip} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));

  expect(onFlip).toHaveBeenCalledTimes(1);
});
