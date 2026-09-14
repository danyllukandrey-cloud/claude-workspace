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
import type {
  AccountScreenResource,
  ChatMessage,
  ChatProposal,
  ReportViewModel,
  RuleSettingsScreenRule,
  RuleSettingsScreenTargetCard,
} from '../agent';
import { AppError } from '../shared/errors';

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
    // Review C10 (AC-03): реальний PATCH /cards/{cardId} (description/markFilled,
    // main.tsx) -- App замикає над cardId, той самий стиль, що onRename.
    onUpdateDescription: vi.fn().mockResolvedValue(undefined),
    // Review 2026-09-07 A4/C11 (T47): реальний PATCH /entries/{entryId} +
    // повторний loadBack (main.tsx) -- App замикає над cardId, той самий
    // стиль, що onRename; повертає СВІЖИЙ CardBackData (як CardBack.onFlagEntry
    // сам вимагає), не Promise<void>.
    onFlagEntry: vi.fn().mockResolvedValue({ metricBlocks: [], aggregateProgress: null, entries: [] }),
    // T24 (RED, sad.md §5 "Навігація -- чотири напрямки"): реєстрація
    // Структури в app-shell -- App.tsx ще НЕ приймає ці пропи, це і є
    // навмисний "не існує такий проп" RED цього тесту. Назви й форма
    // повністю узгоджені з реальними пропами вже написаних
    // structure/ui/DeclarationScreen.tsx (loadStructure/onSave),
    // structure/ui/LayoutBoard.tsx (loadLayout/onMoveCard) і
    // structure/ui/AnalyticsScreen.tsx (loadAnalytics) -- App лише
    // прокидає їх без змін (той самий DI-стиль, що loadCards).
    loadStructure: vi.fn().mockResolvedValue({ declaration: null, layoutMode: null, logicVariant: null, hasArrangedCards: false }),
    onSaveDeclaration: vi.fn().mockResolvedValue(undefined),
    loadLayout: vi.fn().mockResolvedValue({ cellCount: 0, justReset: false, cards: [] }),
    onMoveCard: vi.fn().mockResolvedValue(undefined),
    loadAnalytics: vi.fn().mockResolvedValue({ layoutMode: null, average: null, excludedCount: 0, trendAvailable: true, cards: [] }),
    // Review-fix 2026-09-11 (verify): LayoutBoard.loadCloseCardOptions/onCloseCard
    // уже написані й протестовані (SCR-04), main.tsx їх уже експортує -- але App
    // їх не приймав і не прокидав, тож LayoutBoard.canCloseCard завжди false і
    // кнопка "Закрити напрямок" (AC-12) ніде не з'являлась. Той самий DI-стиль,
    // що loadLayout/onMoveCard вище.
    loadCloseCardOptions: vi.fn().mockResolvedValue({ metricBlocks: [], targetCards: [] }),
    onCloseCard: vi.fn().mockResolvedValue(undefined),
    // D-121: ChatPanel монтується ЗАВЖДИ (постійна, поза перемикачем
    // direction) -- тож ці три мають резолвитись одразу (не pending Promise)
    // у КОЖНОМУ тесті, не лише тих, що самі про Чат, інакше кожен тест
    // застрягає на фоновому Spinner всередині панелі.
    loadChatHistory: vi.fn().mockResolvedValue([] as ChatMessage[]),
    loadChatOnboarding: vi.fn().mockResolvedValue({ welcomeShown: true, message: null }),
    loadActiveChatProposal: vi.fn().mockResolvedValue(null as ChatProposal | null),
    sendChatMessage: vi.fn(),
    confirmChatProposal: vi.fn(),
    loadRuleTargetCards: vi.fn().mockResolvedValue([] as RuleSettingsScreenTargetCard[]),
    loadRules: vi.fn().mockResolvedValue([] as RuleSettingsScreenRule[]),
    onSaveRule: vi.fn(),
    loadReports: vi.fn().mockResolvedValue([] as ReportViewModel[]),
    loadSyncResources: vi.fn().mockResolvedValue([] as AccountScreenResource[]),
    onAddSyncResource: vi.fn(),
    onRemoveSyncResource: vi.fn(),
    onDeleteAccount: vi.fn(),
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

test('з валідним (не протермінованим) токеном рендерить нав-меню застосунку (не LoginScreen)', async () => {
  const props = baseProps();
  props.readStoredSession.mockReturnValue({
    token: 'valid.jwt.token',
    expiresAt: '2026-09-10T00:00:00.000Z', // після FIXED_NOW (2026-09-06)
  });

  render(<App {...props} />);

  // D-121: дефолтний напрямок контентної зони -- Картки (Чат більше не
  // напрямок, він постійна ChatPanel поза цим перемикачем) -- loadCards
  // викликається одразу при вході, без кліку.
  expect(props.renderGoogleButton).not.toHaveBeenCalled();
  await waitFor(() => expect(props.loadCards).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('button', { name: 'Картки' })).toBeTruthy();
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
  // читає readStoredSession) пишеться в сховище, і екран перемикається на
  // нав-меню застосунку (D-121: дефолтний напрямок -- Картки, тож loadCards
  // викликається одразу, без кліку).
  expect(await screen.findByRole('button', { name: 'Картки' })).toBeTruthy();
  await waitFor(() => expect(props.loadCards).toHaveBeenCalledTimes(1));

  expect(props.writeStoredSession).toHaveBeenCalledWith({
    token: sessionResult.token,
    expiresAt: sessionResult.expiresAt,
  });
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
  // D-121: дефолтний напрямок -- уже Картки, окремий клік не потрібен.

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
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

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
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Спорт' }));

  // CardFace (T26) -- єдиний, хто рендерить назву картки як <h2>; DeckGrid
  // більше не на екрані (кнопка "+ Створити картку" -- DeckScreen-специфічна).
  expect(await screen.findByRole('heading', { name: 'Спорт' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '+ Створити картку' })).toBeNull();
  expect(props.loadCard).toHaveBeenCalledTimes(1);
});

// Review 2026-09-07 E (RED, T52): "loadCard/loadBack порушують задокументований
// контракт референційної стабільності" -- App.tsx передавав CardDetailScreen
// НОВУ лямбду `() => loadCard(screen.cardId)` щорендера (той самий баг, що
// DeckScreen.loadCards уже документує НЕ мати -- див. коментар у
// DeckScreen.tsx "Контракт: має бути референційно стабільною"). CardFace/
// CardBack перезапускають свій useEffect(..., [loadCard]) на КОЖНУ зміну
// посилання -- нестабільна функція означає повторний непотрібний запит
// щоразу, як App перерендериться з будь-якої іншої причини.

// Review 2026-09-07, post-ship follow-up review (E remainder): onSessionExpired
// -- інлайн-лямбда прямо в JSX (як і onLogout) -- перестворювалась щорендера
// App, а onSessionExpired водночас є залежністю ефекту DeckScreen (T48) --
// той самий баг, що loadCard/loadBack мали до T52's useCallback-фіксу.

test('review-followup: onSessionExpired передається в DeckScreen референційно стабільним -- повторний рендер App НЕ викликає loadCards знову', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  const { rerender } = render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  await screen.findByText('Спорт');
  expect(props.loadCards).toHaveBeenCalledTimes(1);

  rerender(<App {...props} />);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(props.loadCards).toHaveBeenCalledTimes(1);
});

test('T52: loadCard передається в CardDetailScreen референційно стабільним -- повторний рендер App без навігації НЕ викликає його знову', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  const { rerender } = render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Спорт' }));
  await screen.findByRole('heading', { name: 'Спорт' });
  expect(props.loadCard).toHaveBeenCalledTimes(1);

  // Той самий App, ті самі пропи -- НЕ навігація, просто повторний рендер
  // (той самий стимул, що спричинив би React перерендерити App з будь-якої
  // ІНШОЇ причини -- наприклад, оновлення в іншій частині дерева пропів).
  rerender(<App {...props} />);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(props.loadCard).toHaveBeenCalledTimes(1);
});

test('ISS-55 stage 2: кнопка "← Назад" у деталях картки повертає на Колоду з повторним завантаженням', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

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
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Спорт' }));
  fireEvent.click(await screen.findByRole('heading', { name: 'Спорт' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт і здоров’я' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  // onRename в AppProps приймає (cardId, name) -- App сам звужує до
  // CardDetailScreen-контракту (name: string) => Promise<void> через замикання.
  expect(props.onRename).toHaveBeenCalledWith('card-1', 'Спорт і здоров’я');
});

// Review 2026-09-07 C11 (RED, docs/features/life-area-card/_review/review-2026-09-07.md,
// AC-12): кнопка "виправити" в історії записів раніше нікуди не була
// підключена від App.tsx -- клік нічого не робив. AppProps отримує новий
// injected onFlagEntry(cardId, entryId), App замикає над cardId (той самий
// стиль, що onRename) і прокидає в CardDetailScreen -> CardBack без змін.

test('C11/AC-12: клік "виправити" в історії записів викликає injected onFlagEntry(cardId, entryId)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);
  props.loadBack.mockResolvedValue({
    metricBlocks: [],
    aggregateProgress: null,
    entries: [
      { id: 'entry-1', metricBlockId: 'mb1', amount: 2, status: 'confirmed', recordedAtLabel: '07.09', summary: '+2 раз' },
    ],
  });

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Спорт' }));
  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Історія записів/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'виправити' }));

  expect(props.onFlagEntry).toHaveBeenCalledWith('card-1', 'entry-1');
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
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

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
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

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
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

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
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

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

// ISS-60 (RED, docs/ISSUES.md): App замикає createMetricBlock над cardId
// обраної картки й передає в CardDetailScreen -> CardBack (той самий стиль,
// що onRename/loadCard/loadBack вище).

test('ISS-60: створення блоку-метрики в деталях картки викликає injected createMetricBlock(cardId, values)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);
  props.loadBack.mockResolvedValue({ metricBlocks: [], aggregateProgress: null, entries: [] });

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

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

test('ISS-58: клік "Вийти" в Колоді стирає сесію і повертає на LoginScreen', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Вийти' }));

  expect(props.clearStoredSession).toHaveBeenCalledTimes(1);
  // Той самий контракт, що тест "без токена в сховищі" вище -- LoginScreen
  // єдиний, хто монтує GIS-кнопку; DeckScreen більше не на екрані.
  await waitFor(() => expect(props.renderGoogleButton).toHaveBeenCalledTimes(1));
});

// Review 2026-09-07 C14 (RED, AC-04): DeckScreen.onSessionExpired -- App
// підключає його рівно так само, як внутрішній onLogout DeckScreen уже
// робить (clearStoredSession + setSession(null)) -- 401 при завантаженні
// колоди має привести до того самого LoginScreen, не до глухого банера.

test('C14/AC-04: 401 (AppError, httpStatus 401) з loadCards стирає сесію і повертає на LoginScreen', async () => {
  const props = validSessionProps();
  props.loadCards.mockRejectedValue(new AppError('auth.invalid_token', 'Сесія протермінована', 401));

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  await waitFor(() => expect(props.clearStoredSession).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(props.renderGoogleButton).toHaveBeenCalledTimes(1));
});

// T24 (RED, sad.md §5 "Building block view" -- "Навігація (чотири напрямки,
// узгоджено з Андрієм): 1. Декларація 2. Схема 3. Літопис-Аналітика
// 4. Картки"): App.tsx досі має ОДНУ state machine екрана
// (deck/create/detail/archive, App.tsx рядок 65) БЕЗ жодного постійного
// нижнього нав-меню -- ці чотири напрямки взагалі не існують. DoD T24:
// "App boots with 3 Structure nav tabs reachable from the bottom menu".
//
// Мінімальна форма перевірки: бачимо всі 4 підписи одразу після входу
// (DeckScreen -- дефолтний напрямок "Картки"), клік на кожен новий Structure-
// напрямок викликає відповідну ін'єктовану loadXxx-функцію і показує щось
// специфічне для того екрана (текст/поле, унікальне для DeclarationScreen /
// LayoutBoard / AnalyticsScreen), клік на "Картки" повертає на DeckScreen.

test('T24: після входу видно нижнє нав-меню з 4 пунктами (Декларація/Схема/Літопис-Аналітика/Картки)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);

  render(<App {...props} />);
  // D-121: дефолтний напрямок -- знову Картки (Чат більше не "напрямок").

  await screen.findByText('Тут ще немає жодної картки');

  expect(await screen.findByRole('button', { name: 'Декларація' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Схема' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Літопис-Аналітика' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Картки' })).toBeTruthy();
});

test('T24: клік "Декларація" в нав-меню перемикає екран на DeclarationScreen (loadStructure)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Декларація' }));

  // DeclarationScreen.tsx -- унікальне поле "Картина світу, навіщо, пріоритет".
  expect(await screen.findByLabelText('Картина світу, навіщо, пріоритет')).toBeTruthy();
  expect(props.loadStructure).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Тут ще немає жодної картки')).toBeNull();
});

test('AC-12 (review-fix 2026-09-11): на Схемі з loadCloseCardOptions/onCloseCard кнопка "Закрити напрямок" реально рендериться', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);
  props.loadLayout.mockResolvedValue({
    cellCount: 4,
    justReset: false,
    cards: [{ cardId: 'card-1', cardTitle: 'Спорт', cellIndex: 0, baseOrder: 0 }],
  });

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Схема' }));

  // LayoutBoard.tsx:124 canCloseCard = loadCloseCardOptions !== undefined && onCloseCard !== undefined --
  // без прокидання цих двох пропів з App.tsx ця кнопка не існує, попри те, що SCR-04 повністю написаний.
  expect(await screen.findByRole('button', { name: 'Закрити напрямок «Спорт»' })).toBeTruthy();
});

test('T24: клік "Схема" в нав-меню перемикає екран на LayoutBoard (loadLayout)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Схема' }));

  // LayoutBoard.tsx з порожнім cards -- EmptyState, унікальний для цього екрана.
  expect(await screen.findByText('Поки що немає жодної картки')).toBeTruthy();
  expect(props.loadLayout).toHaveBeenCalledTimes(1);
});

test('T24: клік "Літопис-Аналітика" в нав-меню перемикає екран на AnalyticsScreen (loadAnalytics)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Літопис-Аналітика' }));

  // AnalyticsScreen.tsx -- унікальний рядок "N картки виключено з середнього".
  expect(await screen.findByText('0 картки виключено з середнього (немає метрики)')).toBeTruthy();
  expect(props.loadAnalytics).toHaveBeenCalledTimes(1);
});

test('T24: клік "Картки" повертає на DeckScreen, під-навігація create/detail/archive лишається робочою', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);
  // D-121: дефолтний напрямок -- уже Картки.
  await screen.findByText('Спорт');

  // Переходимо на інший напрямок і повертаємось -- "Картки" має відновити ту саму DeckScreen-навігацію.
  fireEvent.click(await screen.findByRole('button', { name: 'Схема' }));
  await screen.findByText('Спорт', { exact: false }).catch(() => undefined);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  expect(await screen.findByRole('button', { name: 'Спорт' })).toBeTruthy();

  // Під-навігація "Картки" (create) все ще досяжна під тим самим нав-меню.
  fireEvent.click(await screen.findByRole('button', { name: '+ Створити картку' }));
  expect(await screen.findByRole('heading', { name: 'Нова картка' })).toBeTruthy();
});

// T29 (агент, D-25 "агент -- єдиний канал прямого вводу продукту ПЛАН") --
// той самий self-check дух, що review 2026-09-11 MUST-FIX 4/5 для Структури
// -- ці тести пінять РЕАЛЬНУ досяжність з App, не лише факт, що компонент
// написаний і протестований ізольовано (agent/ui/*.test.tsx).
//
// D-121 (docs/app-shell.md) замінює T29 DoD "App boots with Чат as the
// default screen" -- Чат більше не "напрямок" контентної зони, тож ця
// частина DoD більше не застосовна буквально: перевіряємо натомість, що
// ChatPanel ЗАВЖДИ змонтована одночасно з дефолтним напрямком (Картки), не
// одне ЗАМІСТЬ іншого.

test('T29+D-121: після входу видно і дефолтний екран Картки, і постійну ChatPanel, і 3 нових пункти меню одразу', async () => {
  const props = validSessionProps();

  render(<App {...props} />);

  // ChatPanel -- більше не має власного заголовка-сторінки (D-121); досяжність
  // через сам композер, завжди видимий незалежно від розгорнута/згорнута.
  expect(await screen.findByLabelText('Повідомлення')).toBeTruthy();
  expect(props.loadChatHistory).toHaveBeenCalledTimes(1);
  // D-121: Картки -- знову дефолтний напрямок контентної зони, тож loadCards
  // теж викликається одразу, ОДНОЧАСНО з loadChatHistory (не взаємовиключно).
  await waitFor(() => expect(props.loadCards).toHaveBeenCalledTimes(1));

  expect(await screen.findByRole('button', { name: 'Налаштування правил' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Звіти активності' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Обліковий запис і дані' })).toBeTruthy();
});

test('T29: клік "Налаштування правил" перемикає екран на RuleSettingsScreen (loadRules/loadRuleTargetCards)', async () => {
  const props = validSessionProps();
  props.loadRuleTargetCards.mockResolvedValue([{ cardId: 'card-1', cardTitle: 'Спорт' }]);
  props.loadRules.mockResolvedValue([
    { id: 'rule-1', scopeCardId: null, category: 'reminder', ruleText: null },
  ]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Налаштування правил' }));

  expect(await screen.findByRole('heading', { name: 'Налаштування правил' })).toBeTruthy();
  await waitFor(() => expect(props.loadRules).toHaveBeenCalledWith(null));
  await waitFor(() => expect(props.loadRuleTargetCards).toHaveBeenCalledTimes(1));

  // AC-12 card-override: targetCards завантажені асинхронно -- перевизначення
  // для конкретної картки має бачити щойно завантажену "Спорт" в <select>.
  fireEvent.click(screen.getByLabelText('Перевизначити для конкретної картки'));
  expect(await screen.findByRole('option', { name: 'Спорт' })).toBeTruthy();
});

test('T29: клік "Звіти активності" перемикає екран на ReportsScreen (loadReports)', async () => {
  const props = validSessionProps();
  props.loadReports.mockResolvedValue([{ id: 'report-1', periodLabel: 'Тижневий, 01.09–07.09', summary: 'Підсумок тижня', status: 'generated' }]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Звіти активності' }));

  expect(await screen.findByRole('heading', { name: 'Звіти активності' })).toBeTruthy();
  expect(await screen.findByText('Підсумок тижня')).toBeTruthy();
  expect(props.loadReports).toHaveBeenCalledTimes(1);
});

test('T29: клік "Обліковий запис і дані" перемикає екран на AccountScreen (loadSyncResources) і онDeleted завершує сесію', async () => {
  const props = validSessionProps();
  props.loadSyncResources.mockResolvedValue([]);
  props.onDeleteAccount.mockResolvedValue(undefined);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Обліковий запис і дані' }));

  expect(await screen.findByRole('heading', { name: 'Обліковий запис і дані' })).toBeTruthy();
  expect(props.loadSyncResources).toHaveBeenCalledTimes(1);

  // AC-17: видалення акаунта завершує сесію -- App повертається на LoginScreen
  // (той самий onDeleted -> endSession, що кнопка "Вийти" в Колоді вже використовує).
  fireEvent.click(screen.getByRole('button', { name: 'Видалити акаунт і всі дані' }));
  fireEvent.change(screen.getByLabelText(/Слово підтвердження/), { target: { value: 'ВИДАЛИТИ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));

  expect(props.onDeleteAccount).toHaveBeenCalledWith(true);
  await waitFor(() => expect(props.clearStoredSession).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(props.renderGoogleButton).toHaveBeenCalledTimes(1));
});

test('T29: надсилання повідомлення в Чаті викликає injected sendChatMessage і показує репліку агента', async () => {
  const props = validSessionProps();
  props.sendChatMessage.mockResolvedValue({ reply: 'Записав: пробіг 5 км', proposal: null });

  render(<App {...props} />);
  await screen.findByLabelText('Повідомлення'); // D-121: ChatPanel завжди змонтована, без переходу на "Чат".

  fireEvent.change(screen.getByLabelText('Повідомлення'), { target: { value: 'пробіг 5 км' } });
  fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

  expect(props.sendChatMessage).toHaveBeenCalledWith({ content: 'пробіг 5 км', attachment: null });
  expect(await screen.findByText('Записав: пробіг 5 км')).toBeTruthy();
});
