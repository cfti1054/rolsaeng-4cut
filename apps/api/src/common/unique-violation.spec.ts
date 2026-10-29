import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { classifyGameAccountUniqueViolation } from './unique-violation';

const p2002 = (target: unknown) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });

describe('game_accounts P2002 구분(계약 S1 5-2a)', () => {
  it.each([
    [['game_id', 'external_id'], 'external_id'],
    [['gameId', 'externalId'], 'external_id'],
    ['game_accounts_game_id_external_id_key', 'external_id'],
    ['game_accounts_one_primary_per_user_game', 'one_primary'],
    [['user_id', 'game_id'], 'one_primary'],
    [['userId', 'gameId'], 'one_primary'],
    [['is_primary'], 'one_primary'],
    [['nickname'], 'unknown'],
    [[], 'unknown'],
    [undefined, 'unknown'],
    [42, 'unknown'],
  ])('target %j → %s', (target, expected) => {
    expect(classifyGameAccountUniqueViolation(p2002(target))).toBe(expected);
  });

  it('P2002가 아니면 null', () => {
    expect(classifyGameAccountUniqueViolation(new Error('x'))).toBeNull();
    expect(classifyGameAccountUniqueViolation({ code: 'P2025' })).toBeNull();
    expect(classifyGameAccountUniqueViolation(null)).toBeNull();
  });
});
