// Обгортка над Claude API: перевіряє, чи факти картки (записи) виглядають суперечливими
// порівняно з тим, що описав користувач (AC-10, sad.md §6 Critical flow 5).
//
// I/O-виклик до Claude API сюди НЕ вбудований -- `callClaude` інжектується ззовні
// (той самий принцип dependency injection, що й у T11's local-cache). Завдяки цьому
// модуль лишається тестованим без мережі й без ключа API.

/**
 * Перевіряє факти картки на суперечність із її описом через Claude API.
 *
 * @param callClaude -- інжектована функція виклику Claude API: приймає готовий prompt,
 *   повертає сирий текст відповіді.
 * @param cardDescription -- опис картки, як його задав користувач.
 * @param facts -- факти (записи) картки, які потрібно звірити з описом.
 * @returns пояснення, що саме виглядає підозрілим, або `null`, якщо суперечності не знайдено.
 */
export async function checkSuspiciousData(
  callClaude: (prompt: string) => Promise<string>,
  cardDescription: string,
  facts: string
): Promise<string | null> {
  const prompt = buildPrompt(cardDescription, facts);
  let explanation: string;
  try {
    explanation = await callClaude(prompt);
  } catch {
    // Review 2026-09-07 A3, fail-open (test-plan.md, "Claude API unavailable ->
    // card still opens, no dataWarning, no user-facing error"): перевірка на
    // суперечність необов'язкова (AC-10 -- лише коли ЩОСЬ реально знайдено),
    // тож її недоступність не має валити решту картки в 500.
    return null;
  }
  return explanation.length > 0 ? explanation : null;
}

function buildPrompt(cardDescription: string, facts: string): string {
  return [
    'Перевір, чи факти картки суперечать її опису.',
    `Опис картки: ${cardDescription}`,
    `Факти (записи): ${facts}`,
    'Якщо є суперечність -- поясни, що саме не сходиться.',
    'Якщо суперечності немає -- поверни порожній рядок.',
  ].join('\n');
}
