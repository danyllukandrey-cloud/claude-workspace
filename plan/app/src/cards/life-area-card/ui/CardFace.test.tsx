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
  const data: CardFaceData = { name: 'Спорт', description: 'Регулярні тренування для форми й енергії', dataWarning: null, trackingMode: 'goals', healthState: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  expect(await screen.findByText('Спорт')).toBeTruthy();
  expect(screen.getByText('Регулярні тренування для форми й енергії')).toBeTruthy();
  expect(screen.queryByText(/некоректно/)).toBeNull();
});

test('SCR-02 empty-description: показує підказку, коли Опис ще не заповнено', async () => {
  const data: CardFaceData = { name: 'Спорт', description: null, dataWarning: null, trackingMode: 'goals', healthState: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  expect(await screen.findByText('Опис ще не заповнено')).toBeTruthy();
});

test('SCR-02 warning: показує Banner, коли агент позначив дані підозрілими (AC-10)', async () => {
  const data: CardFaceData = {
    name: 'Спорт',
    description: 'Регулярні тренування',
    dataWarning: 'Щось на цій картці виглядає некоректно — розберемось разом?',
    trackingMode: 'goals',
    healthState: null,
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

// CH-02 (docs/features/life-area-card/changes.md): "картка: стан без
// вимірювань" -- м'ячик стану у правому верхньому кутку картки, той самий
// патерн (chip-gloss), що EntryHistoryList.tsx's STATUS_DOT.

test('CH-02: metrics-картка не показує жодного м\'ячика стану', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  await screen.findByText('Спорт');
  expect(screen.queryByLabelText(/Стан картки/)).toBeNull();
});

test.each([
  ['active', 'використовується'],
  ['critical', 'критично потребує відновлення'],
  ['paused', 'на паузі'],
] as const)('CH-02: healthState=%s показує м\'ячик з підписом "%s"', async (healthState, label) => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'state', healthState };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  expect(await screen.findByLabelText(`Стан картки: ${label}`)).toBeTruthy();
});

test('SCR-02: клік "перегорнути" викликає onFlip', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  const onFlip = vi.fn();
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={onFlip} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));

  expect(onFlip).toHaveBeenCalledTimes(1);
});

// CH-05/CH-06 (docs/features/life-area-card/changes.md) -- стан "editing":
// меню "..." -> "Редагувати" (або клік на Назву/Опис) -> ОДНА спільна форма
// (Назва + Опис) -> "На зад" (відкидає) / "Зберегти" (зберігає обидва поля).

test('CH-06 editing: меню "..." -> "Редагувати" показує форму з поточними Назвою і Описом', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} onUpdateDescription={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }));

  expect((screen.getByLabelText('Назва') as HTMLInputElement).value).toBe('Спорт');
  expect((screen.getByLabelText('Опис (навіщо)') as HTMLInputElement).value).toBe('опис');
  // У стані "editing" статичний заголовок, олівчик-текст Опису й "перегорнути" не рендеряться.
  expect(screen.queryByRole('heading', { name: 'Спорт' })).toBeNull();
  expect(screen.queryByText('опис')).toBeNull();
  expect(screen.queryByRole('button', { name: /перегорнути/ })).toBeNull();
});

test('CH-06 editing: без onUpdateDescription форма показує лише Назву', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }));

  expect(screen.getByLabelText('Назва')).toBeTruthy();
  expect(screen.queryByLabelText('Опис (навіщо)')).toBeNull();
  // Без onUpdateDescription клік по Опису теж нічого не відкриває (перевірено окремим тестом нижче).
});

// code-review 2026-09-21 (correctness): раніше onUpdateDescription летів
// НАВІТЬ коли Опис не чіпали (лише Назву) -- зайвий запит, і `null` ("опис
// ще не заповнений") мовчки перетворювався на порожній рядок.
test('code-review: збереження лише Назви (Опис не чіпали) НЕ викликає onUpdateDescription', async () => {
  const data: CardFaceData = { name: 'Спорт', description: null, dataWarning: null, trackingMode: 'goals', healthState: null };
  const onRename = vi.fn().mockResolvedValue(undefined);
  const onUpdateDescription = vi.fn().mockResolvedValue(undefined);
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={onRename}
      onArchive={vi.fn()}
      onArchived={vi.fn()}
      onUpdateDescription={onUpdateDescription}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт і здоров’я' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  await vi.waitFor(() => expect(onRename).toHaveBeenCalledWith('Спорт і здоров’я'));
  expect(onUpdateDescription).not.toHaveBeenCalled();
});

test('CH-06 editing: "Зберегти" викликає onRename і onUpdateDescription({description, markFilled: true}) для непорожнього тексту', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'старий опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  const onRename = vi.fn().mockResolvedValue(undefined);
  const onUpdateDescription = vi.fn().mockResolvedValue(undefined);
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={onRename}
      onArchive={vi.fn()}
      onArchived={vi.fn()}
      onUpdateDescription={onUpdateDescription}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт і здоров’я' } });
  fireEvent.change(screen.getByLabelText('Опис (навіщо)'), { target: { value: 'новий опис' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(onRename).toHaveBeenCalledWith('Спорт і здоров’я');
  await vi.waitFor(() => expect(onUpdateDescription).toHaveBeenCalledWith({ description: 'новий опис', markFilled: true }));
  expect(await screen.findByText('Спорт і здоров’я')).toBeTruthy();
  expect(await screen.findByText('новий опис')).toBeTruthy();
  expect(screen.queryByLabelText('Назва')).toBeNull();
});

test('CH-06 editing: збережений порожній Опис -- markFilled: false (заповненість похідна від тексту, не окремий чекбокс)', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'старий опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  const onUpdateDescription = vi.fn().mockResolvedValue(undefined);
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={vi.fn().mockResolvedValue(undefined)}
      onArchive={vi.fn()}
      onArchived={vi.fn()}
      onUpdateDescription={onUpdateDescription}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }));
  fireEvent.change(screen.getByLabelText('Опис (навіщо)'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  await vi.waitFor(() => expect(onUpdateDescription).toHaveBeenCalledWith({ description: '', markFilled: false }));
});

test('CH-06 editing: "На зад" відкидає чернетку без виклику onRename/onUpdateDescription', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  const onRename = vi.fn();
  const onUpdateDescription = vi.fn();
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={onRename}
      onArchive={vi.fn()}
      onArchived={vi.fn()}
      onUpdateDescription={onUpdateDescription}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Чернетка, яку відкинуть' } });
  fireEvent.click(screen.getByRole('button', { name: 'На зад' }));

  expect(onRename).not.toHaveBeenCalled();
  expect(onUpdateDescription).not.toHaveBeenCalled();
  expect(await screen.findByText('Спорт')).toBeTruthy();
  expect(screen.queryByLabelText('Назва')).toBeNull();
});

test('CH-06 review-fix: onRename ОК, onUpdateDescription reject -- назва все одно застосована (не загублена)', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'старий опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  const onRename = vi.fn().mockResolvedValue(undefined);
  const onUpdateDescription = vi.fn().mockRejectedValue(new Error('Мережа недоступна'));
  render(
    <CardFace
      loadCard={() => Promise.resolve(data)}
      onFlip={vi.fn()}
      onRename={onRename}
      onArchive={vi.fn()}
      onArchived={vi.fn()}
      onUpdateDescription={onUpdateDescription}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт і здоров’я' } });
  // code-review 2026-09-21: descriptionChanged-guard тепер пропускає виклик
  // onUpdateDescription, коли Опис не чіпали -- щоб цей тест і далі
  // перевіряв "reject опису не губить уже застосоване перейменування",
  // Опис тут теж міняємо, інакше мок reject ніколи не спрацював би.
  fireEvent.change(screen.getByLabelText('Опис (навіщо)'), { target: { value: 'новий опис' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  const banner = await screen.findByText('Мережа недоступна');
  expect(banner.getAttribute('data-variant')).toBe('error');
  // Форма лишається відкритою (є що виправити) -- але "На зад" тепер
  // повертає до вже РЕАЛЬНО перейменованої картки, не до старої назви.
  fireEvent.click(screen.getByRole('button', { name: 'На зад' }));
  expect(await screen.findByText('Спорт і здоров’я')).toBeTruthy();
});

test('CH-06 editing error: відхилений onRename показує Banner і лишає форму відкритою', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  const onRename = vi.fn().mockRejectedValue(new Error('network down'));
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={onRename} onArchive={vi.fn()} onArchived={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Нова назва' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  const banner = await screen.findByText('network down');
  expect(banner.getAttribute('data-variant')).toBe('error');
  expect(screen.getByLabelText('Назва')).toBeTruthy();
});

test('CH-05 editing: торкання самої назви теж запускає редагування (другий шлях входу)', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  fireEvent.click(await screen.findByRole('heading', { name: 'Спорт' }));

  const nameField = screen.getByLabelText('Назва') as HTMLInputElement;
  expect(nameField.value).toBe('Спорт');
});

test('CH-06 editing: торкання Опису теж запускає редагування, лише коли є onUpdateDescription', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
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

  expect(screen.getByLabelText('Опис (навіщо)')).toBeTruthy();
});

test('CH-06: без onUpdateDescription клік по Опису нічого не відкриває', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  fireEvent.click(await screen.findByText('опис'));

  expect(screen.queryByLabelText('Опис (навіщо)')).toBeNull();
});

// ISS-56 (docs/ISSUES.md): другий пункт меню "..." -> "Архівувати" --
// відкриває ArchiveCardDialog (T29, SCR-06), уже написаний і протестований
// ІЗОЛЬОВАНО (ArchiveCardDialog.test.tsx) зі своїм фіксованим контрактом
// (cardName/onArchive/onCancel) -- тут перевіряємо лише інтеграцію: пункт
// меню відкриває діалог з правильною cardName, підтвердження викликає
// injected CardFace.onArchive і, після його резолву, injected onArchived
// (новий проп -- сигнал батькові "картку архівовано, є куди піти").

test('ISS-56 SCR-02 archive: меню "..." -> "Архівувати" показує ArchiveCardDialog з назвою картки', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
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
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
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
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
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

test('SCR-02: відкрите меню/чернетка редагування скидаються, коли loadCard проп змінився (нова картка)', async () => {
  const first: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  const second: CardFaceData = { name: 'Навчання', description: 'опис 2', dataWarning: null, trackingMode: 'goals', healthState: null };

  const { rerender } = render(<CardFace loadCard={() => Promise.resolve(first)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  fireEvent.click(await screen.findByRole('heading', { name: 'Спорт' }));
  expect(screen.getByLabelText('Назва')).toBeTruthy();

  rerender(<CardFace loadCard={() => Promise.resolve(second)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  // Нова картка -- стара чернетка/режим редагування не мають лишитись поверх неї.
  expect(await screen.findByRole('heading', { name: 'Навчання' })).toBeTruthy();
  expect(screen.queryByLabelText('Назва')).toBeNull();
});

// code-review 2026-09-21 (conventions): click-outside-close -- той самий
// підхід, що вже є на шестерні верхнього бару (App.tsx) і на звороті картки
// (CardBack.tsx); раніше цього меню тут не мало жодного способу закритись,
// крім повторного кліку на "...".
test('code-review: клік поза меню "..." закриває його', async () => {
  const data: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'goals', healthState: null };
  render(<CardFace loadCard={() => Promise.resolve(data)} onFlip={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onArchived={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  expect(screen.getByRole('menuitem', { name: 'Редагувати' })).toBeTruthy();

  fireEvent.mouseDown(document.body);

  expect(screen.queryByRole('menuitem', { name: 'Редагувати' })).toBeNull();
});
