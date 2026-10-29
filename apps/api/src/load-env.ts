import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `.env`를 다른 모듈보다 먼저 읽는다. AppModule의 JobsModule.forRoot()이 모듈을 읽는 시점의
 * process.env를 쓰므로 main.ts에서 app.module보다 앞서 import해야 한다.
 */
const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
