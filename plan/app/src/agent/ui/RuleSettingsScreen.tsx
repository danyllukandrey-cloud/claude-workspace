// SCR-02 -- Налаштування правил (screens.md), spec.md AC-07/AC-08/AC-12/AC-14
// (T27). 7 стани з screens.md SCR-02: default / card-scope / empty /
// loading / saved / conflict / validation.
//
// DI (plan/app/CLAUDE.md, той самий стиль, що DeclarationScreen/
// CloseCardDialog): loadRules/onSave -- ін'єктовані пропи-функції, жодного
// fetch() тут. Реальний HTTP-транспорт -- ports/rules-handler.ts (T22,
// вже реалізований: GET/POST /api/v1/rules), підключає майбутній викликач
// (T29 wiring).
//
// CardPicker (screens.md: "той самий компонент, що вже запропонував
// structure/screens.md... reused") рендериться інлайн як звичайний
// <select aria-label="Картка"> -- той самий підхід, що інлайн-<select>
// у CloseCardDialog.tsx: жодного окремого файлу компонента-CardPicker ще
// нема в репозиторії (files_hint T27 називає лише цей файл).
//
// RuleCategoryMenu (screens.md: "нове, специфічне для 6 фіксованих
// категорій D-27") -- так само інлайн у цьому файлі: files_hint T27 -- один
// файл, окремого компонента для меню не заведено (той самий підхід
// мінімалізму, що CloseCardDialog не виносить власного Toggle-примітиву).
//
// Категорія-меню -- ADDITIVE, не редагована: бекенд (T22 rules-handler.ts)
// має лише GET/POST /rules, жодного DELETE/PATCH -- тому категорія, що вже
// активна (прийшла з loadRules), рендериться позначеною й `disabled`
// (не можна її "зняти" чи повторно надіслати -- це призвело б до 409
// agent.rule_conflict з тим самим правилом). Лише НОВІ обрані категорії
// потрапляють у selectedCategories і надсилаються при "Зберегти".
//
// POST /rules (rules-handler.ts) приймає РІВНО одну category і/або один
// ruleText за виклик -- тому мультивибір (AC-08 "одну чи кілька категорій")
// надсилається як один onSave-виклик на кожну НОВУ обрану категорію, плюс
// ще один виклик, якщо заповнено власний текст.
//
// conflict (409 agent.rule_conflict, AC-14) -> Banner variant="error".
// validation (422 agent.rule_empty -- ні категорії, ні тексту) -> inline-
// помилка під формою, client-side guard ПЕРЕД викликом onSave (та сама
// умова, що бекенд перевіряє повторно -- без зайвого round-trip для
// перевірки, яку може зробити сам клієнт; той самий підхід, що
// CloseCardDialog.tsx "validation" стан). Якщо onSave усе ж відхиляється з
// agent.rule_empty (захисний випадок), той самий inline-шлях обробляє і це.

import { useEffect, useState } from 'react';
import { Banner, Button, EmptyState, Spinner, TextField } from '../../shared/ui';
import type { BannerVariant } from '../../shared/ui';
import type { ImperativeRuleCategory } from '../domain/rules';

interface CategoryOption {
  value: ImperativeRuleCategory;
  label: string;
}

// 6 категорій D-27, остаточний склад v1 (spec.md AC-08, той самий порядок,
// що wireframe screens.md SCR-02).
const CATEGORY_OPTIONS: CategoryOption[] = [
  { value: 'data', label: 'Дані' },
  { value: 'correction', label: 'Корекція' },
  { value: 'survey', label: 'Опитування' },
  { value: 'context_clarification', label: 'Уточнення контексту' },
  { value: 'owner_impact', label: 'Вплив на власника' },
  { value: 'reminder', label: 'Нагадування' },
];

const VALIDATION_MESSAGE = 'Оберіть хоча б одну категорію або впишіть власне правило';
const SAVE_FAILURE_MESSAGE = 'Не вдалося зберегти правило';
const LOAD_RULES_FAILURE_MESSAGE = 'Не вдалося завантажити правила';

export interface RuleSettingsScreenRule {
  id: string;
  scopeCardId: string | null;
  category: ImperativeRuleCategory | null;
  ruleText: string | null;
}

export interface RuleSettingsScreenTargetCard {
  cardId: string;
  cardTitle: string;
}

export interface RuleSettingsScreenSaveInput {
  scopeCardId: string | null;
  category: ImperativeRuleCategory | null;
  ruleText: string | null;
}

export interface RuleSettingsScreenProps {
  /** Картки, доступні для перевизначення (AC-12) -- CardPicker (structure/screens.md, reused). */
  targetCards: RuleSettingsScreenTargetCard[];
  /** Завантажує активні правила для області (null = глобальні, AC-08 "відкрив налаштування правил"). */
  loadRules: (scopeCardId: string | null) => Promise<RuleSettingsScreenRule[]>;
  /**
   * Зберігає ОДНЕ правило (category і/або ruleText -- data-model.md CHECK,
   * OR не XOR). Кидає AppError-подібну помилку (code/httpStatus) при
   * 409 agent.rule_conflict / 422 agent.rule_empty.
   */
  onSave: (input: RuleSettingsScreenSaveInput) => Promise<RuleSettingsScreenRule>;
}

interface AppErrorShape {
  message: string;
  code: unknown;
}

// Duck-typing замість `instanceof AppError` -- той самий підхід, що
// LayoutBoard.tsx/DeclarationScreen.tsx/CloseCardDialog.tsx.
function isAppErrorShape(error: unknown): error is AppErrorShape {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

interface BannerState {
  variant: BannerVariant;
  text: string;
}

export function RuleSettingsScreen({ targetCards, loadRules, onSave }: RuleSettingsScreenProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCardScope, setIsCardScope] = useState(false);
  const [scopeCardId, setScopeCardId] = useState<string | null>(null);
  const [rules, setRules] = useState<RuleSettingsScreenRule[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<ImperativeRuleCategory>>(new Set());
  const [ruleText, setRuleText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    loadRules(scopeCardId)
      .then((loaded) => {
        if (cancelled) return;
        setRules(loaded);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = isAppErrorShape(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : LOAD_RULES_FAILURE_MESSAGE;
        setLoadError(message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Навмисно без loadRules у deps -- ін'єктована функція лишається
    // стабільною для життя екрана (той самий підхід, що DeclarationScreen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeCardId]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-md justify-center px-4 py-10">
        <Spinner />
      </div>
    );
  }

  // Той самий підхід, що ReportsScreen.tsx: провал початкового завантаження
  // -- окрема error-гілка (Banner variant="error"), а не вічний Spinner
  // (без .catch промайс, що відхилився, лишав loading=true назавжди).
  if (loadError !== null) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
        <h1 className="font-display text-xl font-bold text-ink">
          {isCardScope ? 'Налаштування правил — для картки' : 'Налаштування правил'}
        </h1>
        <Banner variant="error" text={loadError} />
      </div>
    );
  }

  const existingCategories = new Set(
    rules.map((rule) => rule.category).filter((category): category is ImperativeRuleCategory => category !== null),
  );

  const resetFormState = (): void => {
    setSelectedCategories(new Set());
    setRuleText('');
    setValidationError(null);
    setBanner(null);
  };

  const handleToggleCardScope = (): void => {
    if (isCardScope) {
      setIsCardScope(false);
      setScopeCardId(null);
    } else {
      setIsCardScope(true);
      setScopeCardId(targetCards[0]?.cardId ?? null);
    }
    resetFormState();
  };

  const handleCardChange = (nextCardId: string): void => {
    setScopeCardId(nextCardId);
    resetFormState();
  };

  const toggleCategory = (category: ImperativeRuleCategory): void => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleSave = (): void => {
    if (saving) return;

    const trimmedText = ruleText.trim();
    const categoriesToSave = Array.from(selectedCategories);
    const hasText = trimmedText !== '';

    if (categoriesToSave.length === 0 && !hasText) {
      setValidationError(VALIDATION_MESSAGE);
      return;
    }

    setValidationError(null);
    setBanner(null);
    setSaving(true);

    // Кожен елемент -- один onSave-виклик; entries лишається паралельним
    // масивом до tasks, щоб після Promise.allSettled знати, ЯКА категорія
    // (чи вільний текст) стоїть за кожним результатом за індексом.
    type SaveEntry = { kind: 'category'; category: ImperativeRuleCategory } | { kind: 'text' };
    const entries: SaveEntry[] = categoriesToSave.map((category) => ({ kind: 'category', category }));
    if (hasText) {
      entries.push({ kind: 'text' });
    }

    const tasks = entries.map((entry) =>
      entry.kind === 'category'
        ? onSave({ scopeCardId, category: entry.category, ruleText: null })
        : onSave({ scopeCardId, category: null, ruleText: trimmedText }),
    );

    // Promise.allSettled, НЕ Promise.all: один відхилений виклик (напр. 409
    // agent.rule_conflict на одній категорії) не повинен ховати успіх решти
    // -- інакше збережені категорії зникають з екрана до перезавантаження, а
    // ще позначені чекбокси запрошують на повторну відправку вже збереженого.
    Promise.allSettled(tasks).then((results) => {
      const savedRules: RuleSettingsScreenRule[] = [];
      const succeededCategories = new Set<ImperativeRuleCategory>();
      let succeededText = false;
      const errorMessages: string[] = [];
      let ruleEmptyMessage: string | null = null;

      results.forEach((result, index) => {
        const entry = entries[index];
        if (result.status === 'fulfilled') {
          savedRules.push(result.value);
          if (entry.kind === 'category') {
            succeededCategories.add(entry.category);
          } else {
            succeededText = true;
          }
          return;
        }

        const error: unknown = result.reason;
        if (isAppErrorShape(error) && error.code === 'agent.rule_empty') {
          ruleEmptyMessage = error.message;
          return;
        }
        const message = isAppErrorShape(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : SAVE_FAILURE_MESSAGE;
        errorMessages.push(message);
      });

      if (savedRules.length > 0) {
        setRules((prev) => [...prev, ...savedRules]);
      }

      // Тільки успішні категорії зникають з чекбокс-стану -- відхилені
      // лишаються позначеними, щоб користувач бачив, що саме не збереглось,
      // а не втратив свій вибір разом з тим, що дійсно пройшло.
      setSelectedCategories((prev) => {
        const next = new Set(prev);
        succeededCategories.forEach((category) => next.delete(category));
        return next;
      });
      if (succeededText) {
        setRuleText('');
      }

      if (ruleEmptyMessage !== null) {
        setValidationError(ruleEmptyMessage);
      }

      if (errorMessages.length > 0) {
        setBanner({ variant: 'error', text: errorMessages.join('; ') });
      } else if (savedRules.length > 0) {
        setBanner({ variant: 'success', text: 'Збережено' });
      }
    }).finally(() => setSaving(false));
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6">
      <h1 className="font-display text-xl font-bold text-ink">
        {isCardScope ? 'Налаштування правил — для картки' : 'Налаштування правил'}
      </h1>

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={isCardScope}
            onChange={handleToggleCardScope}
            className="h-4 w-4 accent-ink"
          />
          Перевизначити для конкретної картки
        </label>

        {isCardScope && (
          <select
            aria-label="Картка"
            value={scopeCardId ?? ''}
            onChange={(event) => handleCardChange(event.target.value)}
            className="rounded-control border border-border bg-surface-solid px-3.5 py-2.5 text-sm font-medium text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
          >
            {targetCards.map((card) => (
              <option key={card.cardId} value={card.cardId}>
                {card.cardTitle}
              </option>
            ))}
          </select>
        )}
      </div>

      {rules.length === 0 && (
        <EmptyState
          message="Ще жодного правила не задано"
          actionHint="Обери категорію з меню нижче або впиши власне правило"
        />
      )}

      <fieldset className="flex flex-col gap-2.5 rounded-card border border-border bg-surface p-4 shadow-soft backdrop-blur-xl">
        <legend className="px-1 text-sm font-bold text-ink">Готові категорії</legend>
        {CATEGORY_OPTIONS.map((option) => {
          const isActive = existingCategories.has(option.value);
          return (
            <label
              key={option.value}
              className={`flex items-center gap-2 text-sm ${isActive ? 'text-ink-muted' : 'text-ink'}`}
            >
              <input
                type="checkbox"
                checked={isActive || selectedCategories.has(option.value)}
                disabled={isActive}
                onChange={() => toggleCategory(option.value)}
                className="h-4 w-4 accent-ink disabled:cursor-not-allowed"
              />
              {option.label}
            </label>
          );
        })}
      </fieldset>

      <TextField
        label="Або власне правило"
        value={ruleText}
        onChange={setRuleText}
        placeholder='наприклад "не радь, якщо я не питаю"'
        error={validationError ?? undefined}
      />

      <Button label="Зберегти" onClick={handleSave} disabled={saving} />

      {isCardScope && (
        <p className="text-xs text-ink-muted">Діє лише на цій картці, глобальне лишається чинним для решти</p>
      )}

      {banner !== null && <Banner variant={banner.variant} text={banner.text} />}
    </div>
  );
}
