// Реалізація порту сховища через localStorage браузера (T45, review 2026-09-07
// B8/C13 -- QG-1 "офлайн-читання 100%" був недосяжний, бо цей файл лишався
// заглушкою: local-cache.ts (T11) написаний і протестований, але жодна
// реальна реалізація StoragePort ніколи не існувала, тож main.tsx не мав чим
// його підставити.
//
// Правило залежностей (ADR-0004): цей файл імпортує port.ts (реалізує його
// інтерфейс). Ніхто, крім app/main.tsx, не має права імпортувати цей файл
// напряму -- інакше картка прив'яжеться до localStorage і бекенд буде не
// підключити.
//
// Тиха відмова на write/remove (не throw): кеш -- необов'язкова офлайн-
// оптимізація, не єдине джерело правди (ADR-0001, сервер завжди головний).
// Приватний режим браузера чи переповнене сховище не мають валити застосунок --
// картка просто працює без офлайн-кешу в цьому сеансі, як і QG-1 описує
// "fallback" для мережі.

import type { StoragePort } from './port';

export function createLocalStorageAdapter(): StoragePort {
  return {
    read<T>(key: string): T | null {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? null : (JSON.parse(raw) as T);
      } catch {
        return null;
      }
    },
    write<T>(key: string, value: T): void {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // переповнене сховище / приватний режим -- кеш необов'язковий, мовчазна відмова.
      }
    },
    remove(key: string): void {
      try {
        localStorage.removeItem(key);
      } catch {
        // те саме, що write вище.
      }
    },
    clear(): void {
      try {
        localStorage.clear();
      } catch {
        // те саме, що write вище.
      }
    },
  };
}
