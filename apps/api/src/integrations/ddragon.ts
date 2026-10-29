import { z } from 'zod';
import type { DataDragon } from './contracts';
import { type Clock, type FetchLike, rawRequest, systemClock } from './http';
import type { IntegrationOptions } from './options';

const BASE = 'https://ddragon.leagueoflegends.com';
const DAY_MS = 24 * 60 * 60 * 1000;
/** 실패 후 다시 시도하기까지 기다리는 시간(매 요청마다 Data Dragon을 두드리지 않게) */
const FAILURE_BACKOFF_MS = 60_000;

const VersionsSchema = z.array(z.string()).min(1);
const ChampionsSchema = z.object({
  data: z.record(z.object({ id: z.string(), key: z.string(), name: z.string() })),
});

/**
 * Data Dragon(키 불필요). 확인: 2026-10-28 실제 응답으로 확인(보고서 I5).
 *  - 버전: /api/versions.json (최신이 첫 원소), RIOT_DDRAGON_VERSION이 있으면 그 값 고정
 *  - 아이콘: /cdn/{버전}/img/profileicon/{id}.png
 *  - 챔피언: /cdn/{버전}/data/ko_KR/champion.json → data[이름].key(숫자 문자열)=championId, name=한글 이름
 *    이미지: /cdn/{버전}/img/champion/{id}.png
 * 버전은 하루 1회 캐시, 챔피언 표는 버전별로 캐시. 실패하면 null을 돌려주고 화면이 대체 표기를 쓴다.
 */
export class DataDragonHttp implements DataDragon {
  private version: { value: string; at: number } | null = null;
  private lastFailureAt = -Infinity;
  private champsFailureAt = -Infinity;
  private champs: { version: string; byId: Map<number, { key: string; nameKo: string }> } | null = null;

  constructor(
    private readonly opts: IntegrationOptions,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    private readonly clock: Clock = systemClock,
  ) {}

  async profileIconUrl(iconId: number): Promise<string | null> {
    const v = await this.getVersion();
    return v ? `${BASE}/cdn/${v}/img/profileicon/${iconId}.png` : null;
  }

  async champion(championId: number): Promise<{ key: string; nameKo: string; imageUrl: string | null } | null> {
    const v = await this.getVersion();
    if (!v) return null;
    if (this.champs?.version !== v) {
      if (this.clock.now() - this.champsFailureAt < FAILURE_BACKOFF_MS) return null;
      const json = await this.fetchJson(`${BASE}/cdn/${v}/data/ko_KR/champion.json`, ChampionsSchema);
      if (!json) {
        this.champsFailureAt = this.clock.now();
        return null;
      }
      const byId = new Map<number, { key: string; nameKo: string }>();
      for (const c of Object.values(json.data)) {
        const id = Number(c.key);
        if (Number.isInteger(id)) byId.set(id, { key: c.id, nameKo: c.name });
      }
      this.champs = { version: v, byId };
    }
    const c = this.champs.byId.get(championId);
    if (!c) return null;
    return { key: c.key, nameKo: c.nameKo, imageUrl: `${BASE}/cdn/${v}/img/champion/${c.key}.png` };
  }

  private async getVersion(): Promise<string | null> {
    if (this.opts.ddragonVersion) return this.opts.ddragonVersion;
    const now = this.clock.now();
    if (this.version && now - this.version.at < DAY_MS) return this.version.value;
    if (now - this.lastFailureAt < FAILURE_BACKOFF_MS) return this.version?.value ?? null;
    const list = await this.fetchJson(`${BASE}/api/versions.json`, VersionsSchema);
    const latest = list?.[0];
    if (!latest) {
      this.lastFailureAt = now;
      return this.version?.value ?? null; // 오래된 값이라도 있으면 계속 쓴다
    }
    this.version = { value: latest, at: now };
    return latest;
  }

  private async fetchJson<T>(url: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T | null> {
    try {
      const res = await rawRequest(this.fetchFn, url, { method: 'GET' }, this.opts.timeoutMs, this.clock);
      if (res.status < 200 || res.status >= 300) return null;
      const parsed = schema.safeParse(JSON.parse(res.text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
