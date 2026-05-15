const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.optionsplus.app',
  'https://optionsplus.app',
];

function configuredOrigins() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export function allowedOrigin(req) {
  const origin = req.headers.origin || '';
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
