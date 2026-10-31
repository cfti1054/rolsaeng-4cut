'use client';

import { InfoTip } from '@/components/ui/info-tip';
import { ELO_INFO_LABEL, ELO_INFO_TITLE, eloInfoSections } from '@/lib/elo-info';
import { useDashboardSummary } from '@/lib/hooks/rankings';

/** 「내전 ELO란?」 ⓘ(계약 19-3). 값은 앱 셸과 같은 요약 쿼리의 rating_policy. 없으면 숫자 없는 문구 */
export function EloInfo() {
  const q = useDashboardSummary();
  return (
    <InfoTip label={ELO_INFO_LABEL}>
      <h3 className="m-0 text-sm font-bold text-text">{ELO_INFO_TITLE}</h3>
      {eloInfoSections(q.data?.rating_policy ?? null).map((s) => (
        <section key={s.heading} className="mt-3">
          <h4 className="m-0 text-[13px] font-semibold text-text">{s.heading}</h4>
          <p className="m-0 mt-1">{s.body}</p>
        </section>
      ))}
    </InfoTip>
  );
}
