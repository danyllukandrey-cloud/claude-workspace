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
import { useEffect, useState } from 'react';
import { Banner, Button, CardShell, EmptyState, Spinner } from '../../../shared/ui';
import { DeckGrid } from './DeckGrid';
import type { DeckGridItem } from './DeckGrid';
import type { EntryViewModel } from './types';

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
  loadArchivedCardHistory,
}: ArchiveScreenProps): JSX.Element {
  const [state, setState] = useState<ScreenState>({ status: 'loading' });

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 pb-20">
      <h1 className="font-display text-xl font-bold leading-relaxed text-ink">Архів карток</h1>
      <DeckGrid
        items={items}
        renderFront={(item) => (
          <button
            type="button"
            onClick={() => handleOpen(item.id)}
            className="absolute inset-0 flex items-start overflow-hidden rounded-card border border-border bg-surface-solid p-5 text-left font-display text-lg font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5 break-words"
          >
            {item.name}
          </button>
        )}
      />
    </div>
  );
}
