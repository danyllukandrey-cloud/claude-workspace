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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  // Реальні DOM-вузли чипів на канві -- лінії зв'язків (нижче) відступають
  // від центру картки на ФАКТИЧНУ половину її розміру (ширина залежить від
  // довжини назви), а не на приблизну константу. Живе тестування (Андрій,
  // зі скріншотом): фіксований відступ ховав вістря стрілки під широким
  // чипом ("Філософія") -- константа була відкаліброва на вужчий чип.
  const cardElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
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

  // Живе тестування (Андрій, зі скріншотом): rectPullback (нижче, при
  // рендері ліній зв'язків) читає cardElementsRef -- а ref на чип картки
  // заповнюється лише ПІСЛЯ commit, тобто в межах ТОГО САМОГО виклику
  // render(), у якому вперше з'явились картки, cardElementsRef ще
  // порожній -- лінії малювались з відступом-заглушкою (замість реального
  // розміру чипа), тому вістря ховалось під широким чипом. Один додатковий
  // тік ПІСЛЯ commit (dragTick, той самий лічильник, що й драг) змушує
  // перемалювати лінії вже зі свіжо-заповненими рефами.
  useLayoutEffect(() => {
    setDragTick((tick) => tick + 1);
  }, [state.cards.length, state.connections.length]);

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

  /** Тап по картці, поки активний інструмент зв'язування (вимога 4/5). */
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

      {/* Живе тестування (Андрій): "блоки мають лежати в зоні де схема а не
          поза нею" -- ОДНА зона (канва + купка нерозкладених РАЗОМ, жодного
          border-top-розділювача між ними). "Низ зони має бути над кнопками і
          не змінюватись ні в верх ні в низ, зона не має опускатись нижче
          кнопок конфігурація" -- flex-1 (не фіксовані 70%) дає стабільний
          низ, АЛЕ плаваючий тулбар (absolute, поза потоком) інакше просто
          "плавав" би ПОВЕРХ нижньої частини зони, а не над порожнім місцем --
          mb-16 нижче явно резервує той самий простір, що займає тулбар
          (bottom-4 + висота кнопок), тож зона реально закінчується ВИЩЕ за
          кнопки, а не ховається під ними. Живе тестування (Андрій): "прибери
          рамку зони -- вона зайва, нижню частину просто відділи променем" --
          жодного border навколо зони, лише тонка горизонтальна риска під
          самим низом (окремий елемент нижче), не суцільна рамка. */}
      <div
        ref={canvasRef}
        data-testid="canvas"
        className="relative mb-16 flex-1 min-h-0 overflow-hidden"
      >
        {/* SVG-шар зв'язків -- viewBox 0..100 у ЄДИНИХ одиницях з
            left/top-відсотками карток нижче, тож лінія завжди влучає в центр
            чипа, незалежно від реального пропорцій канви (вимога 4). */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            {/* Живе тестування (Андрій, зі скріншотом): "це за великий розмір.
                Такого як розмір інструментарію достатньо" -- вістря було
                розміром 6 одиниць viewBox (при нерівномірному розтягу канви
                це вироджувалось у величезний трикутник). 1.8 -- приблизно
                розмір іконки інструменту в тулбарі (20px). */}
            <marker id="layout-board-arrowhead" markerWidth="1.8" markerHeight="1.8" refX="1.5" refY="0.9" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L1.8,0.9 L0,1.8 Z" fill="currentColor" />
            </marker>
          </defs>
          {state.connections.map((connection) => {
            const a = cardById.get(connection.cardIdA);
            const b = cardById.get(connection.cardIdB);
            if (!a || !b) return null;
            const posA = renderedPosition(a);
            const posB = renderedPosition(b);
            if (!posA || !posB) return null;
            // Живе тестування (Андрій): "При зєднання стрілкою стрілки самої
            // не видно" -- чип картки в DOM йде ПІСЛЯ svg-шару (рендериться
            // зверху), а кінець лінії/вістря стрілки стояв точно в центрі
            // чипа (posB) -- вістря ховалось під непрозорим фоном картки.
            // Далі (Андрій, зі скріншотом): фіксований відступ ховав вістря
            // під ШИРОКИМ чипом ("Філософія") -- константа калібрувалась на
            // вужчий чип. Відступ рахуємо за ФАКТИЧНИМ розміром DOM-вузла
            // кожної картки (rectHalfWidth/rectHalfHeight у % канви) --
            // класичне "промінь із центра прямокутника до його межі":
            // t = min(halfW/|ux|, halfH/|uy|).
            const dx = posB.x - posA.x;
            const dy = posB.y - posA.y;
            const dist = Math.hypot(dx, dy);
            const ux = dist > 0 ? dx / dist : 0;
            const uy = dist > 0 ? dy / dist : 0;
            const canvasRect = canvasRef.current?.getBoundingClientRect();
            const rectPullback = (cardId: string): number => {
              const el = cardElementsRef.current.get(cardId);
              if (!el || !canvasRect || canvasRect.width === 0 || canvasRect.height === 0) return 4;
              const chipRect = el.getBoundingClientRect();
              const halfW = (chipRect.width / 2 / canvasRect.width) * 100;
              const halfH = (chipRect.height / 2 / canvasRect.height) * 100;
              const tW = Math.abs(ux) > 0.001 ? halfW / Math.abs(ux) : Infinity;
              const tH = Math.abs(uy) > 0.001 ? halfH / Math.abs(uy) : Infinity;
              const t = Math.min(tW, tH);
              // +1 -- невеликий запас понад точну межу прямокутника, щоб
              // лінія не торкалась заокругленого кута впритул.
              return Number.isFinite(t) ? t + 1 : 4;
            };
            const pullbackA = dist > 0 ? Math.min(rectPullback(connection.cardIdA), dist / 2 - 0.5) : 0;
            const pullbackB = dist > 0 ? Math.min(rectPullback(connection.cardIdB), dist / 2 - 0.5) : 0;
            const x1 = posA.x + ux * pullbackA;
            const y1 = posA.y + uy * pullbackA;
            const x2 = posB.x - ux * pullbackB;
            const y2 = posB.y - uy * pullbackB;
            return (
              <line
                key={connection.id}
                data-testid={`connection-${connection.id}`}
                data-directed={connection.directed}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
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
              ref={(el) => {
                if (el) cardElementsRef.current.set(card.cardId, el);
                else cardElementsRef.current.delete(card.cardId);
              }}
              style={{ position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              {cardChip(card)}
            </div>
          );
        })}

        {/* Купка нерозкладених -- ВСЕРЕДИНІ тієї самої зони, доклеєна до її
            низу (absolute bottom-0), напівпрозорий фон-підклад, щоб читалась
            навіть поверх картки на канві під нею. max-h -- приблизно 3 рядки
            чипів (вимога Андрія "не більше"), далі власний внутрішній скрол. */}
        {unassigned.length > 0 && (
          <div
            data-testid="unassigned-tray"
            className="absolute inset-x-0 bottom-0 flex max-h-28 flex-wrap content-start gap-2 overflow-y-auto bg-surface/85 p-2 backdrop-blur-sm"
          >
            {unassigned.map((card) => cardChip(card))}
          </div>
        )}
      </div>

      {/* Живе тестування (Андрій): "нижню частину просто відділи променем в
          обидві сторони від центру над кнопкою та інструментом" -- тонка
          горизонтальна риска замість рамки, точно на межі зони (bottom-16 --
          та сама відстань, що mb-16 зони вище), над плаваючим тулбаром. */}
      <div className="pointer-events-none absolute inset-x-10 z-10 border-t border-border" style={{ bottom: '4rem' }} />

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

      {/* Живе тестування (Андрій): "Замість кнопки зв'язати можна просто два
          інструменти стрілочку та пряму з двома кружечками які можна
          вибрати" -- прибрано проміжну кнопку-шлюз "Зв'язати" + окрему
          "Готово". Тепер два інструменти ЗАВЖДИ видимі поруч із
          "Конфігурація": клік по неактивному -- вмикає (перемикає з іншого,
          якщо той був активний), клік по вже активному -- вимикає назад у
          звичайний режим перетягування (той самий toggle, що LAYOUT_MODE
          пігулки, лише без "Готово" -- сам клік по активній іконці ним і є). */}
      <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
        <button
          type="button"
          aria-label="Лінія"
          aria-pressed={linkTool === 'line'}
          onClick={() => setLinkTool((prev) => (prev === 'line' ? null : 'line'))}
          className={`flex h-11 w-11 items-center justify-center rounded-control border transition-colors ${
            linkTool === 'line' ? 'border-ink bg-ink/10 text-ink' : 'border-border bg-surface-solid text-ink-muted hover:border-ink/40'
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="4" cy="10" r="2.4" fill="currentColor" />
            <line x1="6.4" y1="10" x2="13.6" y2="10" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="16" cy="10" r="2.4" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Стрілка"
          aria-pressed={linkTool === 'arrow'}
          onClick={() => setLinkTool((prev) => (prev === 'arrow' ? null : 'arrow'))}
          className={`flex h-11 w-11 items-center justify-center rounded-control border transition-colors ${
            linkTool === 'arrow' ? 'border-ink bg-ink/10 text-ink' : 'border-border bg-surface-solid text-ink-muted hover:border-ink/40'
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <line x1="3" y1="10" x2="15" y2="10" stroke="currentColor" strokeWidth="1.6" />
            <path d="M11 5.5 L16.5 10 L11 14.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </button>
        <Button label="Конфігурація" onClick={openConfig} />
      </div>
    </div>
  );
}
