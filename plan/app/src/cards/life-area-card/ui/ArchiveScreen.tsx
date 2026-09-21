// SCR-07 -- Архів карток (T36): список архівованих карток (US-16, AC-18) і
// перегляд однієї архівованої картки з можливістю розархівувати (AC-17).
//
// default стан ПЕРЕВИКОРИСТОВУЄ наявний DeckGrid (T25, ISS-46) у режимі
// "архів" -- DeckGrid навмисно узагальнений (items+renderFront, нічого не
// знає про статус картки), тож нової сітки тайлів тут не пишемо. D-121
// (живе тестування): передня картка в основній колоді (DeckScreen.tsx)
// перестала бути кнопкою-назвою, що "відкриває" картку окремим екраном --
// але Архів свідомо НЕ зачіпається цим рішенням (Андрій: "поки не чіпаю"),
// тож тут renderFront і далі повертає просту кнопку-назву з тим самим
// onOpen-подібним кліком, що раніше ніс сам DeckGrid. card-view --
// CardShell (shared/ui) + Button "Розархівувати" (AC-17) + read-only історія
// записів (AC-18: "історія записів видима"); поки картка не розархівована,
// новий запис на ній недоступний (тут немає жодної дії його додати), і сама
// історія тут суто для перегляду -- без "виправити" (EntryHistoryList,
// T26/AC-12, тому не використовується напряму: та дія стосується активної
// картки, не архівної).
//
// ISS-45/DI (plan/app/CLAUDE.md "Правило залежностей"): жодного fetch і
// жодного імпорту з ../ports чи ../app цієї ж картки -- реальний HTTP-
// транспорт (Express) підключить майбутня задача T30. Дані й дії компонент
// отримує через ІН'ЄКТОВАНІ пропси-функції, що повертають Promise -- той
// самий стиль DI, що вже в DeckScreen.tsx/CardFace.tsx цього ж репозиторію.
import { useEffect, useRef, useState } from 'react';
import { Banner, Button, CardShell, ConfirmDialog, EmptyState, Spinner, TrashIcon } from '../../../shared/ui';
import type { DeckGridItem } from './DeckGrid';
import type { EntryViewModel } from './types';

// CH-15 (docs/features/life-area-card/changes.md, живе тестування, Андрій):
// "Картки масштабуй завжди до такого розміру щоб вони всі влазили в екран
// розкладки" -- той самий "масштабувати як одне ціле" принцип, що Схема
// (structure/ui/LayoutBoard.tsx CH-15), лише простіше: тут немає системи
// відсотків, яку треба зберегти -- сітка з фіксованим розміром картки й
// колонок МАЄ природний ("бажаний") розмір, порахований напряму з кількості
// карток (ARCHIVE_CARD_SIZE x колонки/рядки), і CSS transform: scale()
// стискає готову сітку під РЕАЛЬНИЙ розмір видимої зони, якщо вона не
// влазить. Фіксована кількість колонок (не responsive breakpoints, як було)
// -- сам розмір картки тепер підлаштовується масштабом, а не колонки під
// ширину екрана.
const ARCHIVE_GRID_COLUMNS = 4;
const ARCHIVE_CARD_SIZE = 160;
const ARCHIVE_GRID_GAP = 12;
const ARCHIVE_MIN_SCALE = 0.4;

export interface ArchiveScreenProps {
  /**
   * Завантажує архівовані картки поточного власника (US-16, AC-18). Ін'єктована
   * функція (DI) -- компонент не знає, звідки походять дані (GET
   * /cards?status=archived підключить T30).
   *
   * Контракт: має бути референційно стабільною (той самий екземпляр функції
   * між рендерами) -- ефект нижче перезапускається при зміні посилання.
   */
  loadArchivedCards: () => Promise<DeckGridItem[]>;
  /**
   * Розархівовує картку (T35, AC-17): status archived -> active. Реальний
   * PATCH-виклик підключить T30 -- тут лише повідомляємо про намір і чекаємо
   * Promise<void>. Після успіху картка видаляється з локального списку
   * архіву без повторного GET.
   */
  onRestoreCard: (cardId: string) => Promise<void>;
  /**
   * CH-15 (docs/features/life-area-card/changes.md): видаляє архівовану
   * картку НАЗАВЖДИ (DELETE /cards/{id}/permanent, не PATCH-архівація) --
   * опційна, той самий патерн, що onDelete/onEdit у MetricBlockCard: без
   * пропу кнопка "Видалити" взагалі не рендериться.
   */
  onDeleteCardPermanently?: (cardId: string) => Promise<void>;
  /**
   * AC-18 ("історія записів видима"): завантажує історію записів обраної
   * архівованої картки для режиму перегляду. Read-only -- на відміну від
   * CardBack.loadBack (T26), тут немає онFlagEntry/агрегату/блоків-метрик:
   * архівна картка показує лише сам факт "що записано і коли", без жодної дії.
   */
  loadArchivedCardHistory: (cardId: string) => Promise<EntryViewModel[]>;
}

type HistoryState =
  | { status: 'loading' }
  | { status: 'ready'; entries: EntryViewModel[] }
  | { status: 'error'; message: string };

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'list'; items: DeckGridItem[] }
  | {
      status: 'card-view';
      items: DeckGridItem[];
      card: DeckGridItem;
      restoreError: string | null;
      isRestoring: boolean;
      history: HistoryState;
    };

const DEFAULT_LOAD_ERROR = 'Не вдалося завантажити архів карток';
const DEFAULT_RESTORE_ERROR = 'Не вдалося розархівувати картку';
const DEFAULT_HISTORY_ERROR = 'Не вдалося завантажити історію записів';

export function ArchiveScreen({
  loadArchivedCards,
  onRestoreCard,
  onDeleteCardPermanently,
  loadArchivedCardHistory,
}: ArchiveScreenProps): JSX.Element {
  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  // CH-15: картка, що чекає підтвердження permanent delete (ConfirmDialog з
  // requireTypedWord, рендериться нижче поза station-специфічним рендером,
  // щоб працювати однаково для list/card-view). null -- нікого не озброєно.
  const [pendingDeleteCard, setPendingDeleteCard] = useState<DeckGridItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // CH-15 (scale-to-fit): вимірює РЕАЛЬНИЙ (доступний) розмір зони сітки --
  // той самий ResizeObserver-підхід, що Схема (LayoutBoard.tsx CH-15),
  // typeof-перевірка -- jsdom (тести) не має ResizeObserver.
  const gridWrapperRef = useRef<HTMLDivElement>(null);
  const [availableSize, setAvailableSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = gridWrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (width: number, height: number): void => {
      if (width === 0 || height === 0) return;
      setAvailableSize({ width, height });
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

  const dismissDeleteDialog = (): void => {
    setPendingDeleteCard(null);
    setDeleteError(null);
    setIsDeleting(false);
  };

  const handleConfirmDelete = (afterDelete: (cardId: string) => void): void => {
    if (!pendingDeleteCard || !onDeleteCardPermanently) return;
    const cardId = pendingDeleteCard.id;
    setIsDeleting(true);
    setDeleteError(null);
    onDeleteCardPermanently(cardId)
      .then(() => {
        dismissDeleteDialog();
        afterDelete(cardId);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Не вдалося видалити картку назавжди';
        setDeleteError(message);
        setIsDeleting(false);
      });
  };

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    loadArchivedCards()
      .then((items) => {
        if (!cancelled) {
          setState({ status: 'list', items });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : DEFAULT_LOAD_ERROR;
          setState({ status: 'error', message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadArchivedCards]);

  if (state.status === 'loading') {
    return <Spinner />;
  }

  if (state.status === 'error') {
    return <Banner variant="error" text={state.message} />;
  }

  if (state.status === 'card-view') {
    const { card, items, restoreError, isRestoring, history } = state;

    const handleRestore = (): void => {
      setState({ status: 'card-view', items, card, restoreError: null, isRestoring: true, history });
      onRestoreCard(card.id)
        .then(() => {
          // AC-17: після успіху картка зникає зі списку архіву -- назад до
          // list з відфільтрованими items, без повторного GET.
          setState({ status: 'list', items: items.filter((item) => item.id !== card.id) });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : DEFAULT_RESTORE_ERROR;
          setState({ status: 'card-view', items, card, restoreError: message, isRestoring: false, history });
        });
    };

    // Review 2026-09-07 E (T52): "з картки в архіві немає повернення до
    // списку архіву" -- лише закриває card-view (той самий список `items`,
    // ЖОДНОГО повторного loadArchivedCards), не чіпає саму картку.
    const handleBack = (): void => setState({ status: 'list', items });

    return (
      <div className="flex h-full min-h-0 flex-col gap-4 p-4 pb-20">
        <h1 className="font-display text-xl font-bold leading-relaxed text-ink">Архів карток</h1>
        <CardShell
          isFlipped={false}
          front={
            // Живе тестування (Андрій, баг 2): CardShell.tsx більше не скролить
            // себе сам -- цей виклик не має власної кнопки-футера (на відміну
            // від CardFace/CardBack), тож переносимо той самий патерн
            // (flex-1 min-h-0 overflow-y-auto) сюди, щоб не втратити скрол при
            // довгій історії записів.
            <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto">
              <h2 className="font-display text-lg font-bold leading-relaxed text-ink">{card.name}</h2>
              <p className="text-sm italic text-ink-muted">Картка в архіві -- новий запис недоступний, поки її не розархівовано</p>
              <Button label="Розархівувати" onClick={handleRestore} disabled={isRestoring} />
              {restoreError !== null && <Banner variant="error" text={restoreError} />}

              {history.status === 'loading' && <Spinner />}
              {history.status === 'error' && <Banner variant="error" text={history.message} />}
              {history.status === 'ready' && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-bold leading-relaxed text-ink">Історія записів</h3>
                  <ul className="flex flex-col gap-2">
                    {history.entries.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between gap-2 rounded-control border border-border bg-surface-solid px-3.5 py-2.5 text-sm"
                      >
                        <span className="text-ink-muted">{entry.recordedAtLabel}</span>
                        <span className="font-medium text-ink">{entry.summary}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button label="← Назад" onClick={handleBack} />
            </div>
          }
          back={null}
        />
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 p-4 pb-20">
        <h1 className="font-display text-xl font-bold leading-relaxed text-ink">Архів карток</h1>
        <EmptyState message="Архів порожній" actionHint="Заархівовані картки з'являться тут після архівації" />
      </div>
    );
  }

  const items = state.items;
  const handleOpen = (id: string): void => {
    const card = items.find((item) => item.id === id);
    if (!card) return;

    setState({
      status: 'card-view',
      items,
      card,
      restoreError: null,
      isRestoring: false,
      history: { status: 'loading' },
    });

    loadArchivedCardHistory(id)
      .then((entries) => {
        setState((current) =>
          current.status === 'card-view' && current.card.id === id
            ? { ...current, history: { status: 'ready', entries } }
            : current,
        );
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : DEFAULT_HISTORY_ERROR;
        setState((current) =>
          current.status === 'card-view' && current.card.id === id
            ? { ...current, history: { status: 'error', message } }
            : current,
        );
      });
  };

  // CH-15 (scale-to-fit): "бажаний" розмір сітки -- порахований НАПРЯМУ з
  // кількості карток (не виміряний DOM), тож завжди відомий синхронно, без
  // зайвого тіку рендеру. rows -- скільки рядків дає ARCHIVE_GRID_COLUMNS.
  const rows = Math.max(1, Math.ceil(items.length / ARCHIVE_GRID_COLUMNS));
  const naturalGridWidth = ARCHIVE_GRID_COLUMNS * ARCHIVE_CARD_SIZE + (ARCHIVE_GRID_COLUMNS - 1) * ARCHIVE_GRID_GAP;
  const naturalGridHeight = rows * ARCHIVE_CARD_SIZE + (rows - 1) * ARCHIVE_GRID_GAP;
  const gridScale = availableSize
    ? Math.max(Math.min(availableSize.width / naturalGridWidth, availableSize.height / naturalGridHeight, 1), ARCHIVE_MIN_SCALE)
    : 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <h1 className="font-display text-xl font-bold leading-relaxed text-ink">Архів карток</h1>
      {/* CH-09 (сітка, не колода DeckGrid -- усі картки архіву видно
          одразу, той самий принцип, що базове розташування нових карток на
          Схемі) + CH-15 (docs/features/life-area-card/changes.md, живе
          тестування, Андрій): "Картки масштабуй завжди до
          такого розміру щоб вони всі влазили в екран розкладки" -- сітка з
          ФІКСОВАНИМ розміром картки (не responsive breakpoints, як було)
          промасштабовується (CSS transform: scale, gridScale вище) під
          реальний розмір видимої зони -- усі картки завжди видно одразу, без
          скролу (той самий принцип, що Схема, CH-15). "Кнопка 'на зад' може
          бути над блоками" (App.tsx, плаваюча) -- більше не резервуємо їй
          місце (pb-20 прибрано), зона отримує максимум доступного простору. */}
      <div ref={gridWrapperRef} className="relative flex flex-1 min-h-0 items-center justify-center overflow-hidden">
        <div
          className="grid content-start"
          style={{
            gridTemplateColumns: `repeat(${ARCHIVE_GRID_COLUMNS}, ${ARCHIVE_CARD_SIZE}px)`,
            gap: ARCHIVE_GRID_GAP,
            transform: `scale(${gridScale})`,
          }}
        >
          {items.map((item) => (
            // CH-15: не <button> -- усередині є ще одна інтерактивна кнопка
            // "Видалити" (вкладені <button> заборонені в HTML), тож ціла
            // картка -- div з role="button"/tabIndex/onKeyDown (Enter/Space),
            // той самий доступний контракт, що справжня кнопка.
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => handleOpen(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleOpen(item.id);
                }
              }}
              style={{ width: ARCHIVE_CARD_SIZE, height: ARCHIVE_CARD_SIZE }}
              // Bug fix 2026-09-21 (живе тестування, Андрій зі скріншотом):
              // "корзинка десь не там де треба" -- overflow-hidden тут (з
              // початкового aspect-square-кнопки, де він захищав ДОВГІ
              // назви) обрізав кнопку "Видалити" нижче, бо та навмисно
              // трохи виступає за край картки (-right-1.5/-top-1.5, той
              // самий прийом, що MetricBlockCard.tsx). Прибрано -- довгі
              // назви й так переносяться (break-words нижче).
              className="relative flex cursor-pointer flex-col items-start rounded-card border border-border bg-surface-solid p-3.5 text-left shadow-soft transition-transform hover:-translate-y-0.5"
            >
              {/* "Назви мають бути там де в колоді з ліва з верху" (Андрій)
                  -- items-start на батькові вище + text-left тут: назва
                  завжди у верхньому лівому куті картки, не по центру. */}
              <span className="font-display text-sm font-semibold text-ink break-words">{item.name}</span>
              {onDeleteCardPermanently && (
                <button
                  type="button"
                  aria-label={`Видалити назавжди картку «${item.name}»`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingDeleteCard(item);
                  }}
                  className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-solid text-ink-muted shadow-soft transition-colors hover:border-bad/40 hover:text-bad"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {pendingDeleteCard && (
        <ConfirmDialog
          message={`Видалити назавжди картку «${pendingDeleteCard.name}»? Цю дію не можна скасувати -- усі її метрики й записи зникнуть без сліду.`}
          confirmLabel="Видалити назавжди"
          cancelLabel="Скасувати"
          requireTypedWord="видалити"
          confirmDisabled={isDeleting}
          onCancel={dismissDeleteDialog}
          onConfirm={() =>
            handleConfirmDelete((deletedCardId) => setState({ status: 'list', items: items.filter((item) => item.id !== deletedCardId) }))
          }
        />
      )}
      {deleteError !== null && (
        <div className="px-1">
          <Banner variant="error" text={deleteError} />
        </div>
      )}
    </div>
  );
}
