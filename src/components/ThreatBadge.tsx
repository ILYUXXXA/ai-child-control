interface ThreatBadgeProps {
  type: string;
  action: string;
}

const typeColors: Record<string, string> = {
  phishing: 'bg-red-100 text-red-700',
  credential_theft: 'bg-orange-100 text-orange-700',
  malware: 'bg-rose-100 text-rose-700',
  safe: 'bg-emerald-100 text-emerald-700',
};

const typeLabels: Record<string, string> = {
  phishing: 'Фишинг',
  credential_theft: 'Кража данных',
  malware: 'Вредонос',
  safe: 'Безопасно',
};

const actionColors: Record<string, string> = {
  block: 'bg-red-600 text-white',
  warn: 'bg-amber-500 text-white',
  allow: 'bg-emerald-500 text-white',
};

const actionLabels: Record<string, string> = {
  block: 'Заблокировано',
  warn: 'Предупреждение',
  allow: 'Разрешено',
};

export default function ThreatBadge({ type, action }: ThreatBadgeProps) {
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeColors[type] ?? 'bg-slate-100 text-slate-600'}`}>
        {typeLabels[type] ?? type}
      </span>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${actionColors[action] ?? 'bg-slate-400 text-white'}`}>
        {actionLabels[action] ?? action}
      </span>
    </span>
  );
}
