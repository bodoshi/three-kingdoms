export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Simple in-memory rate limit (per-edge-instance, best-effort)
const rateMap = new Map();
const RATE_WINDOW = 60_000; // 1 min
const RATE_LIMIT = 10;      // max requests per window

function isRateLimited(ip) {
  const now = Date.now();
  let entry = rateMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    entry = { start: now, count: 1 };
    rateMap.set(ip, entry);
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Rate limit by IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'Rate limited, try again later' }), {
      status: 429,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.AI_API_KEY;
  const apiBase = (process.env.AI_API_BASE || 'https://api.anthropic.com').replace(/\/+$/, '');
  const apiFormat = process.env.AI_API_FORMAT || 'anthropic';
  const defaultModel = process.env.AI_MODEL || 'claude-sonnet-4-20250514';

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'AI proxy not configured' }), {
      status: 503,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { system, messages, max_tokens, stream } = body;

  // Validate input
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Cap max_tokens to prevent abuse
  const safeMaxTokens = Math.min(max_tokens || 1000, 4096);

  try {
    let upstreamResp;

    if (apiFormat === 'anthropic') {
      const payload = {
        model: defaultModel,
        max_tokens: safeMaxTokens,
        stream: !!stream,
        messages,
      };
      if (system) payload.system = system;

      upstreamResp = await fetch(apiBase + '/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });
    } else {
      // OpenAI-compatible format
      const oaiMessages = [];
      if (system) oaiMessages.push({ role: 'system', content: system });
      oaiMessages.push(...messages);

      upstreamResp = await fetch(apiBase + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: defaultModel,
          max_tokens: safeMaxTokens,
          stream: !!stream,
          temperature: 0.9,
          messages: oaiMessages,
        }),
      });
    }

    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text().catch(() => '');
      console.error('Upstream AI error:', upstreamResp.status, errText);
      return new Response(JSON.stringify({ error: 'AI service error: ' + upstreamResp.status }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (stream) {
      // Stream SSE through to the client
      return new Response(upstreamResp.body, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    } else {
      const data = await upstreamResp.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    console.error('AI proxy error:', err);
    return new Response(JSON.stringify({ error: 'Proxy error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}
