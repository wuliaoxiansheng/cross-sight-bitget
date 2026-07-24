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

type LarkText = {
  tag: "plain_text" | "lark_md";
  content: string;
};

type LarkCardElement =
  | {
      tag: "div";
      text?: LarkText;
      fields?: Array<{
        is_short: boolean;
        text: LarkText;
      }>;
    }
  | {
      tag: "hr";
    }
  | {
      tag: "note";
      elements: LarkText[];
    }
  | {
      tag: "action";
      actions: Array<{
        tag: "button";
        text: LarkText;
        type: "primary" | "default";
        url: string;
      }>;
    };

export type LarkInteractiveCard = {
  config: {
    wide_screen_mode: boolean;
  };
  header: {
    template: "green" | "orange";
    title: LarkText;
  };
  elements: LarkCardElement[];
};

export type FeishuTestCardSummary = {
  generatedAt: string;
  rTokenOpenCount: number;
  rTokenCandidateCount: number;
  crossVenueOpenCount: number;
  crossVenueWatchCount: number;
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

function crossVenueLabel(venue: "bitget" | "hyperliquid_xyz"): string {
  return venue === "bitget" ? "Bitget" : "Hyperliquid xyz";
}

function isPushableCrossVenue(item: CrossVenueScanItem): boolean {
  return item.evaluation?.status === "OPEN" && item.evaluation.depthOk;
}

function textDiv(content: string): LarkCardElement {
  return {
    tag: "div",
    text: {
      tag: "lark_md",
      content
    }
  };
}

function metricFields(
  metrics: Array<{
    label: string;
    value: string;
  }>
): LarkCardElement {
  return {
    tag: "div",
    fields: metrics.map((metric) => ({
      is_short: true,
      text: {
        tag: "lark_md",
        content: `**${metric.label}**\n${metric.value}`
      }
    }))
  };
}

function dashboardAction(): LarkCardElement {
  return {
    tag: "action",
    actions: [
      {
        tag: "button",
        text: {
          tag: "plain_text",
          content: "打开 Cross Sight"
        },
        type: "primary",
        url: config.crossSightPublicUrl
      }
    ]
  };
}

function renderRTokenOpportunity(item: OpportunityScanItem, index: number): LarkCardElement[] {
  const evaluation = item.evaluation;
  if (!evaluation) return [];

  const strategyLabel = evaluation.opportunityKind === "basis_convergence"
    ? "价差收敛"
    : "资金费率 + 基差";

  return [
    textDiv(`**${index + 1}. ${pairLabel(item)} | ${strategyLabel}**\n可执行方向：买入 RToken 现货，做空同标的永续合约`),
    metricFields([
      { label: "预估净 Edge", value: formatPercent(evaluation.expectedEdge) },
      { label: "开仓成交基差", value: formatPercent(evaluation.entryBasis) },
      { label: "资金费率 / 年化", value: `${formatPercent(evaluation.fundingRate)} / ${formatPercent(evaluation.fundingApr)}` },
      { label: "计划名义金额", value: `${evaluation.notionalUsd.toLocaleString("en-US")} USDT` }
    ]),
    textDiv(
      `**成交参考**\n现货买入 VWAP ${formatPrice(evaluation.spotBuyVwap)} | 合约做空 VWAP ${formatPrice(evaluation.futuresShortVwap)}\n` +
      `**Agent 判断**\n${evaluation.analysis.signalSummary}\n` +
      `**主要风险**\n${evaluation.analysis.riskNotes[0] ?? evaluation.reason}`
    ),
    { tag: "hr" }
  ];
}

function renderCrossVenueOpportunity(
  scan: CrossVenueOpportunityScan,
  item: CrossVenueScanItem,
  index: number
): LarkCardElement[] {
  const evaluation = item.evaluation;
  if (!evaluation) return [];

  const kindLabel = evaluation.opportunityKind === "spread_convergence"
    ? "历史异常价差收敛"
    : evaluation.opportunityKind === "funding_carry"
      ? "跨市场费率套利"
      : "瞬时价差";
  const history = evaluation.convergence;
  const historyText = evaluation.opportunityKind === "spread_convergence"
    ? `**历史证据**\n中枢 ${formatPercent(history.medianSignedSpread)} | Z ${history.zScore.toFixed(2)} | 异常分位 ${(history.absoluteDeviationPercentile * 100).toFixed(1)}% | 半衰期 ${history.halfLifeHours?.toFixed(1) ?? "--"} 小时\n`
    : "";

  return [
    textDiv(
      `**${index + 1}. ${item.pair.ticker} | ${kindLabel}**\n` +
      `做多 ${crossVenueLabel(evaluation.longVenue)}，做空 ${crossVenueLabel(evaluation.shortVenue)}`
    ),
    metricFields([
      { label: "预估净 Edge", value: formatPercent(evaluation.expectedEdge) },
      { label: "开仓成交基差", value: formatPercent(evaluation.entryBasis) },
      { label: "预估收敛空间", value: formatPercent(evaluation.convergenceGrossEdge) },
      { label: `${scan.fundingHorizonHours}h 费率贡献`, value: formatPercent(evaluation.expectedFundingEdge) }
    ]),
    textDiv(
      `**成交参考**\n多头 VWAP ${formatPrice(evaluation.longEntryVwap)} | 空头 VWAP ${formatPrice(evaluation.shortEntryVwap)} | 名义金额 ${evaluation.notionalUsd.toLocaleString("en-US")} USDT\n` +
      historyText +
      `**主要风险**\n${evaluation.riskNotes[0] ?? evaluation.reason}`
    ),
    { tag: "hr" }
  ];
}

export function buildRTokenOpportunityCard(
  scan: OpportunityScan,
  items: OpportunityScanItem[]
): LarkInteractiveCard {
  const totalOpen = scan.items.filter(isPushableOpen).length;
  const opportunityElements = items.flatMap(renderRTokenOpportunity);

  return {
    config: {
      wide_screen_mode: true
    },
    header: {
      template: "green",
      title: {
        tag: "plain_text",
        content: `${config.feishuKeyword} RToken | ${totalOpen} 个可执行机会`
      }
    },
    elements: [
      textDiv(
        `扫描 ${scan.scannedPairs}/${scan.discoveredPairs} 个配对 | 价差机会 ${scan.basisOpportunityCount} | 费率机会 ${scan.fundingOpportunityCount}\n` +
        `扫描时间：${scan.generatedAt}`
      ),
      { tag: "hr" },
      ...opportunityElements,
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: `仅推送 OPEN 且深度校验通过的机会；同一交易对冷却 ${Math.round(config.feishuNotifyCooldownMs / 60_000)} 分钟。`
          }
        ]
      },
      dashboardAction()
    ]
  };
}

export function buildCrossVenueOpportunityCard(
  scan: CrossVenueOpportunityScan,
  items: CrossVenueScanItem[]
): LarkInteractiveCard {
  const opportunityElements = items.flatMap((item, index) => renderCrossVenueOpportunity(scan, item, index));

  return {
    config: {
      wide_screen_mode: true
    },
    header: {
      template: "green",
      title: {
        tag: "plain_text",
        content: `${config.feishuKeyword} 双合约 | ${scan.openCount} 个可执行机会`
      }
    },
    elements: [
      textDiv(
        `Bitget RWA 与 Hyperliquid xyz 同标的永续 | 扫描 ${scan.scannedPairs}/${scan.discoveredPairs} 个配对\n` +
        `扫描时间：${scan.generatedAt}`
      ),
      { tag: "hr" },
      ...opportunityElements,
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: "跨交易所无法原子成交。Edge 已扣除费用假设，但不包含极端滑点、转账和保证金风险。"
          }
        ]
      },
      dashboardAction()
    ]
  };
}

export function buildFeishuTestCard(summary: FeishuTestCardSummary): LarkInteractiveCard {
  return {
    config: {
      wide_screen_mode: true
    },
    header: {
      template: "orange",
      title: {
        tag: "plain_text",
        content: `${config.feishuKeyword} Cross Sight | 卡片通知已接通`
      }
    },
    elements: [
      textDiv("生产扫描器与 Lark 交互卡片通道连接正常。下面是发送测试时的缓存快照，不代表可直接交易。"),
      metricFields([
        { label: "RToken 可执行", value: `${summary.rTokenOpenCount}` },
        { label: "RToken 候选", value: `${summary.rTokenCandidateCount}` },
        { label: "双合约可执行", value: `${summary.crossVenueOpenCount}` },
        { label: "双合约观察", value: `${summary.crossVenueWatchCount}` }
      ]),
      textDiv(`**快照时间**\n${summary.generatedAt}`),
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: "后续仅在机会达到 OPEN、深度通过且冷却结束时自动推送。"
          }
        ]
      },
      dashboardAction()
    ]
  };
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
    await this.postCard(buildRTokenOpportunityCard(scan, itemsToPush));

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
    await this.postCard(buildCrossVenueOpportunityCard(scan, itemsToPush));
    const sentAtMs = Date.now();
    for (const item of itemsToPush) {
      this.sentByPair.set(this.crossVenueKey(item), { sentAtMs });
    }
  }

  async sendTestCard(summary: FeishuTestCardSummary): Promise<void> {
    if (!config.feishuWebhookUrl) {
      throw new Error("FEISHU_WEBHOOK_URL is not configured");
    }
    await this.postCard(buildFeishuTestCard(summary));
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

  private async postCard(card: LarkInteractiveCard): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(config.feishuWebhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          msg_type: "interactive",
          card
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
