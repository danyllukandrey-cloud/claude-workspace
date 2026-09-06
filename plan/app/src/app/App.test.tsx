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

import { render, screen, fireEvent } from '@testing-library/react';
import { App } from './App';
import type { DeckGridItem } from '../cards/life-area-card';

const FIXED_NOW = () => new Date('2026-09-06T12:00:00.000Z');

function baseProps() {
  return {
    readStoredSession: vi.fn().mockReturnValue(null),
    writeStoredSession: vi.fn(),
    loadCards: vi.fn().mockReturnValue(new Promise<DeckGridItem[]>(() => {})),
    onOpenCard: vi.fn(),
    requestSession: vi.fn(),
    renderGoogleButton: vi.fn(),
    now: FIXED_NOW,
    // ISS-55, stage 1/3: ін'єкція реального POST /cards (createCard, main.tsx),
    // яку App викликає з екрана 'create' (CreateCardForm.onCreate).
    createCard: vi.fn(),
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
