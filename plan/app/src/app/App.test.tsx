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

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { App } from './App';
import type { DeckGridItem, EntryViewModel } from '../cards/life-area-card';
import type {
  AccountScreenResource,
  ChatMessage,
  ChatProposal,
  LogEntryViewModel,
  RuleSettingsScreenRule,
  RuleSettingsScreenTargetCard,
} from '../agent';
import type { PlanScreenItem } from '../plan-horizons';
import { AppError } from '../shared/errors';

const FIXED_NOW = () => new Date('2026-09-06T12:00:00.000Z');

function baseProps() {
  return {
    readStoredSession: vi.fn().mockReturnValue(null),
    writeStoredSession: vi.fn(),
    // ISS-58: кнопка "Вийти" (верхній бар, App.tsx -- переїхала з DeckScreen,
    // D-124) стирає сесію -- реальний localStorage.removeItem (main.tsx).
    clearStoredSession: vi.fn(),
    loadCards: vi.fn().mockReturnValue(new Promise<DeckGridItem[]>(() => {})),
    requestSession: vi.fn(),
    renderGoogleButton: vi.fn(),
    now: FIXED_NOW,
    // ISS-55, stage 1/3: ін'єкція реального POST /cards (createCard, main.tsx),
    // яку App викликає з екрана 'create' (CreateCardForm.onCreate).
    createCard: vi.fn(),
    // D-121 (живе тестування): окремий екран "відкрити картку" (CardDetailScreen,
    // стан 'detail') прибрано -- передня картка колоди сама показує повний
    // вміст одразу. Ці самі fetch-функції ЗА cardId тепер ідуть прямо в
    // DeckScreen без обгортання (раніше App в'язав їх до screen.cardId для
    // CardDetailScreen).
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
    // Реальний DELETE /cards/{id}/metric-blocks/{metricBlockId} (main.tsx) --
    // App замикає над cardId, той самий стиль, що createMetricBlock/onRename.
    archiveMetricBlock: vi.fn().mockResolvedValue(undefined),
    // CH-02 (docs/features/life-area-card/changes.md): реальний PATCH
    // /cards/{cardId} (trackingMode/healthState, main.tsx) -- App замикає над
    // cardId, той самий стиль, що createMetricBlock/onRename.
    onUpdateTracking: vi.fn().mockResolvedValue(undefined),
    // CH-03 (docs/features/life-area-card/changes.md): реальний PATCH
    // /cards/{cardId}/metric-blocks/{metricBlockId} і POST
    // .../metric-blocks/transfer (main.tsx) -- App замикає над cardId, той
    // самий стиль, що createMetricBlock/onRename.
    onUpdateMetricBlock: vi.fn().mockResolvedValue(undefined),
    onTransferMetricBlock: vi.fn().mockResolvedValue(undefined),
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
    loadStructure: vi.fn().mockResolvedValue({ declaration: null }),
    onSaveDeclaration: vi.fn().mockResolvedValue(undefined),
    loadLayout: vi.fn().mockResolvedValue({ layoutMode: null, cards: [], connections: [] }),
    onMoveCard: vi.fn().mockResolvedValue(undefined),
    onCreateConnection: vi.fn().mockResolvedValue(undefined),
    onDeleteConnection: vi.fn().mockResolvedValue(undefined),
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
    loadActionLog: vi.fn().mockResolvedValue([] as LogEntryViewModel[]),
    // T11 (life-plan-levels): ін'єкція чотирьох реальних викликів
    // /api/v1/plan-items (main.tsx), які App прокидає в PlanScreen (T9) і
    // PlanItemEditor (T10) -- той самий DI-стиль, що loadStructure/loadLayout.
    loadPlanItems: vi.fn().mockResolvedValue([] as PlanScreenItem[]),
    onCreatePlanItem: vi.fn().mockResolvedValue(undefined),
    onUpdatePlanItem: vi.fn().mockResolvedValue(undefined),
    onDeletePlanItem: vi.fn().mockResolvedValue(undefined),
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

// ISS-55 stage 1/3, оновлено CH-04 (docs/features/life-area-card/changes.md):
// App.tsx більше НЕ тримає окремий Screen 'create' -- клік на кнопку
// "Створити картку" перемикає внутрішній стан DeckScreen (isCreating),
// показуючи inline CreateCardForm НА МІСЦІ передньої картки колоди
// (DeckGrid's renderFront); успішне збереження викликає ін'єктований
// createCard і повертає до звичайної колоди з повторним GET /cards
// (loadCards має бути викликаний ще раз -- DeckScreen.loadCards'
// референційна стабільність, docs у DeckScreen.tsx).

test('ISS-55/CH-04: клік "Створити картку" в Колоді показує inline форму створення на місці передньої картки', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);
  // D-121: дефолтний напрямок -- уже Картки, окремий клік не потрібен.

  const createButton = await screen.findByRole('button', { name: 'Створити картку' });
  fireEvent.click(createButton);

  // CreateCardForm (T27) -- єдиний, хто рендерить поле "Назва" з написом
  // "Нова картка"; CH-04: реальна картка "Спорт" ховається з DeckGrid, поки
  // триває inline-створення (синтетичний placeholder-item замінює весь колоду).
  expect(await screen.findByRole('heading', { name: 'Нова картка' })).toBeTruthy();
  expect(screen.queryByText('Спорт')).toBeNull();
});

test('ISS-55: успішне створення картки викликає injected createCard і повертає до Колоди з повторним завантаженням', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);
  props.createCard.mockResolvedValue(undefined);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  const createButton = await screen.findByRole('button', { name: 'Створити картку' });
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

// D-121 (живе тестування): "Картка в колоді має одразу бути готова так ніби
// вона відкрита" -- клік на тайл, щоб "відкрити" картку, БІЛЬШЕ НЕ ІСНУЄ
// (раніше -- ISS-55 stage 2/3, CardDetailScreen, прибраний). Передня картка
// показує повний вміст (CardFace) одразу після завантаження колоди --
// App сам не в'яже loadCard/loadBack до жодного screen.cardId (немає такого
// стану більше), просто прокидає ці AppProps прямо в DeckScreen без змін.

test('D-121: передня картка колоди одразу показує повний вміст (CardFace), без окремого кліку "відкрити"', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  // CardFace (T26) -- єдиний, хто рендерить назву картки як <h2>; кнопка
  // "Створити картку" (DeckScreen-специфічна) лишається поряд, не зникає.
  expect(await screen.findByRole('heading', { name: 'Спорт' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Створити картку' })).toBeTruthy();
  expect(props.loadCard).toHaveBeenCalledWith('card-1');
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

test('T52 (перенесено, D-121): loadCard, переданий у DeckFrontCard, референційно стабільний -- повторний рендер App без навігації НЕ викликає його знову', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  const { rerender } = render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  await screen.findByRole('heading', { name: 'Спорт' });
  expect(props.loadCard).toHaveBeenCalledTimes(1);

  // Той самий App, ті самі пропи -- НЕ навігація, просто повторний рендер
  // (той самий стимул, що спричинив би React перерендерити App з будь-якої
  // ІНШОЇ причини -- наприклад, оновлення в іншій частині дерева пропів).
  rerender(<App {...props} />);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(props.loadCard).toHaveBeenCalledTimes(1);
});

test('D-121: перейменування передньої картки викликає injected onRename(cardId, назва)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  fireEvent.click(await screen.findByRole('heading', { name: 'Спорт' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт і здоров’я' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  // onRename в AppProps приймає (cardId, name) -- App прокидає його прямо в
  // DeckScreen, DeckFrontCard сам звужує до (name: string) => Promise<void>
  // через замикання над cardId.
  expect(props.onRename).toHaveBeenCalledWith('card-1', 'Спорт і здоров’я');
});

// Review 2026-09-07 C11 (RED, docs/features/life-area-card/_review/review-2026-09-07.md,
// AC-12): кнопка "виправити" в історії записів раніше нікуди не була
// підключена від App.tsx -- клік нічого не робив. AppProps отримує
// injected onFlagEntry(cardId, entryId) -- App прокидає його прямо в
// DeckScreen (D-121), DeckFrontCard сам замикає над cardId для CardBack.

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

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Історія записів/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'виправити' }));

  expect(props.onFlagEntry).toHaveBeenCalledWith('card-1', 'entry-1');
});

// ISS-55, stage 3/3: App.tsx отримує четвертий екран 'archive' -- клік на
// кнопку "Архів карток" перемикає рендер на ArchiveScreen (T36, SCR-07).
// Обгортаю ArchiveScreen тонкою "← Назад" кнопкою прямо в App.tsx --
// ArchiveScreen сам не має кнопки назад (фіксований контракт T36).
// Повернення на 'deck' повторно викликає loadCards (той самий стиль
// ремаунту, що раніше мав onBack у прибраному CardDetailScreen, D-121).
//
// D-124 (живе тестування, історичний крок): "Архів" переїхав з Колоди на
// Літопис-Аналітику. CH-01 (docs/features/structure/changes.md,
// docs/features/life-area-card/changes.md, координовані правки) прибрав ту
// кнопку з Аналітики знову й додав "Архів карток" на ДВА нові місця --
// Схема (LayoutBoard) і Картки (DeckScreen) -- обидва через СПІЛЬНИЙ
// App.tsx-callback (openArchive), тому тести нижче перевіряють обидва входи.

test('CH-01 (structure): клік "Архів карток" на Схемі перемикає екран на ArchiveScreen', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);
  props.loadLayout.mockResolvedValue({
    layoutMode: null,
    cards: [{ cardId: 'card-x', cardTitle: 'X', x: 20, y: 30 }],
    connections: [],
  });
  props.loadArchivedCards.mockResolvedValue([{ id: 'card-2', name: 'Читання' }]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Схема' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Архів карток' }));

  // ArchiveScreen (T36) рендерить архівовані тайли через DeckGrid -- "Читання"
  // видиме; direction тим часом перемкнувся назад на "Картки" (той самий
  // механізм, що D-124 мав для колишньої кнопки на Аналітиці).
  expect(await screen.findByText('Читання')).toBeTruthy();
  expect(props.loadArchivedCards).toHaveBeenCalledTimes(1);
});

test('CH-01 (life-area-card): клік "Архів карток" на Картках (DeckScreen) перемикає екран на ArchiveScreen', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);
  props.loadArchivedCards.mockResolvedValue([{ id: 'card-2', name: 'Читання' }]);

  render(<App {...props} />);
  // D-121: дефолтний напрямок -- уже Картки, кнопка одразу на екрані.
  await screen.findByRole('heading', { name: 'Спорт' });
  fireEvent.click(await screen.findByRole('button', { name: 'Архів карток' }));

  expect(await screen.findByText('Читання')).toBeTruthy();
  expect(props.loadArchivedCards).toHaveBeenCalledTimes(1);
});

// Задача 13 (живе тестування): раніше "← Назад" завжди виставляв Screen на
// 'deck' -- у зв'язці з direction='cards' (виставленим ще при відкритті
// архіву) це вело на Картки, а не туди, звідки користувач реально прийшов.
// CH-01: тепер ДВА можливих входи (Схема/Картки) -- "Назад" має повернути
// саме на той, звідки відкрили.
test('CH-01: кнопка "← Назад" в Архіві, відкритому зі Схеми, повертає на Схему', async () => {
  const props = validSessionProps();
  props.loadLayout.mockResolvedValue({
    layoutMode: null,
    cards: [{ cardId: 'card-x', cardTitle: 'X', x: 20, y: 30 }],
    connections: [],
  });
  props.loadArchivedCards.mockResolvedValue([]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Схема' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Архів карток' }));
  await screen.findByText('Архів порожній');

  fireEvent.click(screen.getByRole('button', { name: '← Назад' }));

  // Повернення на 'layout' -- LayoutBoard знову видимий (кнопка "Архів
  // карток" -- її власний елемент), loadLayout викликано вдруге (перший раз
  // при первинному монтуванні Схеми, перед відкриттям архіву).
  expect(await screen.findByRole('button', { name: 'Архів карток' })).toBeTruthy();
  expect(props.loadLayout).toHaveBeenCalledTimes(2);
});

test('CH-01: кнопка "← Назад" в Архіві, відкритому з Карток, повертає на Картки', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);
  props.loadArchivedCards.mockResolvedValue([]);

  render(<App {...props} />);
  await screen.findByRole('heading', { name: 'Спорт' });
  fireEvent.click(await screen.findByRole('button', { name: 'Архів карток' }));
  await screen.findByText('Архів порожній');

  fireEvent.click(screen.getByRole('button', { name: '← Назад' }));

  expect(await screen.findByRole('heading', { name: 'Спорт' })).toBeTruthy();
  expect(screen.queryByText('Архів порожній')).toBeNull();
});

// Живе тестування (Андрій): "При натисканні на картки я попадаю в архів
// чомусь" -- "Картки" раніше лише перемикав direction, а Screen лишався
// 'archive' (D-111: навмисно, "Картки не скидає під-навігацію create/detail/
// archive"), тому клік із Архіву повертав в Архів. Тепер "Картки" ЗАВЖДИ
// скидає й Screen на 'deck' -- цей тест пінить саме реальний баг-сценарій.
test('живе тестування: клік "Картки" з Архіву (відкритого зі Схеми) веде на Колоду, не лишає в Архіві', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);
  props.loadLayout.mockResolvedValue({
    layoutMode: null,
    cards: [{ cardId: 'card-x', cardTitle: 'X', x: 20, y: 30 }],
    connections: [],
  });
  props.loadArchivedCards.mockResolvedValue([]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Схема' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Архів карток' }));
  await screen.findByText('Архів порожній');

  fireEvent.click(screen.getByRole('button', { name: 'Картки' }));

  expect(await screen.findByRole('heading', { name: 'Спорт' })).toBeTruthy();
  expect(screen.queryByText('Архів порожній')).toBeNull();
});

test('ISS-55 stage 3: розархівування картки в Архіві викликає injected onRestoreCard(cardId)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);
  props.loadArchivedCards.mockResolvedValue([{ id: 'card-2', name: 'Читання' }]);

  render(<App {...props} />);
  await screen.findByText('Тут ще немає жодної картки');
  fireEvent.click(await screen.findByRole('button', { name: 'Архів карток' }));
  fireEvent.click(await screen.findByText('Читання'));
  fireEvent.click(await screen.findByRole('button', { name: 'Розархівувати' }));

  expect(props.onRestoreCard).toHaveBeenCalledWith('card-2');
});

// ISS-56 (docs/ISSUES.md): CardFace отримав "Архівувати" в меню "..." ->
// ArchiveCardDialog (T29) -> injected AppProps.archiveCard(cardId) (DELETE
// /cards/{cardId}, main.tsx) -> D-121: після успіху DeckFrontCard.onArchived
// сигналить DeckScreen перезавантажити колоду (та сама "ремаунт
// перезавантажує" ідіома, що раніше мав onBack у прибраному CardDetailScreen).

test('ISS-56: архівування передньої картки викликає injected archiveCard(cardId) і перезавантажує колоду', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  await screen.findByRole('heading', { name: 'Спорт' });

  fireEvent.click(screen.getByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Архівувати' }));
  fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }));

  expect(props.archiveCard).toHaveBeenCalledWith('card-1');

  // Колода перезавантажується (мок loadCards повертає ту саму статичну
  // відповідь -- тест пінить сам факт повторного виклику, не реальне
  // зникнення картки, те саме обмеження мав і попередній варіант тесту).
  expect(await screen.findByRole('heading', { name: 'Спорт' })).toBeTruthy();
  expect(props.loadCards).toHaveBeenCalledTimes(2);
});

// ISS-60 (docs/ISSUES.md): App прокидає createMetricBlock прямо в
// DeckScreen -> DeckFrontCard -> CardBack, DeckFrontCard сам замикає над
// cardId передньої картки (той самий стиль, що onRename/loadCard/loadBack).

test('ISS-60: створення блоку-метрики на передній картці викликає injected createMetricBlock(cardId, values)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);
  props.loadBack.mockResolvedValue({ metricBlocks: [], aggregateProgress: null, entries: [] });

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  await screen.findByText('Ще немає жодної активної метрики');

  fireEvent.click(screen.getByRole('button', { name: '+ Додати блок-метрику' }));
  fireEvent.change(screen.getByLabelText('Що рахуємо/вимірюємо:'), { target: { value: 'Тренування' } });
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

// Видалення блоку-метрики: App прокидає archiveMetricBlock прямо в
// DeckScreen -> DeckFrontCard -> CardBack, DeckFrontCard сам замикає над
// cardId передньої картки (той самий стиль, що createMetricBlock/onFlagEntry).

test('видалення блоку-метрики на передній картці (кнопка "×" -> ввід "видалити" -> "Видалити") викликає injected archiveMetricBlock(cardId, metricBlockId)', async () => {
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
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  await screen.findByText('Тренування');

  fireEvent.click(screen.getByRole('button', { name: 'Видалити метрику «Тренування»' }));
  // ChatPanel (постійна панель, D-121) теж має власне текстове поле --
  // getByRole('textbox') на рівні всього App неоднозначний, тому питаємо
  // лише всередині діалогу підтвердження (role="dialog").
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'видалити' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Видалити' }));

  expect(props.archiveMetricBlock).toHaveBeenCalledWith('card-1', 'mb1');
});

test('D-124: клік "Вийти" у верхньому барі (поруч із шестернею) стирає сесію і повертає на LoginScreen', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);

  render(<App {...props} />);
  // "Вийти" тепер у верхньому барі, поза перемикачем direction -- досяжна
  // одразу, без навігації на жоден конкретний напрямок.
  fireEvent.click(await screen.findByRole('button', { name: 'Вийти' }));

  expect(props.clearStoredSession).toHaveBeenCalledTimes(1);
  // Той самий контракт, що тест "без токена в сховищі" вище -- LoginScreen
  // єдиний, хто монтує GIS-кнопку.
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

test('T24: після входу видно нижнє нав-меню з 4 пунктами (Декларація/Схема/Аналітика/Картки)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);

  render(<App {...props} />);
  // D-121: дефолтний напрямок -- знову Картки (Чат більше не "напрямок").

  await screen.findByText('Тут ще немає жодної картки');

  expect(await screen.findByRole('button', { name: 'Декларація' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Схема' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Аналітика' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Картки' })).toBeTruthy();
});

test('T24: клік "Декларація" в нав-меню перемикає екран на DeclarationScreen (loadStructure)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Декларація' }));

  // DeclarationScreen.tsx -- VIEW за замовчуванням (declaration: null з мока
  // вище) -- унікальний курсивний текст-підказка цього екрана.
  expect(await screen.findByText('Тексту декларації поки немає')).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Змінити декларацію' })).toBeTruthy();
  expect(props.loadStructure).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Тут ще немає жодної картки')).toBeNull();
});

test('AC-12 (review-fix 2026-09-11): на Схемі з loadCloseCardOptions/onCloseCard кнопка "Закрити напрямок" реально рендериться', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);
  props.loadLayout.mockResolvedValue({
    layoutMode: null,
    cards: [{ cardId: 'card-1', cardTitle: 'Спорт', x: 20, y: 30 }],
    connections: [],
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

test('T24: клік "Аналітика" в нав-меню перемикає екран на AnalyticsScreen (loadAnalytics)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Аналітика' }));

  // AnalyticsScreen.tsx -- унікальний рядок "N картки виключено з середнього".
  expect(await screen.findByText('0 картки виключено з середнього (немає метрики)')).toBeTruthy();
  expect(props.loadAnalytics).toHaveBeenCalledTimes(1);
});

test('T24: клік "Картки" повертає на DeckScreen, під-навігація create/archive лишається робочою (D-121: "detail" більше нема)', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([{ id: 'card-1', name: 'Спорт' }]);

  render(<App {...props} />);
  // D-121: дефолтний напрямок -- уже Картки.
  await screen.findByText('Спорт');

  // Переходимо на інший напрямок і повертаємось -- "Картки" має відновити ту саму DeckScreen-навігацію.
  fireEvent.click(await screen.findByRole('button', { name: 'Схема' }));
  await screen.findByText('Спорт', { exact: false }).catch(() => undefined);
  fireEvent.click(await screen.findByRole('button', { name: 'Картки' }));

  expect(await screen.findByRole('heading', { name: 'Спорт' })).toBeTruthy();

  // Під-навігація "Картки" (create) все ще досяжна під тим самим нав-меню.
  fireEvent.click(await screen.findByRole('button', { name: 'Створити картку' }));
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

test('T29+D-121+D-123: після входу видно і дефолтний екран Картки, і постійну ChatPanel, і 3 пункти меню шестерні досяжні', async () => {
  const props = validSessionProps();

  render(<App {...props} />);

  // ChatPanel -- більше не має власного заголовка-сторінки (D-121); досяжність
  // через сам композер, завжди видимий незалежно від розгорнута/згорнута.
  expect(await screen.findByLabelText('Повідомлення')).toBeTruthy();
  expect(props.loadChatHistory).toHaveBeenCalledTimes(1);
  // D-121: Картки -- знову дефолтний напрямок контентної зони, тож loadCards
  // теж викликається одразу, ОДНОЧАСНО з loadChatHistory (не взаємовиключно).
  await waitFor(() => expect(props.loadCards).toHaveBeenCalledTimes(1));

  // D-123: ці 3 пункти більше не в нижньому нав-меню одразу -- за значком
  // шестерні (верхній бар) у меню, role="menu".
  fireEvent.click(await screen.findByRole('button', { name: 'Меню налаштувань' }));
  expect(await screen.findByRole('menuitem', { name: 'Налаштування правил' })).toBeTruthy();
  expect(await screen.findByRole('menuitem', { name: 'Лог дій' })).toBeTruthy();
  expect(await screen.findByRole('menuitem', { name: 'Обліковий запис і дані' })).toBeTruthy();
});

// Задача 9: стандартна поведінка випадного меню -- клік будь-де поза меню й
// поза кнопкою-шестернею закриває меню, не лише повторний клік по шестерні
// чи вибір пункту (обидва вже покриті тестами вище/нижче).
test('Задача 9: клік поза меню шестерні закриває його', async () => {
  const props = validSessionProps();

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Меню налаштувань' }));
  expect(await screen.findByRole('menu')).toBeTruthy();

  // Клік по бренд-заголовку у верхньому барі -- точно поза меню й поза
  // шестернею. Саме `heading` рівня 1, не пошук по тексту "ПЛАН": T11 додав у
  // нав-меню кнопку з тим самим підписом (напрямок «ПЛАН»), тож текстовий
  // пошук став неоднозначним -- перевірка від цього не послабилась, лише
  // вказує на той самий елемент точніше.
  fireEvent.mouseDown(await screen.findByRole('heading', { level: 1 }));

  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

test('Задача 9: клік по самій шестерні, поки меню відкрите, закриває його лише один раз (без подвійного тригера)', async () => {
  const props = validSessionProps();

  render(<App {...props} />);
  const gearButton = await screen.findByRole('button', { name: 'Меню налаштувань' });
  fireEvent.click(gearButton);
  expect(await screen.findByRole('menu')).toBeTruthy();

  // mousedown на самій кнопці (document-listener) + click одразу після
  // (React onClick, той самий toggle) -- імітує реальний клік мишею.
  fireEvent.mouseDown(gearButton);
  fireEvent.click(gearButton);

  // Мав закритися (toggle), а не лишитись відкритим через подвійний тригер.
  expect(screen.queryByRole('menu')).toBeNull();
});

test('T29+D-123: клік "Налаштування правил" у меню шестерні перемикає екран на RuleSettingsScreen (loadRules/loadRuleTargetCards)', async () => {
  const props = validSessionProps();
  props.loadRuleTargetCards.mockResolvedValue([{ cardId: 'card-1', cardTitle: 'Спорт' }]);
  props.loadRules.mockResolvedValue([
    { id: 'rule-1', scopeCardId: null, category: 'reminder', ruleText: null },
  ]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Меню налаштувань' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Налаштування правил' }));

  expect(await screen.findByRole('heading', { name: 'Налаштування правил' })).toBeTruthy();
  await waitFor(() => expect(props.loadRules).toHaveBeenCalledWith(null));
  await waitFor(() => expect(props.loadRuleTargetCards).toHaveBeenCalledTimes(1));

  // AC-12 card-override: targetCards завантажені асинхронно -- перевизначення
  // для конкретної картки має бачити щойно завантажену "Спорт" в <select>.
  fireEvent.click(screen.getByLabelText('Перевизначити для конкретної картки'));
  expect(await screen.findByRole('option', { name: 'Спорт' })).toBeTruthy();
});

test('T29+D-123: клік "Лог дій" у меню шестерні перемикає екран на LogScreen (loadActionLog)', async () => {
  const props = validSessionProps();
  props.loadActionLog.mockResolvedValue([{ id: 'log-1', occurredAtLabel: '15.09 10:00', action: 'Створено картку «Спорт»' }]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Меню налаштувань' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Лог дій' }));

  expect(await screen.findByRole('heading', { name: 'Лог дій' })).toBeTruthy();
  expect(await screen.findByText('Створено картку «Спорт»')).toBeTruthy();
  expect(props.loadActionLog).toHaveBeenCalledTimes(1);
});

test('T29+D-123: клік "Обліковий запис і дані" у меню шестерні перемикає екран на AccountScreen (loadSyncResources) і онDeleted завершує сесію', async () => {
  const props = validSessionProps();
  props.loadSyncResources.mockResolvedValue([]);
  props.onDeleteAccount.mockResolvedValue(undefined);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Меню налаштувань' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Обліковий запис і дані' }));

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

// --- T11 (life-plan-levels): підключення напрямку «ПЛАН» в app-shell --------
//
// RED: App.tsx ще не знає ні про напрямок 'plan', ні про чотири нові
// AppProps-колбеки (loadPlanItems/onCreatePlanItem/onUpdatePlanItem/
// onDeletePlanItem) -- PlanScreen.tsx (T9) і PlanItemEditor.tsx (T10)
// написані й протестовані, але недосяжні користувачу, поки композиційний
// корінь їх не склеїть (та сама діра, що review 2026-09-11 MUST-FIX 4
// знайшов у LayoutBoard.onCloseCard).
//
// Назви й форма пропів узгоджені з реальними пропами обох компонентів --
// App лише прокидає їх без змін (той самий DI-стиль, що loadStructure/
// loadLayout вище). Перемикання PlanScreen <-> PlanItemEditor -- єдине, що
// App додає від себе: який саме пункт (чи який горизонт) зараз у редакторі,
// знає лише app-shell, бо обидва компоненти -- листя без спільного батька.

const PLAN_ITEM_TACTICAL = {
  id: 'plan-item-1',
  horizon: 'tactical' as const,
  planText: 'Пробігти півмарафон',
  done: false,
  createdAt: '2026-09-15T09:00:00.000Z',
};

test('T11 (AC-01): клік "ПЛАН" у нав-меню перемикає екран на PlanScreen із даними ін\'єктованого loadPlanItems', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);
  props.loadPlanItems.mockResolvedValue([PLAN_ITEM_TACTICAL]);

  render(<App {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'ПЛАН' }));

  // Три горизонти одним екраном (AC-08) -- секції PlanScreen.tsx -- і сам
  // пункт із ін'єктованого loadPlanItems, а не з вигаданих даних App.
  expect(await screen.findByText('Пробігти півмарафон')).toBeTruthy();
  expect(props.loadPlanItems).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('region', { name: 'Тактичний' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Оперативний' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Стратегічний' })).toBeTruthy();
});

test('T11 (AC-01): чекбокс "виконано" на екрані ПЛАН викликає ін\'єктований onUpdatePlanItem', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);
  props.loadPlanItems.mockResolvedValue([PLAN_ITEM_TACTICAL]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'ПЛАН' }));

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Пробігти півмарафон' }));

  await waitFor(() =>
    expect(props.onUpdatePlanItem).toHaveBeenCalledWith('plan-item-1', { done: true }),
  );
});

test('T11 (AC-01): "+" горизонту відкриває PlanItemEditor, збереження викликає onCreatePlanItem і повертає на PlanScreen', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);
  props.loadPlanItems.mockResolvedValue([]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'ПЛАН' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Додати пункт: Оперативний' }));

  fireEvent.change(await screen.findByLabelText(/Текст пункту/), { target: { value: 'Змінити професію' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  await waitFor(() =>
    expect(props.onCreatePlanItem).toHaveBeenCalledWith({ horizon: 'operational', planText: 'Змінити професію' }),
  );

  // Після збереження редактор закривається -- знову PlanScreen, із повторним
  // читанням списку (новий пункт інакше не з'явився б на екрані).
  await waitFor(() => expect(props.loadPlanItems).toHaveBeenCalledTimes(2));
  expect(screen.queryByLabelText(/Текст пункту/)).toBeNull();
});

test('T11 (AC-04): клік по тексту пункту відкриває редактор -- порожній текст зберігається як onDeletePlanItem', async () => {
  const props = validSessionProps();
  props.loadCards.mockResolvedValue([]);
  props.loadPlanItems.mockResolvedValue([PLAN_ITEM_TACTICAL]);

  render(<App {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'ПЛАН' }));

  fireEvent.click(await screen.findByText('Пробігти півмарафон'));

  const field = await screen.findByLabelText(/Текст пункту/);
  expect((field as HTMLInputElement).value).toBe('Пробігти півмарафон');

  fireEvent.change(field, { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  await waitFor(() => expect(props.onDeletePlanItem).toHaveBeenCalledWith('plan-item-1'));
  expect(props.onUpdatePlanItem).not.toHaveBeenCalled();
});
