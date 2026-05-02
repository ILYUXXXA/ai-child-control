import { ThreatEvent } from '../lib/supabase';

interface ActivityChartProps {
  events: ThreatEvent[];
}

function buildHourBuckets(events: ThreatEvent[]): { hour: string; count: number; maxRisk: number }[] {
  const now = new Date();
  const buckets: Record<number, { count: number; maxRisk: number }> = {};

  for (let i = 23; i >= 0; i--) {
    const h = new Date(now.getTime() - i * 3600 * 1000).getHours();
    buckets[h] = { count: 0, maxRisk: 0 };
  }

  for (const e of events) {
    const h = new Date(e.timestamp * 1000).getHours();
    if (h in buckets) {
      buckets[h].count += 1;
      buckets[h].maxRisk = Math.max(buckets[h].maxRisk, e.risk);
    }
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([hour, data]) => ({ hour: `${hour}:00`, ...data }));
}

function barColor(maxRisk: number): string {
  if (maxRisk >= 70) return 'bg-red-400';
  if (maxRisk >= 30) return 'bg-amber-400';
  return 'bg-sky-300';
}

export default function ActivityChart({ events }: ActivityChartProps) {
  const buckets = buildHourBuckets(events);
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">Активность по часам (последние 24 ч)</p>
      <div className="flex items-end gap-1 h-24">
        {buckets.map((b) => (
          <div key={b.hour} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div
              className={`w-full rounded-t transition-all duration-300 ${barColor(b.maxRisk)} ${b.count === 0 ? 'opacity-20' : ''}`}
              style={{ height: `${(b.count / maxCount) * 80}px`, minHeight: b.count > 0 ? '4px' : '2px' }}
            />
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10 transition-opacity">
              {b.hour}: {b.count} событий
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-slate-400">00:00</span>
        <span className="text-xs text-slate-400">12:00</span>
        <span className="text-xs text-slate-400">23:00</span>
      </div>
    </div>
  );
}
