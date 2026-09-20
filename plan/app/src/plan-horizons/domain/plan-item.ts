// Доменна логіка "ПЛАН" -- пункт плану (spec.md AC-01/AC-02/AC-03/AC-03b,
// data-model.md `plan_item`). Чисті функції, без I/O (plan/app/CLAUDE.md,
// "domain -> НІЧОГО"): мітка часу приходить ззовні параметром, домен не
// звертається ні до годинника, ні до бази.

/**
 * Три фіксовані горизонти (CONTEXT.md `plan-horizon`). Англійські значення
 * enum -- той самий підхід, що `layout_mode` у Структурі; переклад живе в ui/.
 */
export type PlanHorizon = 'tactical' | 'operational' | 'strategic';

export const PLAN_HORIZONS: readonly PlanHorizon[] = ['tactical', 'operational', 'strategic'];

/** Рантайм-перевірка значення з межі системи (HTTP body) -- тип сам по собі рантайм не гарантує. */
export function isPlanHorizon(value: unknown): value is PlanHorizon {
  return typeof value === 'string' && (PLAN_HORIZONS as readonly string[]).includes(value);
}

/** М'яке видалення (AC-04): 'removed'-пункти не показуються, але ніколи не зникають фізично. */
export type PlanItemStatus = 'active' | 'removed';

export interface PlanItem {
  id: string;
  ownerUserId: string;
  horizon: PlanHorizon;
  planText: string;
  done: boolean;
  status: PlanItemStatus;
  /** ISO 8601 -- це і є "дата додавання", яку показує сторінка ПЛАН (AC-01/AC-08). */
  createdAt: string;
  updatedAt: string;
}

export class PlanItemValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlanItemValidationError';
    this.code = code;
  }
}

/**
 * AC-02: текст обовʼязковий САМЕ при створенні нового пункту. До редагування
 * наявного пункту це правило не застосовується -- очищення тексту там є
 * жестом видалення (AC-04), а не помилкою.
 */
export function assertPlanTextPresent(value: string | null | undefined): void {
  if (value == null || !value.trim()) {
    throw new PlanItemValidationError('plan_item.text_required', 'Пункт плану не може бути без тексту');
  }
}

function assertHorizon(value: unknown): asserts value is PlanHorizon {
  if (!isPlanHorizon(value)) {
    throw new PlanItemValidationError('plan_item.horizon_invalid', 'Горизонт пункту плану має бути один із трьох');
  }
}

export interface CreatePlanItemInput {
  id: string;
  ownerUserId: string;
  horizon: PlanHorizon;
  planText: string;
  /** ISO 8601, підставляє викликач (use-case) -- домен не має власного годинника. */
  createdAt: string;
}

export function createPlanItem(input: CreatePlanItemInput): PlanItem {
  assertHorizon(input.horizon);
  assertPlanTextPresent(input.planText);

  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    horizon: input.horizon,
    planText: input.planText.trim(),
    done: false,
    status: 'active',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

/**
 * AC-03/AC-03b: чекбокс "виконано" -- реверсивний тумблер, а не односторонній
 * перехід (на відміну від картки, що доходить до "заповнена"). Пункт лишається
 * у своєму горизонті: позначення виконаним ніколи не прибирає його з виду.
 */
export function setDone(item: PlanItem, done: boolean, updatedAt: string): PlanItem {
  return { ...item, done, updatedAt };
}

export function toggleDone(item: PlanItem, updatedAt: string): PlanItem {
  return setDone(item, !item.done, updatedAt);
}
