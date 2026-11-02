export type PgConnection = {
  connectionString: string;
  /** Railway 공개 주소(sslmode=require)는 인증서를 느슨하게 본다. 내부 주소는 ssl을 쓰지 않는다. */
  ssl?: { rejectUnauthorized: boolean };
};

/**
 * Prisma용 `schema` 쿼리는 node-postgres가 모른다. sslmode는 Pool 옵션으로 옮긴다.
 * 비밀번호가 들어 있는 앞부분은 다시 인코딩하지 않는다.
 */
export function parseDatabaseUrl(databaseUrl: string): PgConnection {
  const qIndex = databaseUrl.indexOf('?');
  const base = qIndex === -1 ? databaseUrl : databaseUrl.slice(0, qIndex);
  const params = new URLSearchParams(qIndex === -1 ? '' : databaseUrl.slice(qIndex + 1));
  const sslmode = params.get('sslmode');
  params.delete('schema');
  params.delete('sslmode');
  const rest = params.toString();
  const connectionString = rest ? `${base}?${rest}` : base;
  if (sslmode === 'verify-full') return { connectionString, ssl: { rejectUnauthorized: true } };
  if (sslmode === 'require' || sslmode === 'prefer' || sslmode === 'verify-ca') {
    return { connectionString, ssl: { rejectUnauthorized: false } };
  }
  return { connectionString };
}
