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

const FACE_DATA: CardFaceData = { name: 'Спорт', description: 'опис', dataWarning: null, trackingMode: 'metrics', healthState: null };
const BACK_DATA: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };

function baseProps(overrides: Partial<Parameters<typeof DeckScreen>[0]> = {}) {
  return {
    loadCards: vi.fn().mockResolvedValue([]),
    // CH-04 (docs/features/life-area-card/changes.md): реальне createCard --
    // DeckScreen сам показує inline CreateCardForm і викликає цей проп лише
    // з її onSubmit, той самий "успіх -> Promise<void>" контракт, що
    // onRename/onArchive нижче.
    onCreateCard: vi.fn().mockResolvedValue(undefined),
    // CH-01 (docs/features/life-area-card/changes.md): дубль "Архів карток"
    // біля "Створити картку" -- App.tsx підставляє реальний shared callback.
    onOpenArchive: vi.fn(),
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

// CH-04 (docs/features/life-area-card/changes.md): клік "Створити картку" НЕ
// викликає injected onCreateCard напряму -- лише показує inline
// CreateCardForm на місці передньої картки колоди (renderFront); сам проп
// викликається ЛИШЕ з onSubmit цієї форми (тести нижче, "CH-04:").

test('ISS-55/CH-04: empty-стан показує кнопку "Створити картку", клік показує inline форму, а не викликає onCreateCard одразу', async () => {
  const onCreateCard = vi.fn().mockResolvedValue(undefined);
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue([]), onCreateCard });

  render(<DeckScreen {...props} />);

  await screen.findByText('Тут ще немає жодної картки');
  fireEvent.click(screen.getByRole('button', { name: 'Створити картку' }));

  expect(await screen.findByRole('heading', { name: 'Нова картка' })).toBeTruthy();
  expect(onCreateCard).not.toHaveBeenCalled();
});

test('ISS-55/CH-04: default-стан (DeckGrid з картками) показує кнопку "Створити картку" поряд з передньою карткою, клік показує inline форму', async () => {
  const items = [{ id: 'card-1', name: 'Спорт' }];
  const onCreateCard = vi.fn().mockResolvedValue(undefined);
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue(items), onCreateCard });

  render(<DeckScreen {...props} />);

  await screen.findByRole('heading', { name: 'Спорт' });
  fireEvent.click(screen.getByRole('button', { name: 'Створити картку' }));

  expect(await screen.findByRole('heading', { name: 'Нова картка' })).toBeTruthy();
  // CH-04: реальна картка "Спорт" (передня чи задня) зникає з екрана, поки
  // триває створення -- порожня картка "на місці передньої", не поряд з нею.
  expect(screen.queryByText('Спорт')).toBeNull();
  expect(onCreateCard).not.toHaveBeenCalled();
});

test('CH-04: заповнення й збереження inline форми викликає onCreateCard, закриває форму й перезавантажує колоду', async () => {
  const onCreateCard = vi.fn().mockResolvedValue(undefined);
  const loadCards = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'card-1', name: 'Спорт' }]);
  const props = baseProps({ loadCards, onCreateCard });

  render(<DeckScreen {...props} />);

  await screen.findByText('Тут ще немає жодної картки');
  fireEvent.click(screen.getByRole('button', { name: 'Створити картку' }));
  fireEvent.change(await screen.findByLabelText('Назва'), { target: { value: 'Спорт' } });
  fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

  expect(onCreateCard).toHaveBeenCalledWith({ name: 'Спорт' });
  expect(await screen.findByRole('heading', { name: 'Спорт' })).toBeTruthy();
  expect(loadCards).toHaveBeenCalledTimes(2);
});

test('CH-04: "Скасувати" в inline формі закриває її без виклику onCreateCard, повертає передню картку', async () => {
  const items = [{ id: 'card-1', name: 'Спорт' }];
  const onCreateCard = vi.fn();
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue(items), onCreateCard });

  render(<DeckScreen {...props} />);

  await screen.findByRole('heading', { name: 'Спорт' });
  fireEvent.click(screen.getByRole('button', { name: 'Створити картку' }));
  await screen.findByRole('heading', { name: 'Нова картка' });
  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(await screen.findByRole('heading', { name: 'Спорт' })).toBeTruthy();
  expect(onCreateCard).not.toHaveBeenCalled();
});

// D-124 (живе тестування): "Вийти" переїхало у верхній бар (App.test.tsx),
// не рендериться тут. Колишня кнопка "Архів" (яка вела на Літопис-
// Аналітику) теж прибрана звідси тим самим рішенням -- але CH-01
// (docs/features/life-area-card/changes.md) повертає СЮДИ окрему кнопку
// "Архів карток" (дубль зі Схеми, не повернення старої D-124 поведінки),
// тести нижче її покривають.

test('D-124/CH-01: кнопки внизу ("Створити картку" + "Архів карток") -- автоширини, не на всю сторінку', async () => {
  const items = [{ id: 'card-1', name: 'Спорт' }];
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue(items) });

  render(<DeckScreen {...props} />);

  await screen.findByRole('heading', { name: 'Спорт' });
  const button = screen.getByRole('button', { name: 'Створити картку' });
  const archiveButton = screen.getByRole('button', { name: 'Архів карток' });

  // Автоширини -- спільна обгортка `flex justify-center`, НЕ `flex-col` (де
  // flex за замовчуванням стретчив би дитину на всю ширину колонки). Пінимо
  // сам контракт (клас батька), не виміряний піксельний розмір -- jsdom не
  // рахує реальний layout.
  expect(button.parentElement).toBe(archiveButton.parentElement);
  expect(button.parentElement?.className).toContain('justify-center');
  expect(button.parentElement?.className).not.toContain('flex-col');
});

test('CH-01 (life-area-card/changes.md): клік "Архів карток" викликає injected onOpenArchive', async () => {
  const items = [{ id: 'card-1', name: 'Спорт' }];
  const onOpenArchive = vi.fn();
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue(items), onOpenArchive });

  render(<DeckScreen {...props} />);

  await screen.findByRole('heading', { name: 'Спорт' });
  fireEvent.click(screen.getByRole('button', { name: 'Архів карток' }));

  expect(onOpenArchive).toHaveBeenCalledTimes(1);
});

test('CH-01: empty-стан теж показує "Архів карток" поруч із "Створити картку"', async () => {
  const onOpenArchive = vi.fn();
  const props = baseProps({ loadCards: vi.fn().mockResolvedValue([]), onOpenArchive });

  render(<DeckScreen {...props} />);

  await screen.findByText('Тут ще немає жодної картки');
  fireEvent.click(screen.getByRole('button', { name: 'Архів карток' }));

  expect(onOpenArchive).toHaveBeenCalledTimes(1);
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

// CH-07 review-fix (docs/features/life-area-card/changes.md): без reload()
// після перейменування, `state.items` (звідки DeckFrontCard бере `cardName`
// для CardBack's архівного діалогу, CH-07) лишався зі старою назвою --
// createCard/onArchived уже мали "успіх -> reload()", rename не мав.

test('CH-07 review-fix: успішне перейменування перезавантажує loadCards (щоб cardName у звороті теж оновився)', async () => {
  const items = [{ id: 'card-1', name: 'Спорт' }];
  const loadCards = vi.fn().mockResolvedValue(items);
  const onRename = vi.fn().mockResolvedValue(undefined);
  const props = baseProps({ loadCards, onRename });

  render(<DeckScreen {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Редагувати' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт і здоров’я' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(onRename).toHaveBeenCalledWith('card-1', 'Спорт і здоров’я');
  await vi.waitFor(() => expect(loadCards).toHaveBeenCalledTimes(2));
});
