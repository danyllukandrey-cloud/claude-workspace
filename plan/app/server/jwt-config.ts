// Review 2026-09-07 (backend hardening, T50, "слабкий JWT_SECRET без
// перевірки довжини"): чиста функція, винесена з index.ts САМЕ для
// тестованості -- index.ts (composition root) навмисно не юніт-тестується
// (шапка файлу: реальна мережа/БД/Google, покриття лише test:integration/
// ручний прогін), тому перевірку робить окремий модуль без побічних ефектів.
//
// 32 байти -- мінімум для HS256 (RFC 7518 §3.2 рекомендує ключ довжиною не
// менше розміру хеша, SHA-256 = 32 байти); коротший ключ підбирається
// brute-force значно швидше, ніж підпис лишається дійсним (24h TTL, index.ts).

export const MIN_JWT_SIGNING_KEY_BYTES = 32;

export function assertJwtSigningKeyStrength(secret: string): void {
  const byteLength = new TextEncoder().encode(secret).length;
  if (byteLength < MIN_JWT_SIGNING_KEY_BYTES) {
    throw new Error(
      `JWT_SECRET закороткий (${byteLength} байт, потрібно мінімум ${MIN_JWT_SIGNING_KEY_BYTES}) -- слабкий ключ підпису робить JWT підбірним brute-force`
    );
  }
}
