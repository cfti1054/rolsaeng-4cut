import { describe, expect, it } from 'vitest';
import { parseDatabaseUrl } from './database-url';

describe('DATABASE_URL', () => {
  it('Prisma schema 쿼리를 빼고 비밀번호 인코딩은 유지한다', () => {
    expect(parseDatabaseUrl('postgresql://gcd:p%40ss@localhost:5432/gcd?schema=public')).toEqual({
      connectionString: 'postgresql://gcd:p%40ss@localhost:5432/gcd',
    });
  });

  it('sslmode=require는 인증서를 느슨하게 본다', () => {
    expect(parseDatabaseUrl('postgresql://u:p@example:5432/db?sslmode=require').ssl).toEqual({
      rejectUnauthorized: false,
    });
    expect(parseDatabaseUrl('postgresql://u:p@example:5432/db?sslmode=verify-full').ssl).toEqual({
      rejectUnauthorized: true,
    });
  });
});
