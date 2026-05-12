// =============================================================================
// config.js -- OptionsPlus configuration
// All API calls go through /api/* routes -- keys live in Vercel env vars only
// =============================================================================

const CONFIG = {
  // Backend API routes (Vercel serverless functions)
  API: {
    market:   '/api/market',
    quote:    '/api/quote',
    earnings: '/api/earnings',
    analyze:  '/api/analyze',
    options:  '/api/options',
  },

  // Supabase (anon key is safe in frontend -- RLS policies enforce security)
  SUPABASE_URL: 'https://mvohmjzwdvjilvljbivg.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_yqEE2eE9r2iTOnzh43nA5A_hJLnxYeT',

  // Cache TTLs (milliseconds)
  TTL: {
    market:   4 * 60 * 60 * 1000,   // 4 hours
    sectors:  4 * 60 * 60 * 1000,   // 4 hours
    earnings: 12 * 60 * 60 * 1000,  // 12 hours
    quote:    15 * 60 * 1000,        // 15 minutes
  },

  // Cache keys
  CK: {
    market:  'op_mkt_v1',
    sectors: 'op_sec_v1',
    earnings: 'op_earn_v1_',   // append ticker
    quote:   'op_quote_v1_',   // append ticker
    prefs:   'op_prefs_v1',
    session: 'op_session_v1',
  },

  // App metadata
  APP_NAME: 'OptionsPlus',
  VERSION: '1.0.0-beta',
};

// Default user preferences
const DEFAULT_PREFS = {
  userId:          null,
  displayName:     'Trader',
  primaryStrategy: 'credit',
  dteLow:          14,
  dteHigh:         21,
  deltaLow:        0.18,
  deltaHigh:       0.28,
  cushionMin:      5,
  creditWidthMin:  8,
  maxRiskPerTrade: 500,
  startingAccountSize: 10000,
  accountSize:     10000,
  marketNote:      '',
};

// Historical baseline (seeded -- user can edit in prefs)
const DEFAULT_HIST = {
  totalTrades:  0,
  wins:         0,
  losses:       0,
  breakeven:    0,
  realizedPnl:  0,
  winPct:       null,
  avgWinPct:    null,
  avgLossPct:   null,
  profitFactor: null,
  baselinePeriodValue: 1,
  baselinePeriodUnit: 'years',
};

// Strategy definitions
const STRAT_GROUPS = {
  'CREDIT': [
    'PUT CREDIT SPREAD', 'CALL CREDIT SPREAD', 'CASH SECURED PUT',
    'COVERED CALL', 'IRON CONDOR', 'PUT RATIO SPREAD', 'CALL RATIO SPREAD'
  ],
  'DEBIT': [
    'PUT DEBIT SPREAD', 'CALL DEBIT SPREAD', 'LONG PUT', 'LONG CALL',
    'PUT BUTTERFLY', 'CALL BUTTERFLY', 'IRON BUTTERFLY'
  ],
  'CUSTOM': ['CUSTOM'],
};
const ALL_STRATS = [...STRAT_GROUPS.CREDIT, ...STRAT_GROUPS.DEBIT, ...STRAT_GROUPS.CUSTOM];

// Default legs per strategy
const DEF_LEGS = {
  'PUT CREDIT SPREAD':  [{a:'SELL',t:'PUT',n:1,s:''},{a:'BUY',t:'PUT',n:1,s:''}],
  'CALL CREDIT SPREAD': [{a:'SELL',t:'CALL',n:1,s:''},{a:'BUY',t:'CALL',n:1,s:''}],
  'CASH SECURED PUT':   [{a:'SELL',t:'PUT',n:1,s:''}],
  'COVERED CALL':       [{a:'SELL',t:'CALL',n:1,s:''}],
  'IRON CONDOR':        [{a:'SELL',t:'PUT',n:1,s:''},{a:'BUY',t:'PUT',n:1,s:''},{a:'SELL',t:'CALL',n:1,s:''},{a:'BUY',t:'CALL',n:1,s:''}],
  'PUT RATIO SPREAD':   [{a:'SELL',t:'PUT',n:2,s:''},{a:'BUY',t:'PUT',n:1,s:''}],
  'CALL RATIO SPREAD':  [{a:'SELL',t:'CALL',n:2,s:''},{a:'BUY',t:'CALL',n:1,s:''}],
  'PUT DEBIT SPREAD':   [{a:'BUY',t:'PUT',n:1,s:''},{a:'SELL',t:'PUT',n:1,s:''}],
  'CALL DEBIT SPREAD':  [{a:'BUY',t:'CALL',n:1,s:''},{a:'SELL',t:'CALL',n:1,s:''}],
  'LONG PUT':           [{a:'BUY',t:'PUT',n:1,s:''}],
  'LONG CALL':          [{a:'BUY',t:'CALL',n:1,s:''}],
  'PUT BUTTERFLY':      [{a:'BUY',t:'PUT',n:1,s:''},{a:'SELL',t:'PUT',n:2,s:''},{a:'BUY',t:'PUT',n:1,s:''}],
  'CALL BUTTERFLY':     [{a:'BUY',t:'CALL',n:1,s:''},{a:'SELL',t:'CALL',n:2,s:''},{a:'BUY',t:'CALL',n:1,s:''}],
  'IRON BUTTERFLY':     [{a:'SELL',t:'PUT',n:1,s:''},{a:'BUY',t:'PUT',n:1,s:''},{a:'SELL',t:'CALL',n:1,s:''},{a:'BUY',t:'CALL',n:1,s:''}],
  'CUSTOM':             [{a:'BUY',t:'PUT',n:1,s:''}],
};

// Sector metadata
const SEC_META = [
  {sym:'XLK', name:'Technology',     top3:'AAPL, MSFT, NVDA',  note:'High IV -- best premium environment. Rate and earnings sensitive.'},
  {sym:'SOXX',name:'Semiconductors', top3:'NVDA, AVGO, AMD',   note:'Highest vol in your universe. Best premium but most gap risk.'},
  {sym:'XLC', name:'Comm. Services', top3:'META, GOOGL, NFLX', note:'META in portfolio. SNOW and RBLX trade here. High IV around earnings.'},
  {sym:'XLF', name:'Financials',     top3:'JPM, BAC, GS',      note:'HOOD in history. Rate-sensitive -- avoid within 5 days of FOMC.'},
  {sym:'XLE', name:'Energy',         top3:'XOM, CVX, COP',     note:'CVX and EPD in portfolio. Moves with oil. Cleaner trends, lower IV.'},
  {sym:'XLV', name:'Healthcare',     top3:'UNH, JNJ, LLY',     note:'CYTK in history. Biotech can gap 20%+ on trial data.'},
  {sym:'XLY', name:'Consumer Disc.', top3:'AMZN, TSLA, HD',    note:'EBAY in history. Watches consumer spending and tariff news.'},
  {sym:'XLI', name:'Industrials',    top3:'GE, CAT, HON',      note:'Steady mover. Lower IV -- good for conservative CSPs.'},
];

// Ticker to sector mapping
const TICKER_SECTOR = {
  NVDA:'Semiconductors', AMD:'Semiconductors', INTC:'Semiconductors', SOXX:'Semiconductors',
  AAPL:'Technology', MSFT:'Technology', GOOGL:'Technology', SNOW:'Technology', PLTR:'Technology',
  META:'Comm. Services', RBLX:'Comm. Services',
  HOOD:'Financials', JPM:'Financials', BAC:'Financials', GS:'Financials',
  F:'Consumer Disc.', GM:'Consumer Disc.', TSLA:'Consumer Disc.', EBAY:'Consumer Disc.',
  CVX:'Energy', XOM:'Energy', EPD:'Energy',
  UNH:'Healthcare', CYTK:'Healthcare',
  SPY:'S&P 500', QQQ:'Nasdaq',
};

// Journal tags
const TRADE_TAGS = [
  'GOOD SETUP', 'HIGH IV', 'EARNINGS RISK', 'SUPPORT BOUNCE',
  'FOMO', 'RED DAY ENTRY', 'HEDGE', 'BWB INCOME', 'WEEKLY', 'ASSIGNMENT RISK'
];
