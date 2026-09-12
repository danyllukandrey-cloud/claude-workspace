// T43 -- Ports: DELETE /account handler.
// contracts/openapi.yaml `/api/v1/account` (operationId deleteAccount),
// spec.md AC-17/AC-17b, US-11.
//
// Framework-agnostic (той самий підхід, що ../../cards/life-area-card/ports/
// card-handlers.ts і ../../structure/ports/layout-handlers.ts) -- звичайна
// async-функція (db, userId, ...) -> Promise<...>. Успішний виклик тут не
// повертає жодного значення (`undefined`) -- контракт визначає 204 без тіла
// відповіді для цього ендпоінта; майбутній транспортний шар (T30) сам
// відповідає за встановлення статус-коду 204 на порожньому успіху.
//
// AppError НЕ перехоплюється тут (той самий підхід, що card-handlers.ts/
// rules-handler.ts) -- пропускається нагору як є. 401 у контракті -- турбота
// авторизаційного мідлвара (D-33), не цього файлу.
//
// DoD "Handler returns 204/401 exactly per contract": цей файл сам не
// генерує жодного статус-коду -- 204 це "успіх без значення", 401 ніколи не
// походить із цього шару (auth middleware стоїть перед ним). Порт лише
// прокидає виклик у use-case (T39, deleteAccount) і дає AppError пройти
// нагору без обгортання.
//
// AC-17b (confirmation guard) -- ВІДКРИТА НЕОДНОЗНАЧНІСТЬ КОНТРАКТУ:
// openapi.yaml для DELETE /api/v1/account не описує жодного тіла запиту, а
// в описі прямо сказано, що підтвердження (слово підтвердження) перевіряється
// на UI-рівні ДО цього виклику -- "сам ендпоінт передбачає, що рішення вже
// прийняте". Але app-шар (../app/delete-account.ts, T39) усе одно вимагає
// явний `confirmed: boolean` як defense-in-depth (сам файл і його DoD це
// документують). Контракт не називає, ЗВІДКИ транспортний шар (T30) візьме
// це значення (query-параметр? заголовок? нове поле тіла, яке ще не додане
// в контракт?). Консервативне рішення тут -- НЕ вирішувати це мовчки
// (наприклад, жорстко зашивши `confirmed: true`, що зробило б захист AC-17b
// назавжди недосяжним через цей ендпоінт): порт приймає `confirmed` як
// явний параметр і прокидає його в use-case як є, той самий підхід, що
// createRule/updateCard (card-handlers.ts/rules-handler.ts) прокидають поля
// тіла без власних припущень. Людині варто звірити це з T30/сумісним
// оновленням контракту, перш ніж підключати реальний транспорт.

import { deleteAccount as deleteAccountUseCase } from '../app/delete-account';
import type { Db } from '../infra/postgres-repo';

// --- deleteAccount -- DELETE /api/v1/account -------------------------------

export async function deleteAccount(db: Db, userId: string, confirmed: boolean): Promise<void> {
  await deleteAccountUseCase(db, { userId, confirmed });
}
