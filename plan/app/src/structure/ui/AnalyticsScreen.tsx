// SCR-03 — Літопис-Аналітика (spec.md AC-01, AC-04, AC-05, AC-06, AC-06b,
// AC-07, AC-13).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що DeclarationScreen/
// CardDetailScreen): `loadAnalytics` — ін'єктована пропи-функція, жодного
// fetch() тут. Дані вже прораховані use-case'ом ../app/get-analytics.ts
// (average/excludedCount/layoutMode/cards), доповнені `cardTitle` на
// картку (join з life-area-card робить шар ports/, поза межами цієї
// задачі) і окремим `trendAvailable` — `false` лише коли не відповів
// GET /structure/layout/history (sad.md §11, TBD), а не коли в конкретної
// картки `trend === null` (AC-07 "замало точок історії").
//
// AC-06/AC-06b: жодного слова-вердикту ("добре"/"погано"/"ефективно") —
// лише числа (прогрес %, ранг-розрив, стрілка тренду) або прапорець
// "заявлено важливим, не підтримується" для карток без метрик у
// не-логічній розкладці (spec.md §3 Non-goals, D-60).
// AC-13: картки без обчислюваного прогресу виключені з середнього, але їх
// кількість завжди показана окремо — і в порожньому, і в непорожньому стані.
//
// Живе тестування (Андрій, вимоги 16-18): екран розбитий на три зони
// (grid-контейнер нижче, коментарі при кожній зоні) + дві плаваючі кнопки
// "Архів"/"Звіт" знизу зліва, поверх контенту, поза потоком (position:
// absolute відносно кореневого relative-контейнера, не fixed відносно
// viewport — App.tsx лишається незміненим, кнопки плавають саме над ЦИМ
// екраном, не над сусідньою ChatPanel).
//
// Зона 3 ("звіти") — навмисно порожня структура, без даних: логіку самих
// "звітів за часом" (що це за запис, звідки дані) Андрій ще не описав
// ("опишу пізніше") — рядок у summary задачі, не вигадане поле в
// AnalyticsScreenState. НЕ плутати з ReportsScreen.tsx (agent/ui) —
// "Звіти активності" там окрема сутність (CONTEXT.md `activity-report`,
// той самий коментар лишає ReportsScreen.tsx на своєму місці). Кнопка
// "Звіт" поруч з "Архів" — теж окреме ("звіт за запитом", задача 18) —
// зараз просто текст-заглушка при кліку, логіку опише Андрій пізніше.

import { useEffect, useState } from 'react';
import { Banner, Button, Spinner } from '../../shared/ui';

export type AnalyticsTrend = 'growing' | 'shrinking' | null;

export interface AnalyticsScreenCard {
  cardId: string;
  cardTitle: string;
  progress: number | null;
  gap: number | null;
  trend: AnalyticsTrend;
  unmaintained: boolean;
}

export interface AnalyticsScreenState {
  layoutMode: 'single' | 'free' | 'logic' | null;
  average: number | null;
  excludedCount: number;
  /** `false` тільки коли не відповів GET /structure/layout/history — не плутати з trend===null у окремій картці. */
  trendAvailable: boolean;
  cards: AnalyticsScreenCard[];
}

export interface AnalyticsScreenProps {
  /** Завантажує прораховану аналітику. */
  loadAnalytics: () => Promise<AnalyticsScreenState>;
  /**
   * D-124 (живе тестування): кнопка "Архів" переїхала сюди з Колоди
   * (life-area-card/DeckScreen.tsx) -- Андрій: "кнопку архів потрібно
   * перенести на сторінку Літопис-Аналітика". App.tsx перемикає і `direction`
   * ('cards'), і внутрішній Screen ('archive') одним викликом -- сам
   * ArchiveScreen (SCR-07) лишається в модулі life-area-card без змін.
   */
  onOpenArchive: () => void;
}

function formatPercent(value: number | null): string | null {
  if (value === null) return null;
  return `${Math.round(value * 100)}%`;
}

function trendLabel(trend: AnalyticsTrend): string | null {
  if (trend === 'growing') return 'росте';
  if (trend === 'shrinking') return 'меншає';
  return null;
}

// Спільний стиль заголовка зони -- той самий прийом, що
// EntryHistoryList.tsx's "Історія записів" / AccountScreen.tsx's
// "Синхронізація"/"Небезпечна зона".
const ZONE_LABEL_CLASS = 'font-display text-sm font-bold uppercase tracking-wide text-ink-muted';

export function AnalyticsScreen({ loadAnalytics, onOpenArchive }: AnalyticsScreenProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<AnalyticsScreenState | null>(null);
  // Задача 18: "Звіт" -- заглушка. Клік перемикає видимість статичного
  // тексту "звіт за запитом" -- жодної реальної логіки поки що (Андрій
  // опише її пізніше).
  const [showReportStub, setShowReportStub] = useState(false);

  useEffect(() => {
    loadAnalytics().then((result) => {
      setState(result);
      setLoading(false);
    });
    // Навмисно без loadAnalytics у deps -- викликається рівно раз при
    // монтуванні (той самий підхід, що DeclarationScreen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || state === null) {
    return <Spinner />;
  }

  const { layoutMode, average, excludedCount, trendAvailable, cards } = state;
  const averageText = formatPercent(average);

  // D-120 (оновлено): "статистична картка" -- та сама поверхня (border-border/
  // bg-surface/shadow-soft), що CardShell, без блобів-підкладок (тут не
  // картка, що перевертається). Тренд (growing/shrinking) і unmaintained
  // (прапорець) навмисно НЕ пофарбовані у світлофор good/warn/bad -- ні одне
  // з них не є готовим 3-станним статусом на кшталт confirmed/pending/
  // rejected, а growing/shrinking у контексті плану життя не завжди
  // "добре"/"погано" (AC-06 -- жодного вердикту). Обидва лишаються
  // нейтральним ink-стилем (фірмового accent-кольору більше немає).
  //
  // Кореневий контейнер -- `relative h-full` (задача 17): висота береться
  // від предка (App.tsx-контентна зона grid-рядок minmax(0,1fr) в h-dvh --
  // та сама "означена висота" схема, що CardShell.tsx вже документує для
  // h-full), щоб "верхні 50% екрана" (h-1/2 нижче) рахувались від реальної
  // видимої висоти сторінки, а не від висоти вмісту. `relative` -- точка
  // відліку для плаваючих кнопок унизу (absolute, не fixed відносно
  // viewport -- кнопки плавають над ЦИМ екраном, а не над ChatPanel/шапкою).
  return (
    <div className="relative flex h-full min-h-0 flex-col gap-4">
      {/* Задача 17: верхні 50% висоти екрана -- дві рівні зони пліч-о-пліч
          (кожна ~половина ширини), без переходу в один стовпчик на вузькому
          екрані -- Андрій прямо просив "ділять між собою екран пополам". */}
      <div className="grid h-1/2 shrink-0 grid-cols-2 gap-3 sm:gap-4">
        {/* Зона 1 -- загальний опис стану (те, що раніше звалось "Середній
            прогрес"): та сама логіка/дані, лише нове місце. */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-card border border-border bg-surface p-4 shadow-soft backdrop-blur-xl sm:p-5">
          <h2 className={ZONE_LABEL_CLASS}>Загальний стан</h2>
          {averageText !== null && (
            <p className="text-sm font-medium text-ink-muted">
              Середній прогрес:{' '}
              <span className="font-display text-2xl font-bold text-ink">{averageText}</span>
            </p>
          )}
          <p className="text-xs text-ink-faint">{excludedCount} картки виключено з середнього (немає метрики)</p>
          {!trendAvailable && (
            <Banner variant="info" text="Тренд наразі недоступний -- не вдалося завантажити історію" />
          )}
        </div>

        {/* Зона 2 -- показники по картках: та сама назва/progress/rank-gap/
            trend/unmaintained, тепер у вужчій колонці з власним внутрішнім
            скролом (min-h-0 + overflow-y-auto), якщо карток багато. */}
        <div className="flex min-h-0 flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-soft backdrop-blur-xl sm:p-5">
          <h2 className={ZONE_LABEL_CLASS}>Показники по картках</h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {cards.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-ink-muted">Немає карток з обчислюваним прогресом</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {cards.map((card) => {
                  const progressText = formatPercent(card.progress);
                  const trendText = trendAvailable ? trendLabel(card.trend) : null;
                  return (
                    <li
                      key={card.cardId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-control border border-border bg-surface-solid px-4 py-3 shadow-soft"
                    >
                      <span className="font-medium text-ink">{card.cardTitle}</span>
                      {progressText !== null && (
                        <span className="font-display text-sm font-bold text-ink">{progressText}</span>
                      )}
                      {layoutMode === 'logic' && card.gap !== null && (
                        <span className="text-xs text-ink-muted"> ранг-розрив: {card.gap}</span>
                      )}
                      {trendText !== null && <span className="text-xs text-ink-muted"> {trendText}</span>}
                      {card.unmaintained && (
                        <span className="rounded-full bg-border px-2 py-0.5 text-xs font-medium text-ink">
                          заявлено важливим, не підтримується
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Задача 17: зона 3 -- звіти, БЕЗ рамки/картки-контейнера (просто
          продовження сторінки, на відміну від зон 1/2 вище), підіймається
          під дві верхні зони й займає решту висоти, зі своїм скролом
          (flex-1 + min-h-0 + overflow-y-auto -- той самий патерн, що зона 2
          вище). Хронологічна "стрічка" (крапка + лінія між записами) --
          навмисно НЕ реалізована як фейкові дані: сам формат запису "звіту"
          (що це, звідки дані) Андрій ще не описав. Тут -- чесний порожній
          стан, готовий приймати список, коли з'явиться джерело даних
          (окреме від ReportsScreen.tsx "Звіти активності", agent/ui). */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <h2 className={ZONE_LABEL_CLASS}>Звіти</h2>
        <div className="min-h-0 flex-1 overflow-y-auto pb-16">
          <p className="px-2 py-8 text-center text-sm text-ink-muted">Звітів поки немає</p>
        </div>
      </div>

      {/* Задача 16/18: "Архів" (D-124) і "Звіт" -- плаваючі, знизу зліва
          екрана Аналітики, звичайного розміру (поза flex-потоком через
          `absolute` -- на відміну від старого місця в кінці `flex flex-col`,
          де кнопка розтягувалась на всю ширину за замовчуванням align-items:
          stretch), над контентом (z-20) незалежно від того, скільки записів/
          карток знизу -- контент скролиться у своїх зонах вище, самі кнопки
          лишаються "приклеєні" в одному місці (absolute відносно кореневого
          relative-контейнера, який завжди дорівнює видимій висоті екрана
          Аналітики -- h-full вище), не зникають під скролом і не зсуваються
          нижче видимої області. */}
      <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
        <Button label="Архів" onClick={onOpenArchive} />
        <Button label="Звіт" onClick={() => setShowReportStub((prev) => !prev)} />
      </div>
      {showReportStub && (
        <div className="absolute bottom-16 left-4 z-20 max-w-xs">
          <Banner variant="info" text="звіт за запитом" />
        </div>
      )}
    </div>
  );
}
