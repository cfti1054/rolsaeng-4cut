'use client';

// 프로필 레이팅 그래프. recharts가 크므로 profile-scrim이 이 파일을 지연 로딩한다(첫 화면 JS를 줄이려고).
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatFull } from '@/lib/format';
import { cn } from '@/lib/cn';
import { ratingChartData } from '@/lib/scrim-results';

type ChartPoint = ReturnType<typeof ratingChartData>[number];

function RatingDot(props: { cx?: number; cy?: number; payload?: ChartPoint; last?: boolean }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  const fill = payload.up === false ? 'var(--orange)' : payload.up === null ? 'var(--faint)' : 'var(--accent)';
  return <circle cx={cx} cy={cy} r={props.last ? 5 : 3.5} fill={fill} stroke="var(--surface)" strokeWidth={1.5} />;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload: ChartPoint }[] }) {
  const pt = active ? payload?.[0]?.payload : undefined;
  if (!pt) return null;
  return (
    <div className="rounded-xl border border-line-2 bg-surface-3 px-3 py-2 text-xs shadow-[0_8px_20px_var(--shadow)]">
      <div className="font-display text-sm font-bold text-text">{pt.elo}</div>
      {pt.title ? (
        <>
          <div className="max-w-[200px] truncate text-text-2">{pt.title}</div>
          {pt.at && <div className="text-faint">{formatFull(pt.at)}</div>}
        </>
      ) : (
        <div className="text-faint">시작 레이팅</div>
      )}
    </div>
  );
}

export function RatingChart({ points, truncated, fetching }: { points: Parameters<typeof ratingChartData>[0]; truncated: boolean; fetching: boolean }) {
  const data = ratingChartData(points);
  const first = data[0]!.elo;
  const lastPt = data[data.length - 1]!;
  const min = Math.min(...data.map((d) => d.elo));
  const max = Math.max(...data.map((d) => d.elo));
  const n = points.length;
  return (
    <div className={cn('flex flex-col gap-1', fetching && 'opacity-70')}>
      <div
        role="img"
        aria-label={`최근 ${n}경기 레이팅이 ${first}에서 시작해 최고 ${max}, 최저 ${min}을 거쳐 ${lastPt.elo}로 마감`}
        className="h-[210px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="i" hide />
            <YAxis
              width={44}
              domain={[(v: number) => Math.floor((v - 10) / 10) * 10, (v: number) => Math.ceil((v + 10) / 10) * 10]}
              tick={{ fill: 'var(--faint)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--line-3)' }} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="elo"
              stroke="var(--accent)"
              strokeWidth={2.5}
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; payload?: ChartPoint; index?: number }) => (
                <RatingDot key={props.index} cx={props.cx} cy={props.cy} payload={props.payload} last={props.index === data.length - 1} />
              )}
              activeDot={{ r: 6, fill: 'var(--accent)', stroke: 'var(--surface)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between pl-11 font-display text-[11px] text-faint">
        <span>{n}경기 전</span>
        <span>최근</span>
      </div>
      {truncated && <p className="m-0 text-xs text-faint">최근 100경기만 보여요</p>}
    </div>
  );
}

// -----------------------------------------------------------------------------
