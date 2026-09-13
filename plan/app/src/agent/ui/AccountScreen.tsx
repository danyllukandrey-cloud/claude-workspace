// SCR-04 -- Обліковий запис і дані (screens.md), spec.md AC-17/AC-17b/
// AC-18/AC-18b (T45). 5 станів з screens.md SCR-04: default / add-resource /
// sync-error / confirm-delete / deleted.
//
// DI (plan/app/CLAUDE.md, той самий стиль, що RuleSettingsScreen/
// DeclarationScreen/CloseCardDialog): loadResources/onAddResource/
// onRemoveResource/onDeleteAccount/onDeleted -- ін'єктовані пропи-функції,
// жодного fetch() тут. Реальний HTTP-транспорт -- ports/sync-resource-
// handler.ts (T44) + ports/account-handler.ts (T43), обидва вже реалізовані,
// підключає майбутній викликач (T29 wiring).
//
// ResourceList (screens.md: "NEW, інша природа ніж CardPicker") рендериться
// інлайн як звичайний <ul> -- той самий мінімалізм, що RuleCategoryMenu/
// CardPicker в RuleSettingsScreen.tsx: files_hint T45 називає лише цей один
// файл, окремого компонента-ResourceList ще нема в репозиторії.
//
// sync-error (AC-18b) -- НЕ окремий екран/маршрут, а Banner, що з'являється
// в default-режимі, коли хоч один завантажений ресурс має status: 'error'
// (sync-resources.ts SyncResourceStatusRow). screens.md перелічує його як
// окремий рядок таблиці станів, але wireframe для sync-error не намальований
// окремо -- він показаний "поверх" того самого списку default, того самого
// підходу, що RuleSettingsScreen показує conflict-Banner поверх свого
// default-вигляду, не як окремий екран.
//
// confirm-delete (AC-17b) -- явна додаткова дія: слово підтвердження
// "ВИДАЛИТИ" (буквально з wireframe screens.md SCR-04) має збігатися ТОЧНО
// (регістр і весь рядок), інакше кнопка "Видалити" лишається disabled --
// звичайний click тут нічого не важить сам по собі, друга кнопка --
// insufficient guard.
//
// onDeleteAccount отримує явний `confirmed: boolean` -- дзеркалить
// відкриту неоднозначність контракту, задокументовану в
// ports/account-handler.ts (T43): openapi.yaml не називає, звідки
// транспортний шар (T30) візьме підтвердження, а app-шар (T39) все одно
// вимагає `confirmed` як defense-in-depth. Цей екран -- сам UI-рівневий
// ґейт (AC-17b): викликає onDeleteAccount лише з `true`, і лише коли
// введене слово збігається точно -- але передає прапорець явно, а не ховає
// його за викликом без параметрів, щоб defense-in-depth лишався видимим
// наскрізь, а не мовчки застиг на `true` десь усередині.
//
// deleted (AC-17) -- "сесія завершена, повернення на екран входу": сам факт
// навігації -- відповідальність викликача (onDeleted callback, той самий
// підхід, що інші екрани делегують навігацію нагору), цей компонент лише
// показує підтвердження й викликає onDeleted рівно один раз.

import { useEffect, useState } from 'react';
import { Banner, Button, EmptyState, Spinner, TextField } from '../../shared/ui';

const DELETE_CONFIRMATION_WORD = 'ВИДАЛИТИ';
const ADD_RESOURCE_FAILURE_MESSAGE = 'Не вдалося додати ресурс';
const DELETE_ACCOUNT_FAILURE_MESSAGE = 'Не вдалося видалити акаунт';
const LOAD_RESOURCES_FAILURE_MESSAGE = 'Не вдалося завантажити ресурси синхронізації';
const REMOVE_RESOURCE_FAILURE_MESSAGE = 'Не вдалося прибрати ресурс';

export interface AccountScreenResource {
  id: string;
  url: string;
  status: 'active' | 'error';
  lastError: string | null;
}

export interface AccountScreenProps {
  /** Завантажує список ресурсів синхронізації користувача (AC-18). */
  loadResources: () => Promise<AccountScreenResource[]>;
  /** Додає новий ресурс. Кидає AppError-подібну помилку (422 sync_resource.url_invalid) при невалідному посиланні. */
  onAddResource: (url: string) => Promise<AccountScreenResource>;
  /** Прибирає ресурс синхронізації зі списку. */
  onRemoveResource: (resourceId: string) => Promise<void>;
  /** Видаляє акаунт і всі дані назавжди (AC-17). `confirmed` -- завжди `true` тут, UI-ґейт AC-17b уже пройдено. */
  onDeleteAccount: (confirmed: boolean) => Promise<void>;
  /** Викликається рівно один раз після успішного видалення -- навігація на екран входу належить викликачу. */
  onDeleted: () => void;
}

interface AppErrorShape {
  message: string;
  code: unknown;
}

// Duck-typing замість `instanceof AppError` -- той самий підхід, що
// RuleSettingsScreen.tsx/LayoutBoard.tsx/DeclarationScreen.tsx/CloseCardDialog.tsx.
function isAppErrorShape(error: unknown): error is AppErrorShape {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

type Mode = 'default' | 'add-resource' | 'confirm-delete' | 'deleted';

export function AccountScreen({
  loadResources,
  onAddResource,
  onRemoveResource,
  onDeleteAccount,
  onDeleted,
}: AccountScreenProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resources, setResources] = useState<AccountScreenResource[]>([]);
  const [mode, setMode] = useState<Mode>('default');
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [newResourceUrl, setNewResourceUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [confirmationInput, setConfirmationInput] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    loadResources()
      .then((loaded) => {
        if (cancelled) return;
        setResources(loaded);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = isAppErrorShape(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : LOAD_RESOURCES_FAILURE_MESSAGE;
        setLoadError(message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Навмисно без loadResources у deps -- ін'єктована функція лишається
    // стабільною для життя екрана (той самий підхід, що RuleSettingsScreen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <Spinner />;
  }

  // Той самий підхід, що ReportsScreen.tsx: провал початкового завантаження
  // -- окрема error-гілка (Banner variant="error"), а не вічний Spinner чи
  // мовчазний порожній список (без цього промайс, що відхилився, лишав
  // loading=true назавжди -- unhandled rejection + вічний спінер).
  if (loadError !== null) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <h1 className="font-display text-xl font-bold text-ink">Обліковий запис і дані</h1>
        <Banner variant="error" text={loadError} />
      </div>
    );
  }

  if (mode === 'deleted') {
    return (
      <div className="flex flex-col gap-2 p-4">
        <h1 className="font-display text-xl font-bold text-ink">Обліковий запис і дані</h1>
        <p className="text-sm text-ink-muted">Акаунт видалено. Усі дані видалено назавжди.</p>
      </div>
    );
  }

  const errorResources = resources.filter((resource) => resource.status === 'error' && resource.lastError !== null);

  const handleStartAddResource = (): void => {
    setNewResourceUrl('');
    setAddError(null);
    setMode('add-resource');
  };

  const handleCancelAddResource = (): void => {
    setNewResourceUrl('');
    setAddError(null);
    setMode('default');
  };

  const handleSubmitAddResource = (): void => {
    if (adding) return;

    setAddError(null);
    setAdding(true);

    onAddResource(newResourceUrl)
      .then((added) => {
        setResources((prev) => [...prev, added]);
        setNewResourceUrl('');
        setMode('default');
      })
      .catch((error: unknown) => {
        const message = isAppErrorShape(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : ADD_RESOURCE_FAILURE_MESSAGE;
        setAddError(message);
      })
      .finally(() => setAdding(false));
  };

  const handleRemoveResource = (resourceId: string): void => {
    setRemoveError(null);
    onRemoveResource(resourceId)
      .then(() => {
        setResources((prev) => prev.filter((resource) => resource.id !== resourceId));
      })
      .catch((error: unknown) => {
        const message = isAppErrorShape(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : REMOVE_RESOURCE_FAILURE_MESSAGE;
        setRemoveError(message);
      });
  };

  const handleStartDeleteAccount = (): void => {
    setConfirmationInput('');
    setDeleteError(null);
    setMode('confirm-delete');
  };

  const handleCancelDeleteAccount = (): void => {
    setConfirmationInput('');
    setDeleteError(null);
    setMode('default');
  };

  const handleConfirmDeleteAccount = (): void => {
    if (deleting || confirmationInput !== DELETE_CONFIRMATION_WORD) return;

    setDeleteError(null);
    setDeleting(true);

    onDeleteAccount(true)
      .then(() => {
        setMode('deleted');
        onDeleted();
      })
      .catch((error: unknown) => {
        const message = isAppErrorShape(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : DELETE_ACCOUNT_FAILURE_MESSAGE;
        setDeleteError(message);
      })
      .finally(() => setDeleting(false));
  };

  if (mode === 'confirm-delete') {
    const canDelete = confirmationInput === DELETE_CONFIRMATION_WORD;
    return (
      <div className="flex flex-col gap-5 p-4">
        <h1 className="font-display text-xl font-bold text-ink">Видалити акаунт і всі дані</h1>
        <p className="text-sm text-ink-muted">
          Це незворотно. Усі картки, записи, декларація й пам'ять агента будуть видалені назавжди.
        </p>

        <TextField
          label={`Слово підтвердження -- введи "${DELETE_CONFIRMATION_WORD}", щоб підтвердити`}
          value={confirmationInput}
          onChange={setConfirmationInput}
        />

        {/* D-120: справжня незворотна дія -- матовий суцільний bad (той самий
            стиль, що ConfirmDialog.tsx), не .chip-gloss (глянець лишається
            лише за світлофором статусу виміру). "Скасувати" -- нейтральна
            другорядна дія (border-border/text-ink), той самий підхід, що
            кнопка "Скасувати" в ConfirmDialog.tsx -- Button-примітив свідомо
            має лише один (фірмовий) варіант, поділ на головну/другорядну дію
            навмисно лишено кроку стилізації екрана (коментар у Button.tsx). */}
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={handleCancelDeleteAccount}
            className="rounded-control border border-border px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-border"
          >
            Скасувати
          </button>
          <button
            type="button"
            onClick={handleConfirmDeleteAccount}
            disabled={!canDelete || deleting}
            className="rounded-control bg-bad px-4 py-3 text-sm font-bold text-accent-ink shadow-btn transition-opacity enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            Видалити
          </button>
        </div>

        {deleteError !== null && <Banner variant="error" text={deleteError} />}
      </div>
    );
  }

  if (mode === 'add-resource') {
    return (
      <div className="flex flex-col gap-5 p-4">
        <h1 className="font-display text-xl font-bold text-ink">Обліковий запис і дані</h1>

        <TextField
          label="Посилання на зовнішній ресурс"
          value={newResourceUrl}
          onChange={setNewResourceUrl}
          placeholder="https://docs.google.com/document/d/..."
          error={addError ?? undefined}
        />

        <div className="flex flex-wrap gap-3">
          <Button label="Додати" onClick={handleSubmitAddResource} disabled={adding} />
          <button
            type="button"
            onClick={handleCancelAddResource}
            className="rounded-control border border-border px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-border"
          >
            Скасувати
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <h1 className="font-display text-xl font-bold text-ink">Обліковий запис і дані</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">Синхронізація</h2>

        {resources.length === 0 ? (
          <EmptyState
            message="Ще жодного ресурсу синхронізації не додано"
            actionHint='Додай посилання на зовнішній ресурс кнопкою "Додати ресурс"'
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {resources.map((resource) => (
              <li
                key={resource.id}
                className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface-solid px-3.5 py-2.5 text-sm text-ink"
              >
                <span className="min-w-0 flex-1 truncate">{resource.url}</span>
                <button
                  type="button"
                  aria-label={`Прибрати ${resource.url}`}
                  onClick={() => handleRemoveResource(resource.id)}
                  className="shrink-0 text-ink-faint transition-colors hover:text-bad"
                >
                  x
                </button>
              </li>
            ))}
          </ul>
        )}

        {errorResources.map((resource) => (
          <Banner key={resource.id} variant="error" text={resource.lastError as string} />
        ))}

        {removeError !== null && <Banner variant="error" text={removeError} />}

        <Button label="Додати ресурс" onClick={handleStartAddResource} />
      </section>

      <hr className="border-t border-border" />

      {/* D-120: "Небезпечна зона" -- заголовок лишається нейтральним (той самий
          стиль, що "Синхронізація" вище), сигнал небезпеки несе САМА кнопка --
          контурний bad (border-bad/text-bad), не суцільна заливка: це вхід у
          підтвердження (mode="confirm-delete"), не сама незворотна дія --
          та вже отримує суцільний bg-bad нижче, той самий підхід, що
          ConfirmDialog.tsx. Button-примітив лишається єдиним фірмовим
          варіантом (коментар у Button.tsx) -- тут навмисно raw <button>. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">Небезпечна зона</h2>
        <button
          type="button"
          onClick={handleStartDeleteAccount}
          className="self-start rounded-control border border-bad px-4 py-3 text-sm font-bold text-bad transition-colors hover:bg-bad/10"
        >
          Видалити акаунт і всі дані
        </button>
      </section>
    </div>
  );
}
