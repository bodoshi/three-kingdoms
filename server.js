const http = require('http');
const fs = require('fs');
const path = require('path');

// --- 配置 ---
const PORT = 3000;
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_API_BASE = (process.env.AI_API_BASE || 'https://api.anthropic.com').replace(/\/+$/, '');
const AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-20250514';
const AI_API_FORMAT = process.env.AI_API_FORMAT || 'anthropic';

// 尝试从 .env 文件读取
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
} catch {}

function getKey() { return process.env.AI_API_KEY || AI_API_KEY; }
function getBase() { return (process.env.AI_API_BASE || AI_API_BASE).replace(/\/+$/, ''); }
function getModel() { return process.env.AI_MODEL || AI_MODEL; }
function getFormat() { return process.env.AI_API_FORMAT || AI_API_FORMAT; }

// 简单频率限制
const rateMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  let e = rateMap.get(ip);
  if (!e || now - e.start > 60000) { rateMap.set(ip, { start: now, count: 1 }); return false; }
  return ++e.count > 10;
}

// MIME types
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // AI Proxy
  if (req.url === '/api/ai-proxy' && req.method === 'POST') {
    return handleAIProxy(req, res);
  }

  // 静态文件服务
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

async function handleAIProxy(req, res) {
  const ip = req.socket.remoteAddress || '';
  if (isRateLimited(ip)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limited' }));
    return;
  }

  const apiKey = getKey();
  if (!apiKey) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'AI_API_KEY not set. Create .env file with AI_API_KEY=sk-ant-...' }));
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;
  let parsed;
  try { parsed = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const { system, messages, max_tokens, stream } = parsed;
  if (!messages || !messages.length) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'messages required' }));
    return;
  }

  const safeMaxTokens = Math.min(max_tokens || 1000, 4096);
  const apiBase = getBase();
  const model = getModel();
  const fmt = getFormat();

  try {
    let upstreamUrl, headers, payload;

    if (fmt === 'anthropic') {
      upstreamUrl = apiBase + '/v1/messages';
      headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'Authorization': 'Bearer ' + apiKey, 'anthropic-version': '2023-06-01' };
      payload = { model, max_tokens: safeMaxTokens, stream: !!stream, messages };
      if (system) payload.system = system;
    } else {
      upstreamUrl = apiBase + '/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
      const oaiMessages = [];
      if (system) oaiMessages.push({ role: 'system', content: system });
      oaiMessages.push(...messages);
      payload = { model, max_tokens: safeMaxTokens, stream: !!stream, temperature: 0.9, messages: oaiMessages };
    }

    const upstream = await fetch(upstreamUrl, { method: 'POST', headers, body: JSON.stringify(payload) });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      console.error('Upstream error:', upstream.status, errText);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AI error: ' + upstream.status }));
      return;
    }

    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      const reader = upstream.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          res.write(value);
        }
      };
      pump().catch(() => res.end());
    } else {
      const data = await upstream.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    }
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error' }));
  }
}

server.listen(PORT, () => {
  console.log(`\n  Three Kingdoms server running at http://localhost:${PORT}\n`);
  if (!getKey()) console.log('  WARNING: AI_API_KEY not set! Create .env file:\n  AI_API_KEY=sk-ant-xxx\n');
  else console.log('  AI proxy ready (model: ' + getModel() + ')\n');
});
