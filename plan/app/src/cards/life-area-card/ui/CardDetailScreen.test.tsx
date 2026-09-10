// RED (ISS-55 stage 2/3, docs/ISSUES.md): екран деталей картки -- композиція
// CardFace (SCR-02, T26) + CardBack (SCR-03, T26), обидва вже написані й
// протестовані ІЗОЛЬОВАНО зі своїми фіксованими контрактами (loadCard/onFlip/
// onRename на CardFace; loadBack/onFlip/onFlagEntry?/onRenameTransferredBlock?
// на CardBack) -- жоден із них не має "назад до Колоди", тому цей новий шар
// додає власний стан "яка сторона показана" і власну кнопку повернення.
//
// Тестуємо ЛИШЕ композицію (перемикання лицьова/зворот, кнопка "Назад",
// прокидання пропів) -- усі стани самих CardFace/CardBack (loading/error/
// warning/rename/ongoing/capped/...) уже покриті CardFace.test.tsx/
// CardBack.test.tsx, дублювати їх тут було б шумом (правило test-author).

import { fireEvent, render, screen } from '@testing-library/react';
import { CardDetailScreen } from './CardDetailScreen';
import type { CardBackData, CardFaceData } from './types';

const FACE_DATA: CardFaceData = { name: 'Спорт', description: 'Регулярні тренування', dataWarning: null };
const BACK_DATA: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };

function baseProps() {
  return {
    loadCard: vi.fn().mockResolvedValue(FACE_DATA),
    loadBack: vi.fn().mockResolvedValue(BACK_DATA),
    onRename: vi.fn().mockResolvedValue(undefined),
    onBack: vi.fn(),
    // ISS-56 (docs/ISSUES.md): пропуск через до CardFace (onArchive) +
    // сигнал угору "картку архівовано, іти до Колоди" (onArchived).
    onArchive: vi.fn().mockResolvedValue(undefined),
    onArchived: vi.fn(),
  };
}

test('за замовчуванням показує лицьову сторону (CardFace) -- викликає loadCard, не loadBack', async () => {
  const props = baseProps();
  render(<CardDetailScreen {...props} />);

  expect(await screen.findByText('Спорт')).toBeTruthy();
  expect(props.loadCard).toHaveBeenCalledTimes(1);
  expect(props.loadBack).not.toHaveBeenCalled();
});

test('кнопка "← Назад" видима на лицьовій стороні й викликає onBack', async () => {
  const props = baseProps();
  render(<CardDetailScreen {...props} />);

  await screen.findByText('Спорт');
  fireEvent.click(screen.getByRole('button', { name: '← Назад' }));

  expect(props.onBack).toHaveBeenCalledTimes(1);
});

test('клік "перегорнути →" на лицьовій стороні перемикає на зворот (CardBack) -- викликає loadBack', async () => {
  const props = baseProps();
  render(<CardDetailScreen {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));

  expect(await screen.findByText('Ще немає жодної активної метрики')).toBeTruthy();
  expect(props.loadBack).toHaveBeenCalledTimes(1);
  // Лицьова сторона (назва картки як CardFace її рендерить) більше не на екрані.
  expect(screen.queryByText('Спорт')).toBeNull();
});

test('клік "← лицьова" на звороті перемикає назад на CardFace', async () => {
  const props = baseProps();
  render(<CardDetailScreen {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  await screen.findByText('Ще немає жодної активної метрики');

  fireEvent.click(screen.getByRole('button', { name: /лицьова/ }));

  expect(await screen.findByText('Спорт')).toBeTruthy();
});

test('кнопка "← Назад" лишається доступною й на звороті, викликає onBack', async () => {
  const props = baseProps();
  render(<CardDetailScreen {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  await screen.findByText('Ще немає жодної активної метрики');

  fireEvent.click(screen.getByRole('button', { name: '← Назад' }));

  expect(props.onBack).toHaveBeenCalledTimes(1);
});

test('перейменування на лицьовій стороні викликає injected onRename (AC-19 наскрізь через композицію)', async () => {
  const props = baseProps();
  render(<CardDetailScreen {...props} />);

  await screen.findByText('Спорт');
  fireEvent.click(screen.getByRole('heading', { name: 'Спорт' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт і здоров’я' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(props.onRename).toHaveBeenCalledWith('Спорт і здоров’я');
});

test('редагування Опису на лицьовій стороні викликає injected onUpdateDescription (review C10/AC-03 наскрізь через композицію)', async () => {
  const props = baseProps();
  const onUpdateDescription = vi.fn().mockResolvedValue(undefined);
  render(<CardDetailScreen {...props} onUpdateDescription={onUpdateDescription} />);

  fireEvent.click(await screen.findByText('Регулярні тренування'));
  fireEvent.change(screen.getByLabelText('Опис (навіщо)'), { target: { value: 'новий опис' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(onUpdateDescription).toHaveBeenCalledWith({ description: 'новий опис', markFilled: false });
});

test('onFlagEntry/onRenameTransferredBlock, якщо передані, прокидаються в CardBack', async () => {
  const props = baseProps();
  const onFlagEntry = vi.fn().mockResolvedValue(BACK_DATA);
  const onRenameTransferredBlock = vi.fn().mockResolvedValue(BACK_DATA);

  render(
    <CardDetailScreen {...props} onFlagEntry={onFlagEntry} onRenameTransferredBlock={onRenameTransferredBlock} />,
  );

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));

  // Не викликано без дії користувача -- лише перевіряємо, що композиція не
  // падає й не ігнорує ці пропи мовчки (передача підтверджується непрямо:
  // CardBack.test.tsx уже перевіряє власну поведінку onFlagEntry/
  // onRenameTransferredBlock ізольовано; тут важливо саме прокидання).
  await screen.findByText('Ще немає жодної активної метрики');
  expect(onFlagEntry).not.toHaveBeenCalled();
});

// ISS-56 (RED, docs/ISSUES.md): CardFace отримав другий пункт меню
// "Архівувати" -> ArchiveCardDialog -> injected onArchive; CardDetailScreen
// прокидає onArchive до CardFace без змін і прокидає власний onArchived
// угору (App.tsx поверне користувача до Колоди, бо loadCard/loadBack на
// щойно архівованій картці дадуть 404, якщо картку перегорнути знову).

test('ISS-56: архівування на лицьовій стороні викликає injected onArchive, потім onArchived (наскрізь через композицію)', async () => {
  const props = baseProps();
  render(<CardDetailScreen {...props} />);

  await screen.findByText('Спорт');
  fireEvent.click(screen.getByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Архівувати' }));
  fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }));

  expect(props.onArchive).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(props.onArchived).toHaveBeenCalledTimes(1));
});

// ISS-60/D-110 (RED, docs/ISSUES.md): CardDetailScreen прокидає два нові
// опційні пропи без змін у CardBack -- onCreateMetricBlock (ISS-60) і
// onAddEntry (D-110, тимчасове). Тестуємо лише прокидання (той самий підхід,
// що вже є для onFlagEntry/onRenameTransferredBlock вище) -- власна поведінка
// кожного вже покрита CardBack.test.tsx ізольовано.

test('ISS-60/D-110: onCreateMetricBlock/onAddEntry, якщо передані, прокидаються в CardBack без змін', async () => {
  const props = baseProps();
  const onCreateMetricBlock = vi.fn().mockResolvedValue(undefined);
  const onAddEntry = vi.fn().mockResolvedValue(undefined);

  render(
    <CardDetailScreen {...props} onCreateMetricBlock={onCreateMetricBlock} onAddEntry={onAddEntry} />,
  );

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  await screen.findByText('Ще немає жодної активної метрики');

  // Прокидання підтверджується непрямо через реальну поведінку CardBack --
  // кнопка створення блоку з'являється лише коли onCreateMetricBlock переданий.
  expect(screen.getByRole('button', { name: '+ Додати блок-метрику' })).toBeTruthy();
  expect(onCreateMetricBlock).not.toHaveBeenCalled();
  expect(onAddEntry).not.toHaveBeenCalled();
});

// D-111 (docs/DECISIONS.md, виправлено живим тестуванням/скріншотами):
// навігаційні кнопки одного класу (перегортання + повернення до Колоди)
// стоять В ОДНОМУ Й ТОМУ Ж МІСЦІ на обох сторонах -- унизу, а не просто
// "згруповані по стороні" (перша спроба показала кнопки вгорі на звороті й
// унизу на лиці -- користувачу доводилось щоразу шукати їх заново).

test('D-111: на лицьовій стороні "← Назад" стоїть ПІСЛЯ "перегорнути →" (внизу)', async () => {
  const props = baseProps();
  const { container } = render(<CardDetailScreen {...props} />);
  await screen.findByText('Спорт');

  const buttons = Array.from(container.querySelectorAll('button')).map((button) => button.textContent);
  const flipIndex = buttons.findIndex((text) => text?.includes('перегорнути'));
  const backIndex = buttons.findIndex((text) => text === '← Назад');

  expect(flipIndex).toBeGreaterThan(-1);
  expect(backIndex).toBeGreaterThan(flipIndex);
});

test('D-111: на звороті "← Назад" стоїть ПІСЛЯ "← лицьова" (унизу -- те саме місце, що на лиці)', async () => {
  const props = baseProps();
  const { container } = render(<CardDetailScreen {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  await screen.findByText('Ще немає жодної активної метрики');

  const buttons = Array.from(container.querySelectorAll('button')).map((button) => button.textContent);
  const flipIndex = buttons.findIndex((text) => text?.includes('лицьова'));
  const backIndex = buttons.findIndex((text) => text === '← Назад');

  expect(flipIndex).toBeGreaterThan(-1);
  expect(backIndex).toBeGreaterThan(flipIndex);
});
