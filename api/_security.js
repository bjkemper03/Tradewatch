const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.optionsplus.app',
  'https://optionsplus.app',
];
const RATE_BUCKETS = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;

function configuredOrigins() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export function allowedOrigin(req) {
  const origin = req.headers?.origin || '';
  if (!origin) return '';
  const allowList = configuredOrigins().concat(DEFAULT_ALLOWED_ORIGINS);
  if (allowList.includes(origin)) return origin;
  if (/^https:\/\/tradewatch-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  if (/^https:\/\/.*-bjkemper03s-projects\.vercel\.app$/i.test(origin)) return origin;
  return '';
}

export function applyApiHeaders(req, res, methods) {
  const origin = allowedOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods.join(','));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store');
}

export function handleOptions(req, res, methods) {
  applyApiHeaders(req, res, methods.concat('OPTIONS'));
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function cleanTicker(raw) {
  const ticker = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) return null;
  return ticker;
}

export function checkRateLimit(req, res, options = {}) {
  const limit = options.limit || RATE_LIMIT_MAX;
  const windowMs = options.windowMs || RATE_LIMIT_WINDOW_MS;
  const now = Date.now();
  const ip = String(
    req.headers?.['x-forwarded-for'] ||
    req.headers?.['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  ).split(',')[0].trim();
  const key = `${options.key || 'api'}:${ip}`;
  const bucket = RATE_BUCKETS.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  RATE_BUCKETS.set(key, bucket);

  if (RATE_BUCKETS.size > 10000) {
    for (const [k, v] of RATE_BUCKETS.entries()) {
      if (now > v.resetAt) RATE_BUCKETS.delete(k);
    }
  }

  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
  res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > limit) {
    res.status(429).json({ ok: false, error: 'Too many requests. Please wait a minute and try again.' });
    return false;
  }
  return true;
}
