import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

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
  if (playerName) {
    return getPlayerDetail(playerName);
  }
  const mode = url.searchParams.get('mode') || 'total';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  return getLeaderboard(mode, limit);
}

async function getLeaderboard(mode, limit) {
  const validModes = ['total', 'quick', 'tourn', 'pvp', 'streak'];
  if (!validModes.includes(mode)) {
    return json({ error: 'Invalid mode' }, 400);
  }

  const key = mode === 'streak' ? 'lb:streak' : `lb:${mode}`;

  // Get top players with scores (descending)
  const results = await kv.zrange(key, 0, limit - 1, { rev: true, withScores: true });

  // results is [member, score, member, score, ...]
  const entries = [];
  for (let i = 0; i < results.length; i += 2) {
    entries.push({ name: results[i], score: results[i + 1] });
  }

  // Fetch details for each player
  const leaderboard = await Promise.all(
    entries.map(async (entry, idx) => {
      const data = await kv.hgetall(`player:${entry.name.toLowerCase()}`);
      if (!data) return null;

      const modeKey = mode === 'total' ? '' : mode === 'streak' ? '' : mode;
      const games = mode === 'total' || mode === 'streak'
        ? (data.total_games || 0)
        : (data[`${modeKey}_games`] || 0);
      const wins = mode === 'total' || mode === 'streak'
        ? (data.total_wins || 0)
        : (data[`${modeKey}_wins`] || 0);

      return {
        rank: idx + 1,
        name: data.display_name || entry.name,
        score: entry.score,
        wins,
        games,
        winRate: games > 0 ? `${Math.round((wins / games) * 100)}%` : '0%',
        maxMargin: mode === 'total' || mode === 'streak'
          ? Math.max(data.quick_max_margin || 0, data.tourn_max_margin || 0, data.pvp_max_margin || 0)
          : (data[`${modeKey}_max_margin`] || 0),
        maxStreak: data.max_win_streak || 0,
      };
    })
  );

  const totalPlayers = await kv.zcard('lb:total');

  return json({
    leaderboard: leaderboard.filter(Boolean),
    total_players: totalPlayers || 0,
  });
}

async function getPlayerDetail(name) {
  const key = `player:${name.toLowerCase()}`;
  const data = await kv.hgetall(key);
  if (!data) {
    return json({ error: 'Player not found' }, 404);
  }

  // Get ranks across all leaderboards
  const [totalRank, quickRank, tournRank, pvpRank, streakRank] = await Promise.all([
    kv.zrevrank('lb:total', name.toLowerCase()),
    kv.zrevrank('lb:quick', name.toLowerCase()),
    kv.zrevrank('lb:tourn', name.toLowerCase()),
    kv.zrevrank('lb:pvp', name.toLowerCase()),
    kv.zrevrank('lb:streak', name.toLowerCase()),
  ]);

  return json({
    ...data,
    ranks: {
      total: totalRank !== null ? totalRank + 1 : null,
      quick: quickRank !== null ? quickRank + 1 : null,
      tourn: tournRank !== null ? tournRank + 1 : null,
      pvp: pvpRank !== null ? pvpRank + 1 : null,
      streak: streakRank !== null ? streakRank + 1 : null,
    },
  });
}

// POST: submit game result
async function handlePost(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { nickname, mode, won, margin, timestamp } = body;

  // Validate nickname
  if (!nickname || !NICKNAME_RE.test(nickname.trim())) {
    return json({ error: 'Invalid nickname (2-12 chars, letters/digits/CJK)' }, 400);
  }

  // Validate mode
  const modeKey = MODE_MAP[mode];
  if (!modeKey) {
    return json({ error: 'Invalid mode (quick/tournament/pvp)' }, 400);
  }

  // Validate margin
  if (typeof margin !== 'number' || Math.abs(margin) > MAX_MARGIN) {
    return json({ error: 'Invalid margin' }, 400);
  }

  const cleanName = nickname.trim();
  const playerKey = `player:${cleanName.toLowerCase()}`;

  // Rate limit check
  const rlKey = `rl:${cleanName.toLowerCase()}`;
  const lastSubmit = await kv.get(rlKey);
  if (lastSubmit) {
    return json({ error: 'Too fast, wait a moment' }, 429);
  }
  await kv.set(rlKey, 1, { ex: RATE_LIMIT_SEC });

  // Get or init player data
  const existing = (await kv.hgetall(playerKey)) || {};
  const data = {
    display_name: cleanName,
    total_games: (existing.total_games || 0) + 1,
    total_wins: (existing.total_wins || 0) + (won ? 1 : 0),
    quick_games: existing.quick_games || 0,
    quick_wins: existing.quick_wins || 0,
    quick_max_margin: existing.quick_max_margin || 0,
    tourn_games: existing.tourn_games || 0,
    tourn_wins: existing.tourn_wins || 0,
    tourn_max_margin: existing.tourn_max_margin || 0,
    pvp_games: existing.pvp_games || 0,
    pvp_wins: existing.pvp_wins || 0,
    pvp_max_margin: existing.pvp_max_margin || 0,
    max_win_streak: existing.max_win_streak || 0,
    current_streak: existing.current_streak || 0,
    last_played: timestamp || Date.now(),
  };

  // Update mode-specific stats
  data[`${modeKey}_games`] = (existing[`${modeKey}_games`] || 0) + 1;
  if (won) {
    data[`${modeKey}_wins`] = (existing[`${modeKey}_wins`] || 0) + 1;
    if (margin > (existing[`${modeKey}_max_margin`] || 0)) {
      data[`${modeKey}_max_margin`] = margin;
    }
    data.current_streak = (existing.current_streak || 0) + 1;
    if (data.current_streak > data.max_win_streak) {
      data.max_win_streak = data.current_streak;
    }
  } else {
    data.current_streak = 0;
  }

  // Write player hash
  await kv.hset(playerKey, data);

  // Update leaderboards
  const nameLower = cleanName.toLowerCase();
  await Promise.all([
    kv.zadd('lb:total', { score: data.total_wins, member: nameLower }),
    kv.zadd(`lb:${modeKey}`, { score: data[`${modeKey}_wins`], member: nameLower }),
    kv.zadd('lb:streak', { score: data.max_win_streak, member: nameLower }),
  ]);

  // Get current ranks
  const [totalRank, modeRank] = await Promise.all([
    kv.zrevrank('lb:total', nameLower),
    kv.zrevrank(`lb:${modeKey}`, nameLower),
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
    return json({ error: 'Internal server error' }, 500);
  }
}
