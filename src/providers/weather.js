import { fetchJson, cached } from '../cache.js';
import { getConfig } from '../config.js';

// WMO weather code -> short Chinese description.
const WMO = {
  0: 'Sereno',
  1: 'Prevalentemente sereno',
  2: 'Parzialmente nuvoloso',
  3: 'Nuvoloso',
  45: 'Nebbia',
  48: 'Nebbia gelata',
  51: 'Pioviggine leggera',
  53: 'Pioviggine moderata',
  55: 'Pioviggine intensa',
  56: 'Pioviggine gelata leggera',
  57: 'Pioviggine gelata intensa',
  61: 'Pioggia leggera',
  63: 'Pioggia moderata',
  65: 'Pioggia intensa',
  66: 'Pioggia gelata leggera',
  67: 'Pioggia gelata intensa',
  71: 'Neve leggera',
  73: 'Neve moderata',
  75: 'Neve intensa',
  77: 'Granuli di neve',
  80: 'Rovesci leggeri',
  81: 'Rovesci moderati',
  82: 'Rovesci intensi',
  85: 'Rovesci di neve leggeri',
  86: 'Rovesci di neve intensi',
  95: 'Temporale',
  96: 'Temporale con grandine',
  99: 'Temporale con grandine intensa'
};
const wmo = (c) => WMO[c] ?? `码${c}`;

export async function getWeather() {
  const { lat, lon, city } = getConfig().weather;
  // 一次请求同时供页 1（当前天气）与页 2（日出日落 / 未来几天）使用。
  // 多取 4 天不会增加请求数，也不用为慢信息再接一个数据源。
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
    `&current=temperature_2m,weather_code,relative_humidity_2m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&timezone=auto&forecast_days=4`;

  // 配置可在服务运行中热改。key 里必须带上坐标和城市名，否则改了城市之后的
  // 10 分钟里，画面会显示"新城市 + 老城市的温度"，还带着旧的 fetchedAt。
  return cached('weather:' + city + ':' + lat + ',' + lon, 10 * 60 * 1000, async () => {
    const r = await fetchJson(url);
    if (!r.ok) return { ok: false, error: r.error, city };
    const c = r.data.current || {};
    const d = (r.data.daily || {});
    const num = (v) => {
      const n = Number(v);
      return v === null || v === '' || v === undefined || !Number.isFinite(n) ? null : n;
    };
    // 温度是整块天气卡的主数值：上游返回 null/字符串/"N/A" 时宁可标不可用，
    // 也不要画出 "null°C  Hnull Lnull" 这种图。
    const temp = num(c.temperature_2m);
    if (temp === null) return { ok: false, error: 'invalid weather payload', city };
    const code = num(c.weather_code);
    const times = Array.isArray(d.time) ? d.time : [];
    const clock = (value) => typeof value === 'string' && /^\d{2}:\d{2}$/.test(value.slice(11, 16))
      ? value.slice(11, 16) : null;
    const days = [];
    for (let i = 0; i < Math.min(4, times.length); i++) {
      const dayCode = num(d.weather_code?.[i]);
      days.push({
        date: String(times[i] || '').slice(5),
        code: dayCode,
        text: dayCode === null ? '' : wmo(dayCode),
        high: num(d.temperature_2m_max?.[i]),
        low: num(d.temperature_2m_min?.[i]),
        sunrise: clock(d.sunrise?.[i]),
        sunset: clock(d.sunset?.[i])
      });
    }
    return {
      ok: true,
      city,
      temp,
      humidity: num(c.relative_humidity_2m),
      code,
      text: code === null ? '' : wmo(code),
      high: num(d.temperature_2m_max?.[0]),
      low: num(d.temperature_2m_min?.[0]),
      sunrise: days[0]?.sunrise ?? null,
      sunset: days[0]?.sunset ?? null,
      days,
      source: 'open-meteo'
    };
  });
}
