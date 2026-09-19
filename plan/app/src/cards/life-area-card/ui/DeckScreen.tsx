// SCR-01 -- Колода карток (T25): стартовий екран застосунку.
// Стани -- docs/features/life-area-card/screens.md, SCR-01: default / empty /
// loading / error.
//
// DI, не fetch (ISS-45): у репозиторії ще немає підключеного HTTP-транспорту
// (Express) -- ports/*.ts framework-agnostic, реальний fetch підключить
// майбутня задача T30. Тому дані компонент отримує через ІН'ЄКТОВАНИЙ проп-
// функцію loadCards, що повертає Promise -- той самий підхід DI, що вже в
// app/*.ts цієї картки (callClaude, closeStructurePosition як параметри).
// Компонент сам керує локальним станом (loading/error) навколо виклику цього
// пропу -- жодного fetch() і жодного імпорту з ports/ чи app/ цієї ж картки
// (правило залежностей, plan/app/CLAUDE.md).

import { useEffect, useState } from 'react';
import { AppError } from '../../../shared/errors';
import { Banner, Button, EmptyState, Spinner } from '../../../shared/ui';
import { CreateCardForm } from './CreateCardForm';
import type { CreateCardFormInput } from './CreateCardForm';
import { DeckFrontCard } from './DeckFrontCard';
import { DeckGrid } from './DeckGrid';
import type { DeckGridItem } from './DeckGrid';
import type { MetricBlockFormValues } from './MetricBlockForm';
import type { CardBackData, CardFaceData, MetricBlockTransferTargetCard } from './types';
import type { CardTrackingMode, CardHealthState } from '../domain/card';

const CREATE_CARD_LABEL = 'Створити картку';
const ARCHIVE_LABEL = 'Архів карток';
// CH-04 (docs/features/life-area-card/changes.md): DeckGrid вимагає хоч один
// item, щоб узагалі щось намалювати (порожній масив -- <></>, DeckGrid.tsx).
// Коли колода порожня (перша картка користувача), інлайн-форма створення
// все одно має з'явитись "на місці передньої картки" -- цей синтетичний
// item існує лише для того, щоб дати DeckGrid один шар для рендеру;
// renderFront ігнорує сам item, коли isCreating (завжди CreateCardForm).
const CREATE_PLACEHOLDER_ITEM: DeckGridItem = { id: '__create-card-placeholder__', name: '' };

export interface DeckScreenProps {
  /**
   * Завантажує активні картки поточного власника. Ін'єктована функція (DI) --
   * компонент не знає, звідки походять дані (GET /cards підключить T30).
   *
   * Контракт: має бути референційно стабільною (той самий екземпляр функції
   * між рендерами, наприклад через useCallback у виклику) -- ефект нижче
   * перезапускається при зміні посилання на loadCards, тож нестабільна
   * функція (нова лямбда щорендера) спричинить цикл повторних запитів.
   */
  loadCards: () => Promise<DeckGridItem[]>;
  /**
   * CH-04 (docs/features/life-area-card/changes.md): реальне створення
   * картки (POST /cards) -- ISS-55 ввів цей проп як `() => void` (перемикач
   * екрана App.tsx), CH-04 прибирає окремий екран: тепер це сам виклик
   * створення, ін'єктований сюди тим самим стилем DI, що onRename/onArchive.
   * DeckScreen сам керує локальним "isCreating" перемиканням -- клік
   * "Створити картку" НЕ викликає цей проп напряму, лише показує inline
   * CreateCardForm (renderFront нижче), яка викликає його з onSubmit.
   */
  onCreateCard: (input: CreateCardFormInput) => Promise<void>;
  /**
   * CH-01 (docs/features/life-area-card/changes.md): дубль кнопки "Архів
   * карток" біля "Створити картку" -- та сама точка входу, що кнопка на
   * Схемі (`structure` CH-01, координовано). App.tsx (composition root)
   * підставляє СПІЛЬНИЙ callback в обидва місця -- не окрему реалізацію тут.
   */
  onOpenArchive: () => void;
  /**
   * Review 2026-09-07 C14 (AC-04): loadCards відхилено з AppError, чий
   * httpStatus === 401 (сесія протермінована/невалідна, main.tsx) --
   * викликається ЗАМІСТЬ показу Banner-помилки, щоб користувач не впирався
   * в глухий кут (App.tsx поверне LoginScreen, той самий шлях, що onLogout).
   */
  onSessionExpired: () => void;

  // --- Передня картка (D-121, живе тестування: "картка в колоді має одразу
  // бути готова так ніби вона відкрита") -- ті самі проп-контракти, якими
  // App.tsx раніше живив окремий CardDetailScreen, тепер прокидаються сюди й
  // далі в DeckFrontCard (DeckGrid.tsx renderFront) без змін. -----------
  loadCard: (cardId: string) => Promise<CardFaceData>;
  loadBack: (cardId: string) => Promise<CardBackData>;
  onRename: (cardId: string, name: string) => Promise<void>;
  onArchive: (cardId: string) => Promise<void>;
  onUpdateDescription?: (cardId: string, input: { description: string; markFilled: boolean }) => Promise<void>;
  onFlagEntry?: (cardId: string, entryId: string) => Promise<CardBackData>;
  onCreateMetricBlock?: (cardId: string, values: MetricBlockFormValues) => Promise<void>;
  onArchiveMetricBlock?: (cardId: string, metricBlockId: string) => Promise<void>;
  /** CH-02: зберігає режим відстеження картки -- опційно, той самий DI-патерн, що решта дій вище. */
  onUpdateTracking?: (cardId: string, input: { trackingMode: CardTrackingMode; healthState: CardHealthState | null }) => Promise<void>;
  /** CH-03: зберігає перейменування/налаштування блоку-метрики -- опційно, той самий DI-патерн, що решта дій вище. */
  onUpdateMetricBlock?: (cardId: string, metricBlockId: string, values: MetricBlockFormValues) => Promise<void>;
  /** CH-03: переносить блок-метрику на іншу картку (наявна transferMetricBlock) -- опційно. */
  onTransferMetricBlock?: (cardId: string, metricBlockId: string, targetCardId: string) => Promise<void>;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; items: DeckGridItem[] }
  | { status: 'error'; message: string };

const DEFAULT_ERROR_MESSAGE = 'Не вдалося завантажити колоду карток';

export function DeckScreen({
  loadCards,
  onCreateCard,
  onOpenArchive,
  onSessionExpired,
  loadCard,
  loadBack,
  onRename,
  onArchive,
  onUpdateDescription,
  onFlagEntry,
  onCreateMetricBlock,
  onArchiveMetricBlock,
  onUpdateTracking,
  onUpdateMetricBlock,
  onTransferMetricBlock,
}: DeckScreenProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // CH-04: чи зараз показано inline CreateCardForm ЗАМІСТЬ передньої картки
  // колоди -- локальний UI-перемикач (той самий "isX toggle-стан" підхід, що
  // isCreatingBlock у CardBack.tsx), НЕ окремий Screen App.tsx більше не тримає.
  const [isCreating, setIsCreating] = useState(false);
  // C14: "Спробувати ще раз" не може просто повторно викликати loadCards()
  // напряму (ефект нижче має лишитись єдиним місцем, що читає/пише state) --
  // інкремент цього лічильника в deps ефекту тригерить той самий цикл
  // loading -> loaded/error заново. D-121: той самий лічильник тепер служить
  // і сигналу "картку заархівовано" (DeckFrontCard.onArchived) -- перезапит
  // колоди без архівної картки, той самий підхід, що onBack мав у прибраному
  // CardDetailScreen (ремаунт через зміну ключа стану, не прямий виклик).
  const [retryToken, setRetryToken] = useState(0);
  const reload = (): void => setRetryToken((token) => token + 1);

  /**
   * CH-04: injected onCreateCard -- CreateCardForm сам ловить відхилення й
   * показує свій Banner (лишається відкритою на невдачі, той самий підхід,
   * що CreateCardForm.test.tsx уже покриває), тому тут НЕ обгортаємо в
   * try/catch -- лише успіх закриває inline-форму й перезавантажує колоду.
   */
  const handleCreate = (input: CreateCardFormInput): Promise<void> =>
    onCreateCard(input).then(() => {
      setIsCreating(false);
      reload();
    });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    loadCards()
      .then((items) => {
        if (!cancelled) {
          setState({ status: 'loaded', items });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // C14/AC-04: 401 -- сесія протермінована/невалідна, не "мережа
        // недоступна" -- банер помилки тут був би глухим кутом (нема кнопки,
        // що могла б це виправити). onSessionExpired повертає до LoginScreen.
        if (error instanceof AppError && error.httpStatus === 401) {
          onSessionExpired();
          return;
        }
        const message = error instanceof Error ? error.message : DEFAULT_ERROR_MESSAGE;
        setState({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [loadCards, retryToken, onSessionExpired]);

  // D-120: примітиви (Spinner/Banner/EmptyState/Button) уже самі стилізовані
  // й не приймають className -- тут стилізуються лише обгорткові контейнери
  // (тло сторінки, відступи, групування дій).
  //
  // D-124 (живе тестування): "Архів" переїхав на Літопис-Аналітику
  // (structure/ui/AnalyticsScreen.tsx), "Вийти" -- у верхній бар (App.tsx,
  // поруч із шестернею) -- обидва прибрано звідси. Лишається "Створити
  // картку" (без "+", наступний прохід живого тестування прибрав), центрована
  // й АВТОШИРИНИ -- `flex justify-center` замість колишнього `flex-col` (у
  // колонці Button стретчився на всю ширину за замовчуванням flex-стиснення,
  // не через власний CSS).
  //
  // CH-01 (docs/features/life-area-card/changes.md, координовано зі
  // structure CH-01): "Архів карток" повертається сюди як ДУБЛЬ (не як
  // повернення старої D-124 поведінки -- та кнопка вела на іншу дію й досі
  // прибрана з Аналітики) поруч із "Створити картку" -- `justify-center`
  // лишається, `flex-col` -> `flex-wrap` (дві кнопки в ряд, перенос на
  // вузькому екрані, той самий "не на всю ширину" контракт).
  //
  // D-125 (живе тестування): "усе пропорційно" -- відступ кнопки від нижньої
  // панелі має дорівнювати власному відступу самої панелі (py-3, App.tsx's
  // <nav>) зверху від її кнопок. Раніше тут стояли ВЛАСНІ px-4/py-6/gap-6 --
  // ЗАЙВІ поверх px-4/py-3, які контентна зона (App.tsx) вже додає навколо
  // будь-якого напрямку -- подвійний відступ (16+24=40px знизу) не мав
  // нічого спільного з py-3 (12px) нав-меню. Прибрано власні px-4/py-6
  // повністю (контентна зона App.tsx вже дає симетричний відступ на всіх
  // чотирьох станах нижче), gap-6 -> gap-3 (та сама відстань, що від кнопки
  // до низу) -- і колода, і стрілки ‹/›, і кнопка тепер на ОДНІЙ спільній
  // одиниці відступу. Картка сама виросла пропорційно (DeckGrid's
  // `flex-1 min-h-0`, D-122) -- звільнене місце дісталось саме їй.
  //
  // D-121 фікс: `h-full` (не `min-h-screen`) на всіх станах -- той самий
  // фікс, що App.tsx вже отримав (`h-dvh`/`min-h-0`): DeckScreen тепер живе
  // ВСЕРЕДИНІ вже висотно-обмеженої контентної зони app-shell, `min-h-screen`
  // тут або нічого не додає, або (гірше) продавлює контентну зону вище за її
  // бюджет висоти.
  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-bg px-4">
        <Spinner />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-full flex-col justify-center gap-4 bg-bg px-4 py-8">
        <Banner variant="error" text={state.message} />
        <Button label="Спробувати ще раз" onClick={reload} />
      </div>
    );
  }

  if (state.items.length === 0 && !isCreating) {
    return (
      <div className="flex h-full flex-col gap-3 bg-bg">
        <EmptyState message="Тут ще немає жодної картки" actionHint="Створіть першу картку, щоб почати" />
        <div className="mt-auto flex flex-wrap items-center justify-center gap-3">
          <Button label={CREATE_CARD_LABEL} onClick={() => setIsCreating(true)} />
          {/* CH-01 (life-area-card/changes.md): дубль "Архів карток", та сама
              точка входу, що кнопка на Схемі (structure CH-01). */}
          <Button label={ARCHIVE_LABEL} onClick={onOpenArchive} />
        </div>
      </div>
    );
  }

  // CH-04 (docs/features/life-area-card/changes.md): порожня картка
  // з'являється "на місці передньої картки колоди" -- ЗАВЖДИ один
  // синтетичний item (не реальний масив state.items), незалежно від того,
  // скільки карток уже в колоді. Так само і для порожньої колоди (гілка
  // вище цього не покриває -- DeckGrid.tsx повертає <></> для []).
  // Навмисно: реальні картки під час створення "ховаються" з DeckGrid --
  // інакше клік по картці, що визирає позаду (DeckGrid's жест "перегорнути
  // колоду"), змінив би key переднього шару й перемонтував CreateCardForm,
  // втративши недописану чернетку.
  if (isCreating) {
    return (
      <div className="flex h-full flex-col gap-3 bg-bg">
        <DeckGrid items={[CREATE_PLACEHOLDER_ITEM]} renderFront={() => <CreateCardForm onCreate={handleCreate} onCancel={() => setIsCreating(false)} />} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 bg-bg">
      <DeckGrid
        items={state.items}
        renderFront={(item) => (
          <DeckFrontCard
            cardId={item.id}
            loadCard={loadCard}
            loadBack={loadBack}
            onRename={onRename}
            onArchive={onArchive}
            onArchived={reload}
            onUpdateDescription={onUpdateDescription}
            onFlagEntry={onFlagEntry}
            onCreateMetricBlock={onCreateMetricBlock}
            onArchiveMetricBlock={onArchiveMetricBlock}
            onUpdateTracking={onUpdateTracking}
            onUpdateMetricBlock={onUpdateMetricBlock}
            onTransferMetricBlock={onTransferMetricBlock}
            // CH-03: картки-цілі пікера перенесення -- решта колоди, без
            // цієї самої (переносити блок у картку, яку зараз редагуєш,
            // безглуздо, той самий принцип, що LayoutBoard's
            // loadCloseCardOptions target-фільтр).
            transferTargetCards={state.items
              .filter((c) => c.id !== item.id)
              .map((c): MetricBlockTransferTargetCard => ({ id: c.id, name: c.name }))}
          />
        )}
      />
      <div className="mt-auto flex flex-wrap items-center justify-center gap-3">
        <Button label={CREATE_CARD_LABEL} onClick={() => setIsCreating(true)} />
        {/* CH-01 (life-area-card/changes.md): дубль "Архів карток", та сама
            точка входу, що кнопка на Схемі (structure CH-01). */}
        <Button label={ARCHIVE_LABEL} onClick={onOpenArchive} />
      </div>
    </div>
  );
}
