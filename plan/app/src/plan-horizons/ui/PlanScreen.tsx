// T9 -- екран «ПЛАН»: три горизонти одним екраном (spec.md AC-01, AC-03,
// AC-03b, AC-08, AC-11).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що DeclarationScreen.tsx):
// loadPlanItems/onToggleDone/onAddPlanItem/onOpenPlanItem -- ін'єктовані
// пропи-функції, жодного fetch() тут. HTTP-транспорт підключає композиційний
// корінь (src/app/main.tsx, T11).
//
// Чому екран приймає ПЛОСКИЙ список, а не готове групування: саме так його
// віддає контракт (contracts/openapi.yaml, `PlanItemPage.items` -- один
// плоский список із курсором). Групування по горизонтах -- показова форма,
// тож живе тут, поруч із показом, а не дублюється в транспорті.
//
// Порядок горизонтів -- PLAN_HORIZONS (тактичний -> оперативний ->
// стратегічний), порядок усередині горизонту -- як прийшов із сервера
// (за датою додавання, AC-08; ручного перевпорядкування у v1 нема).
//
// AC-11: порожній горизонт показує СВОЮ кнопку «+», а не EmptyState. Текст
// «тут порожньо» першому користувачу нічого не дає -- йому потрібна дія, а
// кнопка «+» і є ця дія; вона ж стоїть у непорожньому горизонті, бо наперед
// невідомо, скільки пунктів комусь знадобиться (spec.md §1, уточнення
// `clarify`).
//
// Оптимістичний чекбокс: стан перемикається одразу (AC-03 -- «позначає
// виконаним НЕГАЙНО»), а збій збереження повертає його назад і показує
// Banner. Інакше користувач бачив би галочку там, де сервер її не прийняв.

import { useEffect, useState } from 'react';
import { Banner, Spinner } from '../../shared/ui';
import { PLAN_HORIZONS } from '../domain/plan-item';
import type { PlanHorizon } from '../domain/plan-item';

/** Форма пункту, яку показує екран -- рівно `components.schemas.PlanItem` контракту. */
export interface PlanScreenItem {
  id: string;
  horizon: PlanHorizon;
  planText: string;
  done: boolean;
  /** ISO 8601 -- дата ДОДАВАННЯ пункту, незмінна після створення (AC-01/AC-08). */
  createdAt: string;
}

export interface PlanScreenProps {
  /** Завантажує всі активні пункти плану користувача (плоский список). */
  loadPlanItems: () => Promise<PlanScreenItem[]>;
  /** Зберігає новий стан чекбокса «виконано» (AC-03/AC-03b). */
  onToggleDone: (item: PlanScreenItem, done: boolean) => Promise<void>;
  /** Відкриває редактор НОВОГО пункту в цьому горизонті (AC-01). */
  onAddPlanItem: (horizon: PlanHorizon) => void;
  /** Відкриває редактор саме цього наявного пункту (AC-04 -- очищення тексту). */
  onOpenPlanItem: (item: PlanScreenItem) => void;
}

export const PLAN_HORIZON_LABELS: Record<PlanHorizon, string> = {
  tactical: 'Тактичний',
  operational: 'Оперативний',
  strategic: 'Стратегічний',
};

const PLAN_HORIZON_HINTS: Record<PlanHorizon, string> = {
  tactical: 'до року',
  operational: '3-5 років',
  strategic: '10+ років',
};

// Той самий формат дати, що в Лозі дій (src/app/main.tsx) -- день і місяць без
// року: у списку намірів рік майже завжди поточний, і показувати його щоразу
// означало б шум замість орієнтира.
function formatAddedAt(createdAt: string): string {
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit' }).format(new Date(createdAt));
}

export function PlanScreen({
  loadPlanItems,
  onToggleDone,
  onAddPlanItem,
  onOpenPlanItem,
}: PlanScreenProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PlanScreenItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPlanItems().then((loaded) => {
      setItems(loaded);
      setLoading(false);
    });
    // Навмисно без loadPlanItems у deps -- викликається рівно раз при монтуванні
    // (той самий підхід, що DeclarationScreen: DI-функція стабільна для життя екрана).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <Spinner />;
  }

  const setDoneLocally = (id: string, done: boolean): void => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, done } : item)));
  };

  const toggle = async (item: PlanScreenItem): Promise<void> => {
    const next = !item.done;
    setError(null);
    setDoneLocally(item.id, next);

    try {
      await onToggleDone(item, next);
    } catch (err: unknown) {
      // Сервер не прийняв зміну -- повертаємо чекбокс у попередній стан, щоб
      // екран не показував прогрес, якого насправді немає.
      setDoneLocally(item.id, item.done);
      setError(err instanceof Error ? err.message : 'Не вдалося зберегти');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto px-4 py-6">
      {error !== null && <Banner variant="error" text={error} />}

      {PLAN_HORIZONS.map((horizon) => {
        const label = PLAN_HORIZON_LABELS[horizon];
        const horizonItems = items.filter((item) => item.horizon === horizon);

        return (
          <section key={horizon} aria-label={label} className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-ink">
              {label} <span className="font-normal text-ink-muted">({PLAN_HORIZON_HINTS[horizon]})</span>
            </h2>

            <ul className="flex flex-col gap-1.5">
              {horizonItems.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    aria-label={item.planText}
                    checked={item.done}
                    onChange={() => void toggle(item)}
                    className="h-4 w-4 rounded border-border"
                  />
                  <span
                    onClick={() => onOpenPlanItem(item)}
                    className={`flex-1 cursor-pointer ${item.done ? 'text-ink-muted line-through' : ''}`}
                  >
                    {item.planText}
                  </span>
                  <span className="text-xs italic text-ink-faint">{formatAddedAt(item.createdAt)}</span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              aria-label={`Додати пункт: ${label}`}
              onClick={() => onAddPlanItem(horizon)}
              className="self-start rounded-control border border-border bg-surface px-3 py-1.5 text-sm font-bold text-ink shadow-btn backdrop-blur-xl transition-colors hover:bg-border"
            >
              +
            </button>
          </section>
        );
      })}
    </div>
  );
}
