import { fireEvent, render, screen } from '@testing-library/react';
import { CardFace } from './CardFace';
import type { CardFaceData } from './types';

// screens.md SCR-02 стани -- кожен тест тригерить свій стан через результат
// (чи ще не результат) ін'єктованого loadCard, не лише монтування зі
// статичними пропами.

test('SCR-02 loading: показує спінер, поки loadCard ще не завершився', () => {
  render(<CardFace loadCard={() => new Promise<CardFaceData>(() => {})} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  expect(screen.getByRole('status')).toBeTruthy();
});

test('SCR-02 default: показує назву й Опис, коли обидва заповнені', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'Регулярні тренування для форми й енергії', dataWarning: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  expect(await screen.findByText('Спорт')).toBeTruthy();
  expect(screen.getByText('Регулярні тренування для форми й енергії')).toBeTruthy();
  expect(screen.queryByText(/некоректно/)).toBeNull();
});

test('SCR-02 empty-description: показує підказку, коли Опис ще не заповнено', async () => {
  const data: CardFaceData = { name: 'Спорт', description: null, dataWarning: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  expect(await screen.findByText('Опис ще не заповнено')).toBeTruthy();
});

test('SCR-02 warning: показує Banner, коли агент позначив дані підозрілими (AC-10)', async () => {
  const data: CardFaceData = {
    name: 'Спорт',
    description: 'Регулярні тренування',
    dataWarning: 'Щось на цій картці виглядає некоректно — розберемось разом?',
  };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  const warning = await screen.findByText('Щось на цій картці виглядає некоректно — розберемось разом?');
  expect(warning.getAttribute('data-variant')).toBe('info');
  // Опис лишається видимим -- AC-10: попередження не блокує решту картки.
  expect(screen.getByText('Регулярні тренування')).toBeTruthy();
});

test('SCR-02 error: показує Banner помилки, коли loadCard відхилено (404 card.not_found)', async () => {
  render(<CardFace loadCard={() => Promise.reject(new Error('Картку не знайдено'))} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  const banner = await screen.findByText('Картку не знайдено');
  expect(banner.getAttribute('data-variant')).toBe('error');
});

test('SCR-02: клік "перегорнути" викликає onFlip', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  const onFlip = vi.fn();
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={onFlip} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));

  expect(onFlip).toHaveBeenCalledTimes(1);
});

// AC-19 -- стан "rename": меню "..." -> "Перейменувати" -> назва редагована
// inline -> Зберегти/Скасувати.

test('SCR-02 rename: меню "..." -> "Перейменувати" показує TextField із поточною назвою', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

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
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={onRename} onArchive={vi.fn()} onArchived={vi.fn()} />);

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
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={onRename} onArchive={vi.fn()} onArchived={vi.fn()} />);

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
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={onRename} onArchive={vi.fn()} onArchived={vi.fn()} />);

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
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  fireEvent.click(await screen.findByRole('heading', { name: 'Спорт' }));

  const nameField = screen.getByLabelText('Назва') as HTMLInputElement;
  expect(nameField.value).toBe('Спорт');
});

// ISS-56 (RED, docs/ISSUES.md): другий пункт меню "..." -> "Архівувати" --
// відкриває ArchiveCardDialog (T29, SCR-06), уже написаний і протестований
// ІЗОЛЬОВАНО (ArchiveCardDialog.test.tsx) зі своїм фіксованим контрактом
// (cardName/onArchive/onCancel) -- тут перевіряємо лише інтеграцію: пункт
// меню відкриває діалог з правильною cardName, підтвердження викликає
// injected CardFace.onArchive і, після його резолву, injected onArchived
// (новий проп -- сигнал батькові "картку архівовано, є куди піти").

test('ISS-56 SCR-02 archive: меню "..." -> "Архівувати" показує ArchiveCardDialog з назвою картки', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={vi.fn()}
      onArchive={vi.fn().mockResolvedValue(undefined)}
      onArchived={vi.fn()}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Архівувати' }));

  expect(screen.getByText(/Архівувати картку «Спорт»\?/)).toBeTruthy();
});

test('ISS-56 SCR-02 archive: підтвердження в діалозі викликає injected onArchive і потім onArchived', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const onArchived = vi.fn();
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={vi.fn()}
      onArchive={onArchive}
      onArchived={onArchived}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Архівувати' }));
  fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }));

  expect(onArchive).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(onArchived).toHaveBeenCalledTimes(1));
});

test('ISS-56 SCR-02 archive: "Скасувати" в діалозі закриває його без виклику onArchive/onArchived', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  const onArchive = vi.fn().mockResolvedValue(undefined);
  const onArchived = vi.fn();
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={vi.fn()}
      onArchive={onArchive}
      onArchived={onArchived}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Архівувати' }));
  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(onArchive).not.toHaveBeenCalled();
  expect(onArchived).not.toHaveBeenCalled();
  expect(screen.queryByText(/Архівувати картку/)).toBeNull();
});

test('SCR-02: відкрите меню/чернетка rename скидаються, коли loadCard проп змінився (нова картка)', async () => {
  const first: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  const second: CardFaceData = { name: 'Навчання', description: 'опис 2', dataWarning: null };

  const { rerender } = render(<CardFace loadCard={() => Promise.resolve(first)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  fireEvent.click(await screen.findByRole('heading', { name: 'Спорт' }));
  expect(screen.getByLabelText('Назва')).toBeTruthy();

  rerender(<CardFace loadCard={() => Promise.resolve(second)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  // Нова картка -- стара чернетка/режим rename не мають лишитись поверх неї.
  expect(await screen.findByRole('heading', { name: 'Навчання' })).toBeTruthy();
  expect(screen.queryByLabelText('Назва')).toBeNull();
});

// Review 2026-09-07 C10 (AC-03): до цього фіксу CardFace взагалі не мав
// способу відкрити Опис на редагування чи позначити картку заповненою --
// AC-03 (блокування markFilled без Опису) технічно існував на бекенді
// (update-card.ts), але користувач не міг його досягти жодним кліком.
// onUpdateDescription -- опційний (як onAddEntry в MetricBlockCard, T49):
// відсутній -- афорданс не рендериться.

test('C10: без onUpdateDescription клік по Опису нічого не відкриває', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  fireEvent.click(await screen.findByText('опис'));

  expect(screen.queryByLabelText('Опис (навіщо)')).toBeNull();
});

test('C10: з onUpdateDescription клік по Опису відкриває TextField і чекбокс "позначити заповненою"', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={vi.fn()}
      onArchive={vi.fn()}
      onArchived={vi.fn()}
      onUpdateDescription={vi.fn()}
    />,
  );

  fireEvent.click(await screen.findByText('опис'));

  const field = screen.getByLabelText('Опис (навіщо)') as HTMLInputElement;
  expect(field.value).toBe('опис');
  expect(screen.getByLabelText('Позначити заповненою')).toBeTruthy();
});

test('C10: "Зберегти" викликає onUpdateDescription({description, markFilled}) і оновлює Опис', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'старий опис', dataWarning: null };
  const onUpdateDescription = vi.fn().mockResolvedValue(undefined);
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={vi.fn()}
      onArchive={vi.fn()}
      onArchived={vi.fn()}
      onUpdateDescription={onUpdateDescription}
    />,
  );

  fireEvent.click(await screen.findByText('старий опис'));
  fireEvent.change(screen.getByLabelText('Опис (навіщо)'), { target: { value: 'новий опис' } });
  fireEvent.click(screen.getByLabelText('Позначити заповненою'));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(onUpdateDescription).toHaveBeenCalledWith({ description: 'новий опис', markFilled: true });
  expect(await screen.findByText('новий опис')).toBeTruthy();
  expect(screen.queryByLabelText('Опис (навіщо)')).toBeNull();
});

test('C10: "Скасувати" відкидає зміну без виклику onUpdateDescription', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
  const onUpdateDescription = vi.fn();
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={vi.fn()}
      onArchive={vi.fn()}
      onArchived={vi.fn()}
      onUpdateDescription={onUpdateDescription}
    />,
  );

  fireEvent.click(await screen.findByText('опис'));
  fireEvent.change(screen.getByLabelText('Опис (навіщо)'), { target: { value: 'чернетка, яку відкинуть' } });
  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(onUpdateDescription).not.toHaveBeenCalled();
  expect(await screen.findByText('опис')).toBeTruthy();
});

// AC-03 буквально: "user tries to mark the card as filled while leaving Опис
// empty" -> "system blocks marking it filled and explains that a short
// 'навіщо' is required first". Бекенд (update-card.ts) уже кидає цю помилку --
// тест доводить, що гілка ДОСЯЖНА через UI (до фіксу не існувало способу
// взагалі викликати onUpdateDescription).
test('C10/AC-03: відхилений onUpdateDescription (порожній Опис + markFilled) показує пояснення, поле лишається відкритим', async () => {
  const data: CardFaceData = { name: 'Спорт', description: null, dataWarning: null };
  const onUpdateDescription = vi.fn().mockRejectedValue(new Error('Потрібен короткий опис "навіщо", перш ніж позначити картку заповненою'));
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={vi.fn()}
      onArchive={vi.fn()}
      onArchived={vi.fn()}
      onUpdateDescription={onUpdateDescription}
    />,
  );

  fireEvent.click(await screen.findByText('Опис ще не заповнено'));
  fireEvent.click(screen.getByLabelText('Позначити заповненою'));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  const banner = await screen.findByText('Потрібен короткий опис "навіщо", перш ніж позначити картку заповненою');
  expect(banner.getAttribute('data-variant')).toBe('error');
  expect(screen.getByLabelText('Опис (навіщо)')).toBeTruthy();
});
