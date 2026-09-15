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

import { useEffect, useRef, useState } from 'react';
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
  /**
   * Живе тестування (Андрій): "Звіти зникають при перемиканні" -- раніше
   * reportEntries жив у локальному useState цього компонента, тож
   * розмонтування при переході на інший напрямок (App.tsx умовно рендерить
   * AnalyticsScreen лише коли direction==='analytics') скидало список.
   * Контрольований пропс -- те саме, що App.tsx уже тримає для screen/
   * direction -- переживає перемикання екранів.
   */
  reportEntries: string[];
  /** Додає новий запис-заглушку в reportEntries (App.tsx тримає сам стан). */
  onAddReportEntry: () => void;
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

// Той самий поріг/колірний код, що MetricBlockCard.tsx's progressToneClasses
// (D-126) -- узгоджено, не вигадуємо другу мову кольору для того самого
// "% виконання" в іншому екрані. Тут -- заливка смуги-шкали, не бейдж.
function progressBarFillClass(share: number): string {
  if (share >= 0.7) return 'bg-good';
  if (share >= 0.3) return 'bg-warn';
  return 'bg-bad';
}

export function AnalyticsScreen({
  loadAnalytics,
  onOpenArchive,
  reportEntries,
  onAddReportEntry,
}: AnalyticsScreenProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<AnalyticsScreenState | null>(null);
  const reportsScrollRef = useRef<HTMLDivElement>(null);
  const previousReportCountRef = useRef(reportEntries.length);

  // Живе тестування (Андрій): нові записи додаються ЗВЕРХУ (найновіший
  // першим) -- побачивши новий запис, погляд має "скролитись угору", щоб
  // його знайти, а не шукати внизу довгого списку. Скролимо контейнер до
  // top=0 щоразу, коли довжина списку РЕАЛЬНО зросла (не при першому
  // монтуванні з уже наявними записами -- лише на фактичний новий клік).
  useEffect(() => {
    if (reportEntries.length > previousReportCountRef.current && reportsScrollRef.current) {
      reportsScrollRef.current.scrollTop = 0;
    }
    previousReportCountRef.current = reportEntries.length;
  }, [reportEntries.length]);

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
          <p className="text-xs italic text-ink-faint">{excludedCount} картки виключено з середнього (немає метрики)</p>
          {!trendAvailable && (
            <Banner variant="info" text="Тренд наразі недоступний -- не вдалося завантажити історію" />
          )}
        </div>

        {/* Зона 2 -- показники по картках: живе тестування (Андрій) -- два
            стовпчики (grid-cols-2), компактніше форматування (менший
            padding/шрифт, той самий підхід, що MetricBlockCard.tsx, D-120
            верстка-прохід), щоб влазило максимально без скролу. Під кожною
            карткою -- шкала прогресу на всю ширину рядка (текст+% разом --
            100%), заливка кольором за тим самим порогом, що
            progressToneClasses у MetricBlockCard.tsx (D-126): <30% червоний,
            30-70% жовтий, ≥70% зелений. */}
        <div className="flex min-h-0 flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-soft backdrop-blur-xl sm:p-5">
          <h2 className={ZONE_LABEL_CLASS}>Показники по картках</h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {cards.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm italic text-ink-muted">Немає карток з обчислюваним прогресом</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2">
                {cards.map((card) => {
                  const progressText = formatPercent(card.progress);
                  const trendText = trendAvailable ? trendLabel(card.trend) : null;
                  return (
                    <li
                      key={card.cardId}
                      className="flex flex-col gap-1 rounded-control border border-border bg-surface-solid px-2.5 py-2"
                    >
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="truncate text-sm font-medium text-ink">{card.cardTitle}</span>
                        {progressText !== null && (
                          <span className="shrink-0 font-display text-sm font-bold text-ink">{progressText}</span>
                        )}
                      </div>
                      {card.progress !== null && (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                          <div
                            className={`h-full rounded-full ${progressBarFillClass(card.progress)}`}
                            style={{ width: `${Math.round(card.progress * 100)}%` }}
                          />
                        </div>
                      )}
                      {(layoutMode === 'logic' && card.gap !== null) || trendText !== null || card.unmaintained ? (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {layoutMode === 'logic' && card.gap !== null && (
                            <span className="text-xs text-ink-muted">ранг-розрив: {card.gap}</span>
                          )}
                          {trendText !== null && <span className="text-xs text-ink-muted">{trendText}</span>}
                          {card.unmaintained && (
                            <span className="rounded-full bg-border px-1.5 py-0.5 text-xs font-medium text-ink">
                              заявлено важливим, не підтримується
                            </span>
                          )}
                        </div>
                      ) : null}
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
          реальний формат запису "звіту" (що це, звідки дані) Андрій ще не
          описав, тож поки що кожен запис -- та сама текст-заглушка,
          додана кліком по "Звіт" нижче (не фейкові дані, а справжній,
          хай і поки штучний, ввід користувача). Живе тестування: НАЙНОВІШИЙ
          запис -- ПЕРШИЙ у списку (зверху), лінія хронології йде вниз до
          старіших -- при появі нового запису погляд "скролиться вгору"
          (reportsScrollRef ефект вище), щоб новий запис одразу було видно
          без ручного скролу. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <h2 className={ZONE_LABEL_CLASS}>Звіти</h2>
        <div ref={reportsScrollRef} className="min-h-0 flex-1 overflow-y-auto pb-16">
          {reportEntries.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm italic text-ink-muted">Звітів поки немає</p>
          ) : (
            <ul className="flex flex-col">
              {reportEntries.map((text, index) => {
                const isLast = index === reportEntries.length - 1;
                return (
                  <li key={index} className={`relative flex gap-3 ${isLast ? '' : 'pb-5'}`}>
                    <div className="relative flex w-2.5 shrink-0 flex-col items-center">
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-good" />
                      {/* Лінія хронології -- "світло-зелена", від крапки цього
                          запису вниз до крапки наступного, старішого. Останній
                          (найстаріший видимий) запис лінії вниз не має. */}
                      {!isLast && <span className="absolute top-4 bottom-0 w-px bg-good/40" />}
                    </div>
                    <p className="pt-1 text-sm text-ink">{text}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Задача 16/18: "Архів" (D-124) і "Звіт" -- плаваючі, знизу СПРАВА
          екрана Аналітики (живе тестування -- Андрій уточнив: не зліва),
          звичайного розміру (поза flex-потоком через `absolute` -- на
          відміну від старого місця в кінці `flex flex-col`, де кнопка
          розтягувалась на всю ширину за замовчуванням align-items:
          stretch), над контентом (z-20) незалежно від того, скільки записів/
          карток знизу -- контент скролиться у своїх зонах вище, самі кнопки
          лишаються "приклеєні" в одному місці (absolute відносно кореневого
          relative-контейнера, який завжди дорівнює видимій висоті екрана
          Аналітики -- h-full вище), не зникають під скролом і не зсуваються
          нижче видимої області. */}
      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2">
        <Button label="Архів" onClick={onOpenArchive} />
        <Button label="Звіт" onClick={onAddReportEntry} />
      </div>
    </div>
  );
}
