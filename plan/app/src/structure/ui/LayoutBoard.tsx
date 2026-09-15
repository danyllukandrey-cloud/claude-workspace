// SCR-02 — Схема (spec.md AC-08, AC-11, AC-11b; D-131-наступне рішення).
//
// Андрій (чат, 2026-09-15), кілька повідомлень підряд:
// 1. "Схема не працює і вона жахлива. Пропоную прибрати повністю оті
//    клітинки." — фіксована сітка клітинок прибрана ПОВНІСТЮ, канва вільна.
// 2. "просто зображення схеми щоб займало верхні 70 відсотків екрану, а
//    блоки просто нехай будуть поскладані з низу" — ОДНА канва (верхні 70%
//    висоти кореня екрана), нерозкладені картки скупчені в решті простору
//    знизу (купка/tray), не окрема "зона базового розташування".
// 3. "Блоки мають пересуватись вільно і по нижній розкладці і по верхній
//    мишкою чи пальцем в телефоні." — реальний touch-drag через Pointer
//    Events API (onPointerDown/Move/Up), НЕ HTML5 draggable/onDragStart
//    (те, що тут стояло раніше -- фізично не працює на дотикових екранах).
// 4. "Між блоками потрібно створити звязки... можемо розєднати і
//    перезєднати." — інструмент "Зв'язати": тап по першій картці, тап по
//    другій -- лінія/стрілка з'являється. Тап по наявній лінії -- видаляє її
//    (миттєво, без ConfirmDialog -- легша дія, ніж архівація картки, яка
//    справді має незворотні наслідки для метрик; зв'язок можна перестворити
//    одним тапом, тож зайвий діалог лише сповільнював би основний сценарій
//    "зʼєднав не так -- перезʼєднав").
// 5. "якщо ми робимо стрілки то нам потрібно буде додати їх як
//    інструментарій можливого з'єднання" — перемикач "Лінія"/"Стрілка" ПЕРЕД
//    тим, як тапати картки.
//
// DI (plan/app/CLAUDE.md, той самий стиль, що DeclarationScreen/
// AnalyticsScreen): loadLayout/onMoveCard/onCreateConnection/
// onDeleteConnection — ін'єктовані пропи-функції, жодного fetch() тут.
//
// CONFIG-екран (пікер режиму розкладки, ConfirmDialog про авто-розклад) --
// ЛИШАЄТЬСЯ як є з попереднього проходу (D-131), логіка вибору режиму тут не
// змінюється. Змінюється лише BOARD-екран (сама канва).

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Banner, Button, ConfirmDialog, EmptyState, Spinner } from '../../shared/ui';
import { CloseCardDialog } from './CloseCardDialog';
import type {
  CloseCardDialogMetricBlock,
  CloseCardDialogTargetCard,
  CloseCardMetricTransferInput,
} from './CloseCardDialog';
import type { LayoutMode } from '../domain/layout';
import { clampPercent } from '../domain/layout';

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
  /** Відсоток канви (0-100). Обидва `null` разом -- картка в купці нерозкладених знизу екрана. */
  x: number | null;
  y: number | null;
}

export interface LayoutBoardConnection {
  id: string;
  cardIdA: string;
  cardIdB: string;
  /** true -- стрілка cardIdA -> cardIdB; false -- звичайна лінія. */
  directed: boolean;
}

/** Те, що SCR-04 має знати про картку, яку закривають (AC-12). */
export interface LayoutBoardCloseCardOptions {
  metricBlocks: CloseCardDialogMetricBlock[];
  /** Куди можна перенести метрику -- решта активних карток власника. */
  targetCards: CloseCardDialogTargetCard[];
}

export interface LayoutBoardState {
  /**
   * Режим Структури на момент завантаження -- потрібен лише щоб зробити
   * ЯВНИМ купку нерозкладених карток, коли `layoutMode === 'staging'`
   * (вимога 15's сенс: цей режим НІЧОГО не авто-розкладає). `null` -- режим
   * ще не обрано (AC-09).
   */
  layoutMode: LayoutMode;
  cards: LayoutBoardCard[];
  connections: LayoutBoardConnection[];
}

export interface LayoutBoardProps {
  /** Завантажує поточну розкладку (позиції + зв'язки + картки). */
  loadLayout: () => Promise<LayoutBoardState>;
  /** Переносить картку на нову позицію канви (0-100 %). Кидає AppError-подібну помилку, якщо сервер відповів, або звичайну Error при мережевому збої. */
  onMoveCard: (input: { cardId: string; x: number; y: number }) => Promise<void>;
  /** Вимоги 4/5 -- інструмент "Зв'язати" створює лінію (`directed: false`) чи стрілку (`directed: true`, cardIdA -> cardIdB). */
  onCreateConnection: (input: { cardIdA: string; cardIdB: string; directed: boolean }) => Promise<void>;
  /** Вимога 4 -- тап по наявному зв'язку розриває його. */
  onDeleteConnection: (input: { connectionId: string }) => Promise<void>;
  /**
   * "Конфігурація" -- зберігає ОБРАНИЙ режим розкладки (AC-11/AC-11b), що на
   * сервері тепер рахує реальний авто-розклад (D-131-наступне рішення), не
   * скидання в трей. Кидає AppError-подібну помилку, якщо сервер відповів,
   * або звичайну Error при мережевому збої (офлайн).
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

/** Обидва варіанти, які пропонує інструмент "Зв'язати" (вимога 5). */
type LinkTool = 'line' | 'arrow';

export function LayoutBoard({
  loadLayout,
  onMoveCard,
  onCreateConnection,
  onDeleteConnection,
  onSaveLayoutMode,
  loadCloseCardOptions,
  onCloseCard,
}: LayoutBoardProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<LayoutBoardState>({ layoutMode: null, cards: [], connections: [] });
  const [banner, setBanner] = useState<{ variant: 'error' | 'info'; text: string } | null>(null);

  // AC-12: яку картку закриваємо (null -- діалог закритий) і чим його наповнити.
  const [closingCard, setClosingCard] = useState<{ cardId: string; cardTitle: string } | null>(null);
  const [closeOptions, setCloseOptions] = useState<LayoutBoardCloseCardOptions | null>(null);

  // Живе тестування (Андрій): "Конфігурація" -- локальний перемикач екрана.
  const [screenMode, setScreenMode] = useState<'board' | 'config'>('board');
  const [pendingLayoutMode, setPendingLayoutMode] = useState<LayoutMode>(null);
  const [configBanner, setConfigBanner] = useState<{ variant: 'error' | 'info'; text: string } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  // --- Драг мишею/дотиком (вимога 3) -- Pointer Events API -------------------
  const canvasRef = useRef<HTMLDivElement>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  // Джерело правди для позиції картки, що ЗАРАЗ тягнеться -- ref (синхронний
  // читач на pointerup), `dragTick` лише змушує React перемалювати JSX із
  // цим свіжим значенням (сам ref зміни не спричиняє ре-рендер).
  const liveDragRef = useRef<{ cardId: string; x: number; y: number } | null>(null);
  const [, setDragTick] = useState(0);

  // --- Інструмент "Зв'язати" (вимоги 4/5) -------------------------------------
  const [linkTool, setLinkTool] = useState<LinkTool | null>(null);
  const [linkFirstCardId, setLinkFirstCardId] = useState<string | null>(null);

  useEffect(() => {
    loadLayout().then((loaded) => {
      setState(loaded);
      setLoading(false);
    });
    // Навмисно без loadLayout у deps -- викликається рівно раз при монтуванні.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Пікселі вказівника -> відсоток канви (0-100), клемплені -- той самий clampPercent, що сервер (domain/layout.ts). */
  function toCanvasPercent(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { x: clampPercent(Number.NaN), y: clampPercent(Number.NaN) };
    }
    return {
      x: clampPercent(((clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((clientY - rect.top) / rect.height) * 100),
    };
  }

  useEffect(() => {
    if (!draggingCardId) return undefined;

    const handleMove = (event: PointerEvent): void => {
      const { x, y } = toCanvasPercent(event.clientX, event.clientY);
      liveDragRef.current = { cardId: draggingCardId, x, y };
      setDragTick((tick) => tick + 1);
    };

    const handleUp = (): void => {
      const final = liveDragRef.current;
      liveDragRef.current = null;
      setDraggingCardId(null);
      if (!final) return;

      onMoveCard({ cardId: final.cardId, x: final.x, y: final.y }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Не вдалося зберегти позицію';
        setBanner({ variant: 'error', text: `Не вдалося зберегти позицію -- мережева помилка. ${message}` });
      });
      // Оптимістично лишаємо картку там, де її відпустили -- наступний
      // loadLayout() (наприклад, після зміни конфігурації) підтвердить
      // реальний серверний стан, той самий принцип, що onCloseCard/
      // onSaveLayoutMode нижче.
      setState((prev) => ({
        ...prev,
        cards: prev.cards.map((card) => (card.cardId === final.cardId ? { ...card, x: final.x, y: final.y } : card)),
      }));
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingCardId]);

  if (loading) {
    return <Spinner />;
  }

  if (state.cards.length === 0) {
    return <EmptyState message="Поки що немає жодної картки" actionHint="Додай картку, щоб розкласти її тут" />;
  }

  // AC-11/AC-11b: рахуємо напряму з уже завантажених позицій.
  const hasArrangedCards = state.cards.some((card) => card.x !== null);

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
        // Джерело правди -- сервер (реальний авто-розклад нового режиму):
        // перечитуємо розкладку, а не вгадуємо новий стан локально.
        loadLayout()
          .then(setState)
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'Не вдалося оновити розкладку';
            setBanner({ variant: 'error', text: `Режим збережено, але розкладку не перечитано. ${message}` });
          });
      })
      .catch((err: unknown) => {
        if (isAppErrorShape(err)) {
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
    setPendingLayoutMode(state.layoutMode);
  };

  if (screenMode === 'config') {
    return (
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 pb-20">
          {/* D-111: варіанти одного вибору (режим розкладки) лишаються поруч,
              як рядок пігулок, що переноситься на вузькому екрані. */}
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
            message="Зміна розкладки перерахує авто-розклад для всіх карток за новим режимом. Продовжити?"
            confirmLabel="Змінити"
            cancelLabel="Скасувати"
            onConfirm={handleConfirmChange}
            onCancel={handleCancelChange}
          />
        )}
      </div>
    );
  }

  // --- BOARD -------------------------------------------------------------

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
        setClosingCard(null);
        const message = err instanceof Error ? err.message : 'Не вдалося прочитати метрики картки';
        setBanner({ variant: 'error', text: `Не вдалося відкрити закриття напрямку. ${message}` });
      });
  };

  const dismissCloseDialog = (): void => {
    setClosingCard(null);
    setCloseOptions(null);
  };

  const exitLinkMode = (): void => {
    setLinkTool(null);
    setLinkFirstCardId(null);
  };

  /** Тап по картці, поки активний інструмент "Зв'язати" (вимога 4/5). */
  const handleLinkTap = (cardId: string): void => {
    if (linkTool === null) return;

    if (linkFirstCardId === null) {
      setLinkFirstCardId(cardId);
      return;
    }

    if (linkFirstCardId === cardId) {
      // Тап по вже обраній картці вдруге -- скасовує вибір, не створює
      // зв'язок картки самої із собою.
      setLinkFirstCardId(null);
      return;
    }

    const cardIdA = linkFirstCardId;
    const cardIdB = cardId;
    setLinkFirstCardId(null);
    onCreateConnection({ cardIdA, cardIdB, directed: linkTool === 'arrow' })
      .then(() => loadLayout())
      .then(setState)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Не вдалося створити зв'язок";
        setBanner({ variant: 'error', text: message });
      });
  };

  /** Тап по наявній лінії/стрілці -- миттєве видалення (не архівація, легша дія, D-131-наступне рішення). */
  const handleDeleteConnection = (connectionId: string): void => {
    setState((prev) => ({ ...prev, connections: prev.connections.filter((c) => c.id !== connectionId) }));
    onDeleteConnection({ connectionId }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Не вдалося видалити зв'язок";
      setBanner({ variant: 'error', text: message });
      // Відмова -- перечитуємо реальний стан, локальне видалення вище було оптимістичним.
      loadLayout().then(setState).catch(() => {});
    });
  };

  const handlePointerDown = (cardId: string) => (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (linkTool !== null) {
      handleLinkTap(cardId);
      return;
    }
    event.preventDefault();
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // jsdom/старі браузери -- pointer capture best-effort, window-рівневі
      // слухачі (useEffect вище) працюють і без нього.
    }
    // Стартова "жива" позиція -- поточна збережена (чи центр канви 50/50,
    // якщо картка досі в купці нерозкладених) -- так чип не смикається до
    // першого pointermove.
    const existing = state.cards.find((c) => c.cardId === cardId);
    setDraggingCardId(cardId);
    liveDragRef.current = { cardId, x: existing?.x ?? 50, y: existing?.y ?? 50 };
  };

  /** Позиція картки для рендеру -- жива (під час драгу) чи збережена. */
  function renderedPosition(card: LayoutBoardCard): { x: number; y: number } | null {
    if (draggingCardId === card.cardId && liveDragRef.current?.cardId === card.cardId) {
      return { x: liveDragRef.current.x, y: liveDragRef.current.y };
    }
    if (card.x === null || card.y === null) return null;
    return { x: card.x, y: card.y };
  }

  /**
   * Назва картки + (за наявності можливості) дія "Закрити напрямок". Спільний
   * рендер для канви й для купки нерозкладених.
   */
  const cardChip = (card: LayoutBoardCard, extraClassName = ''): JSX.Element => (
    <div
      key={card.cardId}
      data-testid={`card-${card.cardId}`}
      data-card-id={card.cardId}
      onPointerDown={handlePointerDown(card.cardId)}
      style={{ touchAction: 'none' }}
      className={`flex max-w-full cursor-grab flex-col items-center gap-1 rounded-control bg-surface-solid px-2.5 py-2 text-center shadow-soft active:cursor-grabbing ${extraClassName}`}
    >
      <span className="max-w-full truncate text-xs font-semibold text-ink">{card.cardTitle}</span>
      {canCloseCard && (
        <button
          type="button"
          aria-label={`Закрити напрямок «${card.cardTitle}»`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => openCloseDialog(card)}
          className="text-[11px] font-medium text-ink-faint transition-colors hover:text-ink"
        >
          Закрити напрямок
        </button>
      )}
    </div>
  );

  const unassigned = state.cards.filter((card) => card.x === null && card.cardId !== draggingCardId);
  const canvasCards = state.cards.filter((card) => card.x !== null || card.cardId === draggingCardId);

  // Вимога 15 ("Готово до розкладання"): купка нерозкладених лишається явним
  // стійким нагадуванням для цього режиму, поки лишається хоч одна картка без позиції.
  const showStagingHint = state.layoutMode === 'staging' && unassigned.length > 0;

  const cardById = new Map(state.cards.map((card) => [card.cardId, card]));

  const linkHint =
    linkTool === null
      ? null
      : linkFirstCardId === null
        ? 'Оберіть першу картку, потім другу -- зʼявиться зв\'язок'
        : 'Оберіть другу картку';

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {banner !== null && (
        <div className="px-1 pb-2">
          <Banner variant={banner.variant} text={banner.text} />
        </div>
      )}

      {linkHint !== null && (
        <div className="px-1 pb-2">
          <Banner variant="info" text={linkHint} />
        </div>
      )}

      {showStagingHint && (
        <div className="px-1 pb-2">
          <Banner variant="info" text="Готово до розкладання -- перетягни картки знизу на канву" />
        </div>
      )}

      {/* Вимога 2 (Андрій, чат): ОДНА канва -- верхні 70% висоти екрана, не
          окрема "зона базового розташування". */}
      <div ref={canvasRef} data-testid="canvas" className="relative h-[70%] min-h-0 shrink-0 overflow-hidden rounded-control border border-border">
        {/* SVG-шар зв'язків -- viewBox 0..100 у ЄДИНИХ одиницях з
            left/top-відсотками карток нижче, тож лінія завжди влучає в центр
            чипа, незалежно від реального пропорцій канви (вимога 4). */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <marker id="layout-board-arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
            </marker>
          </defs>
          {state.connections.map((connection) => {
            const a = cardById.get(connection.cardIdA);
            const b = cardById.get(connection.cardIdB);
            if (!a || !b) return null;
            const posA = renderedPosition(a);
            const posB = renderedPosition(b);
            if (!posA || !posB) return null;
            return (
              <line
                key={connection.id}
                data-testid={`connection-${connection.id}`}
                data-directed={connection.directed}
                x1={posA.x}
                y1={posA.y}
                x2={posB.x}
                y2={posB.y}
                className={`text-ink/50 hover:text-ink ${linkTool === null ? 'pointer-events-auto cursor-pointer' : ''}`}
                stroke="currentColor"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                markerEnd={connection.directed ? 'url(#layout-board-arrowhead)' : undefined}
                onClick={linkTool === null ? () => handleDeleteConnection(connection.id) : undefined}
              />
            );
          })}
        </svg>

        {canvasCards.map((card) => {
          const pos = renderedPosition(card);
          if (!pos) return null;
          return (
            <div
              key={card.cardId}
              style={{ position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              {cardChip(card)}
            </div>
          );
        })}
      </div>

      {/* Вимога 2: купка нерозкладених -- решта висоти, звичайний потік (flex-wrap), не absolute. */}
      <div data-testid="unassigned-tray" className="flex min-h-0 flex-1 flex-wrap content-start gap-2 overflow-y-auto border-t border-border pt-3">
        {unassigned.map((card) => cardChip(card))}
      </div>

      {/* AC-12 / SCR-04. */}
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

      {/* Живе тестування (Андрій): "Конфігурація" -- знизу по центру, поверх
          контенту. "Зв'язати" (вимоги 4/5) -- поруч, той самий floating-патерн. */}
      <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
        {linkTool === null ? (
          <>
            <Button label="Зв'язати" onClick={() => setLinkTool('line')} />
            <Button label="Конфігурація" onClick={openConfig} />
          </>
        ) : (
          <>
            <button
              type="button"
              aria-pressed={linkTool === 'line'}
              onClick={() => setLinkTool('line')}
              className={`rounded-control border px-3.5 py-2.5 text-sm font-bold transition-colors ${
                linkTool === 'line' ? 'border-ink bg-ink/10 text-ink' : 'border-border bg-surface-solid text-ink-muted'
              }`}
            >
              Лінія
            </button>
            <button
              type="button"
              aria-pressed={linkTool === 'arrow'}
              onClick={() => setLinkTool('arrow')}
              className={`rounded-control border px-3.5 py-2.5 text-sm font-bold transition-colors ${
                linkTool === 'arrow' ? 'border-ink bg-ink/10 text-ink' : 'border-border bg-surface-solid text-ink-muted'
              }`}
            >
              Стрілка
            </button>
            <Button label="Готово" onClick={exitLinkMode} />
          </>
        )}
      </div>
    </div>
  );
}
