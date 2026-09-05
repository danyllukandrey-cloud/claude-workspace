import { checkSuspiciousData } from './claude-client';

describe('checkSuspiciousData', () => {
  // AC-10: Given user's card has data the agent flags as inconsistent with what the user described
  // When the user opens the card or asks the agent about it
  // Then the agent points out what looks wrong and offers to correct it together, without blocking the rest of the card
  it('повертає пояснення (не null, не порожній рядок), коли заглушка Claude API знаходить суперечність', async () => {
    const cardDescription = 'Щотижневі пробіжки, ціль -- 3 рази на тиждень';
    const facts = 'За останні 4 тижні -- жодного запису про пробіжку';

    // Заглушка Claude API: за наперед відомим входом імітує відповідь агента, що знайшов суперечність.
    const fakeCallClaude = async (_prompt: string): Promise<string> =>
      'Опис каже про щотижневі пробіжки, але за останні 4 тижні немає жодного запису -- варто уточнити.';

    const result = await checkSuspiciousData(fakeCallClaude, cardDescription, facts);

    expect(result).not.toBeNull();
    expect(result).not.toBe('');
  });

  // AC-10 (та сама теза, узгоджена гілка): Given дані картки узгоджені з описаним користувачем
  // When користувач відкриває картку або питає агента про неї
  // Then агент нічого підозрілого не вказує -- перевірка повертає null
  it('повертає null, коли заглушка Claude API не знаходить суперечності', async () => {
    const cardDescription = 'Щотижневі пробіжки, ціль -- 3 рази на тиждень';
    const facts = 'За останні 4 тижні -- 12 записів про пробіжку, узгоджено з ціллю';

    // Заглушка Claude API: за наперед відомим входом імітує відповідь агента "нічого підозрілого".
    const fakeCallClaude = async (_prompt: string): Promise<string> => '';

    const result = await checkSuspiciousData(fakeCallClaude, cardDescription, facts);

    expect(result).toBeNull();
  });
});
