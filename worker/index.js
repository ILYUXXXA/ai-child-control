/**
 * CyberParent AI — Cloudflare Worker
 * Accepts screenshots from the desktop agent, analyzes them via Groq Vision API,
 * sends Telegram alerts and returns risk/action to the agent.
 * Screenshots are NEVER stored; only text metrics are written to KV.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorJson(message, status = 400) {
  return json({ error: message }, status);
}

// ─── Groq Vision ────────────────────────────────────────────────────────────

async function analyzeWithGroq(base64Image, groqApiKey) {
  const prompt = `Проанализируй этот скриншот экрана ребёнка.
Найди признаки:
- Фишинг (поддельный сайт банка/сервиса)
- несанкционированный Запрос пароля, CVV, кода из SMS 
- Вредоносные ссылки или скачивание
- Любую попытку кражи данных

Верни ТОЛЬКО JSON (без markdown, без пояснений):
{
  "risk": 0-100,
  "threat_type": "phishing|credential_theft|malware|safe",
  "reason": "краткое описание угрозы (50 символов максимум)",
  "location": "где на экране находится угроза"
}`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 256,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Image}` },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '';

  // Strip possible markdown code fences
  const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

// ─── Telegram notification ───────────────────────────────────────────────────

async function sendTelegram(botToken, chatId, risk, threatType, reason, location, timestamp) {
  const time = new Date(timestamp * 1000).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' });
  const riskBar = buildRiskBar(risk);
  const emoji = risk >= 70 ? '🚨' : '⚠️';
  const actionLabel = risk >= 70 ? 'ЗАБЛОКИРОВАНО' : 'ПРЕДУПРЕЖДЕНИЕ';

  const text =
    `${emoji} <b>CyberParent AI — ${actionLabel}</b>\n\n` +
    `${riskBar}\n` +
    `<b>Риск:</b> ${risk}%\n` +
    `<b>Тип угрозы:</b> ${threatType}\n` +
    `<b>Причина:</b> ${reason}\n` +
    `<b>Место:</b> ${location}\n` +
    `<b>Время:</b> ${time}\n\n` +
    `/block — Заблокировать сайт\n` +
    `/ignore — Игнорировать`;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error('Telegram send error:', errBody);
  }
}

function buildRiskBar(risk) {
  const filled = Math.round(risk / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `[${bar}] ${risk}%`;
}

// ─── KV metrics (no screenshots) ────────────────────────────────────────────

async function recordMetric(kv, deviceId, risk, threatType, action) {
  if (!kv) return;
  try {
    const key = `metrics:${deviceId}`;
    const existing = await kv.get(key, 'json') ?? { total: 0, threats: 0, blocked: 0, lastRisk: 0 };
    existing.total += 1;
    if (risk >= 30) existing.threats += 1;
    if (action === 'block') existing.blocked += 1;
    existing.lastRisk = risk;
    existing.lastThreatType = threatType;
    existing.updatedAt = Date.now();
    await kv.put(key, JSON.stringify(existing), { expirationTtl: 60 * 60 * 24 * 30 });
  } catch (e) {
    console.error('KV write error:', e);
  }
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

async function checkRateLimit(kv, ip) {
  if (!kv) return true; // allow if KV not bound
  const key = `rl:${ip}`;
  const count = parseInt((await kv.get(key)) ?? '0', 10);
  if (count >= 35) return false; // 35 req/min safety margin below Groq 30rpm
  await kv.put(key, String(count + 1), { expirationTtl: 60 });
  return true;
}

// ─── Main handler ────────────────────────────────────────────────────────────

async function handleAnalyze(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

  const allowed = await checkRateLimit(env.CYBERPARENT_KV, ip);
  if (!allowed) {
    return errorJson('Rate limit exceeded. Max 35 requests per minute.', 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson('Invalid JSON body');
  }

  const { screenshot_base64, timestamp, device_id = 'default' } = body;

  if (!screenshot_base64) return errorJson('screenshot_base64 is required');
  if (!env.GROQ_API_KEY) return errorJson('Worker misconfigured: missing GROQ_API_KEY', 500);

  // Strip data URI prefix if present
  const base64Clean = screenshot_base64.replace(/^data:image\/[a-z]+;base64,/i, '');

  let analysis;
  try {
    analysis = await analyzeWithGroq(base64Clean, env.GROQ_API_KEY);
  } catch (e) {
    console.error('Groq error:', e);
    return errorJson(`Groq Vision API error: ${e.message}`, 502);
  }

  // Validate and clamp
  const risk = Math.max(0, Math.min(100, parseInt(analysis.risk ?? 0, 10)));
  const threatType = ['phishing', 'credential_theft', 'malware', 'safe'].includes(analysis.threat_type)
    ? analysis.threat_type
    : 'safe';
  const reason = String(analysis.reason ?? '').slice(0, 100);
  const location = String(analysis.location ?? '').slice(0, 100);

  // Determine action
  let action;
  const thresholdBlock = parseInt(env.THRESHOLD_BLOCK ?? '70', 10);
  const thresholdWarn = parseInt(env.THRESHOLD_WARN ?? '30', 10);

  if (risk >= thresholdBlock) {
    action = 'block';
  } else if (risk >= thresholdWarn) {
    action = 'warn';
  } else {
    action = 'allow';
  }

  // Telegram notification for risk >= 50
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  if (risk >= 50 && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    // Fire-and-forget; don't block response
    env.ctx?.waitUntil(
      sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, risk, threatType, reason, location, ts)
    );
  }

  // Record metric (no screenshot)
  if (env.CYBERPARENT_KV) {
    env.ctx?.waitUntil(recordMetric(env.CYBERPARENT_KV, device_id, risk, threatType, action));
  }

  return json({ risk, threat_type: threatType, reason, location, action });
}

async function handleMetrics(request, env) {
  const url = new URL(request.url);
  const deviceId = url.searchParams.get('device_id') ?? 'default';

  if (!env.CYBERPARENT_KV) return json({ error: 'KV not bound' }, 500);

  const key = `metrics:${deviceId}`;
  const data = await env.CYBERPARENT_KV.get(key, 'json');
  return json(data ?? { total: 0, threats: 0, blocked: 0, lastRisk: 0 });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    // Attach ctx so handlers can use waitUntil
    env.ctx = ctx;

    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/analyze-screenshot' && request.method === 'POST') {
      return handleAnalyze(request, env);
    }

    if (url.pathname === '/metrics' && request.method === 'GET') {
      return handleMetrics(request, env);
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', version: '1.0.0' });
    }

    return json({ error: 'Not found' }, 404);
  },
};
