import { config } from "../config/env.js";
import type { OpportunityScan, OpportunityScanItem } from "../types/market.js";

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

  return [
    `${index + 1}. ${pairLabel(item)}`,
    `   Edge：${formatPercent(evaluation.expectedEdge)} | 开仓基差：${formatPercent(evaluation.entryBasis)} | 资金费率年化：${formatPercent(evaluation.fundingApr)}`,
    `   VWAP：现货买入 ${formatPrice(evaluation.spotBuyVwap)} / 合约做空 ${formatPrice(evaluation.futuresShortVwap)}`,
    `   Agent：${evaluation.analysis.signalSummary}`,
    `   建议：${evaluation.analysis.suggestedAction}${riskNote}`
  ].join("\n");
}

function buildMessage(scan: OpportunityScan, items: OpportunityScanItem[]): string {
  const totalOpen = scan.items.filter(isPushableOpen).length;
  const lines = items.map(buildOpportunityLine).join("\n\n");

  return [
    `【${config.feishuKeyword} RToken 机会提醒】Cross Sight 发现 ${totalOpen} 个可开仓机会`,
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
      this.sentByPair.set(item.pair.id, { sentAtMs });
    }
  }

  private shouldSend(item: OpportunityScanItem): boolean {
    const lastSent = this.sentByPair.get(item.pair.id);
    if (!lastSent) return true;
    return Date.now() - lastSent.sentAtMs >= config.feishuNotifyCooldownMs;
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
