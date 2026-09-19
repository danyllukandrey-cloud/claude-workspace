// D-121 (живе тестування): передня картка колоди -- та сама композиція
// CardFace+CardBack, що раніше ніс CardDetailScreen.tsx (прибраний, тести
// звідти перенесено сюди мінус усе про "← Назад" -- нема куди й нема від
// чого відходити, картка сама на місці в колоді).
//
// Тестуємо ЛИШЕ композицію (перемикання лицьова/зворот, cardId-зв'язування,
// прокидання пропів) -- усі стани самих CardFace/CardBack (loading/error/
// warning/rename/ongoing/capped/...) уже покриті CardFace.test.tsx/
// CardBack.test.tsx, дублювати їх тут було б шумом (правило test-author).

import { fireEvent, render, screen } from '@testing-library/react';
import { DeckFrontCard } from './DeckFrontCard';
import type { CardBackData, CardFaceData } from './types';

const FACE_DATA: CardFaceData = {
  name: 'Спорт',
  description: 'Регулярні тренування',
  dataWarning: null,
  trackingMode: 'metrics',
  healthState: null,
};
const BACK_DATA: CardBackData = { metricBlocks: [], aggregateProgress: null, entries: [] };

function baseProps() {
  return {
    cardId: 'card-1',
    loadCard: vi.fn().mockResolvedValue(FACE_DATA),
    loadBack: vi.fn().mockResolvedValue(BACK_DATA),
    onRename: vi.fn().mockResolvedValue(undefined),
    // ISS-56 (docs/ISSUES.md): пропуск через до CardFace (onArchive) +
    // сигнал угору -- D-121 тепер "перезавантаж колоду" (DeckScreen.reload),
    // не "іди до Колоди" (окремого екрана більше нема).
    onArchive: vi.fn().mockResolvedValue(undefined),
    onArchived: vi.fn(),
  };
}

test('за замовчуванням показує лицьову сторону (CardFace) -- викликає loadCard(cardId), не loadBack', async () => {
  const props = baseProps();
  render(<DeckFrontCard {...props} />);

  expect(await screen.findByText('Спорт')).toBeTruthy();
  expect(props.loadCard).toHaveBeenCalledWith('card-1');
  expect(props.loadBack).not.toHaveBeenCalled();
});

test('клік "перегорнути →" на лицьовій стороні перемикає на зворот (CardBack) -- викликає loadBack(cardId)', async () => {
  const props = baseProps();
  render(<DeckFrontCard {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));

  expect(await screen.findByText('Ще немає жодної активної метрики')).toBeTruthy();
  expect(props.loadBack).toHaveBeenCalledWith('card-1');
  // Лицьова сторона (назва картки як CardFace її рендерить) більше не на екрані.
  expect(screen.queryByText('Спорт')).toBeNull();
});

test('клік "← перегорнути" на звороті перемикає назад на CardFace', async () => {
  const props = baseProps();
  render(<DeckFrontCard {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  await screen.findByText('Ще немає жодної активної метрики');

  fireEvent.click(screen.getByRole('button', { name: /перегорнути/ }));

  expect(await screen.findByText('Спорт')).toBeTruthy();
});

// D-121: ключується по cardId у DeckGrid (key={item.id} на батьківському
// елементі) -- React ремонтує DeckFrontCard при зміні передньої картки, тож
// side скидається на 'face' сам собою. Тут перевіряємо ту саму поведінку
// БЕЗ DeckGrid -- ремонт через смену React key напряму в тесті.
test('нова передня картка (ремонт через зміну key) завжди стартує лицьовою стороною, навіть якщо попередня була на звороті', async () => {
  const props = baseProps();
  const { rerender } = render(<DeckFrontCard key="card-1" {...props} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  await screen.findByText('Ще немає жодної активної метрики');

  const nextProps = { ...baseProps(), cardId: 'card-2', loadCard: vi.fn().mockResolvedValue({ ...FACE_DATA, name: 'Навчання' }) };
  rerender(<DeckFrontCard key="card-2" {...nextProps} />);

  expect(await screen.findByText('Навчання')).toBeTruthy();
  expect(nextProps.loadCard).toHaveBeenCalledWith('card-2');
});

test('перейменування викликає injected onRename(cardId, name) (AC-19 наскрізь через композицію)', async () => {
  const props = baseProps();
  render(<DeckFrontCard {...props} />);

  await screen.findByText('Спорт');
  fireEvent.click(screen.getByRole('heading', { name: 'Спорт' }));
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт і здоров’я' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(props.onRename).toHaveBeenCalledWith('card-1', 'Спорт і здоров’я');
});

test('редагування Опису викликає injected onUpdateDescription(cardId, input) (review C10/AC-03 наскрізь через композицію)', async () => {
  const props = baseProps();
  const onUpdateDescription = vi.fn().mockResolvedValue(undefined);
  render(<DeckFrontCard {...props} onUpdateDescription={onUpdateDescription} />);

  fireEvent.click(await screen.findByText('Регулярні тренування'));
  fireEvent.change(screen.getByLabelText('Опис (навіщо)'), { target: { value: 'новий опис' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(onUpdateDescription).toHaveBeenCalledWith('card-1', { description: 'новий опис', markFilled: false });
});

test('onFlagEntry/onCreateMetricBlock, якщо передані, прокидаються в CardBack з cardId', async () => {
  const props = baseProps();
  const onFlagEntry = vi.fn().mockResolvedValue(BACK_DATA);
  const onCreateMetricBlock = vi.fn().mockResolvedValue(undefined);

  render(<DeckFrontCard {...props} onFlagEntry={onFlagEntry} onCreateMetricBlock={onCreateMetricBlock} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));

  // Прокидання підтверджується непрямо (та сама поведінка, що
  // CardDetailScreen.test.tsx мав) -- власна поведінка CardBack уже покрита
  // CardBack.test.tsx ізольовано; тут важливе саме прокидання й cardId.
  expect(await screen.findByText('Ще немає жодної активної метрики')).toBeTruthy();
  expect(screen.getByRole('button', { name: '+ Додати блок-метрику' })).toBeTruthy();
  expect(onFlagEntry).not.toHaveBeenCalled();
});

test('onArchiveMetricBlock, якщо передано, прокидається в CardBack з cardId', async () => {
  const props = baseProps();
  const onArchiveMetricBlock = vi.fn().mockResolvedValue(undefined);
  const dataWithBlock: CardBackData = {
    metricBlocks: [
      { id: 'mb1', label: 'Тренування', unit: 'раз', progress: { kind: 'bounded', share: 0.5, overGoal: 0 }, hasPendingEntry: false },
    ],
    aggregateProgress: 0.5,
    entries: [],
  };
  const loadBack = vi.fn().mockResolvedValue(dataWithBlock);

  render(<DeckFrontCard {...props} loadBack={loadBack} onArchiveMetricBlock={onArchiveMetricBlock} />);

  fireEvent.click(await screen.findByRole('button', { name: /перегорнути/ }));
  await screen.findByText('Тренування');

  fireEvent.click(screen.getByRole('button', { name: 'Видалити метрику «Тренування»' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'видалити' } });
  fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));

  expect(onArchiveMetricBlock).toHaveBeenCalledWith('card-1', 'mb1');
});

// ISS-56: CardFace's меню "..." -> "Архівувати" -> ArchiveCardDialog ->
// injected onArchive(cardId), потім onArchived() -- D-121: onArchived тепер
// "перезавантаж колоду" (DeckScreen.reload), не "іди до Колоди".

test('ISS-56: архівування викликає injected onArchive(cardId), потім onArchived (наскрізь через композицію)', async () => {
  const props = baseProps();
  render(<DeckFrontCard {...props} />);

  await screen.findByText('Спорт');
  fireEvent.click(screen.getByRole('button', { name: 'Меню картки' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Архівувати' }));
  fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }));

  expect(props.onArchive).toHaveBeenCalledWith('card-1');
  await vi.waitFor(() => expect(props.onArchived).toHaveBeenCalledTimes(1));
});
