/**
 * 봇 API 키 발급·목록·폐기 CLI(계약 6-1). 실행: corepack pnpm --filter api api-key <create|list|revoke> ...
 * DATABASE_URL 필요. 원문은 create 출력에서 한 번만 보이고 DB에는 해시만 저장한다. 시드로 키를 만들지 않는다(D221).
 */
import { PrismaClient } from '@prisma/client';
import { generateApiKey } from '../src/common/api-key';
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_TARGET,
  EXIT_USAGE,
  USAGE,
  classifyMatches,
  formatCreated,
  formatList,
  formatRevoked,
  parseCliArgs,
  type CliCommand,
  type KeyRow,
} from './api-key-cli';

const SELECT = { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, revokedAt: true } as const;

async function run(prisma: PrismaClient, cmd: CliCommand, out: (s: string) => void, err: (s: string) => void): Promise<number> {
  if (cmd.command === 'create') {
    const key = generateApiKey();
    const row = await prisma.apiKey.create({
      data: { name: cmd.name, keyHash: key.hash, keyPrefix: key.prefix, scopes: cmd.scopes, createdById: null },
      select: SELECT,
    });
    out(formatCreated(row, key.raw));
    return EXIT_OK;
  }

  if (cmd.command === 'list') {
    const rows: KeyRow[] = await prisma.apiKey.findMany({ select: SELECT, orderBy: { createdAt: 'asc' } });
    out(formatList(rows));
    return EXIT_OK;
  }

  const rows: KeyRow[] =
    cmd.target.by === 'id'
      ? await prisma.apiKey.findMany({ where: { id: cmd.target.id }, select: SELECT })
      : await prisma.apiKey.findMany({ where: { keyPrefix: cmd.target.prefix }, select: SELECT });
  const m = classifyMatches(rows);
  if (m.kind === 'none') {
    err('해당하는 키가 없다.');
    return EXIT_TARGET;
  }
  if (m.kind === 'many') {
    err(`prefix 가 여러 키와 겹친다. --id 로 지정해라:\n${formatList(m.rows)}`);
    return EXIT_TARGET;
  }
  if (m.row.revokedAt) {
    out(formatRevoked(m.row, m.row.revokedAt, true));
    return EXIT_OK;
  }
  const now = new Date();
  // 동시에 폐기돼도 처음 시각을 지킨다
  await prisma.apiKey.updateMany({ where: { id: m.row.id, revokedAt: null }, data: { revokedAt: now } });
  out(formatRevoked(m.row, now, false));
  return EXIT_OK;
}

async function main(): Promise<number> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`오류: ${parsed.error}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  const prisma = new PrismaClient();
  try {
    return await run(prisma, parsed.value, (s) => console.log(s), (s) => console.error(s));
  } catch (e) {
    // 메시지만(키 원문은 예외에 들어가지 않는다)
    console.error(`실패: ${e instanceof Error ? e.message : 'unknown'}`);
    return EXIT_FAILURE;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => {
  process.exitCode = code;
});
