export const config = { runtime: 'edge' };

// Upstash REST API helpers (no SDK dependency)
const REDIS_URL = () => process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisCmd(...args) {
  const resp = await fetch(REDIS_URL(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!resp.ok) throw new Error(`Redis ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  if (data.error) throw new Error(`Redis error: ${data.error}`);
  return data.result;
}

async function redisPipeline(cmds) {
  const resp = await fetch(`${REDIS_URL()}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!resp.ok) throw new Error(`Redis pipeline ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.map(r => {
    if (r.error) throw new Error(`Redis pipeline error: ${r.error}`);
    return r.result;
  });
}

// HGETALL returns flat array → convert to object
function flatToObj(arr) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return null;
  const obj = {};
  for (let i = 0; i < arr.length; i += 2) obj[arr[i]] = arr[i + 1];
  return obj;
}

// Object → flat args for HSET: [key, f1, v1, f2, v2, ...]
function objToHsetArgs(key, obj) {
  const args = ['HSET', key];
  for (const [k, v] of Object.entries(obj)) args.push(k, String(v));
  return args;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MODE_MAP = { quick: 'quick', tournament: 'tourn', pvp: 'pvp' };
const MAX_MARGIN = 80;
const NICKNAME_RE = /^[\u4e00-\u9fffa-zA-Z0-9_\-\s]{2,12}$/;
const RATE_LIMIT_SEC = 20;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// GET: leaderboard or player detail
async function handleGet(url) {
  const playerName = url.searchParams.get('player');
  if (playerName) return getPlayerDetail(playerName);

  const mode = url.searchParams.get('mode') || 'total';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  return getLeaderboard(mode, limit);
}

async function getLeaderboard(mode, limit) {
  const validModes = ['total', 'quick', 'tourn', 'pvp', 'streak'];
  if (!validModes.includes(mode)) return json({ error: 'Invalid mode' }, 400);

  const key = mode === 'streak' ? 'lb:streak' : `lb:${mode}`;

  // Get top players with scores (descending) + total count
  const [results, totalPlayers] = await redisPipeline([
    ['ZRANGE', key, '0', String(limit - 1), 'REV', 'WITHSCORES'],
    ['ZCARD', 'lb:total'],
  ]);

  // results is [member, score, member, score, ...]
  const entries = [];
  for (let i = 0; i < results.length; i += 2) {
    entries.push({ name: results[i], score: Number(results[i + 1]) });
  }

  // Fetch details for each player via pipeline
  if (entries.length === 0) return json({ leaderboard: [], total_players: totalPlayers || 0 });

  const detailCmds = entries.map(e => ['HGETALL', `player:${e.name.toLowerCase()}`]);
  const detailResults = await redisPipeline(detailCmds);

  const leaderboard = entries.map((entry, idx) => {
    const data = flatToObj(detailResults[idx]);
    if (!data) return null;

    const modeKey = mode === 'total' ? '' : mode === 'streak' ? '' : mode;
    const games = mode === 'total' || mode === 'streak'
      ? Number(data.total_games || 0)
      : Number(data[`${modeKey}_games`] || 0);
    const wins = mode === 'total' || mode === 'streak'
      ? Number(data.total_wins || 0)
      : Number(data[`${modeKey}_wins`] || 0);

    return {
      rank: idx + 1,
      name: data.display_name || entry.name,
      score: entry.score,
      wins,
      games,
      winRate: games > 0 ? `${Math.round((wins / games) * 100)}%` : '0%',
      maxMargin: mode === 'total' || mode === 'streak'
        ? Math.max(Number(data.quick_max_margin || 0), Number(data.tourn_max_margin || 0), Number(data.pvp_max_margin || 0))
        : Number(data[`${modeKey}_max_margin`] || 0),
      maxStreak: Number(data.max_win_streak || 0),
    };
  });

  return json({ leaderboard: leaderboard.filter(Boolean), total_players: totalPlayers || 0 });
}

async function getPlayerDetail(name) {
  const raw = await redisCmd('HGETALL', `player:${name.toLowerCase()}`);
  const data = flatToObj(raw);
  if (!data) return json({ error: 'Player not found' }, 404);

  const nameLower = name.toLowerCase();
  const ranks = await redisPipeline([
    ['ZREVRANK', 'lb:total', nameLower],
    ['ZREVRANK', 'lb:quick', nameLower],
    ['ZREVRANK', 'lb:tourn', nameLower],
    ['ZREVRANK', 'lb:pvp', nameLower],
    ['ZREVRANK', 'lb:streak', nameLower],
  ]);

  return json({
    ...data,
    ranks: {
      total: ranks[0] !== null ? ranks[0] + 1 : null,
      quick: ranks[1] !== null ? ranks[1] + 1 : null,
      tourn: ranks[2] !== null ? ranks[2] + 1 : null,
      pvp: ranks[3] !== null ? ranks[3] + 1 : null,
      streak: ranks[4] !== null ? ranks[4] + 1 : null,
    },
  });
}

// POST: submit game result
async function handlePost(req) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { nickname, mode, won, margin, timestamp } = body;

  if (!nickname || !NICKNAME_RE.test(nickname.trim())) return json({ error: 'Invalid nickname (2-12 chars)' }, 400);
  const modeKey = MODE_MAP[mode];
  if (!modeKey) return json({ error: 'Invalid mode (quick/tournament/pvp)' }, 400);
  if (typeof margin !== 'number' || Math.abs(margin) > MAX_MARGIN) return json({ error: 'Invalid margin' }, 400);

  const cleanName = nickname.trim();
  const playerKey = `player:${cleanName.toLowerCase()}`;
  const nameLower = cleanName.toLowerCase();

  // Rate limit check
  const lastSubmit = await redisCmd('GET', `rl:${nameLower}`);
  if (lastSubmit) return json({ error: 'Too fast, wait a moment' }, 429);

  // Set rate limit + get existing player data
  const [, existingRaw] = await redisPipeline([
    ['SET', `rl:${nameLower}`, '1', 'EX', String(RATE_LIMIT_SEC)],
    ['HGETALL', playerKey],
  ]);
  const existing = flatToObj(existingRaw) || {};

  const data = {
    display_name: cleanName,
    total_games: Number(existing.total_games || 0) + 1,
    total_wins: Number(existing.total_wins || 0) + (won ? 1 : 0),
    quick_games: Number(existing.quick_games || 0),
    quick_wins: Number(existing.quick_wins || 0),
    quick_max_margin: Number(existing.quick_max_margin || 0),
    tourn_games: Number(existing.tourn_games || 0),
    tourn_wins: Number(existing.tourn_wins || 0),
    tourn_max_margin: Number(existing.tourn_max_margin || 0),
    pvp_games: Number(existing.pvp_games || 0),
    pvp_wins: Number(existing.pvp_wins || 0),
    pvp_max_margin: Number(existing.pvp_max_margin || 0),
    max_win_streak: Number(existing.max_win_streak || 0),
    current_streak: Number(existing.current_streak || 0),
    last_played: timestamp || Date.now(),
  };

  // Update mode-specific stats
  data[`${modeKey}_games`] = Number(existing[`${modeKey}_games`] || 0) + 1;
  if (won) {
    data[`${modeKey}_wins`] = Number(existing[`${modeKey}_wins`] || 0) + 1;
    if (margin > Number(existing[`${modeKey}_max_margin`] || 0)) {
      data[`${modeKey}_max_margin`] = margin;
    }
    data.current_streak = Number(existing.current_streak || 0) + 1;
    if (data.current_streak > data.max_win_streak) {
      data.max_win_streak = data.current_streak;
    }
  } else {
    data.current_streak = 0;
  }

  // Write player hash + update leaderboards
  await redisPipeline([
    objToHsetArgs(playerKey, data),
    ['ZADD', 'lb:total', String(data.total_wins), nameLower],
    ['ZADD', `lb:${modeKey}`, String(data[`${modeKey}_wins`]), nameLower],
    ['ZADD', 'lb:streak', String(data.max_win_streak), nameLower],
  ]);

  // Get current ranks
  const [totalRank, modeRank] = await redisPipeline([
    ['ZREVRANK', 'lb:total', nameLower],
    ['ZREVRANK', `lb:${modeKey}`, nameLower],
  ]);

  return json({
    ok: true,
    rank: {
      total: totalRank !== null ? totalRank + 1 : null,
      mode: modeRank !== null ? modeRank + 1 : null,
    },
    streak: data.current_streak,
    maxStreak: data.max_win_streak,
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url, `https://${req.headers.get('host')}`);
    if (req.method === 'GET') return handleGet(url);
    if (req.method === 'POST') return handlePost(req);
    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('Hall of Fame API error:', err);
    return json({ error: 'Internal server error', detail: err.message }, 500);
  }
}
