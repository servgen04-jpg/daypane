import { getWorkbuddy } from './providers/workbuddy.js';
import { getClaudeCodeUsage } from './providers/claudecode.js';
import { getCodexUsage } from './providers/codex.js';
import { getWeather } from './providers/weather.js';
import { getCalendar } from './providers/calendar.js';
import { getStocks } from './providers/stocks.js';
import { getClocks } from './providers/clocks.js';
import { getFx } from './providers/fx.js';
import { getNews } from './providers/news.js';
import { getMlb } from './providers/mlb.js';
import { getReported } from './reported.js';
import { getConfig } from './config.js';

// 一个数据源炸掉，不能让整块看板变空白。
// 以前所有 provider 直接塞进 Promise.all —— 只要其中一个抛异常（比如 config.json
// 里写了个非法时区、新闻源返回畸形 XML），整个 /api/dashboard 就 500，
// Kindle 只能退回旧缓存。这里把每个源单独兜住，返回一个形状一致的失败体。
function failed(name, error) {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: name + ': ' + message, items: [] };
}

function guard(name, fn) {
  try {
    const value = fn();
    if (value && typeof value.then === 'function') {
      return Promise.resolve(value).catch((e) => failed(name, e));
    }
    return value == null ? failed(name, 'empty result') : value;
  } catch (e) {
    return failed(name, e);
  }
}

// local 模式：直接读本机 DB 与本地日志。
function quotasLocal(db) {
  return {
    workbuddy: guard('workbuddy', () => getWorkbuddy(db)),
    claudecode: guard('claudecode', getClaudeCodeUsage),
    codex: guard('codex', getCodexUsage)
  };
}

// cloud 模式：没有本地 DB，用本机上报器推上来的 data/quotas.json。
// stale 时打上标记，看板会显示"电脑离线"而不是假装数据新鲜。
function quotasCloud(reported) {
  const wrap = (v) => {
    if (!v) {
      return { ok: false, error: 'no report', unit: '', used: null, cap: null, remaining: null, percent: 0, stale: true };
    }
    return { ...v, stale: reported.stale };
  };
  return {
    workbuddy: wrap(reported.quotas && reported.quotas.workbuddy),
    claudecode: wrap(reported.quotas && reported.quotas.claudecode),
    codex: wrap(reported.quotas && reported.quotas.codex)
  };
}

// Aggregate every section into a single dashboard payload.
// Network calls run concurrently; local calls are synchronous.
export async function buildDashboard(db) {
  const cfg = getConfig();
  const cloud = cfg.mode === 'cloud';

  const [weather, stocks, fx, news, mlb, newsEn, calendar] = await Promise.all([
  guard('weather', getWeather),
  guard('stocks', getStocks),
  guard('fx', getFx),
  guard('news', () => getNews()),
  guard('mlb', getMlb),
  guard('news-en', () => getNews('en')),
  guard('calendar', getCalendar)
]);

  // cloud 模式只解析一次上报文件：以前这里读一次、quotasCloud 里再读一次，
  // 两次读到不同快照时 pcOnline 和 quotas.fetchedAt 会对不上。
  const reported = cloud ? guard('reported', getReported) : null;
  const now = Date.now();

  // 额度的"刷新时间"：local 模式是从本机 DB 现读的（=此刻），
  // cloud 模式是本机上报器最后一次推送上来的时间。
  const quotas = cloud ? quotasCloud(reported) : quotasLocal(db);

  return {
    ok: true,
    serverTime: now,
    mode: cloud ? 'cloud' : 'local',
    // 电脑是否还"活着"：local 模式永远在线；cloud 模式看上报是否新鲜
    pcOnline: cloud ? !!(reported && reported.ok && !reported.stale) : true,
    quotas: { ...quotas, fetchedAt: cloud ? (reported && reported.ts) || null : now },
    weather,
    stocks,
    clocks: guard('clocks', getClocks),
    fx,
    news,
    newsEn,
    mlb
  };
}
