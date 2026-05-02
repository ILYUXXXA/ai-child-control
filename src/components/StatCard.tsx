import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'red' | 'amber' | 'green' | 'blue' | 'slate';
  icon: React.ReactNode;
}

const accentMap: Record<string, string> = {
  red: 'bg-red-50 border-red-200 text-red-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  blue: 'bg-sky-50 border-sky-200 text-sky-700',
  slate: 'bg-slate-50 border-slate-200 text-slate-700',
};

const iconMap: Record<string, string> = {
  red: 'bg-red-100 text-red-600',
  amber: 'bg-amber-100 text-amber-600',
  green: 'bg-emerald-100 text-emerald-600',
  blue: 'bg-sky-100 text-sky-600',
  slate: 'bg-slate-100 text-slate-600',
};

export default function StatCard({ label, value, sub, accent = 'slate', icon }: StatCardProps) {
  return (
    <div className={`rounded-2xl border p-5 flex gap-4 items-start ${accentMap[accent]}`}>
      <div className={`rounded-xl p-3 flex-shrink-0 ${iconMap[accent]}`}>{icon}</div>
      <div>
        <p className="text-sm font-medium opacity-70">{label}</p>
        <p className="text-3xl font-bold leading-tight">{value}</p>
        {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
