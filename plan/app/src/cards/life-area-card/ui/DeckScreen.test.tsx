import { render, screen, fireEvent } from '@testing-library/react';
import { DeckScreen } from './DeckScreen';
import { AppError } from '../../../shared/errors';
import type { CardBackData, CardFaceData } from './types';

// AC-04 (T25 DoD, п.1): усі 4 стани зі screens.md SCR-01 (default / empty /
// loading / error) рендеряться за відповідним триггером -- не лише
// монтуванням з готовими пропами. Дані приходять через ін'єктовану
// loadCards() (ISS-45, DI), тому кожен стан тут триггериться реальним
// проходженням Promise: pending -> "loading", resolve([...]) -> "default",
// resolve([]) -> "empty", reject(...) -> "error".
//
// D-121 (живе тестування): "картка в колоді має одразу бути готова так ніби
// вона відкрита" -- onOpenCard прибрано, DeckScreen отримав натомість ті
// самі cardId-параметризовані пропи, що раніше йшли лише в окремий
// CardDetailScreen (прибраний) -- loadCard/loadBack/onRename/onArchive
// (+опційні onUpdateDescription/onFlagEntry/onCreateMetricBlock). baseProps()
// нижче -- єдине місце, що їх задає, щоб не повторювати в кожному тесті.

const FACE_DATA: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null };
const BACK_DATA: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };

function baseProps(overrides: Partial<Parameters<typeof DeckScreen>[0]> = {}) {
  return {
    loadCards: vi.fn().mockResolvedValue([]),
    onCreateCard: vi.fn(),
    onOpenArchive: vi.fn(),
    onLogout: vi.fn(),
    onSessionExpired: vi.fn(),
    loadCard: vi.fn().mockResolvedValue(FACE_DATA),
    loadBack: vi.fn().mockResolvedValue(BACK_DATA),
    onRename: vi.fn().mockResolvedValue(undefined),
    onArchive: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

test('loading: показує Spinner одразу після монтування, поки loadCards ще не резолвнувся', () => {
  // Promise навмисно ніколи не резолвиться в цьому тесті -- перевіряємо лише
  // стан "loading" одразу після початкового GET /cards (screens.md SCR-01).
  const pending = new Promise<never>(() => {});
  const props = baseProps({ loadCards: vi.fn().mockReturnValue(pending) });

  render(<DeckScreen {...props} />);

  expect(screen.getByRole('status')).toBeTruthy();
  expect(props.loadCards).toHaveBeenCalledTimes(1);
});

test('default: після резолву loadCards передня картка одразу показує повний вміст (CardFace) -- жодного окремого кроку "відкрити"', async () => {
  const items = [
    { id: 'card-1', name: 'Спорт' },
    { id: 'card-2', name: 'Навчання' },
  ];
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue(items) });

  render(<DeckScreen {...props} />);

  // D-121: передня картка -- одразу CardFace (заголовок = назва, з loadCard),
  // не тайл-кнопка. Задня картка й далі показує лише підпис-назву.
  expect(await screen.findByRole('heading', { name: 'Спорт' })).toBeTruthy();
  expect(props.loadCard).toHaveBeenCalledWith('card-1');
  expect(screen.getByText('Навчання')).toBeTruthy();
});

test('empty: після резолву loadCards із порожнім масивом рендерить EmptyState', async () => {
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue([]) });

  render(<DeckScreen {...props} />);

  expect(await screen.findByText('Тут ще немає жодної картки')).toBeTruthy();
});

test('error: після реджекту loadCards рендерить Banner із текстом помилки', async () => {
  const props = baseProps({ loadCards: vi.fn().mockRejectedValue(new Error('Мережа недоступна')) });

  render(<DeckScreen {...props} />);

  expect(await screen.findByText('Мережа недоступна')).toBeTruthy();
});

test('error: реджект без Error-повідомлення падає назад на дефолтний текст', async () => {
  const props = baseProps({ loadCards: vi.fn().mockRejectedValue('щось пішло не так') });

  render(<DeckScreen {...props} />);

  expect(await screen.findByText('Не вдалося завантажити колоду карток')).toBeTruthy();
});

test('ISS-55: empty-стан показує кнопку "+ Створити картку", клік викликає onCreateCard', async () => {
  const onCreateCard = vi.fn();
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue([]), onCreateCard });

  render(<DeckScreen {...props} />);

  await screen.findByText('Тут ще немає жодної картки');
  fireEvent.click(screen.getByRole('button', { name: '+ Створити картку' }));

  expect(onCreateCard).toHaveBeenCalledTimes(1);
});

test('ISS-55: default-стан (DeckGrid з картками) показує кнопку "+ Створити картку" поряд з переднью карткою', async () => {
  const items = [{ id: 'card-1', name: 'Спорт' }];
  const onCreateCard = vi.fn();
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue(items), onCreateCard });

  render(<DeckScreen {...props} />);

  await screen.findByRole('heading', { name: 'Спорт' });
  fireEvent.click(screen.getByRole('button', { name: '+ Створити картку' }));

  expect(onCreateCard).toHaveBeenCalledTimes(1);
});

// ISS-55 stage 3/3: кнопка "Архів" -- в ОБОХ станах (empty і default), той
// самий патерн розміщення, що onCreateCard (stage 1).

test('ISS-55 stage 3: empty-стан показує кнопку "Архів", клік викликає onOpenArchive', async () => {
  const onOpenArchive = vi.fn();
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue([]), onOpenArchive });

  render(<DeckScreen {...props} />);

  await screen.findByText('Тут ще немає жодної картки');
  fireEvent.click(screen.getByRole('button', { name: 'Архів' }));

  expect(onOpenArchive).toHaveBeenCalledTimes(1);
});

test('ISS-55 stage 3: default-стан (DeckGrid з картками) показує кнопку "Архів" поряд з переднью карткою', async () => {
  const items = [{ id: 'card-1', name: 'Спорт' }];
  const onOpenArchive = vi.fn();
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue(items), onOpenArchive });

  render(<DeckScreen {...props} />);

  await screen.findByRole('heading', { name: 'Спорт' });
  fireEvent.click(screen.getByRole('button', { name: 'Архів' }));

  expect(onOpenArchive).toHaveBeenCalledTimes(1);
});

// ISS-58: кнопка "Вийти" -- та сама відсутність, що знайшов Андрій живим
// тестуванням ("а як мені вийти з акаунту?"). Той самий патерн розміщення,
// що onCreateCard/onOpenArchive.

test('ISS-58: empty-стан показує кнопку "Вийти", клік викликає onLogout', async () => {
  const onLogout = vi.fn();
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue([]), onLogout });

  render(<DeckScreen {...props} />);

  await screen.findByText('Тут ще немає жодної картки');
  fireEvent.click(screen.getByRole('button', { name: 'Вийти' }));

  expect(onLogout).toHaveBeenCalledTimes(1);
});

// Review 2026-09-07 C14 (docs/features/life-area-card/_review/review-2026-09-07.md):
// раніше 401 (сесія протермінована/невалідна) падав у той самий Banner, що
// будь-яка інша мережева помилка -- глухий кут, користувач не міг нічого
// зробити. Тепер loadCards (main.tsx) кидає AppError('...', ..., 401) саме
// для 401 -- DeckScreen розпізнає це й викликає onSessionExpired замість
// показу банера (App.tsx поверне LoginScreen, той самий шлях, що onLogout).

test('C14/AC-04: AppError з httpStatus 401 викликає onSessionExpired замість Banner', async () => {
  const onSessionExpired = vi.fn();
  const props = baseProps({
    loadCards: vi.fn().mockRejectedValue(new AppError('auth.invalid_token', 'Сесія протермінована', 401)),
    onSessionExpired,
  });

  render(<DeckScreen {...props} />);

  await vi.waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  // Не звичайний банер помилки -- глухого кута більше нема.
  expect(screen.queryByText('Сесія протермінована')).toBeNull();
});

// Review 2026-09-07 C14: стан помилки (мережева, не 401) отримує кнопку
// "Спробувати ще раз" -- раніше не було ЖОДНОГО способу відновитись без
// перезавантаження всієї сторінки. D-121: той самий "reload" тепер служить і
// сигналу "картку заархівовано" (DeckFrontCard.test.tsx покриває це окремо).

test('C14: стан помилки показує кнопку "Спробувати ще раз", клік повторно викликає loadCards', async () => {
  const loadCards = vi.fn().mockRejectedValueOnce(new Error('Мережа недоступна')).mockResolvedValueOnce([]);
  const props = baseProps({ loadCards });

  render(<DeckScreen {...props} />);

  await screen.findByText('Мережа недоступна');
  fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));

  expect(await screen.findByText('Тут ще немає жодної картки')).toBeTruthy();
  expect(loadCards).toHaveBeenCalledTimes(2);
});
