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
  const [resources, setResources] = useState<AccountScreenResource[]>([]);
  const [mode, setMode] = useState<Mode>('default');

  const [newResourceUrl, setNewResourceUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [confirmationInput, setConfirmationInput] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    loadResources().then((loaded) => {
      if (cancelled) return;
      setResources(loaded);
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

  if (mode === 'deleted') {
    return (
      <div>
        <h1>Обліковий запис і дані</h1>
        <p>Акаунт видалено. Усі дані видалено назавжди.</p>
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
    onRemoveResource(resourceId).then(() => {
      setResources((prev) => prev.filter((resource) => resource.id !== resourceId));
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
      <div>
        <h1>Видалити акаунт і всі дані</h1>
        <p>
          Це незворотно. Усі картки, записи, декларація й пам'ять агента будуть видалені назавжди.
        </p>

        <TextField
          label={`Слово підтвердження -- введи "${DELETE_CONFIRMATION_WORD}", щоб підтвердити`}
          value={confirmationInput}
          onChange={setConfirmationInput}
        />

        <Button label="Скасувати" onClick={handleCancelDeleteAccount} />
        <Button label="Видалити" onClick={handleConfirmDeleteAccount} disabled={!canDelete || deleting} />

        {deleteError !== null && <Banner variant="error" text={deleteError} />}
      </div>
    );
  }

  if (mode === 'add-resource') {
    return (
      <div>
        <h1>Обліковий запис і дані</h1>

        <TextField
          label="Посилання на зовнішній ресурс"
          value={newResourceUrl}
          onChange={setNewResourceUrl}
          placeholder="https://docs.google.com/document/d/..."
          error={addError ?? undefined}
        />

        <Button label="Додати" onClick={handleSubmitAddResource} disabled={adding} />
        <Button label="Скасувати" onClick={handleCancelAddResource} />
      </div>
    );
  }

  return (
    <div>
      <h1>Обліковий запис і дані</h1>

      <h2>Синхронізація</h2>

      {resources.length === 0 ? (
        <EmptyState
          message="Ще жодного ресурсу синхронізації не додано"
          actionHint='Додай посилання на зовнішній ресурс кнопкою "Додати ресурс"'
        />
      ) : (
        <ul>
          {resources.map((resource) => (
            <li key={resource.id}>
              {resource.url}
              <button type="button" aria-label={`Прибрати ${resource.url}`} onClick={() => handleRemoveResource(resource.id)}>
                x
              </button>
            </li>
          ))}
        </ul>
      )}

      {errorResources.map((resource) => (
        <Banner key={resource.id} variant="error" text={resource.lastError as string} />
      ))}

      <Button label="Додати ресурс" onClick={handleStartAddResource} />

      <hr />
      <h2>Небезпечна зона</h2>
      <Button label="Видалити акаунт і всі дані" onClick={handleStartDeleteAccount} />
    </div>
  );
}
