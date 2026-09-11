// Доменна логіка "Структури" -- декларація (AC-10).
// Структура тримає власну декларацію "картина світу, навіщо, пріоритет"
// повністю окремо від Опису будь-якої картки: два поля НІКОЛИ не мерджаться
// і не показуються як одне. Чиста функція, без I/O (plan/app/CLAUDE.md).

export interface Structure {
  id: string;
  ownerUserId: string;
  declaration: string | null;
}

export function setDeclaration(structure: Structure, text: string): Structure {
  if (text.trim().length === 0) {
    throw new Error('declaration must not be empty or whitespace-only');
  }

  return { ...structure, declaration: text };
}
