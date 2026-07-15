import { config } from "../config/env.js";
import type {
  CrossVenueOpportunityScan,
  CrossVenueScanItem,
  OpportunityScan,
  OpportunityScanItem
} from "../types/market.js";

type SentState = {
  sentAtMs: number;
};

type FeishuResponse = {
  code?: number;
  StatusCode?: number;
  msg?: string;
  StatusMessage?: string;
};

const REQUEST_TIMEOUT_MS = 8_000;

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });
}

function pairLabel(item: OpportunityScanItem): string {
  return `${item.pair.spotSymbol} / ${item.pair.futuresSymbol}`;
}

function isPushableOpen(item: OpportunityScanItem): boolean {
  return item.evaluation?.status === "OPEN" && item.evaluation.depthOk;
}

function buildOpportunityLine(item: OpportunityScanItem, index: number): string {
  const evaluation = item.evaluation;
  if (!evaluation) return "";

  const riskNote = evaluation.analysis.riskNotes[0] ? `\n   风险：${evaluation.analysis.riskNotes[0]}` : "";
  const strategyLabel = evaluation.opportunityKind === "basis_convergence" ? "RToken 基差收敛" : "费率 + 价差";

  return [
    `${index + 1}. [${strategyLabel}] ${pairLabel(item)}`,
    `   预估 Edge：${formatPercent(evaluation.expectedEdge)} | 跨市场净价差：${formatPercent(evaluation.basisEdge)} | 开仓基差：${formatPercent(evaluation.entryBasis)}`,
    `   当前资金费率：${formatPercent(evaluation.fundingRate)} | 年化：${formatPercent(evaluation.fundingApr)}`,
    `   VWAP：现货买入 ${formatPrice(evaluation.spotBuyVwap)} / 合约做空 ${formatPrice(evaluation.futuresShortVwap)}`,
    `   Agent：${evaluation.analysis.signalSummary}`,
    `   建议：${evaluation.analysis.suggestedAction}${riskNote}`
  ].join("\n");
}

function crossVenueLabel(venue: "bitget" | "hyperliquid_xyz"): string {
  return venue === "bitget" ? "Bitget" : "Hyperliquid xyz";
}

function isPushableCrossVenue(item: CrossVenueScanItem): boolean {
  return item.evaluation?.status === "OPEN" && item.evaluation.depthOk;
}

function buildCrossVenueMessage(scan: CrossVenueOpportunityScan, items: CrossVenueScanItem[]): string {
  const lines = items.map((item, index) => {
    const evaluation = item.evaluation;
    if (!evaluation) return "";
    const kindLabel = evaluation.opportunityKind === "spread_convergence"
      ? "历史异常价差收敛"
      : evaluation.opportunityKind === "funding_carry"
        ? "跨市场费率套利"
        : "瞬时价差";
    const historyLine = evaluation.opportunityKind === "spread_convergence"
      ? `\n   历史：Z ${evaluation.convergence.zScore.toFixed(2)} | 分位 ${(evaluation.convergence.absoluteDeviationPercentile * 100).toFixed(1)}% | 中枢 ${formatPercent(evaluation.convergence.medianSignedSpread)}`
      : "";
    return [
      `${index + 1}. [${kindLabel}] ${item.pair.ticker}`,
      `   多：${crossVenueLabel(evaluation.longVenue)} | 空：${crossVenueLabel(evaluation.shortVenue)}`,
      `   预估 Edge：${formatPercent(evaluation.expectedEdge)} | 成交基差：${formatPercent(evaluation.entryBasis)} | 收敛空间：${formatPercent(evaluation.convergenceGrossEdge)} | ${scan.fundingHorizonHours}h 费率差：${formatPercent(evaluation.expectedFundingEdge)}${historyLine}`,
      `   VWAP：多头 ${formatPrice(evaluation.longEntryVwap)} / 空头 ${formatPrice(evaluation.shortEntryVwap)}`,
      `   费用假设：双边往返 ${formatPercent(evaluation.feeDrag)} | 名义金额 ${evaluation.notionalUsd.toLocaleString("en-US")} USDT`,
      `   风险：${evaluation.riskNotes[0]}`
    ].join("\n");
  }).join("\n\n");

  return [
    `【${config.feishuKeyword} 双合约价差提醒】Cross Sight 发现 ${scan.openCount} 个跨市场永续机会`,
    `扫描时间：${scan.generatedAt}`,
    `扫描范围：Bitget RWA ↔ Hyperliquid xyz 同名合约 ${scan.scannedPairs}/${scan.discoveredPairs} 个`,
    "",
    lines,
    "",
    "注意：跨交易所无法原子成交，推送是行情筛选，不是收益保证。"
  ].join("\n");
}

function buildMessage(scan: OpportunityScan, items: OpportunityScanItem[]): string {
  const totalOpen = scan.items.filter(isPushableOpen).length;
  const lines = items.map(buildOpportunityLine).join("\n\n");

  return [
    `【${config.feishuKeyword} RToken 机会提醒】Cross Sight 发现 ${totalOpen} 个可开仓机会（价差 ${scan.basisOpportunityCount} / 费率 ${scan.fundingOpportunityCount}）`,
    `扫描时间：${scan.generatedAt}`,
    `扫描范围：${scan.scannedPairs}/${scan.discoveredPairs} 个 Bitget RToken 配对，名义金额 ${scan.notionalUsd} USDT`,
    "",
    lines,
    "",
    `本次推送 ${items.length} 个；同一交易对冷却 ${Math.round(config.feishuNotifyCooldownMs / 60_000)} 分钟，避免重复刷屏。`
  ].join("\n");
}

function isFeishuSuccess(response: FeishuResponse): boolean {
  if (typeof response.code === "number") return response.code === 0;
  if (typeof response.StatusCode === "number") return response.StatusCode === 0;
  return true;
}

export class FeishuOpportunityNotifier {
  private readonly sentByPair = new Map<string, SentState>();

  async notifyOpenOpportunities(scan: OpportunityScan): Promise<void> {
    if (!config.feishuWebhookUrl) return;

    const dueItems = scan.items.filter((item) => isPushableOpen(item) && this.shouldSend(item));
    if (dueItems.length === 0) return;

    const itemsToPush = dueItems.slice(0, config.feishuNotifyMaxItems);
    const message = buildMessage(scan, itemsToPush);
    await this.postText(message);

    const sentAtMs = Date.now();
    for (const item of itemsToPush) {
      const key = `${item.pair.id}:${item.evaluation?.opportunityKind ?? "unknown"}`;
      this.sentByPair.set(key, { sentAtMs });
    }
  }

  async notifyCrossVenueOpportunities(scan: CrossVenueOpportunityScan): Promise<void> {
    if (!config.feishuWebhookUrl) return;
    const dueItems = scan.items.filter((item) => isPushableCrossVenue(item) && this.shouldSendCrossVenue(item));
    if (dueItems.length === 0) return;

    const itemsToPush = dueItems.slice(0, config.feishuNotifyMaxItems);
    await this.postText(buildCrossVenueMessage(scan, itemsToPush));
    const sentAtMs = Date.now();
    for (const item of itemsToPush) {
      this.sentByPair.set(this.crossVenueKey(item), { sentAtMs });
    }
  }

  private shouldSend(item: OpportunityScanItem): boolean {
    const key = `${item.pair.id}:${item.evaluation?.opportunityKind ?? "unknown"}`;
    const lastSent = this.sentByPair.get(key);
    if (!lastSent) return true;
    return Date.now() - lastSent.sentAtMs >= config.feishuNotifyCooldownMs;
  }

  private shouldSendCrossVenue(item: CrossVenueScanItem): boolean {
    const lastSent = this.sentByPair.get(this.crossVenueKey(item));
    return !lastSent || Date.now() - lastSent.sentAtMs >= config.feishuNotifyCooldownMs;
  }

  private crossVenueKey(item: CrossVenueScanItem): string {
    return `cross:${item.pair.id}:${item.evaluation?.opportunityKind ?? "unknown"}:${item.evaluation?.direction ?? "unknown"}`;
  }

  private async postText(text: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(config.feishuWebhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          msg_type: "text",
          content: {
            text
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Feishu webhook HTTP ${response.status}`);
      }

      const payload = (await response.json().catch(() => ({}))) as FeishuResponse;
      if (!isFeishuSuccess(payload)) {
        throw new Error(payload.msg ?? payload.StatusMessage ?? "Feishu webhook returned a non-zero status");
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const feishuOpportunityNotifier = new FeishuOpportunityNotifier();
