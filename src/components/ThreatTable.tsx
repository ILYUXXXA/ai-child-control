import { ThreatEvent } from '../lib/supabase';
import ThreatBadge from './ThreatBadge';
import RiskBar from './RiskBar';

interface ThreatTableProps {
  events: ThreatEvent[];
  loading: boolean;
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export default function ThreatTable({ events, loading }: ThreatTableProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <div className="text-5xl mb-3">🛡️</div>
        <p className="font-medium">Угроз не обнаружено</p>
        <p className="text-sm">Монитор активен — всё чисто</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-500 uppercase tracking-wide">
            <th className="pb-3 pr-4 font-semibold">Дата/Время</th>
            <th className="pb-3 pr-4 font-semibold">Устройство</th>
            <th className="pb-3 pr-4 font-semibold">Риск</th>
            <th className="pb-3 pr-4 font-semibold">Тип / Действие</th>
            <th className="pb-3 font-semibold">Причина</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {events.map((e) => (
            <tr key={e.id} className="hover:bg-slate-50 transition-colors group">
              <td className="py-3 pr-4 whitespace-nowrap font-mono text-slate-500">
                <span className="block text-slate-700">{formatTime(e.timestamp)}</span>
                <span className="text-xs text-slate-400">{formatDate(e.timestamp)}</span>
              </td>
              <td className="py-3 pr-4 text-slate-600 font-medium">{e.device_id}</td>
              <td className="py-3 pr-4 min-w-[130px]">
                <RiskBar risk={e.risk} />
              </td>
              <td className="py-3 pr-4">
                <ThreatBadge type={e.threat_type} action={e.action} />
              </td>
              <td className="py-3 text-slate-600 max-w-xs truncate" title={e.reason}>
                {e.reason || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
