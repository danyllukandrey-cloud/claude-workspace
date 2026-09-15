// SCR-02 — Схема (spec.md AC-02, AC-08, AC-11, AC-11b).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що DeclarationScreen/
// AnalyticsScreen): loadLayout/onMoveCard — ін'єктовані пропи-функції,
// жодного fetch() тут. onMoveCard мапиться 1:1 на PUT /structure/layout/{cardId}
// (contracts/openapi.yaml moveCard) — сам HTTP-запит лишається за ports/.
//
// AC-11b: екран сам не вирішує ЧОМУ стався reset (зміна layoutMode на будь-
// яке з 5 плоских значень, вимоги 14/15) — loadLayout уже згорнув причину в
// один прапорець justReset (той самий підхід, що AnalyticsScreen's
// trendAvailable). Рендер від причини не залежить: банер "розклади заново" +
// нерозкладені картки в base order внизу, сітка вище лишається порожньою.
//
// Вимога 15 ("Готово до розкладання"): той самий трей нерозкладених стає
// СТІЙКИМ явним станом (не одноразовим), коли `layoutMode === 'staging'` --
// showStagingHint нижче.
//
// AC-02 (D-62, 409 structure.cell_occupied): помилка показується inline,
// прив'язана до самої клітинки, не банером/toast на всю ширину екрана
// (design-system.md "errors inline, never alert/confirm"). Мережева
// помилка (fetch сам не спрацював) — навпаки, банер, бо стосується всього
// збереження, не конкретної клітинки.
//
// Живе тестування (Андрій): "Налаштування розкладки схеми переносимо в
// сторінку схеми" — LAYOUT_MODE_OPTIONS-пікер (і ConfirmDialog-попередження
// про скидання, AC-11/AC-11b) переїхали сюди цілком з DeclarationScreen.tsx.
// Локальний перемикач `screenMode` ('board' | 'config') — плаваюча кнопка
// знизу по центру "Конфігурація" (той самий floating-патерн, що
// DeclarationScreen/AnalyticsScreen). `hasArrangedCards` тепер рахується
// напряму з `state.cards` (чи хоч одна `cellIndex !== null`) — сервер
// окремого прапорця під це не віддає, і не мусить: ознака вже вся тут, у
// вже завантажених позиціях. Після успішного збереження режиму екран
// ПЕРЕЧИТУЄ loadLayout() (джерело правди -- сервер, той самий підхід, що
// onClosed у CloseCardDialog-гілці нижче), щоб трей нерозкладених і банер
// justReset одразу відобразили реальний новий стан.

import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import { Banner, Button, ConfirmDialog, EmptyState, Spinner } from '../../shared/ui';
import { CloseCardDialog } from './CloseCardDialog';
import type {
  CloseCardDialogMetricBlock,
  CloseCardDialogTargetCard,
  CloseCardMetricTransferInput,
} from './CloseCardDialog';
import type { LayoutMode } from '../domain/layout';

interface LayoutModeOption {
  value: Exclude<LayoutMode, null>;
  label: string;
}

// Порядок -- саме той, що назвав Андрій (вимога 15), перенесено дослівно з
// колишнього DeclarationScreen.tsx: баланс навколо ядра / фокус і
// спостереження / причина і наслідок / вільна розкладка / готово до
// розкладання.
const LAYOUT_MODE_OPTIONS: LayoutModeOption[] = [
  { value: 'balance', label: 'Баланс навколо ядра' },
  { value: 'focus', label: 'Фокус і спостереження' },
  { value: 'cause_effect', label: 'Причина і наслідок' },
  { value: 'free', label: 'Вільна розкладка' },
  { value: 'staging', label: 'Готово до розкладання' },
];

export interface LayoutBoardCard {
  cardId: string;
  cardTitle: string;
  cellIndex: number | null;
  baseOrder: number;
}

/** Те, що SCR-04 має знати про картку, яку закривають (AC-12). */
export interface LayoutBoardCloseCardOptions {
  metricBlocks: CloseCardDialogMetricBlock[];
  /** Куди можна перенести метрику -- решта активних карток власника. */
  targetCards: CloseCardDialogTargetCard[];
}

export interface LayoutBoardState {
  cellCount: number;
  /** Щойно скинуто розташування (AC-11b) -- банер + base order внизу. */
  justReset: boolean;
  /**
   * Вимога 15 ("Готово до розкладання"): режим Структури на момент завантаження
   * -- потрібен лише щоб зробити ЯВНИМ той самий трей нерозкладених карток
   * (нижче), що вже існує для будь-якого reset (AC-11b). `null` -- режим ще не
   * обрано (AC-09); дефолтне значення нижче ('free') на нього не впливає --
   * банер staging просто не показується.
   */
  layoutMode: LayoutMode;
  cards: LayoutBoardCard[];
}

export interface LayoutBoardProps {
  /** Завантажує поточну розкладку. */
  loadLayout: () => Promise<LayoutBoardState>;
  /** Переносить картку на нову клітинку. Кидає AppError-подібну помилку (code/httpStatus), якщо сервер відповів, або звичайну Error при мережевому збої. */
  onMoveCard: (input: { cardId: string; cellIndex: number }) => Promise<void>;
  /**
   * Живе тестування (Андрій): "Конфігурація" -- зберігає ОБРАНИЙ режим
   * розкладки (AC-11/AC-11b). Кидає AppError-подібну помилку (code/httpStatus),
   * якщо сервер відповів, або звичайну Error при мережевому збої (офлайн) --
   * той самий контракт, що onMoveCard/onSave.
   */
  onSaveLayoutMode: (input: { layoutMode: LayoutMode }) => Promise<void>;
  /**
   * AC-12 -- читає, що саме пропонувати перенести при закритті напрямку
   * (GET /cards/{cardId}/metric-blocks + перелік карток-цілей). Опційний: поки
   * composition root його не підставив, дії "Закрити напрямок" просто немає --
   * краще ніж діалог, який нікуди не веде.
   */
  loadCloseCardOptions?: (cardId: string) => Promise<LayoutBoardCloseCardOptions>;
  /** AC-12 -- POST /structure/layout/{cardId}/close. Опційний разом із loadCloseCardOptions. */
  onCloseCard?: (input: { cardId: string; metricTransfers: CloseCardMetricTransferInput[] }) => Promise<void>;
}

interface AppErrorShape {
  message: string;
  code: unknown;
  httpStatus: unknown;
}

// Duck-typing замість `instanceof AppError` -- той самий підхід, що
// DeclarationScreen.tsx: тест (і реальний HTTP-шар портів) моделює "сервер
// відповів" будь-якою помилкою з полями code/httpStatus.
function isAppErrorShape(err: unknown): err is AppErrorShape {
  return typeof err === 'object' && err !== null && 'code' in err && 'httpStatus' in err;
}

export function LayoutBoard({
  loadLayout,
  onMoveCard,
  onSaveLayoutMode,
  loadCloseCardOptions,
  onCloseCard,
}: LayoutBoardProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<LayoutBoardState>({ cellCount: 0, justReset: false, layoutMode: null, cards: [] });
  const [cellErrors, setCellErrors] = useState<Record<number, string>>({});
  const [banner, setBanner] = useState<{ variant: 'error' | 'info'; text: string } | null>(null);
  // AC-12: яку картку закриваємо (null -- діалог закритий) і чим його наповнити.
  // Дві окремі змінні, бо між кліком і відповіддю GET .../metric-blocks є мить,
  // коли картка вже обрана, а списку метрик ще немає -- там рендериться Spinner,
  // а не порожній діалог, який виглядав би як "метрик немає".
  const [closingCard, setClosingCard] = useState<{ cardId: string; cardTitle: string } | null>(null);
  const [closeOptions, setCloseOptions] = useState<LayoutBoardCloseCardOptions | null>(null);

  // Живе тестування (Андрій): "Конфігурація" -- локальний перемикач екрана,
  // не окремий напрямок App.tsx (той самий рівень, що DeclarationScreen's
  // view/edit). `pendingLayoutMode` -- чернетка пікера, скидається на
  // поточне збережене значення щоразу, коли відкривається CONFIG (openConfig
  // нижче), а не лишається застарілим між відкриттями.
  const [screenMode, setScreenMode] = useState<'board' | 'config'>('board');
  const [pendingLayoutMode, setPendingLayoutMode] = useState<LayoutMode>(null);
  const [configBanner, setConfigBanner] = useState<{ variant: 'error' | 'info'; text: string } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  useEffect(() => {
    loadLayout().then((loaded) => {
      setState(loaded);
      setLoading(false);
    });
    // Навмисно без loadLayout у deps -- викликається рівно раз при монтуванні
    // (той самий підхід, що DeclarationScreen: DI-функція стабільна для
    // життя екрана).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <Spinner />;
  }

  if (state.cards.length === 0) {
    return <EmptyState message="Поки що немає жодної картки" actionHint="Додай картку, щоб розкласти її тут" />;
  }

  // AC-11/AC-11b: рахуємо напряму з уже завантажених позицій -- жодного
  // окремого прапорця з бекенду, "картка з клітинкою" вже й є ознака.
  const hasArrangedCards = state.cards.some((card) => card.cellIndex !== null);

  const openConfig = (): void => {
    setConfigBanner(null);
    setPendingLayoutMode(state.layoutMode);
    setScreenMode('config');
  };

  const persistLayoutMode = (nextLayoutMode: LayoutMode): void => {
    onSaveLayoutMode({ layoutMode: nextLayoutMode })
      .then(() => {
        setConfigBanner(null);
        setScreenMode('board');
        // Джерело правди -- сервер (позиції реально скинуті чи ні):
        // перечитуємо розкладку, а не вгадуємо новий стан локально -- той
        // самий підхід, що onClosed у CloseCardDialog-гілці нижче. Помилку
        // ЦЬОГО перечитування рахуємо окремо від помилки збереження -- режим
        // МІГ зберегтися, навіть якщо саме це оновлення не наздогнало.
        loadLayout()
          .then(setState)
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'Не вдалося оновити розкладку';
            setBanner({ variant: 'error', text: `Режим збережено, але розкладку не перечитано. ${message}` });
          });
      })
      .catch((err: unknown) => {
        if (isAppErrorShape(err)) {
          // Не збереглось -- лишаємось у CONFIG, є що виправити й повторити.
          setConfigBanner({ variant: 'error', text: err.message });
        } else {
          const message = err instanceof Error ? err.message : 'Не вдалося зберегти';
          setConfigBanner({
            variant: 'info',
            text: `Немає з'єднання -- зміни збережено локально й будуть синхронізовані пізніше (офлайн). ${message}`,
          });
          setScreenMode('board');
        }
      });
  };

  const handleSaveConfig = (): void => {
    const layoutChanged = pendingLayoutMode !== state.layoutMode;
    const needsConfirm = hasArrangedCards && layoutChanged;

    if (needsConfirm) {
      setConfirmPending(true);
      return;
    }

    persistLayoutMode(pendingLayoutMode);
  };

  const handleConfirmChange = (): void => {
    setConfirmPending(false);
    persistLayoutMode(pendingLayoutMode);
  };

  const handleCancelChange = (): void => {
    setConfirmPending(false);
    // Той самий принцип, що колишній DeclarationScreen.tsx: скасування
    // лишає попередній (уже збережений) режим обраним, не чернетку.
    setPendingLayoutMode(state.layoutMode);
  };

  if (screenMode === 'config') {
    return (
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 pb-20">
          {/* D-111: варіанти одного вибору (режим розкладки) лишаються поруч,
              як рядок пігулок, що переноситься на вузькому екрані -- той
              самий пікер, дослівно перенесений із DeclarationScreen.tsx. */}
          <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
            {LAYOUT_MODE_OPTIONS.map((option) => {
              const isSelected = pendingLayoutMode === option.value;
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-control border px-3.5 py-2.5 text-sm font-medium transition-colors ${
                    isSelected
                      ? 'border-ink bg-ink/10 text-ink'
                      : 'border-border bg-surface-solid text-ink-muted hover:border-ink/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="layoutMode"
                    checked={isSelected}
                    onChange={() => setPendingLayoutMode(option.value)}
                    className="h-4 w-4 accent-ink"
                  />
                  {option.label}
                </label>
              );
            })}
          </fieldset>

          {configBanner !== null && <Banner variant={configBanner.variant} text={configBanner.text} />}
        </div>

        <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
          <Button label="Зберегти" onClick={handleSaveConfig} />
        </div>

        {confirmPending && (
          <ConfirmDialog
            message="Зміна розкладки скине розташування вже розкладених карток. Продовжити?"
            confirmLabel="Змінити"
            cancelLabel="Скасувати"
            onConfirm={handleConfirmChange}
            onCancel={handleCancelChange}
          />
        )}
      </div>
    );
  }

  const handleDragStart = (event: DragEvent, cardId: string): void => {
    event.dataTransfer.setData('cardId', cardId);
  };

  // AC-12, вхід у SCR-04. `canCloseCard` -- обидві можливості інжектовані
  // разом: діалог без onCloseCard показував би кнопку "Закрити", яка нічого
  // не робить.
  const canCloseCard = loadCloseCardOptions !== undefined && onCloseCard !== undefined;

  const openCloseDialog = (card: LayoutBoardCard): void => {
    if (loadCloseCardOptions === undefined) {
      return;
    }

    setBanner(null);
    setCloseOptions(null);
    setClosingCard({ cardId: card.cardId, cardTitle: card.cardTitle });

    loadCloseCardOptions(card.cardId)
      .then(setCloseOptions)
      .catch((err: unknown) => {
        // Діалог НЕ відкривається напівпорожнім: без списку метрик користувач
        // не бачив би, що саме втратить, а "закрити без переносу" виглядало б
        // як єдиний варіант.
        setClosingCard(null);
        const message = err instanceof Error ? err.message : 'Не вдалося прочитати метрики картки';
        setBanner({ variant: 'error', text: `Не вдалося відкрити закриття напрямку. ${message}` });
      });
  };

  const dismissCloseDialog = (): void => {
    setClosingCard(null);
    setCloseOptions(null);
  };

  /**
   * Назва картки + (за наявності можливості) дія "Закрити напрямок". Спільний
   * рендер для сітки й для треї нерозкладених -- AC-17/AC-11b ставлять картку в
   * трей, і закрити напрямок звідти має бути так само можливо.
   *
   * aria-label несе НАЗВУ картки: кнопок на екрані стільки ж, скільки карток,
   * і без назви вони були б нерозрізненні (і для скрінрідера, і для тесту).
   */
  const cardChip = (card: LayoutBoardCard): JSX.Element => (
    <span
      key={card.cardId}
      className="flex max-w-full flex-col items-center gap-1 rounded-control bg-surface-solid px-2.5 py-2 text-center shadow-soft"
    >
      <span
        draggable
        data-card-id={card.cardId}
        onDragStart={(event) => handleDragStart(event, card.cardId)}
        className="max-w-full truncate text-xs font-semibold text-ink"
      >
        {card.cardTitle}
      </span>
      {canCloseCard && (
        <button
          type="button"
          aria-label={`Закрити напрямок «${card.cardTitle}»`}
          onClick={() => openCloseDialog(card)}
          className="text-[11px] font-medium text-ink-faint transition-colors hover:text-ink"
        >
          Закрити напрямок
        </button>
      )}
    </span>
  );

  const handleDrop = (event: DragEvent, cellIndex: number): void => {
    const cardId = event.dataTransfer.getData('cardId');
    if (!cardId) {
      return;
    }

    setCellErrors((prev) => {
      const next = { ...prev };
      delete next[cellIndex];
      return next;
    });

    onMoveCard({ cardId, cellIndex })
      .then(() => {
        setState((prev) => ({
          ...prev,
          cards: prev.cards.map((card) => (card.cardId === cardId ? { ...card, cellIndex } : card)),
        }));
      })
      .catch((err: unknown) => {
        if (isAppErrorShape(err)) {
          if (err.code === 'structure.cell_occupied') {
            setCellErrors((prev) => ({ ...prev, [cellIndex]: 'Ця клітинка вже зайнята' }));
          } else {
            setCellErrors((prev) => ({ ...prev, [cellIndex]: err.message }));
          }
        } else {
          const message = err instanceof Error ? err.message : 'Не вдалося зберегти';
          setBanner({ variant: 'error', text: `Не вдалося зберегти позицію -- мережева помилка. ${message}` });
        }
      });
  };

  const unassigned = state.cards
    .filter((card) => card.cellIndex === null)
    .sort((a, b) => a.baseOrder - b.baseOrder);

  const cells = Array.from({ length: state.cellCount }, (_, cellIndex) => {
    const card = state.cards.find((c) => c.cellIndex === cellIndex) ?? null;

    return (
      <div
        key={cellIndex}
        data-testid={`cell-${cellIndex}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, cellIndex)}
        className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-control p-1.5 text-center ${
          card === null ? 'border border-border' : ''
        }`}
      >
        {card !== null && cardChip(card)}
        {cellErrors[cellIndex] !== undefined && (
          <span className="text-[11px] font-medium text-bad">{cellErrors[cellIndex]}</span>
        )}
      </div>
    );
  });

  // Вимога 15 ("Готово до розкладання"): трей нерозкладених нижче -- той самий
  // механізм, що AC-11b уже показує одноразово після reset (justReset), тут
  // робимо його ЯВНИМ ВИДИМИМ СТАНОМ саме для цього режиму -- не одноразовий
  // банер, а нагадування, поки лишається хоч одна нерозкладена картка. Коли
  // щойно стався reset (justReset), той банер уже пояснює ситуацію -- staging
  // не дублює його в той самий момент.
  const showStagingHint = state.layoutMode === 'staging' && unassigned.length > 0 && !state.justReset;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-20">
        {state.justReset && <Banner variant="info" text="Розклади заново -- попереднє розташування скинуто" />}

        {showStagingHint && <Banner variant="info" text="Готово до розкладання -- перетягни картки знизу на вільні клітинки" />}

        {banner !== null && <Banner variant={banner.variant} text={banner.text} />}

        <div className="grid grid-cols-3 gap-2">{cells}</div>

        {unassigned.length > 0 && (
          <div data-testid="unassigned-tray" className="flex flex-wrap gap-2 border-t border-border pt-3">
            {unassigned.map(cardChip)}
          </div>
        )}

        {/* AC-12 / SCR-04. `key` -- cardId: CloseCardDialog ініціалізує свій
            стан рядків ОДИН раз (useState(() => ...)), тож без ремаунта
            відкриття діалогу для іншої картки показувало б перемикачі
            попередньої. Назва картки -- тут, у заголовку: сам діалог її не
            рендерить (review 2026-09-11, Частина 3), а без неї незрозуміло, що
            саме закриваєш. role="dialog" -- теж звідси; фокус-пастка поки
            відсутня (знахідка рев'ю про фокус лишається відкритою). */}
        {closingCard !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
            <div
              role="dialog"
              aria-label={`Закрити напрямок «${closingCard.cardTitle}»`}
              className="flex w-full max-w-sm flex-col gap-4 rounded-card border border-border bg-surface-solid p-6 shadow-soft"
            >
              <h2 className="font-display text-lg font-semibold leading-relaxed text-ink">Закрити «{closingCard.cardTitle}»?</h2>
              {closeOptions === null ? (
                <Spinner />
              ) : (
                <CloseCardDialog
                  key={closingCard.cardId}
                  cardTitle={closingCard.cardTitle}
                  metricBlocks={closeOptions.metricBlocks}
                  targetCards={closeOptions.targetCards}
                  onClose={({ metricTransfers }) =>
                    (onCloseCard as NonNullable<LayoutBoardProps['onCloseCard']>)({
                      cardId: closingCard.cardId,
                      metricTransfers,
                    })
                  }
                  onClosed={() => {
                    dismissCloseDialog();
                    // Джерело правди -- сервер (позиція стала 'closed', метрики
                    // переїхали): перечитуємо розкладку, а не вгадуємо новий стан
                    // локально. screens.md SCR-04 success -- "повернення на SCR-02".
                    loadLayout()
                      .then(setState)
                      .catch((err: unknown) => {
                        const message = err instanceof Error ? err.message : 'Не вдалося оновити розкладку';
                        setBanner({ variant: 'error', text: `Напрямок закрито, але розкладку не перечитано. ${message}` });
                      });
                  }}
                  onCancel={dismissCloseDialog}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Живе тестування (Андрій): "Конфігурація" -- знизу по центру, поверх
          контенту (той самий floating-патерн, що DeclarationScreen/
          AnalyticsScreen), не зліва/справа. */}
      <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
        <Button label="Конфігурація" onClick={openConfig} />
      </div>
    </div>
  );
}
