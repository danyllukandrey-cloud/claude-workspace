// T23 — SCR-04 Закрити напрямок (screens.md): component test for
// CloseCardDialog — default/empty/rename-needed/validation/error/success
// states (spec.md AC-12). Component does not exist yet — this is the RED
// step, no production code written (test-author role), same convention as
// LayoutBoard.test.tsx (T21) / DeclarationScreen.test.tsx (T20): RED imports
// the not-yet-written module directly, the module-not-found failure IS the
// expected first-run outcome.
//
// DI style (plan/app/CLAUDE.md, matches LayoutBoard/DeclarationScreen):
// `onClose` is an injected prop-function that maps 1:1 to
// `POST /structure/layout/{cardId}` (contracts/openapi.yaml closeCard,
// app/close-card.ts's CloseCardInput minus ownerUserId/cardId — those are
// the ports/http layer's job, out of scope here). No fetch() inside the
// component.
//
// screens.md SCR-04 states covered:
// - default: per-metric Toggle + CardPicker (AC-12) — closing without any
//   transfer selected is always allowed (test-plan.md edge case: "closing a
//   card with zero metric-blocks -> plain confirm", mirrored here as "no
//   toggle checked -> plain confirm").
// - empty: card has zero metric-blocks -> only a "закрити без переносу"
//   Button, no per-metric rows at all.
// - rename-needed: onClose rejects with the life-area-card AC-15 collision
//   code (`metric_block.name_collision`, 409, transfer-metric-block.ts) ->
//   TextField for the new label + Banner, "Продовжити" retries with
//   newLabel filled in.
// - validation: a metric's Toggle is switched on but no target card picked
//   -> inline error under CardPicker, blocks submit — client-side, onClose
//   is never called (no API round-trip for a check the UI can do itself).
// - error: onClose rejects with `structure.metric_transfer_target_invalid`
//   (422, contracts/openapi.yaml closeCard) -> Banner, never toast/alert
//   (design-system.md "errors inline, never alert/confirm").
// - success: onClose resolves -> `onClosed` fires (screens.md: "закриття
//   підтверджено, повернення на SCR-02" — the return-to-SCR-02 navigation
//   itself belongs to the caller, this dialog only signals completion).

import { fireEvent, render, screen } from '@testing-library/react';
import { CloseCardDialog } from './CloseCardDialog';
import type { CloseCardDialogProps } from './CloseCardDialog';

function baseProps(overrides: Partial<CloseCardDialogProps> = {}): CloseCardDialogProps {
  return {
    cardTitle: 'Навчання (дубль)',
    metricBlocks: [
      { metricBlockId: 'mb-1', label: 'книги' },
      { metricBlockId: 'mb-2', label: 'курси' },
    ],
    targetCards: [
      { cardId: 'card-navchannia', cardTitle: 'Навчання' },
      { cardId: 'card-sport', cardTitle: 'Спорт' },
    ],
    onClose: vi.fn().mockResolvedValue(undefined),
    onClosed: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

test('default: показує перемикач переносу і вибір цільової картки для кожної метрики (AC-12)', () => {
  const props = baseProps();
  render(<CloseCardDialog {...props} />);

  expect(screen.getByText(/книги/)).toBeTruthy();
  expect(screen.getByText(/курси/)).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Закрити' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Скасувати' })).toBeTruthy();
});

test('default: закриття без жодного вибраного перенесення викликає onClose з порожнім metricTransfers', async () => {
  const props = baseProps();
  render(<CloseCardDialog {...props} />);

  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

  expect(await screen.findByText(/./)).toBeTruthy(); // дочекатись стабілізації UI після кліку
  expect(props.onClose).toHaveBeenCalledWith({ metricTransfers: [] });
});

test('default (AC-12): перемикач + обрана цільова картка формують metricTransfers для onClose', async () => {
  const props = baseProps();
  render(<CloseCardDialog {...props} />);

  const toggles = screen.getAllByRole('checkbox');
  fireEvent.click(toggles[1]); // "курси" -> переносимо

  const picker = screen.getByLabelText(/курси/i).closest('*')!.parentElement!;
  const select = picker.querySelector('select') ?? screen.getAllByRole('combobox')[0];
  fireEvent.change(select, { target: { value: 'card-navchannia' } });

  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

  await screen.findByText(/./);
  expect(props.onClose).toHaveBeenCalledWith({
    metricTransfers: [{ metricBlockId: 'mb-2', targetCardId: 'card-navchannia' }],
  });
});

test('empty: жодного блоку-метрики -- лише кнопка "закрити без переносу", жодного рядка з перемикачем', () => {
  const props = baseProps({ metricBlocks: [] });
  render(<CloseCardDialog {...props} />);

  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: 'Закрити без переносу' })).toBeTruthy();
});

test('empty: клік "закрити без переносу" викликає onClose з порожнім metricTransfers', async () => {
  const props = baseProps({ metricBlocks: [] });
  render(<CloseCardDialog {...props} />);

  fireEvent.click(screen.getByRole('button', { name: 'Закрити без переносу' }));

  await screen.findByText(/./);
  expect(props.onClose).toHaveBeenCalledWith({ metricTransfers: [] });
});

test('validation: перемикач увімкнено, але цільову картку не вказано -- inline помилка під CardPicker, onClose не викликається', () => {
  const props = baseProps();
  render(<CloseCardDialog {...props} />);

  const toggles = screen.getAllByRole('checkbox');
  fireEvent.click(toggles[0]); // "книги" -> хочу перенести, картку не обрав

  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

  expect(screen.getByText(/оберіть картку|вкажіть картку|не обрано/i)).toBeTruthy();
  expect(props.onClose).not.toHaveBeenCalled();
});

test('rename-needed (life-area-card AC-15, 409 metric_block.name_collision): показує TextField для нової назви й Banner', async () => {
  const onClose = vi
    .fn()
    .mockRejectedValueOnce({
      name: 'AppError',
      message: 'У картці-призначенні вже є блок із такою назвою й одиницею',
      code: 'metric_block.name_collision',
      httpStatus: 409,
    })
    .mockResolvedValueOnce(undefined);
  const props = baseProps({ onClose });
  render(<CloseCardDialog {...props} />);

  const toggles = screen.getAllByRole('checkbox');
  fireEvent.click(toggles[1]); // "курси"
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'card-navchannia' } });
  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

  await screen.findByText(/вже є блок із такою назвою/i);
  expect(screen.getByLabelText(/нова назва|перенесено/i)).toBeTruthy();

  fireEvent.change(screen.getByLabelText(/нова назва|перенесено/i), {
    target: { value: 'курси (перенесено)' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Продовжити' }));

  await screen.findByText(/./);
  expect(onClose).toHaveBeenLastCalledWith({
    metricTransfers: [{ metricBlockId: 'mb-2', targetCardId: 'card-navchannia', newLabel: 'курси (перенесено)' }],
  });
});

test('error (422 structure.metric_transfer_target_invalid): рендериться Banner, не toast/alert', async () => {
  const onClose = vi.fn().mockRejectedValue({
    name: 'AppError',
    message: 'targetCardId does not exist or is not yours',
    code: 'structure.metric_transfer_target_invalid',
    httpStatus: 422,
  });
  const props = baseProps({ onClose });
  render(<CloseCardDialog {...props} />);

  const toggles = screen.getAllByRole('checkbox');
  fireEvent.click(toggles[1]);
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'card-navchannia' } });
  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

  const banner = await screen.findByText(/does not exist|не (?:знайдено|валідна)/i);
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
});

test('success: onClose резолвиться -- викликається onClosed (screens.md: повернення на SCR-02)', async () => {
  const props = baseProps();
  render(<CloseCardDialog {...props} />);

  fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

  await screen.findByText(/./);
  expect(props.onClosed).toHaveBeenCalledTimes(1);
});

test('скасування викликає onCancel і НЕ викликає onClose', () => {
  const props = baseProps();
  render(<CloseCardDialog {...props} />);

  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(props.onCancel).toHaveBeenCalledTimes(1);
  expect(props.onClose).not.toHaveBeenCalled();
});
