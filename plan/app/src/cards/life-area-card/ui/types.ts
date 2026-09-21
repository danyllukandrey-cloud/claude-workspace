// В'ю-моделі SCR-02/SCR-03 (T26) -- форма даних, яку CardFace/CardBack
// очікують від ін'єктованих пропсів-функцій.
//
// ISS-45 (docs/ISSUES.md): реального HTTP-транспорту в репозиторії ще нема
// (framework-agnostic ports/*.ts, підключить майбутня T30). Тому ці типи НЕ
// повторюють CardRecord/MetricBlockRecord/EntryRecord з ../infra/postgres-repo.ts
// (ui не має права імпортувати ports/app/infra цієї ж картки, лише domain і
// shared/ui -- plan/app/CLAUDE.md, "Правило залежностей") -- це окрема,
// презентаційна форма тих самих фактів, яку зібере докупи майбутнє wiring (T30).
//
// Progress/EntryStatus реекспортуються з domain -- це вже узгоджені типи
// самої предметної області (ui -> domain дозволено), нема сенсу дублювати їх.
import type { Progress } from '../domain/progress';
import type { EntryStatus } from '../domain/entry';
import type { CardTrackingMode, CardHealthState } from '../domain/card';

export interface CardFaceData {
  name: string;
  description: string | null;
  /** AC-10: непорожнє лише коли агент справді запідозрив щось у даних картки. */
  dataWarning: string | null;
  /** CH-02/CH-10 (docs/features/life-area-card/changes.md): 'ongoing'/'goals' -- звичайна картка, 'state' -- "стан без вимірювань" (кольоровий м'ячик замість прогресу). */
  trackingMode: CardTrackingMode;
  /** CH-02: ненульове лише коли trackingMode === 'state' -- визначає колір м'ячика в правому верхньому кутку картки. */
  healthState: CardHealthState | null;
}

/** CH-03 (docs/features/life-area-card/changes.md): сирі налаштування блоку -- потрібні лише для попереднього заповнення форми редагування (MetricBlockForm), не для показу прогресу (той рахунок -- Progress вище). */
export interface MetricBlockSettings {
  targetCount: number | null;
  isOngoing: boolean;
  /** `<input type="date">` формат (YYYY-MM-DD) або null -- той самий формат, що MetricBlockFormValues.targetDate. */
  targetDate: string | null;
}

export interface MetricBlockViewModel {
  id: string;
  label: string;
  unit: string;
  progress: Progress;
  /** AC-06/AC-11: серед записів цього блоку є хоч один зі статусом 'pending'. */
  hasPendingEntry: boolean;
  /**
   * CH-03: сирі налаштування для попереднього заповнення форми редагування.
   * Опційне -- десятки наявних тестових fixtures (до CH-03) не несуть його;
   * MetricBlockCard.tsx/CardBack.tsx трактують відсутність як "олівець
   * редагування налаштувань недоступний, лише перейменування/перенесення".
   */
  settings?: MetricBlockSettings;
}

/** CH-03: одна картка-ціль у пікері "перенести на іншу картку". */
export interface MetricBlockTransferTargetCard {
  id: string;
  name: string;
}

export interface EntryViewModel {
  id: string;
  metricBlockId: string;
  amount: number;
  status: EntryStatus;
  /** Уже відформатована дата для показу (напр. "27.08") -- форматування дат не бізнес-логіка UI. */
  recordedAtLabel: string;
  /** Короткий підпис запису в історії, напр. "+1 тренування". */
  summary: string;
}

/**
 * Пропозиція перейменувати блок-метрику, перенесення якої зіткнулось із
 * наявним блоком (та сама назва+одиниця) на цій картці (AC-15).
 *
 * ux-flows.md US-13: рішення про сам перенос ухвалюється зовні (`structure`'s
 * SCR-04, закриття напрямку) -- ця картка лише отримує результат і, якщо
 * стався збіг, пропонує нову назву перед завершенням.
 */
export interface PendingTransferCollision {
  metricBlockId: string;
  label: string;
  unit: string;
}

export interface CardBackData {
  metricBlocks: MetricBlockViewModel[];
  /** AC-09 формула (D-105): null, якщо жодного bounded-блоку немає (декларативна картка чи лише ongoing-блоки). */
  aggregateProgress: number | null;
  /** Історія записів, найновіші перші (AC-13). */
  entries: EntryViewModel[];
  pendingTransferCollision?: PendingTransferCollision | null;
  /**
   * CH-02/CH-10: той самий режим, що CardFaceData -- звідси керується
   * "неактивність" налаштувань метрик нижче й видимість цілі/дати в формі
   * блоку. Опційне (на відміну від CardFaceData, де це поле обов'язкове) --
   * десятки наявних тестових fixtures цього файлу передували CH-02;
   * відсутнє поле трактується як 'goals' (CardBack.tsx), той самий дефолт,
   * що й у самій базі даних.
   */
  trackingMode?: CardTrackingMode;
  /** CH-02: ненульове лише коли trackingMode === 'state'. */
  healthState?: CardHealthState | null;
}
