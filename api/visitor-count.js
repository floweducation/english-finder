const TIME_ZONE = 'Asia/Seoul';
const COUNTER_PREFIX = 'english-finder:visitors';

const getRedisConfig = () => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  return {
    url: url.replace(/\/+$/, ''),
    token,
  };
};

const getKoreanDateKey = (dayOffset = 0) => {
  const date = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

const toNumber = (value) => {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const parseRequestBody = (body) => {
  if (typeof body !== 'string') {
    return body;
  }

  try {
    return JSON.parse(body || '{}');
  } catch {
    return {};
  }
};

const runRedisPipeline = async (commands) => {
  const config = getRedisConfig();

  if (!config) {
    return null;
  }

  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !Array.isArray(payload)) {
    const message = payload?.error || `Upstash request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload.map((item) => item?.result ?? 0);
};

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const todayKey = getKoreanDateKey(0);
  const yesterdayKey = getKoreanDateKey(-1);
  const totalCounterKey = `${COUNTER_PREFIX}:total`;
  const todayCounterKey = `${COUNTER_PREFIX}:day:${todayKey}`;
  const yesterdayCounterKey = `${COUNTER_PREFIX}:day:${yesterdayKey}`;
  const body = parseRequestBody(req.body);
  const shouldCountVisit = req.method === 'POST' && body?.countVisit === true;

  try {
    const commands = shouldCountVisit
      ? [
          ['INCR', totalCounterKey],
          ['INCR', todayCounterKey],
          ['GET', yesterdayCounterKey],
        ]
      : [
          ['GET', totalCounterKey],
          ['GET', todayCounterKey],
          ['GET', yesterdayCounterKey],
        ];

    const results = await runRedisPipeline(commands);

    res.setHeader('Cache-Control', 'no-store');

    if (!results) {
      return res.status(200).json({
        enabled: false,
        total: 0,
        today: 0,
        yesterday: 0,
        timezone: TIME_ZONE,
        updatedAt: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      enabled: true,
      total: toNumber(results[0]),
      today: toNumber(results[1]),
      yesterday: toNumber(results[2]),
      timezone: TIME_ZONE,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('visitor-count error:', error);
    return res.status(500).json({
      error: '방문자 수를 불러오지 못했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
