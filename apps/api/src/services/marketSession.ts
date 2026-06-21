import type { MarketSessionContext } from "../types/market.js";

type NewYorkTimeParts = {
  date: string;
  weekday: string;
  hour: number;
  minute: number;
};

const US_MARKET_HOLIDAYS_2026 = new Map<string, string>([
  ["2026-01-01", "New Year's Day"],
  ["2026-01-19", "Martin Luther King Jr. Day"],
  ["2026-02-16", "Presidents' Day"],
  ["2026-04-03", "Good Friday"],
  ["2026-05-25", "Memorial Day"],
  ["2026-06-19", "Juneteenth"],
  ["2026-07-03", "Independence Day observed"],
  ["2026-09-07", "Labor Day"],
  ["2026-11-26", "Thanksgiving Day"],
  ["2026-12-25", "Christmas Day"]
]);

function getNewYorkParts(now: Date): NewYorkTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute"))
  };
}

function minutesSinceMidnight(parts: NewYorkTimeParts): number {
  return parts.hour * 60 + parts.minute;
}

export function getMarketSessionContext(now = new Date()): MarketSessionContext {
  const parts = getNewYorkParts(now);
  const holidayName = US_MARKET_HOLIDAYS_2026.get(parts.date);
  const isWeekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  const minute = minutesSinceMidnight(parts);
  const premarketStart = 4 * 60;
  const regularStart = 9 * 60 + 30;
  const regularEnd = 16 * 60;
  const afterHoursEnd = 20 * 60;

  if (holidayName) {
    return {
      state: "holiday_closed",
      label: "美股节假日休市",
      description: `${parts.date} 纽约时间为 ${holidayName}，底层美股休市，RToken 资金费率和基差更容易失真或归零。`,
      isLikelyInactive: true,
      newYorkDate: parts.date,
      newYorkTime: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
    };
  }

  if (isWeekend) {
    return {
      state: "weekend_closed",
      label: "美股周末休市",
      description: "当前是纽约周末，底层美股不开盘，股票类合约资金费率归零更常见。",
      isLikelyInactive: true,
      newYorkDate: parts.date,
      newYorkTime: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
    };
  }

  if (minute >= regularStart && minute < regularEnd) {
    return {
      state: "regular",
      label: "美股交易中",
      description: "当前处于美股常规交易时段，RToken 与对应合约的基差更有参考意义。",
      isLikelyInactive: false,
      newYorkDate: parts.date,
      newYorkTime: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
    };
  }

  if ((minute >= premarketStart && minute < regularStart) || (minute >= regularEnd && minute < afterHoursEnd)) {
    return {
      state: "extended",
      label: "美股盘前/盘后",
      description: "当前处于美股扩展交易时段，价格可能先动，但深度和资金费率需要降权看。",
      isLikelyInactive: false,
      newYorkDate: parts.date,
      newYorkTime: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
    };
  }

  return {
    state: "overnight_closed",
    label: "美股隔夜休市",
    description: "当前处于纽约隔夜休市窗口，底层锚定价格不活跃，费率归零不能直接视为接口异常。",
    isLikelyInactive: true,
    newYorkDate: parts.date,
    newYorkTime: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
  };
}
