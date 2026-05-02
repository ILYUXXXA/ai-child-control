import { useEffect, useState, useCallback } from 'react';
import {
  Shield,
  AlertTriangle,
  Ban,
  Activity,
  RefreshCw,
  CheckCircle2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { supabase, ThreatEvent } from './lib/supabase';
import StatCard from './components/StatCard';
import ThreatTable from './components/ThreatTable';
import ActivityChart from './components/ActivityChart';

const PAGE_SIZE = 50;

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function ThreatBreakdown({ events }: { events: ThreatEvent[] }) {
  const counts: Record<string, number> = { phishing: 0, credential_theft: 0, malware: 0, safe: 0 };
  for (const e of events) counts[e.threat_type] = (counts[e.threat_type] ?? 0) + 1;

  const items = [
    { key: 'phishing', label: 'Фишинг', color: 'bg-red-500', text: 'text-red-600' },
    { key: 'credential_theft', label: 'Кража данных', color: 'bg-orange-400', text: 'text-orange-600' },
    { key: 'malware', label: 'Вредонос', color: 'bg-rose-500', text: 'text-rose-600' },
    { key: 'safe', label: 'Безопасно', color: 'bg-emerald-400', text: 'text-emerald-600' },
  ];
  const total = Math.max(1, Object.values(counts).reduce((a, b) => a + b, 0));

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const count = counts[item.key] ?? 0;
        const pct = Math.round((count / total) * 100);
        return (
          <div key={item.key}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-600 font-medium">{item.label}</span>
              <span className={`font-bold ${item.text}`}>{count}</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${item.color}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
      <p className="text-xs text-slate-400 pt-1">Всего событий: {events.length}</p>
    </div>
  );
}

const ARCH_DIAGRAM = `
  ┌──────────────────────────────────────────────────────────────────┐
  │                   CYBERPARENT AI — СИСТЕМА                       │
  └──────────────────────────────────────────────────────────────────┘

  [Компьютер ребёнка]       [Облако]                  [Родитель]
  ┌─────────────────┐       ┌──────────────────────┐  ┌───────────┐
  │ screen_monitor  │─JPEG─▶│  Cloudflare Worker   │─▶│  Telegram │
  │  (Python agent) │◀─JSON─│  /analyze-screenshot │  │    Bot    │
  └─────────────────┘       └──────────┬───────────┘  └───────────┘
     скриншот                          │
     каждые 1-2с                       ▼
     сжатие 70%              ┌──────────────────┐
     base64                  │  Groq Vision AI  │
                             │  llama-3.2-90b   │
                             └────────┬─────────┘
                                      │ JSON: risk, threat_type
                                      ▼
                             ┌──────────────────┐
                             │  Supabase DB     │  ◀── этот дашборд
                             │  threat_events   │
                             └──────────────────┘

  risk ≥ 70% → BLOCK + Telegram   risk 30-70% → WARN
  скриншоты НИКОГДА не сохраняются — только текст угроз`.trim();

export default function App() {
  const [events, setEvents] = useState<ThreatEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const online = useOnlineStatus();

  const fetchEvents = useCallback(async () => {
    const { data, error } = await supabase
      .from('threat_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (!error && data) {
      setEvents(data as ThreatEvent[]);
      setLastRefresh(new Date());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const channel = supabase
      .channel('threat_events_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'threat_events' }, (payload) => {
        setEvents((prev) => [payload.new as ThreatEvent, ...prev].slice(0, PAGE_SIZE));
        setLastRefresh(new Date());
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => fetchEvents(), 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchEvents]);

  const blocked = events.filter((e) => e.action === 'block').length;
  const warned = events.filter((e) => e.action === 'warn').length;
  const today = events.filter((e) => {
    const d = new Date(e.timestamp * 1000);
    const now = new Date();
    return d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
  }).length;
  const avgRisk = events.length
    ? Math.round(events.reduce((s, e) => s + e.risk, 0) / events.length)
    : 0;
  const latestRisk = events[0]?.risk ?? 0;

  const securityStatus =
    blocked > 0
      ? { label: 'Угрозы заблокированы', colorClass: 'text-red-600 bg-red-50 border-red-200', icon: <Ban className="w-3.5 h-3.5" /> }
      : warned > 0
      ? { label: 'Есть предупреждения', colorClass: 'text-amber-600 bg-amber-50 border-amber-200', icon: <AlertTriangle className="w-3.5 h-3.5" /> }
      : { label: 'Всё под контролем', colorClass: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: <CheckCircle2 className="w-3.5 h-3.5" /> };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-sky-600 text-white rounded-xl p-2">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">CyberParent AI</h1>
              <p className="text-xs text-slate-500">Родительский контроль на основе ИИ</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`hidden sm:flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
                online
                  ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                  : 'text-red-600 bg-red-50 border-red-200'
              }`}
            >
              {online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {online ? 'Онлайн' : 'Офлайн'}
            </span>

            <span
              className={`hidden sm:flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${securityStatus.colorClass}`}
            >
              {securityStatus.icon}
              {securityStatus.label}
            </span>

            <button
              onClick={() => setAutoRefresh((v) => !v)}
              title="Авто-обновление"
              className={`rounded-lg p-2 border transition-colors ${
                autoRefresh
                  ? 'bg-sky-50 border-sky-200 text-sky-600'
                  : 'bg-slate-50 border-slate-200 text-slate-400'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin [animation-duration:3s]' : ''}`} />
            </button>

            <button
              onClick={() => {
                setLoading(true);
                fetchEvents();
              }}
              className="rounded-lg px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold transition-colors"
            >
              Обновить
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Событий сегодня"
            value={today}
            sub="за текущие сутки"
            accent="blue"
            icon={<Activity className="w-5 h-5" />}
          />
          <StatCard
            label="Заблокировано"
            value={blocked}
            sub="action = block"
            accent={blocked > 0 ? 'red' : 'slate'}
            icon={<Ban className="w-5 h-5" />}
          />
          <StatCard
            label="Предупреждений"
            value={warned}
            sub="action = warn"
            accent={warned > 0 ? 'amber' : 'slate'}
            icon={<AlertTriangle className="w-5 h-5" />}
          />
          <StatCard
            label="Средний риск"
            value={`${avgRisk}%`}
            sub={`последний: ${latestRisk}%`}
            accent={avgRisk >= 70 ? 'red' : avgRisk >= 30 ? 'amber' : 'green'}
            icon={<Shield className="w-5 h-5" />}
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-sm font-bold text-slate-700 mb-4">График активности (24 ч)</h2>
            <ActivityChart events={events} />
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-sm font-bold text-slate-700 mb-4">Типы угроз</h2>
            <ThreatBreakdown events={events} />
          </div>
        </div>

        {/* Threat log */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-700">Журнал угроз</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {events.length} событий · обновлено {lastRefresh.toLocaleTimeString('ru-RU')}
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          </div>
          <div className="p-6">
            <ThreatTable events={events} loading={loading} />
          </div>
        </div>

        {/* Architecture diagram */}
        <div className="bg-slate-900 text-slate-300 rounded-2xl p-6 shadow-sm font-mono text-xs leading-relaxed overflow-x-auto">
          <h2 className="text-sm font-bold text-slate-300 mb-4 font-sans">Архитектура системы</h2>
          <pre>{ARCH_DIAGRAM}</pre>
        </div>
      </main>

      <footer className="border-t border-slate-200 mt-12 py-6 text-center text-xs text-slate-400">
        CyberParent AI &mdash; скриншоты не сохраняются, только текстовые метрики
      </footer>
    </div>
  );
}
