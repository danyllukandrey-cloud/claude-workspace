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
//
// CH-01 (docs/features/structure/changes.md): кнопка "Архів карток" додана
// в тулбар BOARD-екрана, поруч із "Конфігурація" -- друга точка входу в
// архів (перша -- дубль на DeckScreen, life-area-card CH-01), обидві через
// той самий onOpenArchive, який App.tsx підставляє однаково в обидва місця.
//
// CH-03 (частина 1 з 2, docs/features/structure/changes.md): "На зад" на
// сторінці конфігурації -- зліва від "Зберегти", той самий патерн, що
// MetricBlockForm.tsx's onCancel (life-area-card).
//
// CH-04 (docs/features/structure/changes.md): купка нерозкладених ("трей")
// тепер ЗАВЖДИ доступна як ціль перетягування під час драгу (не лише коли в
// ній уже щось лежить). П.1 цього рішення (візуальне стиснення карток канви
// по Y, щоб трей їх не затуляв) СКАСОВАНО живим тестуванням нижче -- дивись
// коментар над renderedPosition.
//
// CH-05/CH-06 (docs/features/structure/changes.md): "Закрити напрямок"
// (структуроспецифічний POST /structure/layout/{cardId}/close) прибрано
// повністю -- дія на чипі картки тепер "Архівувати", той самий injected
// archiveCard, що колода (life-area-card), і той самий injected
// onTransferMetricBlock для перенесення метрик у LayoutBoardArchiveDialog.tsx.
//
// CH-10 (docs/features/structure/changes.md): перемикання конфігурації на
// "Готово до розкладання" переносить усі картки з канви в трей.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Banner, Button, ConfirmDialog, EmptyState, Spinner } from '../../shared/ui';
import { LayoutBoardArchiveDialog } from './LayoutBoardArchiveDialog';
import type { LayoutBoardArchiveDialogMetricBlock, LayoutBoardArchiveDialogTargetCard } from './LayoutBoardArchiveDialog';
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

/**
 * CH-02 (docs/features/structure/changes.md, скоординовано з life-area-card
 * CH-02): той самий тримовний набір, що `life-area-card`'s CardHealthState
 * -- НЕЗАЛЕЖНИЙ локальний тип, не імпорт з `life-area-card` (правило
 * залежностей, plan/app/CLAUDE.md: `structure` не перевикористовує UI/типи
 * картки, лише власний канал `loadLayout`, який `app` (main.tsx) наповнює
 * тим самим фактом з GET /cards).
 */
export type LayoutBoardCardHealthState = 'active' | 'critical' | 'paused';

export interface LayoutBoardCard {
  cardId: string;
  cardTitle: string;
  /** Відсоток канви (0-100). Обидва `null` разом -- картка в купці нерозкладених знизу екрана. */
  x: number | null;
  y: number | null;
  /** CH-02: ненульове лише для карток у режимі "стан без вимірювань" -- домальовується м'ячиком у cardChip нижче. */
  healthState: LayoutBoardCardHealthState | null;
}

export interface LayoutBoardConnection {
  id: string;
  cardIdA: string;
  cardIdB: string;
  /** true -- стрілка cardIdA -> cardIdB; false -- звичайна лінія. */
  directed: boolean;
}

/** Те, що SCR-04 (тепер "Архівування") має знати про картку, яку архівують (AC-12). */
export interface LayoutBoardCloseCardOptions {
  metricBlocks: LayoutBoardArchiveDialogMetricBlock[];
  /** Куди можна перенести метрику -- решта активних карток власника. */
  targetCards: LayoutBoardArchiveDialogTargetCard[];
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
   * AC-12 -- читає, що саме пропонувати перенести перед архівацією (GET
   * /cards/{cardId}/metric-blocks + перелік карток-цілей). Назва проп
   * лишається `loadCloseCardOptions` -- сам ендпоінт НЕ структуроспецифічний
   * (генеричний GET .../metric-blocks, той самий, що вже живить
   * CardBack.transferTargetCards), перейменування самого проп через
   * App.tsx/main.tsx сюди навмисно не заходило (CH-05/CH-06 обмежені
   * підключенням архівації, не рефактором назв уже робочого читання).
   * Опційний: поки composition root його не підставив, дії "Архівувати" на
   * чипі просто немає -- краще ніж діалог, який нікуди не веде.
   */
  loadCloseCardOptions?: (cardId: string) => Promise<LayoutBoardCloseCardOptions>;
  /**
   * CH-05: замінює структуроспецифічний `onCloseCard` (POST
   * /structure/layout/{cardId}/close, прибраний повністю) -- ТОЙ САМИЙ
   * injected `archiveCard`, що вже архівує картку з колоди (life-area-card
   * CardFace/CardBack "..." -> "Архівувати"; D-103: use-case сам закриває
   * активну позицію картки в розкладці Структури). Опційний разом із
   * loadCloseCardOptions -- без обох дія "Архівувати" на чипі не рендериться.
   */
  onArchiveCard?: (cardId: string) => Promise<void>;
  /**
   * CH-06: переносить один блок-метрику картки, що архівується, на іншу
   * картку -- ТОЙ САМИЙ injected onTransferMetricBlock, що вже працює на
   * звороті картки (CardBack.tsx). Опційний -- без нього рядки метрик у
   * діалозі архівування рендеряться без кнопки "Перенести" (той самий "без
   * пропу афорданс не рендериться" принцип, що CardBack.tsx).
   */
  onTransferMetricBlock?: (cardId: string, metricBlockId: string, targetCardId: string) => Promise<void>;
  /**
   * CH-01 (docs/features/structure/changes.md): кнопка "Архів карток" біля
   * "Конфігурація" -- та сама точка входу, що дубль на DeckScreen
   * (life-area-card CH-01, координовано). App.tsx (composition root)
   * підставляє СПІЛЬНИЙ callback в обидва місця -- не окрему реалізацію тут.
   */
  onOpenArchive: () => void;
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

// CH-15 (docs/features/structure/changes.md, живе тестування, Андрій зі
// скріншотами різних масштабів браузера): "картки накладаються одна на одну
// при збільшенні масштабу" -- розмір чипів (текст/відступи) фіксований у
// пікселях і НЕ залежить від розміру канви, тож коли сама канва фізично
// стискається (більший масштаб браузера = МЕНШЕ CSS-пікселів на екрані),
// чипи займають дедалі БІЛЬШУ частку дедалі МЕНШОЇ канви -- і зрештою
// накладаються. Проста "згорнути всю канву" transform:scale() НЕ рішення --
// і чипи, і "канва" (система відсотків) стискаються РАЗОМ в однаковій
// пропорції, тож співвідношення чип/канва не змінюється (перевірено
// розрахунком, не здогадкою). Реальне рішення -- ДВА окремі контейнери:
// contentRef (нижче) має ЗАВЖДИ ОДИН І ТОЙ САМИЙ пиксельний розмір, тож уся
// система відсотків (0-100) завжди рахується відносно ЦЬОГО фіксованого
// розміру, і лише ПІСЛЯ цього готова "картинка" масштабується (CSS
// transform: scale, canvasScale нижче) під РЕАЛЬНИЙ розмір canvasRef.
//
// Живе тестування, ІТЕРАЦІЯ 2 (Андрій, зі скріншотами 125%/159%/зменшеного
// масштабу): перша версія мала ЖОРСТКО закодований "комфортний" розмір
// (900x480, довільне число без виміру реального пристрою) -- на екрані,
// де канва НІКОЛИ природно не сягає такого розміру, це змушувало сцену
// стискатись ЗАВЖДИ, навіть на звичайному, некритичному масштабі. Замість
// довільного числа -- REFERENCE калібрується сам, з РЕАЛЬНОГО розміру
// canvasRef при першому вимірюванні (referenceSize нижче, useState,
// пишеться РІВНО ОДИН РАЗ): "той розмір, який канва мала природно щойно
// відкрили Схему" стає еталонним "масштаб=1", і лише ВІДХИЛЕННЯ від нього
// (зменшення канви при збільшенні масштабу браузера) стискає сцену.
// Жодного магічного числа -- калібрування під конкретний пристрій/вікно.
const MIN_CANVAS_SCALE = 0.55;

// CH-02: той самий колірний словник (chip-gloss/STATUS_DOT патерн, D-120/
// D-126), що life-area-card/ui/CardFace.tsx's HEALTH_STATE_DOT -- НЕ спільний
// імпорт (правило залежностей), окрема копія того самого факту.
const HEALTH_STATE_DOT: Record<LayoutBoardCardHealthState, string> = {
  active: 'bg-good',
  critical: 'bg-bad',
  paused: 'bg-warn',
};

/**
 * Той самий переклад, що life-area-card/ui/CardFace.tsx's HEALTH_STATE_LABEL
 * -- окрема копія (правило залежностей). Code review 2026-09-19: aria-label
 * має нести український підпис, як і решта картки, не сирий enum-код.
 */
const HEALTH_STATE_LABEL: Record<LayoutBoardCardHealthState, string> = {
  active: 'використовується',
  critical: 'критично потребує відновлення',
  paused: 'на паузі',
};

export function LayoutBoard({
  loadLayout,
  onMoveCard,
  onCreateConnection,
  onDeleteConnection,
  onSaveLayoutMode,
  loadCloseCardOptions,
  onArchiveCard,
  onTransferMetricBlock,
  onOpenArchive,
}: LayoutBoardProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<LayoutBoardState>({ layoutMode: null, cards: [], connections: [] });
  const [banner, setBanner] = useState<{ variant: 'error' | 'info'; text: string } | null>(null);

  // AC-12: яку картку архівуємо (null -- діалог закритий) і чим його наповнити.
  const [archivingCard, setArchivingCard] = useState<{ cardId: string; cardTitle: string } | null>(null);
  const [archiveOptions, setArchiveOptions] = useState<LayoutBoardCloseCardOptions | null>(null);

  // Живе тестування (Андрій): "Конфігурація" -- локальний перемикач екрана.
  const [screenMode, setScreenMode] = useState<'board' | 'config'>('board');
  const [pendingLayoutMode, setPendingLayoutMode] = useState<LayoutMode>(null);
  const [configBanner, setConfigBanner] = useState<{ variant: 'error' | 'info'; text: string } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  // CH-04/CH-10: картки, що ВІЗУАЛЬНО показані в треї client-side, попри
  // збережену на сервері позицію -- (а) CH-04 п.2, картку перетягнули у
  // затемнену зону й лишили, (б) CH-10, усі картки канви одразу після
  // перемикання режиму на "Готово до розкладання" (сервер для staging нічого
  // не пише, domain/layout.ts computeStagingLayout -- явний no-op).
  // НАВМИСНО ефемерний client-only стан, не бекенд-виклик: PUT
  // /structure/layout/{cardId} (docs/features/structure/contracts/
  // openapi.yaml:204) приймає лише число, скидання позиції в null на сервері
  // вимагало б розширення контракту -- поза межами цієї правки (LayoutBoard.tsx
  // сам собою). Переживає лише цей візит на Схему: новий loadLayout() при
  // монтуванні починає з чистого Set, як і мало бути -- сервер лишається
  // джерелом правди для чогось, що НЕ було свідомо позначене тут.
  const [pendingUnassignedIds, setPendingUnassignedIds] = useState<Set<string>>(new Set());

  // --- Драг мишею/дотиком (вимога 3) -- Pointer Events API -------------------
  const canvasRef = useRef<HTMLDivElement>(null);
  // CH-15: РЕАЛЬНИЙ, змінного розміру контейнер (весь простір, що дає flex-
  // розкладка сторінки) -- рендерить лише фон/рамку/onClick-скидання
  // pendingDeleteConnectionId. Уся система відсотків (SVG-лінії, чипи, трей)
  // живе у contentRef нижче, фіксованого розміру, відцентрованого й
  // промасштабованого всередину canvasRef (canvasScale, ефект нижче).
  const contentRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  // CH-15, ІТЕРАЦІЯ 2: "масштаб=1" калібрується з РЕАЛЬНОГО розміру
  // canvasRef при першому вимірюванні -- ref (не state!), щоб ResizeObserver-
  // колбек (створений ОДИН раз при монтуванні, замикання не бачить пізніших
  // state) завжди читав СВІЖЕ значення без переприв'язки ефекту. null -- ще
  // не виміряно (перший рендер), contentRef тоді розтягується на 100%/100%
  // (візуально ідентично canvasRef -- як і ДО цього рефакторингу), жодного
  // стрибка контенту.
  const referenceSizeRef = useRef<{ width: number; height: number } | null>(null);
  // Реальні DOM-вузли чипів на канві -- лінії зв'язків (нижче) відступають
  // від центру картки на ФАКТИЧНУ половину її розміру (ширина залежить від
  // довжини назви), а не на приблизну константу. Живе тестування (Андрій,
  // зі скріншотом): фіксований відступ ховав вістря стрілки під широким
  // чипом ("Філософія") -- константа була відкаліброва на вужчий чип.
  const cardElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // CH-04 п.2: реальний DOM-вузол купки -- handleUp визначає, чи відпустили
  // картку САМЕ в цій зоні.
  const trayRef = useRef<HTMLDivElement>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  // Джерело правди для позиції картки, що ЗАРАЗ тягнеться -- ref (синхронний
  // читач на pointerup), `dragTick` лише змушує React перемалювати JSX із
  // цим свіжим значенням (сам ref зміни не спричиняє ре-рендер).
  const liveDragRef = useRef<{ cardId: string; x: number; y: number } | null>(null);
  const [, setDragTick] = useState(0);

  // --- Інструмент "Зв'язати" (вимоги 4/5) -------------------------------------
  const [linkTool, setLinkTool] = useState<LinkTool | null>(null);
  const [linkFirstCardId, setLinkFirstCardId] = useState<string | null>(null);
  /** CH-12: id зв'язку, що чекає підтвердження видалення (кнопка "Видалити" показана саме для нього), або null -- нікого не озброєно. */
  const [pendingDeleteConnectionId, setPendingDeleteConnectionId] = useState<string | null>(null);

  // CH-15: вимірює РЕАЛЬНИЙ (природний, до будь-якого transform) розмір
  // canvasRef -- offsetWidth/offsetHeight/ResizeObserver.contentRect НЕ
  // залежать від CSS transform (лише від layout, transform -- суто paint),
  // тож жодного зациклення "вимірюємо вже промасштабоване" тут немає.
  // typeof-перевірка -- jsdom (тести) не має ResizeObserver: без неї scale
  // лишається 1 назавжди в тестах, поведінка й далі детермінована (той самий
  // підхід, що try/catch навколо setPointerCapture вище).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (width: number, height: number): void => {
      if (width === 0 || height === 0) return;
      // Перше вимірювання -- еталон "масштаб=1", НАЗАВЖДИ (не перезаписується).
      if (referenceSizeRef.current === null) {
        referenceSizeRef.current = { width, height };
        setCanvasScale(1);
        return;
      }
      const { width: refWidth, height: refHeight } = referenceSizeRef.current;
      const scale = Math.min(width / refWidth, height / refHeight, 1);
      setCanvasScale(Number.isFinite(scale) && scale > 0 ? Math.max(scale, MIN_CANVAS_SCALE) : 1);
    };
    measure(el.offsetWidth, el.offsetHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentBoxSize?.[0];
      if (box) {
        measure(box.inlineSize, box.blockSize);
      } else {
        measure(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
  // перемалювати лінії вже зі свіжо-заповненими рефами. CH-04: той самий
  // тік тепер залежить і від кількості нерозкладених (unassignedCount нижче)
  // -- поява/зникнення купки переносить картки між канвою й треєм (різні
  // DOM-вузли), cardElementsRef мусить оновитись свіжими рефами.
  const unassignedCount = state.cards.filter((card) => card.x === null || pendingUnassignedIds.has(card.cardId)).length;
  useLayoutEffect(() => {
    setDragTick((tick) => tick + 1);
  }, [state.cards.length, state.connections.length, unassignedCount, draggingCardId]);

  /**
   * Пікселі вказівника -> відсоток канви (0-100), клемплені -- той самий
   * clampPercent, що сервер (domain/layout.ts). CH-15: contentRef (не
   * canvasRef) -- саме contentRef несе систему відсотків (0-100), і
   * getBoundingClientRect() на трансформованому (масштабованому) елементі
   * коректно повертає ВЖЕ візуальний (після transform) прямокутник у
   * координатах вьюпорта -- той самий простір, що clientX/clientY, тож жодної
   * додаткової математики під масштаб не треба.
   */
  function toCanvasPercent(clientX: number, clientY: number): { x: number; y: number } {
    const rect = contentRef.current?.getBoundingClientRect();
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

    const handleUp = (event: PointerEvent): void => {
      const final = liveDragRef.current;
      liveDragRef.current = null;
      setDraggingCardId(null);
      if (!final) return;

      // CH-04 п.2/п.3: відпустив у затемненій зоні купки -- картка
      // "невизначено" (клієнтський стан, коментар до pendingUnassignedIds
      // вище); відпустив деінде на канві -- звичайна поведінка (onMoveCard),
      // і якщо картка була ЛОКАЛЬНО позначена невизначеною раніше, тепер вона
      // знову "визначена" (прибираємо з Set).
      const trayRect = trayRef.current?.getBoundingClientRect();
      const droppedInTray =
        trayRect !== undefined &&
        event.clientX >= trayRect.left &&
        event.clientX <= trayRect.right &&
        event.clientY >= trayRect.top &&
        event.clientY <= trayRect.bottom;

      if (droppedInTray) {
        setPendingUnassignedIds((prev) => new Set(prev).add(final.cardId));
        return;
      }

      setPendingUnassignedIds((prev) => {
        if (!prev.has(final.cardId)) return prev;
        const next = new Set(prev);
        next.delete(final.cardId);
        return next;
      });

      onMoveCard({ cardId: final.cardId, x: final.x, y: final.y }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Не вдалося зберегти позицію';
        setBanner({ variant: 'error', text: `Не вдалося зберегти позицію -- мережева помилка. ${message}` });
      });
      // Оптимістично лишаємо картку там, де її відпустили -- наступний
      // loadLayout() (наприклад, після зміни конфігурації) підтвердить
      // реальний серверний стан, той самий принцип, що onArchiveCard/
      // onSaveLayoutMode нижче.
      setState((prev) => ({
        ...prev,
        cards: prev.cards.map((card) => (card.cardId === final.cardId ? { ...card, x: final.x, y: final.y } : card)),
      }));
    };

    // Кінець-сесії ревю виявив: без 'pointercancel' перерваний жест (палець
    // зісковзнув за межі viewport, системний жест ОС, вхідний дзвінок під час
    // дотику) видає pointercancel, НЕ pointerup -- draggingCardId лишався б
    // підвішеним назавжди, картка "приклеєною" до останньої точки. handleUp
    // однаково коректно скидає стан для обох подій.
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingCardId]);

  // CH-11 (docs/features/structure/changes.md): правий клік будь-де на
  // екрані Схеми скасовує активний інструмент "Лінія"/"Стрілка" -- той самий
  // ефект, що повторний клік на ту саму кнопку інструменту (нижче в JSX),
  // лише додатковий спосіб. preventDefault -- не показуємо системне
  // контекстне меню браузера, поки інструмент активний.
  useEffect(() => {
    if (linkTool === null) return undefined;
    const handleContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      setLinkTool(null);
      setLinkFirstCardId(null);
    };
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, [linkTool]);

  // CH-12: озброєна (очікує підтвердження) кнопка видалення зв'язку не має
  // пережити перехід в режим інструмента "Зв'язати" -- інакше кнопка
  // "Видалити" від попереднього клікання могла б лишитись видимою поверх
  // нового режиму.
  useEffect(() => {
    if (linkTool !== null) setPendingDeleteConnectionId(null);
  }, [linkTool]);

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

  // CH-03 (частина 1): "На зад" на сторінці конфігурації -- закриває CONFIG
  // без збереження, той самий скид pendingLayoutMode, що вже робить
  // handleCancelChange для ConfirmDialog нижче.
  const handleBackFromConfig = (): void => {
    setConfigBanner(null);
    setPendingLayoutMode(state.layoutMode);
    setScreenMode('board');
  };

  const persistLayoutMode = (nextLayoutMode: LayoutMode): void => {
    onSaveLayoutMode({ layoutMode: nextLayoutMode })
      .then(() => {
        setConfigBanner(null);
        setScreenMode('board');
        // Джерело правди -- сервер (реальний авто-розклад нового режиму):
        // перечитуємо розкладку, а не вгадуємо новий стан локально.
        loadLayout()
          .then((loaded) => {
            setState(loaded);
            if (nextLayoutMode === 'staging') {
              // CH-10: сервер для staging НІЧОГО не пише (domain/layout.ts
              // computeStagingLayout -- явний no-op, apply-layout-mode.ts:51),
              // тож картки канви лишаються з попередніми x/y. "Переїзд у
              // список знизу" тому клієнтський (той самий pendingUnassignedIds,
              // що CH-04) -- позначаємо ВСІ картки, що зараз мають позицію,
              // невизначеними, щоб канва порожніла й користувач розкладав
              // наново (юзер-кейс п.3-4).
              setPendingUnassignedIds(new Set(loaded.cards.filter((card) => card.x !== null).map((card) => card.cardId)));
            } else {
              // code-review 2026-09-21 (correctness): БУДЬ-ЯКИЙ інший режим --
              // сервер щойно віддав СПРАВЖНІ позиції (реальний авто-розклад
              // нового режиму), тож жодна стара клієнтська позначка
              // "невизначено" більше не актуальна. Без цього скидання картка,
              // яку раніше перетягнули в трей (CH-04) чи яка лишилась
              // позначеною після переходу в staging (CH-10), і далі рахувалась
              // би "невизначеною" тут, хоча `loaded.cards` вже дає їй реальний
              // x/y -- картка зависала б у треї попри те, що сервер її розклав.
              setPendingUnassignedIds(new Set());
            }
          })
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

        {/* CH-03 (частина 1): "На зад" зліва від "Зберегти" -- той самий
            патерн, що MetricBlockForm.tsx's onCancel (life-area-card). */}
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3">
          <Button label="На зад" onClick={handleBackFromConfig} />
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

  const canArchiveCard = loadCloseCardOptions !== undefined && onArchiveCard !== undefined;

  const openArchiveDialog = (card: LayoutBoardCard): void => {
    if (loadCloseCardOptions === undefined) {
      return;
    }

    setBanner(null);
    setArchiveOptions(null);
    setArchivingCard({ cardId: card.cardId, cardTitle: card.cardTitle });

    loadCloseCardOptions(card.cardId)
      .then(setArchiveOptions)
      .catch((err: unknown) => {
        setArchivingCard(null);
        const message = err instanceof Error ? err.message : 'Не вдалося прочитати метрики картки';
        setBanner({ variant: 'error', text: `Не вдалося відкрити архівування. ${message}` });
      });
  };

  const dismissArchiveDialog = (): void => {
    setArchivingCard(null);
    setArchiveOptions(null);
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

  /**
   * CH-12 (докладніше docs/features/structure/changes.md): клік на лінію/
   * стрілку більше НЕ видаляє одразу -- лише озброює кнопку підтвердження
   * "Видалити" (рендериться біля середини лінії, нижче в JSX). Справжнє
   * видалення -- лише клік на ЦЮ кнопку (handleDeleteConnection).
   * stopPropagation -- канва має свій onClick, що скидає pendingDeleteConnectionId
   * при кліку "деінде" (вимога 4); без stopPropagation той самий клік одразу
   * скасував би щойно озброєний стан.
   */
  const handleConnectionClick = (connectionId: string) => (event: ReactMouseEvent<SVGLineElement>): void => {
    event.stopPropagation();
    setPendingDeleteConnectionId(connectionId);
  };

  /** Клік на кнопку підтвердження "Видалити" -- справжнє видалення (не архівація, легша дія, D-131-наступне рішення). */
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
    // Bug fix 2026-09-21 (живе тестування, Андрій: "все працює окрім оцієї
    // чортівні" -- скріншот з банером помилки, хоча картка на канві вже
    // реально стояла на місці): банер помилки НІЧИМ не скидався сам, окрім
    // одного місця (dismissArchiveDialog) -- раз показаний "мережева
    // помилка" міг лишатись видимим НАЗАВЖДИ, навіть після того, як наступні
    // перетягування вже проходили успішно. Новий драг -- явний сигнал "юзер
    // намагається знову", старий банер більше не описує поточний стан.
    setBanner(null);
    event.preventDefault();
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // jsdom/старі браузери -- pointer capture best-effort, window-рівневі
      // слухачі (useEffect вище) працюють і без нього.
    }
    // Стартова "жива" позиція -- поточна збережена, чи (картка досі в купці
    // нерозкладених, x/y === null) РЕАЛЬНЕ місце курсора в момент pointerdown
    // -- так чип не смикається до першого pointermove.
    //
    // Bug fix 2026-09-21 (живе тестування, Андрій): тут раніше стояло жорстке
    // "50/50" (центр канви) замість реального курсора -- між pointerdown і
    // першим pointermove React встигав перемалювати з ЦИМ заглушковим
    // значенням (setDraggingCardId нижче -- це state, викликає рендер), тож
    // картку з купки на мить "закидало" в центр канви, а вже тоді вона
    // стрибала під курсор -- саме той "тікає з-під миші" ефект.
    const existing = state.cards.find((c) => c.cardId === cardId);
    const pointerPosition = toCanvasPercent(event.clientX, event.clientY);
    setDraggingCardId(cardId);
    liveDragRef.current = {
      cardId,
      x: existing?.x ?? pointerPosition.x,
      y: existing?.y ?? pointerPosition.y,
    };
  };

  /**
   * Позиція картки для рендеру -- жива (під час драгу, 1:1 з
   * курсором/пальцем) чи збережена (card.x/card.y як є, БЕЗ жодного
   * стиснення чи авто-переформатування).
   *
   * Bug fix 2026-09-21 (живе тестування, Андрій): "єдине правило, коли
   * блок може стояти будь-де -- це якщо я його туди фізично пересунув" --
   * раніше тут стояло стиснення по Y (CH-04 п.1, canvasScaleY), що
   * автоматично підтискало ВСІ картки вгору, щойно з'являвся трей нерозкладених
   * (навіть на самому початку драгу, ДО того, як користувач хоч кудись
   * рухнув курсор) -- і той самий множник міг РАПТОВО зʼявитись/зникнути
   * між рендерами (трей показався/сховався), тож щойно відпущена картка
   * "стрибала" вище точки, де її фізично відпустили. Тепер трей просто
   * лежить ПОВЕРХ канви (як є, може накривати картку, що стоїть у самому
   * низу) -- жодного автоматичного перерозташування чужих карток.
   */
  function renderedPosition(card: LayoutBoardCard): { x: number; y: number } | null {
    if (draggingCardId === card.cardId && liveDragRef.current?.cardId === card.cardId) {
      return { x: liveDragRef.current.x, y: liveDragRef.current.y };
    }
    if (card.x === null || card.y === null) return null;
    return { x: card.x, y: card.y };
  }

  /**
   * Назва картки + (за наявності можливості) дія "Архівувати". Спільний
   * рендер для канви й для купки нерозкладених.
   */
  const cardChip = (card: LayoutBoardCard, extraClassName = ''): JSX.Element => (
    <div
      key={card.cardId}
      data-testid={`card-${card.cardId}`}
      data-card-id={card.cardId}
      onPointerDown={handlePointerDown(card.cardId)}
      style={{ touchAction: 'none' }}
      className={`relative flex max-w-full cursor-grab flex-col items-center gap-1 rounded-control bg-surface-solid px-2.5 py-2 text-center shadow-soft active:cursor-grabbing ${extraClassName}`}
    >
      {/* CH-02: м'ячик стану -- правий верхній кут чипа, той самий кут, що
          life-area-card/ui/CardFace.tsx домальовує на самій картці. */}
      {card.healthState && (
        <span
          aria-label={`Стан картки: ${HEALTH_STATE_LABEL[card.healthState]}`}
          className={`chip-gloss absolute -right-1 -top-1 h-2.5 w-2.5 shrink-0 rounded-full ${HEALTH_STATE_DOT[card.healthState]}`}
        />
      )}
      <span className="max-w-full truncate text-xs font-semibold text-ink">{card.cardTitle}</span>
      {canArchiveCard && (
        <button
          type="button"
          aria-label={`Архівувати «${card.cardTitle}»`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => openArchiveDialog(card)}
          className="text-[11px] font-medium text-ink-faint transition-colors hover:text-ink"
        >
          Архівувати
        </button>
      )}
    </div>
  );

  // CH-04: "невизначено" -- і справжнє (x===null з сервера), і клієнтське
  // (pendingUnassignedIds, CH-04 п.2/CH-10) -- картка, що зараз тягнеться,
  // завжди лишається виключеною з купки (рендериться на канві за живою
  // позицією, canvasCards нижче).
  const isEffectivelyUnassigned = (card: LayoutBoardCard): boolean => card.x === null || pendingUnassignedIds.has(card.cardId);
  const unassigned = state.cards.filter((card) => isEffectivelyUnassigned(card) && card.cardId !== draggingCardId);
  const canvasCards = state.cards.filter((card) => !isEffectivelyUnassigned(card) || card.cardId === draggingCardId);
  // CH-04: купка -- явна ціль перетягування, доступна ще ДО того, як у ній
  // щось лежить (п.2's "давало явний вибір визначено/невизначено") -- тому
  // рендериться і коли є вже нерозкладені картки, і поки триває будь-який
  // драг (щоб було куди відпустити, навіть якщо трей досі порожній).
  const showTray = unassigned.length > 0 || draggingCardId !== null;

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
        onClick={pendingDeleteConnectionId !== null ? () => setPendingDeleteConnectionId(null) : undefined}
      >
        {/* CH-15 (docs/features/structure/changes.md): фіксований (розмір --
            referenceSizeRef, калібрований з РЕАЛЬНОГО canvasRef при першому
            вимірюванні, не довільне число) внутрішній контейнер -- уся
            система відсотків (0-100) рахується ВІДНОСНО НЬОГО, не поточного
            розміру canvasRef вище. left-1/2/top-1/2 + translate(-50%,-50%)
            центрують його всередині canvasRef; потім той самий transform
            домасштабовує (canvasScale) готову "картинку" під РЕАЛЬНИЙ
            розмір canvasRef -- чипи й канва стискаються РАЗОМ, в одній
            пропорції, замість накладання одне на одне. Поки еталон ще не
            виміряно (referenceSizeRef.current===null, перший рендер) --
            100%/100% (=canvasRef, той самий вигляд, що ДО рефакторингу),
            жодного стрибка контенту при переході на каліброване число. */}
        <div
          ref={contentRef}
          data-testid="canvas-content"
          className="absolute left-1/2 top-1/2"
          style={{
            width: referenceSizeRef.current?.width ?? '100%',
            height: referenceSizeRef.current?.height ?? '100%',
            transform: `translate(-50%, -50%) scale(${canvasScale})`,
          }}
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
            // Bug fix 2026-09-21 (живе тестування, Андрій, зі скріншотом):
            // "перетягнув блок в низ... звязки з екрану потрібно автоматично
            // прибрати" -- renderedPosition нижче враховує лише card.x===null
            // (СЕРВЕРНО непризначена), не pendingUnassignedIds (CH-04,
            // КЛІЄНТСЬКИЙ "невизначено" стан) -- лінія тяглась до старої
            // реальної позиції картки, навіть коли сам чип уже намальований у
            // треї. isEffectivelyUnassigned -- той самий предикат, що вже
            // ховає чип із канви (canvasCards вище), тепер і для лінії.
            // Суто візуальне приховування: сам звʼязок НЕ видаляється, повернеш
            // картку на канву -- лінія з'явиться знову з тим самим звʼязком.
            if (isEffectivelyUnassigned(a) || isEffectivelyUnassigned(b)) return null;
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
            // CH-15: contentRef -- ця % математика теж рахується відносно
            // масштабованого контейнера, не природного canvasRef.
            const canvasRect = contentRef.current?.getBoundingClientRect();
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
            // Math.max(0, ...) -- кінець-сесії ревю виявив: коли dist < 1
            // (дві картки перетягнуті майже впритул -- перекриття дозволене,
            // domain/layout.ts), "dist / 2 - 0.5" стає ВІД'ЄМНИМ, і без
            // нижньої межі min() повертав би саме це від'ємне число --
            // лінія/вістря стрілки виїжджали б у протилежний бік.
            const pullbackA = dist > 0 ? Math.max(0, Math.min(rectPullback(connection.cardIdA), dist / 2 - 0.5)) : 0;
            const pullbackB = dist > 0 ? Math.max(0, Math.min(rectPullback(connection.cardIdB), dist / 2 - 0.5)) : 0;
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
                onClick={linkTool === null ? handleConnectionClick(connection.id) : undefined}
              />
            );
          })}
        </svg>

        {/* CH-12: кнопка підтвердження "Видалити" для озброєного зв'язку --
            окремий HTML-шар ПІСЛЯ svg (не сам svg -- кнопці потрібен звичайний
            DOM для стилю/фокусу), позиціюється по середині лінії тими самими
            posA/posB, що й сама лінія вище (без rectPullback -- для кнопки
            досить приблизної середини, точний відступ від чипа тут не
            принциповий). */}
        {(() => {
          if (pendingDeleteConnectionId === null) return null;
          const connection = state.connections.find((c) => c.id === pendingDeleteConnectionId);
          if (!connection) return null;
          const a = cardById.get(connection.cardIdA);
          const b = cardById.get(connection.cardIdB);
          if (!a || !b || isEffectivelyUnassigned(a) || isEffectivelyUnassigned(b)) return null;
          const posA = renderedPosition(a);
          const posB = renderedPosition(b);
          if (!posA || !posB) return null;
          const midX = (posA.x + posB.x) / 2;
          const midY = (posA.y + posB.y) / 2;
          return (
            <button
              type="button"
              data-testid="connection-delete-confirm"
              className="pointer-events-auto absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-control border border-border bg-surface-solid px-2 py-1 text-xs font-semibold text-ink shadow-soft hover:border-ink/40"
              style={{ left: `${midX}%`, top: `${midY}%` }}
              onClick={(event) => {
                event.stopPropagation();
                handleDeleteConnection(connection.id);
                setPendingDeleteConnectionId(null);
              }}
            >
              Видалити
            </button>
          );
        })()}

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
              // Плавний перехід для карток, що ЗАРАЗ НЕ тягнуться -- пом'якшує
              // масові зміни позиції (напр. застосування нової авто-розкладки).
              // Сама картка, що тягнеться, transition НЕ отримує -- інакше вона
              // відставала б від пальця (1:1 з курсором під час драгу).
              className={card.cardId === draggingCardId ? undefined : 'transition-all duration-150 ease-out'}
              style={{ position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              {cardChip(card)}
            </div>
          );
        })}
        </div>

        {/* Купка нерозкладених -- ВСЕРЕДИНІ тієї самої зони, доклеєна до її
            низу (absolute bottom-0), напівпрозорий фон-підклад, щоб читалась
            навіть поверх картки на канві під нею. max-h -- приблизно 3 рядки
            чипів (вимога Андрія "не більше"), далі власний внутрішній скрол.
            CH-04: рендериться і ПОРОЖНЬОЮ під час будь-якого драгу (showTray
            вище) -- "явний вибір визначено/невизначено" (п.2) означає
            користувачу є куди відпустити картку ще ДО того, як там щось
            з'явилось; підсвічування (ring) під час драгу -- та сама
            "затемнена зона", про яку каже юзер-кейс.
            CH-15, ІТЕРАЦІЯ 2 (Андрій, живе тестування різних масштабів):
            купка -- ПОЗА contentRef (не частина сцени, що масштабується
            CH-15 вище) -- "зона базової розкладки має залишатись над
            кнопками", не "летіти" разом зі стисненою сценою. inset-x-10 (не
            inset-x-0) -- та сама ширина, що тонка риска-розділювач нижче
            (inset-x-10): "по ширині має завжди бути як промінь". Без
            min-h -- висота тепер природна, під реальний вміст (чипи), а не
            довільна rem-константа. */}
        {showTray && (
          <div
            ref={trayRef}
            data-testid="unassigned-tray"
            className={`absolute inset-x-10 bottom-0 flex max-h-28 flex-wrap content-center items-center justify-center gap-2 overflow-y-auto p-2 backdrop-blur-sm transition-colors ${
              draggingCardId !== null ? 'bg-ink/15 ring-2 ring-inset ring-ink/30' : 'bg-surface/85'
            }`}
          >
            {unassigned.length === 0 ? (
              <p className="text-center text-xs font-medium text-ink-faint">Відпустіть тут, щоб зробити позицію невизначеною</p>
            ) : (
              unassigned.map((card) => cardChip(card))
            )}
          </div>
        )}
      </div>

      {/* Живе тестування (Андрій): "нижню частину просто відділи променем в
          обидві сторони від центру над кнопкою та інструментом" -- тонка
          горизонтальна риска замість рамки, точно на межі зони (bottom-16 --
          та сама відстань, що mb-16 зони вище), над плаваючим тулбаром. */}
      <div className="pointer-events-none absolute inset-x-10 z-10 border-t border-border" style={{ bottom: '4rem' }} />

      {/* AC-12 / SCR-04 (тепер "Архівування", CH-05/CH-06). */}
      {archivingCard !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-label={`Архівування «${archivingCard.cardTitle}»`}
            className="flex w-full max-w-sm flex-col gap-4 rounded-card border border-border bg-surface-solid p-6 shadow-soft"
          >
            {/* CH-06 п.1: заголовок сторінки -- "Архівування", не "Закрити
                «Назва картки»" -- назва картки лишається окремим підзаголовком. */}
            <div>
              <h2 className="font-display text-lg font-semibold leading-relaxed text-ink">Архівування</h2>
              <p className="text-sm text-ink-muted">Картка «{archivingCard.cardTitle}»</p>
            </div>
            {archiveOptions === null ? (
              <Spinner />
            ) : (
              <LayoutBoardArchiveDialog
                key={archivingCard.cardId}
                cardTitle={archivingCard.cardTitle}
                metricBlocks={archiveOptions.metricBlocks}
                targetCards={archiveOptions.targetCards}
                onTransferMetricBlock={
                  onTransferMetricBlock
                    ? ({ metricBlockId, targetCardId }) => onTransferMetricBlock(archivingCard.cardId, metricBlockId, targetCardId)
                    : undefined
                }
                onArchive={() => (onArchiveCard as NonNullable<LayoutBoardProps['onArchiveCard']>)(archivingCard.cardId)}
                onArchived={() => {
                  dismissArchiveDialog();
                  loadLayout()
                    .then(setState)
                    .catch((err: unknown) => {
                      const message = err instanceof Error ? err.message : 'Не вдалося оновити розкладку';
                      setBanner({ variant: 'error', text: `Картку архівовано, але розкладку не перечитано. ${message}` });
                    });
                }}
                onCancel={dismissArchiveDialog}
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
        {/* CH-01 (structure/changes.md): "Архів карток" по центру біля
            "Конфігурація" -- той самий тулбар, той самий shared callback
            (App.tsx), що дубль цієї кнопки на DeckScreen (Картки). */}
        <Button label="Архів карток" onClick={onOpenArchive} />
      </div>
    </div>
  );
}
