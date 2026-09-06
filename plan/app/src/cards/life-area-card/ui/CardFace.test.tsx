import { fireEvent, render, screen } from '@testing-library/react';
import { CardFace } from './CardFace';
import type { CardFaceData } from './types';

// screens.md SCR-02 стани -- кожен тест тригерить свій стан через результат
// (чи ще не результат) ін'єктованого loadCard, не лише монтування зі
// статичними пропами.

test('SCR-02 loading: показує спінер, поки loadCard ще не завершився', () => {
  render(<CardFace loadCard={() => new Promise<CardFaceData>(() => {})} onFlip={vi.fn()} onRename={vi.fn()} />);

  expect(screen.getByRole('status')).toBeTruthy();
});

test('SCR-02 default: показує назву й Опис, коли обидва заповнені', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'Регулярні тренування для форми й енергії', dataWarning: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} />);

  expect(await screen.findByText('Спорт')).toBeTruthy();
  expect(screen.getByText('Регулярні тренування для форми й енергії')).toBeTruthy();
  expect(screen.queryByText(/некоректно/)).toBeNull();
});

test('SCR-02 empty-description: показує підказку, коли Опис ще не заповнено', async () => {
  const data: CardFaceData = { name: 'Спорт', description: null, dataWarning: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} />);

  expect(await screen.findByText('Опис ще не заповнено')).toBeTruthy();
});

test('SCR-02 warning: показує Banner, коли агент позначив дані підозрілими (AC-10)', async () => {
  const data: CardFaceData = {
    name: 'Спорт',
    description: 'Регулярні тренування',
    dataWarning: 'Щось на цій картці виглядає некоректно — розберемось разом?',
  };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} />);

  const warning = await screen.findByText('Щось на цій картці виглядає некоректно — розберемось разом?');
  expect(warning.getAttribute('data-variant')).toBe('info');
  // Опис лишається видимим -- AC-10: попередження не блокує решту картки.
  expect(screen.getByText('Регулярні тренування')).toBeTruthy();
});

test('SCR-02 error: показує Banner помилки, коли loadCard відхилено (404 card.not_found)', async () => {
  render(<CardFace loadCard={() => Promise.reject(new Error('Картку не знайдено'))} onFlip={vi.fn()} onRename={vi.fn()} />);

  const banner = await screen.findByText('Картку не знайдено');
  expect(banner.getAttribute('data-variant')).toBe('error');
});

test('SCR-02: клік "перегорнути" викликає onFlip', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  const onFlip = vi.fn();
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={onFlip} onRename={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));

  expect(onFlip).toHaveBeenCalledTimes(1);
});

// AC-19 -- стан "rename": меню "..." -> "Перейменувати" -> назва редагована
// inline -> Зберегти/Скасувати.

test('SCR-02 rename: меню "..." -> "Перейменувати" показує TextField із поточною назвою', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Перейменувати' }));

  const nameField = screen.getByLabelText('Назва') as HTMLInputElement;
  expect(nameField.value).toBe('Спорт');
  // У стані "rename" статичний заголовок і "перегорнути" не рендеряться.
  expect(screen.queryByRole('heading', { name: 'Спорт' })).toBeNull();
  expect(screen.queryByRole('button', { name: /перегорнути/ })).toBeNull();
});

test('SCR-02 rename: "Зберегти" викликає onRename(нова назва) і оновлює назву в картці', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  const onRename = vi.fn().mockResolvedValue(undefined);
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={onRename} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Перейменувати' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт і здоров’я' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(onRename).toHaveBeenCalledWith('Спорт і здоров’я');
  expect(await screen.findByText('Спорт і здоров’я')).toBeTruthy();
  expect(screen.queryByLabelText('Назва')).toBeNull();
});

test('SCR-02 rename: "Скасувати" відкидає зміну без виклику onRename', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  const onRename = vi.fn();
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={onRename} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Перейменувати' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Чернетка, яку відкинуть' } });
  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(onRename).not.toHaveBeenCalled();
  expect(await screen.findByText('Спорт')).toBeTruthy();
  expect(screen.queryByLabelText('Назва')).toBeNull();
});

test('SCR-02 rename error: відхилений onRename показує Banner і лишає TextField відкритим', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  const onRename = vi.fn().mockRejectedValue(new Error('network down'));
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={onRename} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Перейменувати' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Нова назва' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  const banner = await screen.findByText('network down');
  expect(banner.getAttribute('data-variant')).toBe('error');
  expect(screen.getByLabelText('Назва')).toBeTruthy();
});

test('SCR-02 rename: торкання самої назви теж запускає rename (AC-19, другий шлях входу)', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} />);

  fireEvent.click(await screen.findByRole('heading', { name: 'Спорт' }));

  const nameField = screen.getByLabelText('Назва') as HTMLInputElement;
  expect(nameField.value).toBe('Спорт');
});

test('SCR-02: відкрите меню/чернетка rename скидаються, коли loadCard проп змінився (нова картка)', async () => {
  const first: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  const second: CardFaceData = { name: 'Навчання', description: 'опис 2', dataWarning: null };

  const { rerender } = render(<CardFace loadCard={() => Promise.resolve(first)} onFlip={vi.fn()} onRename={vi.fn()} />);

  fireEvent.click(await screen.findByRole('heading', { name: 'Спорт' }));
  expect(screen.getByLabelText('Назва')).toBeTruthy();

  rerender(<CardFace loadCard={() => Promise.resolve(second)} onFlip={vi.fn()} onRename={vi.fn()} />);

  // Нова картка -- стара чернетка/режим rename не мають лишитись поверх неї.
  expect(await screen.findByRole('heading', { name: 'Навчання' })).toBeTruthy();
  expect(screen.queryByLabelText('Назва')).toBeNull();
});
