import { listCards } from './list-cards';

// Канонічний рядок картки, як його повертає pg (snake_case) -- той самий
// формат, що очікує toCardRecord у postgres-repo.ts.
const CANONICAL_CARD_ROW = {
  id: 'card-1',
  owner_user_id: 'owner-1',
  name: 'Біг',
  description: null,
  status: 'active',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

describe('listCards', () => {
  // AC-18 (гілка "без параметра"): виклик без третього аргумента поводиться
  // так само, як явний status='active' -- лише активні картки, AC-04 не зламано.
  it('без третього аргумента викликає ту саму SQL-гілку, що й status="active"', async () => {
    const queryDefault = vi.fn().mockResolvedValue({ rows: [CANONICAL_CARD_ROW] });
    const dbDefault = { query: queryDefault };

    const queryExplicitActive = vi.fn().mockResolvedValue({ rows: [CANONICAL_CARD_ROW] });
    const dbExplicitActive = { query: queryExplicitActive };

    await listCards(dbDefault, 'owner-1');
    await listCards(dbExplicitActive, 'owner-1', 'active');

    expect(queryDefault).toHaveBeenCalledTimes(1);
    expect(queryExplicitActive).toHaveBeenCalledTimes(1);

    const [sqlDefault] = queryDefault.mock.calls[0];
    const [sqlExplicitActive] = queryExplicitActive.mock.calls[0];

    // Обидва виклики мають піти по гілці "активні" -- той самий SQL-текст.
    expect(sqlDefault).toBe(sqlExplicitActive);
    expect(sqlDefault).toContain("status = 'active'");
  });

  // AC-18 (гілка "архів"): status='archived' викликає іншу SQL-гілку
  // (listArchivedCardsByOwner), не ту, що для активних.
  it('status="archived" викликає іншу SQL-гілку, ніж активні картки', async () => {
    const archivedRow = { ...CANONICAL_CARD_ROW, status: 'archived' };
    const queryArchived = vi.fn().mockResolvedValue({ rows: [archivedRow] });
    const dbArchived = { query: queryArchived };

    const queryActive = vi.fn().mockResolvedValue({ rows: [CANONICAL_CARD_ROW] });
    const dbActive = { query: queryActive };

    const archivedResult = await listCards(dbArchived, 'owner-1', 'archived');
    await listCards(dbActive, 'owner-1', 'active');

    const [sqlArchived] = queryArchived.mock.calls[0];
    const [sqlActive] = queryActive.mock.calls[0];

    expect(sqlArchived).not.toBe(sqlActive);
    expect(sqlArchived).toContain("status = 'archived'");
    expect(sqlArchived).toContain('ORDER BY updated_at DESC');
    expect(archivedResult).toEqual([
      {
        id: 'card-1',
        ownerUserId: 'owner-1',
        name: 'Біг',
        description: null,
        status: 'archived',
        trackingMode: 'goals',
        healthState: null,
        createdAt: archivedRow.created_at,
        updatedAt: archivedRow.updated_at,
      },
    ]);
  });
});
