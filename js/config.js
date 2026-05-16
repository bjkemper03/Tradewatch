// =============================================================================
// js/config.js -- App constants, default settings, strategy definitions, and state.
// Loads before feature modules so plain-script globals are available everywhere.
// =============================================================================

const SUPA_URL = 'https://mvohmjzwdvjilvljbivg.supabase.co';
const SUPA_KEY = 'sb_publishable_yqEE2eE9r2iTOnzh43nA5A_hJLnxYeT';
const SUPA_SYNC_HOSTS = [
  'localhost',
  '127.0.0.1',
  'optionsplus.io',
  'www.optionsplus.io',
  'tradewatch.vercel.app',
  'tradewatch-git-dev-trade-analysis-overview-ben-kemper-s-projects.vercel.app'
];

const API = { market:'/api/market', quote:'/api/quote', earnings:'/api/earnings', analyze:'/api/analyze' };
const CK = { mkt:'op_mkt_v2', sec:'op_sec_v2', earn:'op_earn_v2_', lp:'op_lp_v2_', prefs:'op_prefs_v2' };
const TTL = { mkt:4*3600000, sec:4*3600000, earn:12*3600000, lp:15*60000 };
const TK = 'op_trades_v2', HK = 'op_hist_v2';
// UI convenience only. Real admin authorization must happen server-side.
const ADMIN_EMAILS = ['benkemper751@gmail.com', 'bjkemper03@gmail.com'];

const DEFAULT_PREFS = {
  displayName:'Trader', primaryStrategy:'credit',
  dteLow:14, dteHigh:21, deltaLow:0.18, deltaHigh:0.28,
  cushionMin:5, creditWidthMin:8, maxRiskPerTrade:500, startingAccountSize:10000, accountSize:10000, marketNote:''
};
const DEFAULT_HIST = { totalTrades:0, wins:0, losses:0, breakeven:0, realizedPnl:0, winPct:null, avgWinPct:null, avgLossPct:null, profitFactor:null, baselinePeriodValue:1, baselinePeriodUnit:'years' };

let _sbClient = null;
let currentUser = null;

let trades = [], hist = {...DEFAULT_HIST}, prefs = {...DEFAULT_PREFS};
let azLegData = [], azStrat = 'PUT CREDIT SPREAD', azResult = null;
let formLegData = [], formStrat = 'PUT CREDIT SPREAD';
let selectedTags = [], showHistory = false, livePrices = {}, tradesTab = 'All', tradesExpanded = false;

const STRAT_GROUPS = {
  'CREDIT':['PUT CREDIT SPREAD','CALL CREDIT SPREAD','CASH SECURED PUT','COVERED CALL','IRON CONDOR','PUT RATIO SPREAD','CALL RATIO SPREAD'],
  'DEBIT': ['PUT DEBIT SPREAD','CALL DEBIT SPREAD','LONG PUT','LONG CALL','PUT BUTTERFLY','CALL BUTTERFLY','IRON BUTTERFLY'],
  'CUSTOM':['CUSTOM']
};
const ALL_STRATS = [...STRAT_GROUPS.CREDIT,...STRAT_GROUPS.DEBIT,...STRAT_GROUPS.CUSTOM];
const DEF = {
  'PUT CREDIT SPREAD': [{a:'SELL',t:'PUT',n:1,s:''},{a:'BUY',t:'PUT',n:1,s:''}],
  'CALL CREDIT SPREAD':[{a:'SELL',t:'CALL',n:1,s:''},{a:'BUY',t:'CALL',n:1,s:''}],
  'CASH SECURED PUT':  [{a:'SELL',t:'PUT',n:1,s:''}],
  'COVERED CALL':      [{a:'SELL',t:'CALL',n:1,s:''}],
  'IRON CONDOR':       [{a:'SELL',t:'PUT',n:1,s:''},{a:'BUY',t:'PUT',n:1,s:''},{a:'SELL',t:'CALL',n:1,s:''},{a:'BUY',t:'CALL',n:1,s:''}],
  'PUT RATIO SPREAD':  [{a:'SELL',t:'PUT',n:2,s:''},{a:'BUY',t:'PUT',n:1,s:''}],
  'CALL RATIO SPREAD': [{a:'SELL',t:'CALL',n:2,s:''},{a:'BUY',t:'CALL',n:1,s:''}],
  'PUT DEBIT SPREAD':  [{a:'BUY',t:'PUT',n:1,s:''},{a:'SELL',t:'PUT',n:1,s:''}],
  'CALL DEBIT SPREAD': [{a:'BUY',t:'CALL',n:1,s:''},{a:'SELL',t:'CALL',n:1,s:''}],
  'LONG PUT':          [{a:'BUY',t:'PUT',n:1,s:''}],
  'LONG CALL':         [{a:'BUY',t:'CALL',n:1,s:''}],
  'PUT BUTTERFLY':     [{a:'BUY',t:'PUT',n:1,s:''},{a:'SELL',t:'PUT',n:2,s:''},{a:'BUY',t:'PUT',n:1,s:''}],
  'CALL BUTTERFLY':    [{a:'BUY',t:'CALL',n:1,s:''},{a:'SELL',t:'CALL',n:2,s:''},{a:'BUY',t:'CALL',n:1,s:''}],
  'IRON BUTTERFLY':    [{a:'SELL',t:'PUT',n:1,s:''},{a:'BUY',t:'PUT',n:1,s:''},{a:'SELL',t:'CALL',n:1,s:''},{a:'BUY',t:'CALL',n:1,s:''}],
  'CUSTOM':            [{a:'BUY',t:'PUT',n:1,s:''}]
};
const TRADE_TAGS = ['GOOD SETUP','HIGH IV','EARNINGS RISK','SUPPORT BOUNCE','FOMO','RED DAY ENTRY','HEDGE','BWB INCOME','WEEKLY','ASSIGNMENT RISK'];
const TICKER_SECTOR = {
  NVDA:'Semiconductors',AMD:'Semiconductors',INTC:'Semiconductors',SOXX:'Semiconductors',
  AAPL:'Technology',MSFT:'Technology',GOOGL:'Technology',META:'Comm. Services',
  SNOW:'Technology',RBLX:'Comm. Services',PLTR:'Technology',HOOD:'Financials',
  F:'Consumer Disc.',GM:'Consumer Disc.',TSLA:'Consumer Disc.',
  CVX:'Energy',XOM:'Energy',EPD:'Energy',JPM:'Financials',BAC:'Financials',
  UNH:'Healthcare',CYTK:'Healthcare',AMZN:'Consumer Disc.',EBAY:'Consumer Disc.',
  SPY:'S&P 500',QQQ:'Nasdaq',
};
