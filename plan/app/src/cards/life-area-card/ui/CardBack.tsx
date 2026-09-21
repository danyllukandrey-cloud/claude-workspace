// SCR-03 -- Картка: зворот (Відстеження) (T26). Дашборд прогресу: частка
// виконання по кожному блоку-метриці + агрегат картки (AC-09/AC-09b),
// історія записів, що розгортається (AC-12/AC-13), і пропозиція
// перейменувати блок-метрику при колізії перенесення (AC-14/AC-15).
//
// ux-flows.md US-13: рішення про сам перенос ухвалюється зовні (`structure`'s
// SCR-04, закриття напрямку) -- ця картка лише ОТРИМУЄ результат; коли він
// зіткнувся з наявним блоком (та сама назва+одиниця), пропонує нову назву
// тут, а не мовчки зливає два блоки.
//
// ISS-45/DI (plan/app/CLAUDE.md "Правило залежностей"): та сама конвенція, що
// CardFace.tsx -- жодного fetch, жодного імпорту з ../ports чи ../app цієї ж
// картки. Дані й дії приходять як ін'єктовані пропси-функції, що повертають
// Promise; компонент сам керує локальним станом (loading/error/
// historyExpanded/колізія перейменування) навколо їхнього виклику.
import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Spinner, TextField } from '../../../shared/ui';
import { ArchiveCardDialog } from './ArchiveCardDialog';
import { ArchiveMetricBlockDialog } from './ArchiveMetricBlockDialog';
import { EntryHistoryList } from './EntryHistoryList';
import { MetricBlockCard } from './MetricBlockCard';
import { MetricBlockForm } from './MetricBlockForm';
import type { MetricBlockFormValues } from './MetricBlockForm';
import type { CardBackData, MetricBlockTransferTargetCard, MetricBlockViewModel } from './types';
import type { CardTrackingMode, CardHealthState } from '../domain/card';

// CH-02 (docs/features/life-area-card/changes.md): три можливі стани, той
// самий порядок, що юзер-кейс перелічує їх.
const HEALTH_STATE_OPTIONS: { value: CardHealthState; label: string }[] = [
  { value: 'active', label: 'використовується' },
  { value: 'critical', label: 'критично потребує відновлення' },
  { value: 'paused', label: 'на паузі' },
];

/** Той самий колірний словник, що CardFace.tsx's HEALTH_STATE_DOT -- підказка кольору поруч із кожним варіантом вибору. */
const HEALTH_STATE_DOT_CLASS: Record<CardHealthState, string> = {
  active: 'bg-good',
  critical: 'bg-bad',
  paused: 'bg-warn',
};

export interface CardBackProps {
  /**
   * CH-07 (docs/features/life-area-card/changes.md): назва картки --
   * CardBackData сама її не несе (лише метрики/історія/агрегат), а
   * ArchiveCardDialog з меню звороту потребує її для тексту підтвердження.
   * DeckFrontCard.tsx прокидає той самий DeckGridItem.name, що вже має.
   */
  cardName: string;
  /** Завантажує дані звороту картки (блоки-метрики, історія, агрегат). */
  loadBack: () => Promise<CardBackData>;
  /** Перегорнути картку назад на лицьову сторону (SCR-02). */
  onFlip: () => void;
  /**
   * AC-12: користувач позначив запис із історії як помилковий -- виправлення
   * саме по собі завжди відбувається в чаті з агентом (ux-flows.md US-12);
   * ця проп-функція лише повідомляє про факт і повертає СВІЖИЙ стан звороту,
   * щоб історія й прогрес одразу відобразили результат.
   */
  onFlagEntry?: (entryId: string) => Promise<CardBackData>;
  /** AC-15: користувач підтвердив нову назву блоку, перенесення якого зіткнулось із наявним -- повертає свіжий стан звороту без колізії. */
  onRenameTransferredBlock?: (input: { metricBlockId: string; newLabel: string }) => Promise<CardBackData>;
  /**
   * ISS-60 (docs/ISSUES.md): створює новий блок-метрику для картки з
   * порожнього стану -- повертає лише Promise<void> (не свіжі дані), тож
   * свіжість забезпечує повторний виклик loadBack, не повернене значення.
   */
  onCreateMetricBlock?: (values: MetricBlockFormValues) => Promise<void>;
  /**
   * Видалення (архівація) блоку-метрики -- DELETE .../metric-blocks/{id}.
   * Той самий опційний DI-патерн, що onCreateMetricBlock: без пропу кнопка
   * "×" на MetricBlockCard не рендериться взагалі. Реальний fetch -- у
   * викликача (main.tsx); тут лише Promise<void>, свіжість зворту після
   * успіху забезпечує повторний виклик loadBack (refresh()), не повернене
   * значення -- той самий підхід, що onCreateMetricBlock.
   */
  onArchiveMetricBlock?: (metricBlockId: string) => Promise<void>;
  /**
   * CH-02 (docs/features/life-area-card/changes.md): зберігає режим
   * відстеження картки ("картка: стан без вимірювань" чи звичайний
   * метричний режим). Опційний, той самий DI-патерн, що onCreateMetricBlock
   * -- без пропу вибір не рендериться (лише поточний стан, якщо він уже є).
   */
  onUpdateTracking?: (input: { trackingMode: CardTrackingMode; healthState: CardHealthState | null }) => Promise<void>;
  /**
   * CH-03 (docs/features/life-area-card/changes.md): зберігає перейменування
   * чи зміну налаштувань (ціль/одиниця/частота) блоку-метрики -- БЕЗ
   * перенесення на іншу картку (те робить onTransferMetricBlock нижче).
   * Опційний, той самий DI-патерн, що решта дій -- без пропу олівець на
   * MetricBlockCard не рендериться взагалі.
   */
  onUpdateMetricBlock?: (metricBlockId: string, values: MetricBlockFormValues) => Promise<void>;
  /**
   * CH-03: переносить блок-метрику на іншу картку -- викликає наявну
   * transferMetricBlock (вже працює, нового бекенду для цієї дії не треба,
   * той самий ендпоінт, що structure's "Закрити напрямок" уже використовує).
   */
  onTransferMetricBlock?: (metricBlockId: string, targetCardId: string) => Promise<void>;
  /**
   * CH-03: картки, куди можна перенести блок -- решта активних карток
   * власника (без цієї самої). Композиційний корінь (DeckScreen.tsx) уже
   * тримає повний список карток колоди -- жодного додаткового мережевого
   * виклику тут не потрібно.
   */
  transferTargetCards?: MetricBlockTransferTargetCard[];
  /**
   * CH-07 (docs/features/life-area-card/changes.md): підтверджує архівацію
   * картки з меню "..." звороту -- той самий проп, що CardFace.onArchive
   * (DeckFrontCard.tsx вже тримає готовий cardId-зв'язаний виклик, жодного
   * нового бекенду не треба). Опційний -- без нього пункт "Архівувати" в
   * меню звороту не рендериться.
   */
  onArchive?: () => Promise<void>;
  /** CH-07: сигнал батькові -- картку архівовано, той самий проп, що CardFace.onArchived. */
  onArchived?: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

const FALLBACK_ERROR_TEXT = 'Не вдалося завантажити картку';
const FALLBACK_COLLISION_ERROR_TEXT = 'У картці вже є блок-метрика з такою назвою й одиницею';

export function CardBack({
  cardName,
  loadBack,
  onFlip,
  onFlagEntry,
  onRenameTransferredBlock,
  onCreateMetricBlock,
  onArchiveMetricBlock,
  onUpdateTracking,
  onUpdateMetricBlock,
  onTransferMetricBlock,
  transferTargetCards,
  onArchive,
  onArchived,
}: CardBackProps): JSX.Element {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<CardBackData | null>(null);
  const [error, setError] = useState<string>(FALLBACK_ERROR_TEXT);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  // CH-07 (docs/features/life-area-card/changes.md): зворот тепер має два
  // режими -- перегляд (типовий) і редагування самої картки (не метрик --
  // ті редагуються через олівчик на MetricBlockCard, isEditingBack тут з
  // цим не перетинається). Меню "..." -- той самий патерн (role="menu"), що
  // CardFace.tsx, лише в правому верхньому кутку звороту, не лиця.
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditingBack, setIsEditingBack] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [collisionError, setCollisionError] = useState<string | undefined>(undefined);
  const [isCreatingBlock, setIsCreatingBlock] = useState(false);
  // Видалення блоку-метрики: блок, для якого зараз відкрито
  // ArchiveMetricBlockDialog -- null означає "жоден", той самий локальний
  // toggle-стан, що isCreatingBlock вище. Тримаємо весь MetricBlockViewModel,
  // не лише id -- діалогу потрібна label для тексту підтвердження.
  const [pendingDeleteBlock, setPendingDeleteBlock] = useState<MetricBlockViewModel | null>(null);
  // CH-03: блок, для якого зараз відкрито редагування -- той самий "null --
  // жоден" toggle-стан, що pendingDeleteBlock. Тримаємо весь
  // MetricBlockViewModel, не лише id -- формі потрібні label/unit/settings
  // для initialValues.
  const [editingBlock, setEditingBlock] = useState<MetricBlockViewModel | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | undefined>(undefined);
  // Review 2026-09-07, post-ship follow-up review (AC-12/E remainder):
  // handleFlagEntry нижче мав ТОЙ САМИЙ баг, що refresh() уже виправлено
  // (setState('error') на невдачі стирало всі дані) -- пропущено окремо,
  // бо це власний catch, не сам refresh(). Той самий isSubmitting-підхід,
  // що T49/MetricBlockCard -- захист від подвійного кліку, поки запит у польоті.
  const [isFlaggingEntry, setIsFlaggingEntry] = useState(false);
  // Живе тестування (Андрій): після "виправити" нічого видимого не
  // відбувалось, крім кульки, що червоніє -- сам механізм задуманий
  // (EntryHistoryList.tsx коментар вгорі) як "виправлення завжди йде через
  // діалог з агентом", але це ніяк не підказувалось у моменті. Підказка
  // з'являється одразу після успішного flag і лишається видимою (не
  // автоховається -- користувач сам іде в чат, коли готовий, не поки
  // читає текст).
  const [showFlagHint, setShowFlagHint] = useState(false);
  // CH-02: захист від подвійного кліку по радіо-вибору режиму, поки перший
  // запит ще в польоті -- той самий isSubmitting-підхід, що isFlaggingEntry.
  const [isSavingTracking, setIsSavingTracking] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  // Review 2026-09-07 E (T52): фоновий refresh (після успішної мутації) --
  // окремий, неблокуючий стан помилки, ніколи не `setState('error')` (той
  // самий шлях, що ПОЧАТКОВЕ завантаження) -- інакше невдалий фоновий
  // перезапит стирав уже показані дані заради банера на весь екран.
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Лічильник issued-запитів refresh(): відповідь застосовується, лише якщо
  // вона від НАЙОСТАННІШОГО виклику -- застаріла (out-of-order) відповідь,
  // що прийшла пізніше свіжішої, ігнорується, а не переписує стан.
  const refreshRequestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setState('loading');

    loadBack()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setRenameValue(result.pendingTransferCollision?.label ?? '');
        setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : FALLBACK_ERROR_TEXT);
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [loadBack]);

  /**
   * Перевантажує зворот після мутації (створення блоку, новий запис) -- той
   * самий loadBack, без окремого стану "loading" (дані вже видимі).
   * Review 2026-09-07 E (T52): помилка тут НЕ рве екран (refreshError,
   * неблокуючий Banner НАД уже показаними даними), і кожен виклик несе свій
   * id -- відповідь застосовується, лише якщо жоден ПІЗНІШИЙ refresh() ще не
   * встиг стартувати (запобігає застарілій out-of-order відповіді
   * переписати свіжішу).
   */
  const refresh = (): void => {
    const requestId = ++refreshRequestIdRef.current;
    loadBack()
      .then((result) => {
        if (refreshRequestIdRef.current !== requestId) return; // застаріла -- ігноруємо
        setData(result);
        setRenameValue(result.pendingTransferCollision?.label ?? '');
        setRefreshError(null);
      })
      .catch((err: unknown) => {
        if (refreshRequestIdRef.current !== requestId) return;
        setRefreshError(err instanceof Error ? err.message : FALLBACK_ERROR_TEXT);
      });
  };

  if (state === 'loading') {
    return <Spinner />;
  }

  if (state === 'error' || !data) {
    return <Banner variant="error" text={error} />;
  }

  // CH-02/CH-10: `trackingMode` опційне на CardBackData (десятки наявних
  // тестових fixtures передували цю зміну) -- 'goals' той самий дефолт, що
  // й сама база даних (postgres-repo.ts card.tracking_mode DEFAULT 'goals').
  const trackingMode = data.trackingMode ?? 'goals';
  const healthState = data.healthState ?? null;
  // CH-10 review (живе тестування 2026-09-21): картка без жодного блоку-
  // метрики ще не мала можливості явно обрати режим -- "Режим картки"
  // ховався за меню "..." навіть тут, тож користувач одразу бачив "+
  // Додати блок-метрику" без кроку вибору статусу взагалі. Для такої картки
  // показуємо "Режим картки" одразу (не за меню), і вже під ним -- залежно
  // від вибору -- або мячики (state), або "+ Додати" (ongoing/goals).
  const hasNoMetrics = data.metricBlocks.length === 0;
  const showTrackingModePicker = isEditingBack || hasNoMetrics;

  const handleFlagEntry = (entryId: string): void => {
    if (!onFlagEntry || isFlaggingEntry) return;
    // Той самий requestId-лічильник, що refresh() -- onFlagEntry теж
    // повертає свіжий CardBackData, тож обидва конкурують за "останній
    // issued", не лише один одного власного класу.
    const requestId = ++refreshRequestIdRef.current;
    setIsFlaggingEntry(true);
    onFlagEntry(entryId)
      .then((fresh) => {
        if (refreshRequestIdRef.current !== requestId) return;
        setData(fresh);
        setRefreshError(null);
        setShowFlagHint(true);
      })
      .catch((err: unknown) => {
        if (refreshRequestIdRef.current !== requestId) return;
        // Review 2026-09-07 (AC-12/E remainder): НЕ `setState('error')` --
        // запис уже виправлено на бекенді (PATCH пройшов), лише перезапит
        // свіжого стану провалився. Стирати весь екран заради цього так
        // само неправильно, як refresh() робив до T52.
        setRefreshError(err instanceof Error ? err.message : 'Не вдалося виправити запис');
      })
      .finally(() => setIsFlaggingEntry(false));
  };

  /**
   * CH-02: перемикає trackingMode/healthState -- той самий "викликати
   * injected дію, потім refresh()" підхід, що handleCreateMetricBlock нижче.
   * Захищено isSavingTracking від подвійного кліку (радіо-кнопки лишаються
   * disabled, поки перший запит не завершився).
   */
  const handleUpdateTracking = (input: { trackingMode: CardTrackingMode; healthState: CardHealthState | null }): void => {
    if (!onUpdateTracking || isSavingTracking) return;
    setTrackingError(null);
    setIsSavingTracking(true);
    onUpdateTracking(input)
      .then(() => {
        // Review-fix: локальний патч замість повного refresh() -- input уже
        // несе точну нову пару trackingMode/healthState (сервер підтвердив),
        // жодне інше поле CardBackData від режиму не залежить (метрики й
        // агрегат рахуються незалежно, лише візуально притлумлюються тут же).
        // Той самий "не перезавантажуй, патч того, що вже знаєш" підхід, що
        // CardFace.saveEdit і DeckScreen.handleRename вже мають у цьому diff.
        setData((prev) => (prev ? { ...prev, trackingMode: input.trackingMode, healthState: input.healthState } : prev));
      })
      .catch((err: unknown) => {
        setTrackingError(err instanceof Error ? err.message : 'Не вдалося зберегти режим картки');
      })
      .finally(() => setIsSavingTracking(false));
  };

  /**
   * CH-03: перейменування/налаштування (без перенесення) -- ТОЙ САМИЙ підхід,
   * що handleCreateMetricBlock нижче: не глушить/не перехоплює відхилення --
   * MetricBlockForm сам показує submitError і лишається відкритою на невдачі
   * (форма закривається лише в гілці .then(), яка не виконається на reject).
   */
  const handleSaveMetricBlockEdit = (values: MetricBlockFormValues): Promise<void> => {
    if (!onUpdateMetricBlock || !editingBlock) return Promise.resolve();
    return onUpdateMetricBlock(editingBlock.id, values).then(() => {
      setEditingBlock(null);
      refresh();
    });
  };

  /** CH-03: перенесення на іншу картку -- наявна transferMetricBlock (injected), закриває редагування й перезавантажує зворот. */
  const handleTransferMetricBlock = (): void => {
    if (!onTransferMetricBlock || !editingBlock || !transferTargetId || isTransferring) return;
    setTransferError(undefined);
    setIsTransferring(true);
    onTransferMetricBlock(editingBlock.id, transferTargetId)
      .then(() => {
        setEditingBlock(null);
        setTransferTargetId('');
        setIsTransferring(false);
        refresh();
      })
      .catch((err: unknown) => {
        setIsTransferring(false);
        setTransferError(err instanceof Error ? err.message : 'Не вдалося перенести блок-метрику');
      });
  };

  const handleCreateMetricBlock = (values: MetricBlockFormValues): Promise<void> => {
    // CH-02 (code review 2026-09-19): захист у глибині, ДРУГИЙ бар'єр поза
    // disabled-кнопкою вище -- "стан без вимірювань" не додає жодного нового
    // блоку-метрики, навіть якщо isCreatingBlock якимсь чином лишився true
    // (напр. форма відкрита ДО перемикання режиму).
    if (!onCreateMetricBlock || trackingMode === 'state') return Promise.resolve();
    return onCreateMetricBlock(values).then(() => {
      setIsCreatingBlock(false);
      refresh();
    });
  };

  /**
   * Підтвердження в ArchiveMetricBlockDialog ("введіть «видалити»") викликає
   * injected onArchiveMetricBlock, потім закриває діалог і перезавантажує
   * зворот (refresh(), той самий "ремаунт перезавантажує" підхід, що
   * handleCreateMetricBlock вище) -- бекенд більше не поверне архівований
   * блок у GET .../metric-blocks, тож він сам зникне зі списку. Помилку
   * (404 card.not_found / мережева) показує сам ArchiveMetricBlockDialog
   * (injected onArchive кидає -- та сама Promise-помилка долітає туди).
   */
  const handleArchiveMetricBlock = (): Promise<void> => {
    if (!onArchiveMetricBlock || !pendingDeleteBlock) return Promise.resolve();
    return onArchiveMetricBlock(pendingDeleteBlock.id).then(() => {
      setPendingDeleteBlock(null);
      refresh();
    });
  };

  // CH-07: той самий "..." -> Редагування/Архівувати патерн, що CardFace.tsx.
  function toggleMenu(): void {
    setIsMenuOpen((prev) => !prev);
  }

  function startEditBack(): void {
    setIsMenuOpen(false);
    setIsEditingBack(true);
  }

  function closeEditBack(): void {
    // Немає окремого "Зберегти" -- кожен вибір режиму картки зберігається
    // одразу (handleUpdateTracking вище), той самий "автозбереження на
    // клік" підхід, що радіо-кнопки й до цієї зміни мали.
    setIsEditingBack(false);
  }

  function startArchive(): void {
    setIsMenuOpen(false);
    setIsArchiving(true);
  }

  function cancelArchive(): void {
    setIsArchiving(false);
  }

  function confirmArchive(): Promise<void> {
    if (!onArchive) return Promise.resolve();
    return onArchive().then(() => {
      onArchived?.();
    });
  }

  const handleConfirmRename = (): void => {
    if (!onRenameTransferredBlock || !data.pendingTransferCollision) return;
    setCollisionError(undefined);
    onRenameTransferredBlock({
      metricBlockId: data.pendingTransferCollision.metricBlockId,
      newLabel: renameValue,
    })
      .then((fresh) => setData(fresh))
      .catch((err: unknown) => {
        setCollisionError(err instanceof Error ? err.message : FALLBACK_COLLISION_ERROR_TEXT);
      });
  };

  return (
    // Живе тестування (Андрій, баг 2): скрол і кнопка "← перегорнути" -- на
    // РІЗНИХ рівнях (CardShell.tsx більше не скролить сам себе). Внутрішня
    // обгортка нижче (flex-1 min-h-0 overflow-y-auto) несе ввесь контент
    // звороту (разом з "Історія записів" -- це частина контенту, що
    // розгортається, не кнопка-футер), КРІМ "← перегорнути" -- вона
    // сестринський елемент ПІСЛЯ обгортки, природно лишається внизу (flex-1
    // забирає решту висоти в сусіда), mt-auto їй більше не потрібен.
    <div className="relative flex h-full flex-col gap-4">
      {/* CH-07 (docs/features/life-area-card/changes.md): "..." у правому
          верхньому кутку звороту -- той самий патерн, що CardFace.tsx, лише
          для НАЛАШТУВАНЬ самої картки (Режим картки), не для метрик (ті --
          олівчик на MetricBlockCard). "Архівувати" -- лише коли onArchive
          переданий (DeckFrontCard.tsx вже прокидає той самий, що на лиці).
          Живе тестування 2026-09-21: `absolute` тут накладало кнопку ПОВЕРХ
          зони скролу нижче -- сама смуга прокрутки (браузерна) починається
          від верхнього краю СКРОЛЬОВАНОГО елемента, тож внутрішній відступ
          (pt-8, перша спроба) зсував лише вміст, не саму смугу. Замість
          цього кнопка тепер займає СПРАВЖНЄ місце в розмітці (звичайний
          рядок, не накладання) -- зона скролу нижче більше не ділить
          вертикальний простір з кнопкою, `relative` тут лишається лише
          точкою відліку для випадного меню. */}
      <div className="relative flex justify-end">
        <button
          type="button"
          aria-label="Меню картки"
          onClick={toggleMenu}
          className="shrink-0 rounded-control px-2 py-1 text-lg font-bold leading-none text-ink-muted transition-colors hover:bg-border hover:text-ink"
        >
          ...
        </button>
        {isMenuOpen && (
          <div
            role="menu"
            // Живе тестування 2026-09-21: `z-10` (був раніше на батьківському
            // `absolute`-контейнері) загубився, коли той контейнер став
            // звичайним рядком -- без нього випадне меню малювалось ПІД
            // зоною скролу (наступний елемент у звичайному потоці), не
            // поверх неї. Тепер z-10 -- на самому меню.
            className="absolute right-0 top-full z-10 mt-1 flex w-44 flex-col gap-0.5 rounded-control border border-border bg-surface-solid p-1.5 shadow-soft"
          >
            {/* Review-fix: без onUpdateTracking немає чого показати в панелі
                редагування (єдиний її вміст зараз -- Режим картки) -- клік
                мовчки нічого не робив би, той самий "без пропу афорданс не
                рендериться" принцип, що вже застосований до "Архівувати". */}
            {onUpdateTracking && (
              <button
                type="button"
                role="menuitem"
                onClick={startEditBack}
                className="w-full rounded-control px-3 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-border"
              >
                Редагування
              </button>
            )}
            {onArchive && (
              <button
                type="button"
                role="menuitem"
                onClick={startArchive}
                className="w-full rounded-control px-3 py-2 text-left text-sm font-medium text-bad transition-colors hover:bg-bad/10"
              >
                Архівувати
              </button>
            )}
          </div>
        )}
      </div>
      {isArchiving && (
        <ArchiveCardDialog cardName={cardName} onArchive={confirmArchive} onCancel={cancelArchive} />
      )}

      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto">
        {/* Review 2026-09-07 E (T52): фоновий refresh невдалий -- НЕблокуючий
            банер над уже показаними даними, не заміна всього екрана. */}
        {refreshError !== null && <Banner variant="error" text={refreshError} />}

        {/* CH-07: коли є хоч один блок-метрики, "Режим картки" -- налаштування,
            не показник, ховається за меню "..." (isEditingBack), замість
            займати місце над блоками щоразу. CH-10 review: поки блоків
            узагалі нема (hasNoMetrics), це навпаки ПЕРШЕ, що бачить
            користувач -- без обраного режиму нема що показувати нижче. */}
        {showTrackingModePicker && onUpdateTracking && (
          <fieldset className="m-0 flex flex-col gap-2 rounded-card border border-border bg-surface-solid p-3.5" disabled={isSavingTracking}>
            <div className="flex items-center justify-between gap-2">
              <legend className="px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">Режим картки</legend>
              {/* "Закрити" має сенс лише коли панель ВІДКРИЛИ (меню на
                  картці, що вже має блоки) -- для порожньої картки це й так
                  єдиний видимий вміст, нема куди "закривати". */}
              {isEditingBack && <Button label="Закрити" onClick={closeEditBack} />}
            </div>
            {/* CH-10 (живе тестування 2026-09-21): 3 варіанти замість 2 --
                той самий напис "Постійний процес з метриками (без дати)"
                одночасно позначав і режим картки тут, і чекбокс у формі
                окремого блоку-метрики нижче, плутало. Порядок навмисний
                (юзер-кейс CH-02/CH-10): стан -> постійний процес -> цілі. */}
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
              <input
                type="radio"
                name="cardTrackingMode"
                checked={trackingMode === 'state'}
                onChange={() => handleUpdateTracking({ trackingMode: 'state', healthState: healthState ?? 'active' })}
                className="h-4 w-4 accent-ink"
              />
              Картка: стан без вимірювань
            </label>
            {trackingMode === 'state' && (
              <div className="ml-6 flex flex-col gap-1.5">
                {HEALTH_STATE_OPTIONS.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                    <input
                      type="radio"
                      name="cardHealthState"
                      checked={healthState === option.value}
                      onChange={() => handleUpdateTracking({ trackingMode: 'state', healthState: option.value })}
                      className="h-4 w-4 accent-ink"
                    />
                    <span className={`chip-gloss h-2.5 w-2.5 shrink-0 rounded-full ${HEALTH_STATE_DOT_CLASS[option.value]}`} aria-hidden="true" />
                    {option.label}
                  </label>
                ))}
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
              <input
                type="radio"
                name="cardTrackingMode"
                checked={trackingMode === 'ongoing'}
                onChange={() => handleUpdateTracking({ trackingMode: 'ongoing', healthState: null })}
                className="h-4 w-4 accent-ink"
              />
              Картка: постійний процес
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
              <input
                type="radio"
                name="cardTrackingMode"
                checked={trackingMode === 'goals'}
                onChange={() => handleUpdateTracking({ trackingMode: 'goals', healthState: null })}
                className="h-4 w-4 accent-ink"
              />
              Картка: з цілями та метриками
            </label>
            {trackingError !== null && <Banner variant="error" text={trackingError} />}
          </fieldset>
        )}

        {/* AC-14/AC-15: перенос уже стався зовні -- тут лише пропозиція
            перейменувати, коли він зіткнувся з наявним блоком тієї ж картки. */}
        {data.pendingTransferCollision && (
          <div className="flex flex-col gap-3">
            <Banner variant="error" text={FALLBACK_COLLISION_ERROR_TEXT} />
            <TextField label="Нова назва блоку-метрики" value={renameValue} onChange={setRenameValue} error={collisionError} />
            <Button label="Зберегти" onClick={handleConfirmRename} />
          </div>
        )}

        {/* D-111 (docs/DECISIONS.md): кнопка/форма створення -- ПЕРЕД будь-яким
            контентом звороту, не лише перед порожнім станом (Andrii: "+ Додати
            блок-метрику" має бути першим, що бачить користувач згори).
            Review 2026-09-07 A4 (AC-07/AC-08): рендериться НЕЗАЛЕЖНО від
            metricBlocks.length -- раніше з'являлась лише в порожньому стані,
            тож у картки з хоч одним блоком не було способу додати другий.
            CH-10 review (живе тестування 2026-09-21): для ПОРОЖНЬОЇ картки в
            режимі "стан" (hasNoMetrics && trackingMode === 'state') ця секція
            взагалі не рендериться -- вибір мячика (вище, "Режим картки") і Є
            єдиним вмістом, показувати ще й приглушену порожню секцію метрик
            під ним нема сенсу. Для порожньої картки в 'ongoing'/'goals'
            секція лишається (кнопка "+ Додати"), лише без EmptyState-напису
            -- сама кнопка вже показує порожнечу, дублювати текстом зайве. */}
        {/* CH-02: "стан без вимірювань" -- усі налаштування метрик стають
            неактивними (disabled), не зникають: колишні блоки лишаються
            видимими (історія прогресу не губиться), просто без можливості
            їх чіпати, поки картка в цьому режимі. `pointer-events-none` +
            приглушений вигляд -- лише ВІЗУАЛЬНИЙ шар (миша/дотик); code
            review 2026-09-19 (CH-02/CH-03 diff): CSS pointer-events НЕ
            блокує Enter/Space-активацію фокусованої кнопки з клавіатури,
            тож кожен інтерактивний елемент нижче ДОДАТКОВО отримує СПРАВЖНІЙ
            `disabled` -- "+ Додати" явно, MetricBlockCard's ×/✎ через свій
            proп (той самий принцип, що <fieldset disabled> вище). */}
        {!(hasNoMetrics && trackingMode === 'state') && (
          <div
            className={trackingMode === 'state' ? 'pointer-events-none flex flex-col gap-3 opacity-40' : 'flex flex-col gap-3'}
            aria-disabled={trackingMode === 'state'}
          >
            {trackingMode === 'state' && (
              <p className="text-xs italic text-ink-faint">Картка в режимі "стан без вимірювань" -- метрики не використовуються.</p>
            )}
            {onCreateMetricBlock &&
              (isCreatingBlock ? (
                // CH-10: режим картки визначає, ЯКІ поля форма показує --
                // 'state' сюди не доходить (кнопка вище вже disabled).
                <MetricBlockForm onSubmit={handleCreateMetricBlock} mode={trackingMode === 'ongoing' ? 'ongoing' : 'goals'} />
              ) : (
                <Button label="+ Додати блок-метрику" onClick={() => setIsCreatingBlock(true)} disabled={trackingMode === 'state'} />
              ))}

            {data.metricBlocks.length > 0 && (
              <div className="flex flex-col gap-3">
              {data.aggregateProgress !== null && (
                <p className="mt-1 font-display text-sm font-bold leading-relaxed text-ink">
                  Загальний прогрес: {Math.round(data.aggregateProgress * 100)}%
                </p>
              )}
              {data.metricBlocks.map((block) => (
                <MetricBlockCard
                  key={block.id}
                  block={block}
                  disabled={trackingMode === 'state'}
                  onDelete={onArchiveMetricBlock ? () => setPendingDeleteBlock(block) : undefined}
                  onEdit={
                    onUpdateMetricBlock || onTransferMetricBlock
                      ? () => {
                          setTransferTargetId('');
                          setTransferError(undefined);
                          setEditingBlock(block);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
            )}
          </div>
        )}

        {/* Видалення блоку-метрики: клік "×" на MetricBlockCard відкриває
            ArchiveMetricBlockDialog саме для того блоку (pendingDeleteBlock).
            onArchiveMetricBlock перевірено вище (onDelete не рендериться без
            нього), другий guard тут -- лише для типів (pendingDeleteBlock міг
            лишитись зі старого рендеру між двома ре-рендерами того самого разу). */}
        {pendingDeleteBlock && onArchiveMetricBlock && (
          <ArchiveMetricBlockDialog
            metricBlockLabel={pendingDeleteBlock.label}
            onArchive={handleArchiveMetricBlock}
            onCancel={() => setPendingDeleteBlock(null)}
          />
        )}

        {/* CH-03 (docs/features/life-area-card/changes.md): редагування блоку-
            метрики -- олівець на MetricBlockCard відкриває цю панель саме для
            того блоку (editingBlock). Два незалежних дійства всередині:
            (1) MetricBlockForm перевикористаний як є (initialValues із
            поточних label/unit/settings, onSubmit -- update, не create) для
            перейменування/зміни налаштувань; (2) вибір картки-цілі +
            "Перенести" -- наявна transferMetricBlock, окремий виклик. */}
        {editingBlock && (onUpdateMetricBlock || onTransferMetricBlock) && (
          <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-solid p-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold leading-relaxed text-ink">
                Редагування «{editingBlock.label}»
              </h3>
              <Button label="Закрити" onClick={() => setEditingBlock(null)} />
            </div>

            {onUpdateMetricBlock && (
              <MetricBlockForm
                key={editingBlock.id}
                initialValues={{
                  label: editingBlock.label,
                  unit: editingBlock.unit,
                  targetCount: editingBlock.settings?.targetCount ?? null,
                  isOngoing: editingBlock.settings?.isOngoing ?? false,
                  targetDate: editingBlock.settings?.targetDate ?? null,
                }}
                // Review-fix (CH-10): режим тут -- з ВЛАСНИХ налаштувань
                // блоку, НЕ з поточного режиму картки. Картку могли
                // перемкнути на "постійний процес" ПІСЛЯ того, як цей блок
                // уже мав ціль+дату (створений під "з цілями") -- узявши
                // режим картки, форма мовчки стерла б ціль/дату при
                // звичайному виправленні одруківки в назві. Блок без
                // settings (старі fixtures до CH-03) -- падаємо на режим
                // картки, дані втрачати нема чого.
                mode={
                  editingBlock.settings
                    ? editingBlock.settings.isOngoing
                      ? 'ongoing'
                      : 'goals'
                    : trackingMode === 'ongoing'
                      ? 'ongoing'
                      : 'goals'
                }
                onSubmit={handleSaveMetricBlockEdit}
              />
            )}

            {onTransferMetricBlock && transferTargetCards && transferTargetCards.length > 0 && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                  Перенести на іншу картку
                  <select
                    value={transferTargetId}
                    onChange={(event) => setTransferTargetId(event.target.value)}
                    className="rounded-control border border-border bg-surface-solid px-3.5 py-2.5 text-sm font-normal text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
                  >
                    <option value="">Оберіть картку</option>
                    {transferTargetCards.map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.name}
                      </option>
                    ))}
                  </select>
                </label>
                {transferError !== undefined && <Banner variant="error" text={transferError} />}
                <Button
                  label="Перенести"
                  onClick={handleTransferMetricBlock}
                  disabled={!transferTargetId || isTransferring}
                />
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setHistoryExpanded((expanded) => !expanded)}
          className="w-full rounded-control border border-border px-4 py-2.5 text-left text-sm font-bold text-ink transition-colors hover:bg-border"
        >
          Історія записів {historyExpanded ? '▴' : '▾'}
        </button>
        {historyExpanded && (
          <EntryHistoryList
            entries={data.entries}
            onFlagEntry={onFlagEntry ? handleFlagEntry : undefined}
            isFlagEntryDisabled={isFlaggingEntry}
          />
        )}
        {historyExpanded && showFlagHint && (
          <Banner variant="info" text="Позначено помилковим -- напишіть агенту в чаті, яке значення правильне, і він виправить запис." />
        )}
      </div>

      {/* D-111 (docs/DECISIONS.md, виправлено): "← перегорнути" -- ОСТАННІЙ
          елемент, унизу -- те саме місце, де на лицьовій стороні стоїть
          "перегорнути →" (CardFace.tsx). Живе тестування (скріншоти):
          користувач бачив кнопки вгорі на звороті й унизу на лиці -- це не
          "згруповано по стороні", а буквально ОДНЕ Й ТЕ САМЕ місце на обох
          сторонах, інакше доводиться щоразу шукати кнопки заново. */}
      <button
        type="button"
        onClick={onFlip}
        className="w-full rounded-control border border-border px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-border"
      >
        ← перегорнути
      </button>
    </div>
  );
}
