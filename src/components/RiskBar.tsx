interface RiskBarProps {
  risk: number;
}

function riskColor(risk: number): string {
  if (risk >= 70) return 'bg-red-500';
  if (risk >= 30) return 'bg-amber-400';
  return 'bg-emerald-400';
}

function riskTextColor(risk: number): string {
  if (risk >= 70) return 'text-red-600';
  if (risk >= 30) return 'text-amber-600';
  return 'text-emerald-600';
}

export default function RiskBar({ risk }: RiskBarProps) {
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${riskColor(risk)}`}
          style={{ width: `${risk}%` }}
        />
      </div>
      <span className={`text-xs font-bold w-8 text-right ${riskTextColor(risk)}`}>{risk}%</span>
    </div>
  );
}
