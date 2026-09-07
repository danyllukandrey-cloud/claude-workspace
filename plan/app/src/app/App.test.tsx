// RED (ISS-52, ADR-0006 "### Фронтенд (ISS-52)", крок 1): app-shell гілкування
// LoginScreen / DeckScreen залежно від наявності й валідності JWT у сховищі.
//
// Архітектурний вибір (звіт test-author): виніс гілкування з main.tsx у
// окремий тестований компонент App.tsx (main.tsx лишиться тонким composition
// root -- createRoot(...).render(<App ... />), як і зараз, тільки App
// перестане бути приватною функцією файлу). Причина: main.tsx імпортує
// createRoot і монтує в реальний #root -- тестувати гілкування напряму на
// ньому означає або рендерити повз jsdom #root, або тягнути побічні ефекти
// модуля (document.getElementById) в кожен тест. Окремий експортований
// компонент -- той самий підхід, що DeckScreen: чистий React-компонент з
// ін'єктованими залежностями, без побічних ефектів на рівні модуля.
//
// DI-форма (рішення test-author): я НЕ використав StoragePort
// (src/shared/storage/port.ts) буквально -- той порт описаний для доменних
// даних картки (read/write/remove за довільним ключем) і його ще не
// підключено ніде (local.ts -- порожня заглушка). Замість цього -- вузькі
// ін'єктовані функції readStoredSession/writeStoredSession, той самий стиль
// DI, що вже є в проєкті (loadCards, callClaude): App не повинен знати, що це
// саме localStorage['plan.jwt'] -- лише "прочитати/записати поточну сесію".
// Реальна реалізація (майбутня задача) підставить localStorage напряму,
// як і loadCards сьогодні підставляє fetch напряму в main.tsx.
//
// "now" теж ін'єктовано -- порівняння expiresAt з поточним часом інакше
// недетерміноване між прогонами тесту (сьогодні збігається, за рік -- ні).

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';
import type { DeckGridItem, EntryViewModel } from '../cards/life-area-card';

const FIXED_NOW = () => new Date('2026-09-06T12:00:00.000Z');

function baseProps() {
  return {
    readStoredSession: vi.fn().mockReturnValue(null),
    writeStoredSession: vi.fn(),
    // ISS-58: кнопка "Вийти" (DeckScreen.onLogout) стирає сесію -- реальний
    // localStorage.removeItem (main.tsx).
    clearStoredSession: vi.fn(),
    loadCards: vi.fn().mockReturnValue(new Promise<DeckGridItem[]>(() => {})),
    requestSession: vi.fn(),
    renderGoogleButton: vi.fn(),
    now: FIXED_NOW,
    // ISS-55, stage 1/3: ін'єкція реального POST /cards (createCard, main.tsx),
    // яку App викликає з екрана 'create' (CreateCardForm.onCreate).
    createCard: vi.fn(),
    // ISS-55, stage 2/3: відкриття картки з Колоди (CardDetailScreen) --
    // навігація на 'detail' тепер ВНУТРІШНЯ (App сам перемикає screen, той
    // самий стиль, що onCreateCard) -- зовнішній injected `onOpenCard` прибрано
    // з AppProps, замість нього App отримує fetch-функції ЗА cardId, які сам
    // передає в CardDetailScreen, коли перемкнувся на 'detail'.
    loadCard: vi.fn().mockResolvedValue({ name: 'Спорт', description: 'опис', dataWarning: null }),
    loadBack: vi.fn().mockResolvedValue({ metricBlocks: [], aggregateProgress: null, entries: [] }),
    onRename: vi.fn().mockResolvedValue(undefined),
    // ISS-55, stage 3/3: ін'єкція реальних GET /cards?status=archived / POST
    // .../restore / GET .../entries (main.tsx), які App передає в ArchiveScreen
    // (T36) при перемиканні на 'archive'.
    loadArchivedCards: vi.fn().mockReturnValue(new Promise<DeckGridItem[]>(() => {})),
    onRestoreCard: vi.fn().mockResolvedValue(undefined),
    loadArchivedCardHistory: vi.fn().mockResolvedValue([] as EntryViewModel[]),
    // ISS-56 (docs/ISSUES.md): реальний DELETE /cards/{cardId} (main.tsx),
    // яку App замикає над cardId (той самий стиль, що loadCard/loadBack/onRename).
    archiveCard: vi.fn().mockResolvedValue(undefined),
    // ISS-60 (docs/ISSUES.md): реальний POST /cards/{id}/metric-blocks
    // (main.tsx) -- App замикає над cardId, той самий стиль, що onRename.
    createMetricBlock: vi.fn().mockResolvedValue(undefined),
    // D-110 (docs/DECISIONS.md, ТИМЧАСОВЕ): реальний POST
    // /cards/{cardId}/metric-blocks/{metricBlockId}/entries (main.tsx) --
    // App замикає над cardId, лишає metricBlockId параметром (CardBack сам
    // замикає над block.id для кожної плитки).
    addEntry: vi.fn().mockResolvedValue(undefined),
    // Review C10 (AC-03): реальний PATCH /cards/{cardId} (description/markFilled,
    // main.tsx) -- App замикає над cardId, той самий стиль, що onRename.
    onUpdateDescription: vi.fn().mockResolvedValue(undefined),
  };
}

function validSessionProps() {
  const props = baseProps();
  props.readStoredSession.mockReturnValue({
    token: 'valid.jwt.token',
    expiresAt: '2026-09-10T00:00:00.000Z', // після FIXED_NOW (2026-09-06)
  });
  return props;
}

test('без токена в сховищі рендерить LoginScreen (монтує GIS-кнопку), не DeckScreen', () => {
  const props = baseProps();
  props.readStoredSession.mockReturnValue(null);

  render(<App {...props} />);

  // LoginScreen -- єдиний, хто монтує GIS-кнопку; DeckScreen -- єдиний, хто
  // викликає loadCards. Перевіряємо через ці контракти, а не текст, щоб не
  // прив'язуватись до верстки жодного з екранів.
  expect(props.renderGoogleButton).toHaveBeenCalledTimes(1);
  expect(props.loadCards).not.toHaveBeenCalled();
});

test('з протермінованим токеном (expiresAt у минулому) рендерить LoginScreen, не DeckScreen', () => {
  const props = baseProps();
  props.readStoredSession.mockReturnValue({
    token: 'expired.jwt.token',
    expiresAt: '2026-09-01T00:00:00.000Z', // до FIXED_NOW (2026-09-06)
  });

  render(<App {...props} />);

  expect(props.renderGoogleButton).toHaveBeenCalledTimes(1);
  expect(props.loadCards).not.toHaveBeenCalled();
});

test('з валідним (не протермінованим) токеном рендерить DeckScreen, не LoginScreen', () => {
  const props = baseProps();
  props.readStoredSession.mockReturnValue({
    token: 'valid.jwt.token',
    expiresAt: '2026-09-10T00:00:00.000Z', // після FIXED_NOW (2026-09-06)
  });

  render(<App {...props} />);

  expect(props.loadCards).toHaveBeenCalledTimes(1);
  expect(props.renderGoogleButton).not.toHaveBeenCalled();
});

test('успішний обмін credential у LoginScreen пише сесію в сховище і перемикає рендер на DeckScreen (ADR-0006, крок 3)', async () => {
  const props = baseProps();
  props.readStoredSession.mockReturnValue(null);

  const sessionResult = {
    token: 'signed.jwt.token',
    expiresAt: '2026-09-07T00:00:00.000Z',
    user: { id: 'app-user-1', email: 'andrii@example.com' },
  };
  props.requestSession.mockResolvedValue(sessionResult);

  let capturedOnCredential: ((credential: string) => void) | undefined;
  props.renderGoogleButton.mockImplementation((_container: HTMLElement, onCredential: (credential: string) => void) => {
    capturedOnCredential = onCredential;
  });

  render(<App {...props} />);

  expect(props.renderGoogleButton).toHaveBeenCalledTimes(1);
  capturedOnCredential?.('fake-google-id-token');

  // Після успішного обміну -- сесія (token+expiresAt, той самий формат, що
  // читає readStoredSession) пишеться в сховище, і екран перемикається.
  await screen.findByRole('status'); // Spinner DeckScreen -- loadCards ще не резолвнувся (pending Promise з baseProps).

  expect(props.writeStoredSession).toHaveBeenCalledWith({
    token: sessionResult.token,
    expiresAt: sessionResult.expiresAt,
  });
  expect(props.loadCards).toHaveBeenCalledTimes(1);
});

// ISS-55 (RED, stage 1/3): App.tsx отримує третій екран 'create' -- клік на
// кнопку "+ Створити картку" (DeckScreen.onCreateCard, щойно доданий проп)
// перемикає рендер із DeckScreen на CreateCardForm; успішне збереження
// викликає ін'єктований createCard і повертає назад на 'deck' з повторним
// GET /cards (loadCards має бути викликаний ще раз -- DeckScreen.loadCards'
// референційна стабільність, docs у DeckScreen.tsx).

test('ISS-55: клік "+ Створити картку" в Колоді перемикає екран на форму створення картки', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);

  const createButton = await screen.findByRole('button', { name: '+ Створити картку' });
  fireEvent.click(createButton);

  // CreateCardForm (T27) -- єдиний, хто рендерить поле "Назва" з написом
  // "Нова картка"; DeckScreen більше не повинен бути на екрані.
  expect(await screen.findByRole('heading', { name: 'Нова картка' })).toBeTruthy();
  expect(screen.queryByText('Спорт')).toBeNull();
});

test('ISS-55: успішне створення картки викликає injected createCard і повертає до Колоди з повторним завантаженням', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);
  props.createCard.mockResolvedValue(undefined);

  render(<App {...props} />);

  const createButton = await screen.findByRole('button', { name: '+ Створити картку' });
  fireEvent.click(createButton);

  const nameField = await screen.findByLabelText('Назва');
  fireEvent.change(nameField, { target: { value: 'Спорт' } });
  fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

  // Повернення на 'deck' -- EmptyState знову видимий (loadCards резолвнувся
  // порожнім масивом і вдруге).
  expect(await screen.findByText('Тут ще немає жодної картки')).toBeTruthy();

  expect(props.createCard).toHaveBeenCalledWith({ name: 'Спорт' });
  expect(props.loadCards).toHaveBeenCalledTimes(2);
});

// ISS-55, stage 2/3 (RED): клік на тайл картки в Колоді (DeckGrid, T25)
// відкриває CardDetailScreen (композиція CardFace/CardBack, ще не написана --
// див. CardDetailScreen.test.tsx). App сам перемикає внутрішній screen на
// 'detail' з обраним cardId (той самий стиль, що onCreateCard) і передає в
// CardDetailScreen ін'єктовані loadCard/loadBack/onRename, ЗВ'ЯЗАНІ з cardId
// тайла, що відкрили -- саме тому props.loadCard/loadBack не приймають
// аргументів (CardFace/CardBack фіксований контракт), а App сам створює
// замикання над cardId при передачі.

test('ISS-55 stage 2: клік на тайл картки в Колоді відкриває деталі картки (CardDetailScreen)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Спорт' }));

  // CardFace (T26) -- єдиний, хто рендерить назву картки як <h2>; DeckGrid
  // більше не на екрані (кнопка "+ Створити картку" -- DeckScreen-специфічна).
  expect(await screen.findByRole('heading', { name: 'Спорт' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '+ Створити картку' })).toBeNull();
  expect(props.loadCard).toHaveBeenCalledTimes(1);
});

test('ISS-55 stage 2: кнопка "← Назад" у деталях картки повертає на Колоду з повторним завантаженням', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Спорт' }));
  await screen.findByRole('heading', { name: 'Спорт' });

  fireEvent.click(screen.getByRole('button', { name: '← Назад' }));

  // Повернення на 'deck' -- тайл картки знову видимий як кнопка DeckGrid.
  expect(await screen.findByRole('button', { name: 'Спорт' })).toBeTruthy();
  expect(props.loadCards).toHaveBeenCalledTimes(2);
});

test('ISS-55 stage 2: перейменування картки в деталях викликає injected onRename(cardId, назва)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Спорт' }));
  fireEvent.click(await screen.findByRole('heading', { name: 'Спорт' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт і здоров’я' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  // onRename в AppProps приймає (cardId, name) -- App сам звужує до
  // CardDetailScreen-контракту (name: string) => Promise<void> через замикання.
  expect(props.onRename).toHaveBeenCalledWith('card-1', 'Спорт і здоров’я');
});

// ISS-55, stage 3/3 (RED): App.tsx отримує четвертий екран 'archive' -- клік
// на кнопку "Архів" у Колоді (DeckScreen.onOpenArchive, щойно доданий проп)
// перемикає рендер на ArchiveScreen (T36, SCR-07), вже написаний і
// протестований ізольовано, але досі нічим не досяжний з App. Обгортаю
// ArchiveScreen тонкою "← Назад" кнопкою прямо в App.tsx (той самий вибір,
// що CardDetailScreen у stage 2) -- ArchiveScreen сам не має кнопки назад
// (фіксований контракт T36), і окремий файл-обгортка був би зайвим для
// одного <button> з тим самим текстом "← Назад", що вже використовує деталі
// картки. Повернення на 'deck' повторно викликає loadCards (той самий стиль
// ремаунту, що onBack у CardDetailScreen).

test('ISS-55 stage 3: клік "Архів" у Колоді перемикає екран на ArchiveScreen', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);
  props.loadArchivedCards.mockResolvedValue([{ id: 'card-2', name: 'Читання' }]);

  render(<App {...props} />);

  const archiveButton = await screen.findByRole('button', { name: 'Архів' });
  fireEvent.click(archiveButton);

  // ArchiveScreen (T36) рендерить архівовані тайли через DeckGrid -- "Читання"
  // видиме, тоді як активна картка "Спорт" (Колода) більше не на екрані.
  expect(await screen.findByText('Читання')).toBeTruthy();
  expect(screen.queryByText('Спорт')).toBeNull();
  expect(props.loadArchivedCards).toHaveBeenCalledTimes(1);
});

test('ISS-55 stage 3: кнопка "← Назад" в Архіві повертає на Колоду з повторним завантаженням', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);
  props.loadArchivedCards.mockResolvedValue([]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Архів' }));
  await screen.findByText('Архів порожній');

  fireEvent.click(screen.getByRole('button', { name: '← Назад' }));

  // Повернення на 'deck' -- тайл активної картки знову видимий, loadCards
  // викликано вдруге (перший раз при первинному монтуванні Колоди).
  expect(await screen.findByRole('button', { name: 'Спорт' })).toBeTruthy();
  expect(props.loadCards).toHaveBeenCalledTimes(2);
});

test('ISS-55 stage 3: розархівування картки в Архіві викликає injected onRestoreCard(cardId)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);
  props.loadArchivedCards.mockResolvedValue([{ id: 'card-2', name: 'Читання' }]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Архів' }));
  fireEvent.click(await screen.findByText('Читання'));
  fireEvent.click(await screen.findByRole('button', { name: 'Розархівувати' }));

  expect(props.onRestoreCard).toHaveBeenCalledWith('card-2');
});

// ISS-56 (RED, docs/ISSUES.md): CardFace отримав "Архівувати" в меню "..." ->
// ArchiveCardDialog (T29) -> injected AppProps.archiveCard(cardId) (DELETE
// /cards/{cardId}, main.tsx) -> після успіху екран повертається на 'deck' з
// повторним loadCards (та сама "ремаунт перезавантажує" ідіома, що onBack).

test('ISS-56: архівування картки в деталях викликає injected archiveCard(cardId) і повертає до Колоди з повторним завантаженням', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Спорт' }));
  await screen.findByRole('heading', { name: 'Спорт' });

  fireEvent.click(screen.getByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Архівувати' }));
  fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }));

  expect(props.archiveCard).toHaveBeenCalledWith('card-1');

  // Повернення на 'deck' -- тайл картки знову видимий, loadCards викликано
  // вдруге (перший раз при первинному відкритті Колоди).
  expect(await screen.findByRole('button', { name: 'Спорт' })).toBeTruthy();
  expect(props.loadCards).toHaveBeenCalledTimes(2);
});

// ISS-60/D-110 (RED, docs/ISSUES.md): App замикає createMetricBlock/addEntry
// над cardId обраної картки й передає в CardDetailScreen -> CardBack (той
// самий стиль, що onRename/loadCard/loadBack вище). addEntry лишається
// параметризованим metricBlockId -- CardBack сам замикає над block.id
// на рівні кожної плитки (MetricBlockCard), тому тут App лише прокидає
// (cardId, metricBlockId, amount) => addEntry(cardId, metricBlockId, amount).

test('ISS-60: створення блоку-метрики в деталях картки викликає injected createMetricBlock(cardId, values)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);
  props.loadBack.mockResolvedValue({ metricBlocks: [], aggregateProgress: null, entries: [] });

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Спорт' }));
  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  await screen.findByText('Ще немає жодної активної метрики');

  fireEvent.click(screen.getByRole('button', { name: '+ Додати блок-метрику' }));
  fireEvent.change(screen.getByLabelText('Що рахуємо:'), { target: { value: 'Тренування' } });
  fireEvent.change(screen.getByLabelText('Одиниця:'), { target: { value: 'раз' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(props.createMetricBlock).toHaveBeenCalledWith('card-1', {
    label: 'Тренування',
    unit: 'раз',
    targetCount: null,
    isOngoing: false,
    targetDate: null,
  });
});

test('D-110: тимчасова кнопка "+" на блоці-метриці викликає injected addEntry(cardId, metricBlockId, amount)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);
  props.loadBack.mockResolvedValue({
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
  });

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Спорт' }));
  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  await screen.findByText(/Тренування: 50%/);

  fireEvent.click(screen.getByRole('button', { name: '+' }));
  fireEvent.change(screen.getByLabelText('Кількість'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

  expect(props.addEntry).toHaveBeenCalledWith('card-1', 'mb1', 2);
});

test('ISS-58: клік "Вийти" в Колоді стирає сесію і повертає на LoginScreen', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Вийти' }));

  expect(props.clearStoredSession).toHaveBeenCalledTimes(1);
  // Той самий контракт, що тест "без токена в сховищі" вище -- LoginScreen
  // єдиний, хто монтує GIS-кнопку; DeckScreen більше не на екрані.
  await waitFor(() => expect(props.renderGoogleButton).toHaveBeenCalledTimes(1));
});
