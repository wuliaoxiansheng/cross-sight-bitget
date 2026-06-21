# Cross Sight · RToken Basis Sentry

Bitget RToken 费率基差监控工具。当前版本会自动发现 Bitget 热门 RToken 现货，并严格映射到同名 USDT 永续合约，例如 `RSPYUSDT` → `SPYUSDT`、`RSPCXUSDT` → `SPCXUSDT`，监控现货/合约基差、资金费率、订单簿深度，并生成 paper trading 预览。

## 项目定位

这个项目不是自动下单机器人，MVP 只做只读行情和模拟记录：

- 自动扫描热门 RToken 现货与合约之间的可成交基差。
- 监控资金费率是否足以覆盖手续费和滑点。
- 用订单簿 VWAP 估算 5,000-10,000 USDT 规模是否真的能成交。
- 输出 `OPEN` / `HOLD` / `CLOSE` / `WAIT` 信号。
- 生成黑客松提交需要的 paper trading 日志格式。
- 服务端后台持续扫描并缓存结果，前端首屏读取快照，不在页面请求时同步等待全量币对扫描完成。

核心策略：

```text
当 RToken 现货价格低于对应永续合约，且空合约可收正资金费率：
  买入 RToken 现货
  做空同名 USDT 永续合约
  收取资金费率并等待基差回归

当资金费率归零/转负，或现货价格反超合约：
  卖出现货
  买回合约
  锁定基差和资金费率收益
```

## 技术栈

```text
apps/web  Next.js + TypeScript
apps/api  Node.js + Fastify + TypeScript
database  Postgres + Prisma
infra     docker-compose
```

后续如果要做复杂历史回测、财报 NLP 或统计研究，可以新增 Python worker，不影响当前 Node.js API。

## 目录结构

```text
.
├── apps
│   ├── api
│   │   ├── prisma
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts
│   │   └── src
│   │       ├── routes
│   │       ├── services
│   │       ├── types
│   │       └── index.ts
│   └── web
│       ├── app
│       ├── components
│       └── lib
├── docker-compose.yml
├── .env.example
└── README.md
```

## 本地运行

先安装依赖：

```bash
npm install
```

启动 Postgres：

```bash
docker compose up -d postgres
```

生成 Prisma Client 并初始化表：

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

启动 API：

```bash
npm run dev:api
```

启动前端：

```bash
npm run dev:web
```

打开：

```text
http://localhost:3000
```

API 默认地址：

```text
http://localhost:4000
```

也可以用 Docker 一起启动：

```bash
docker compose up --build
```

## 环境变量

复制 `.env.example` 到 `.env` 后按需修改。

```text
DATABASE_URL=postgresql://cross_sight:cross_sight@localhost:5432/cross_sight?schema=public
BITGET_BASE_URL=https://api.bitget.com
CORS_ORIGIN=http://localhost:3000
DEFAULT_NOTIONAL_USD=5000
OPEN_EDGE_THRESHOLD=0.003
FUNDING_PERIODS_TO_PRICE=1
LIVE_SCAN_MIN_INTERVAL_MS=10000
FEISHU_WEBHOOK_URL=
FEISHU_KEYWORD=美股
FEISHU_NOTIFY_COOLDOWN_MS=1800000
FEISHU_NOTIFY_MAX_ITEMS=5
NEXT_PUBLIC_BASE_PATH=
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

### 飞书机会推送

配置 `FEISHU_WEBHOOK_URL` 后，服务端后台扫描发现真实可执行的 `OPEN` 信号时会自动推送飞书文本消息。

推送条件：

```text
evaluation.status = OPEN
depthOk = true
FEISHU_WEBHOOK_URL 非空
```

默认消息包含 `FEISHU_KEYWORD=美股`，用于通过飞书自定义关键词安全校验。同一交易对默认 30 分钟内只推送一次，避免每 5 分钟扫描都重复刷屏；可以用 `FEISHU_NOTIFY_COOLDOWN_MS` 调整。单条消息最多推送 `FEISHU_NOTIFY_MAX_ITEMS` 个机会，默认 5 个。

### 子路由部署

如果不想占用域名根路径，可以在构建 Web 时设置 `NEXT_PUBLIC_BASE_PATH`。例如部署到个人主页域名的项目子路由：

```text
NEXT_PUBLIC_BASE_PATH=/cross-sight-bitget
NEXT_PUBLIC_API_BASE_URL=https://wuliaobtc.cloud/cross-sight-bitget/api
```

对应 Nginx 保留根路径静态主页，只把 `/cross-sight-bitget/` 反代到 Next Web，把 `/cross-sight-bitget/api/` 反代到 API。

## API

### Health

```http
GET /health
```

### 监控交易对

```http
GET /pairs
```

接口会从 Bitget public API 自动发现热门 RToken，并只保留能严格配对到 USDT 永续合约的标的。

映射规则：

```json
{
  "spotSymbol": "RSPYUSDT",
  "baseCoin": "rSPY",
  "futuresSymbol": "SPYUSDT",
  "productType": "USDT-FUTURES"
}
```

不要用关键词做模糊匹配。Bitget 上存在名称相近但性质不同的产品，尤其要避免误碰锁仓、债券型或 Earn 类资产。

发现阶段还会做价格量级过滤：现货 ticker 与对应合约 ticker 必须在同一数量级内，避免把 `rC` 这类名称撞到普通 crypto 合约 `CUSDT` 后产生假信号。

### 多币对实时机会扫描

前端默认使用缓存快照：

```http
GET /opportunities/snapshot
```

返回服务端最近一次后台扫描结果：

```text
status          warming / scanning / ready / stale / error
latestScan      最近一次完整扫描
scanning        后台是否正在扫描下一轮
completedAt     最近一次完成时间
nextRunAt       下一轮预计开始时间
limit           后台扫描上限；null 表示扫描 Bitget 当前全量 RToken 配对
```

浏览器端会订阅 SSE：

```http
GET /opportunities/stream
```

每当后台扫描状态或结果变化时，服务端推送 `snapshot` 事件，页面自动更新。

前端工作台支持两类交互：

```text
搜索        输入 RSPCX、SPCXUSDT、COIN、NVDA 等关键词，本地即时过滤扫描结果
筛选        全部 / 有机会 / 费率归零 / 最近非零 / 深度不足 / 无机会
点击标的    右侧 Agent 重新调用实时接口，刷新该标的的订单簿、资金费率、基差和分析结论
```

手动调试接口仍然保留：

```http
GET /opportunities/live-all?notionalUsd=5000
```

返回字段重点：

```text
requestedLimit       请求扫描上限；null 表示全量扫描
scannedPairs         实际完成扫描的配对数量
openCount            有开仓机会的数量
closeCount           更像平仓窗口的数量
depthIssueCount      深度不足的数量
items                每个 RToken/合约配对的扫描结果
```

生产页面不直接依赖 `/live-all`，避免用户打开页面时同步等待所有 Bitget 请求。

当前后台默认是全量扫描：先把 `WATCHLIST` 里的固定关注标的置顶，例如 `RSPCXUSDT / SPCXUSDT`，再补充 Bitget 自动发现的全部严格配对 RToken。前端搜索不会再因为 top 100 截断而找不到低成交额标的。

资金费率字段需要分开看：

```text
fundingRate                         当前单期资金费率，来自 Bitget current-fund-rate
fundingApr                          当前资金费率折算年化
fundingContext.recentNonZeroRate    最近 10 期历史资金费率里最新一条非零值
fundingContext.recentNonZeroApr     最近非零费率折算年化
fundingContext.state                active_positive / active_negative / zero_with_history / zero
```

如果 `fundingRate = 0`，不一定是接口坏了。当前很多 RToken 对应股票合约的实时资金费率确实会归零，但历史接口仍可能看到上一轮或更早的非零费率。页面会把这类标的标成“费率归零”，并显示“最近非零”作为复盘依据。

### 实时机会

```http
GET /opportunities/live?pairId=rspcx_spcx_perp&notionalUsd=5000
```

这个接口也支持动态发现出来的 RToken pair：

```http
GET /opportunities/live?pairId=ralabusdt_alabusdt&spotSymbol=RALABUSDT&futuresSymbol=ALABUSDT&notionalUsd=5000
```

返回字段重点：

```text
status             OPEN / HOLD / CLOSE / WAIT
spotBuyVwap        买入 RToken 现货的 VWAP
futuresShortVwap   做空永续合约的 VWAP
entryBasis         开仓基差
fundingRate        当前单期资金费率
fundingApr         年化资金费率
fundingContext     当前费率状态 + 最近 10 期历史费率摘要
marketSession      美股交易中 / 盘前盘后 / 周末休市 / 节假日休市
analysis           Agent 结构化分析：信号、费率、基差、风险点、建议动作
expectedEdge       基差 + 预计资金费率 - 手续费
depthOk            当前订单簿是否能覆盖名义金额
narratorText       Agent 解释文本
```

### Paper trade 预览

```http
GET /paper-trades/preview?pairId=rspcx_spcx_perp&notionalUsd=5000&balance=10000
```

第一版只生成预览，不自动写入真实交易，不连接 Bitget 账户。

## 计算逻辑

### 为什么用 VWAP

薄深度产品里，`last price` 或买一卖一不能代表真实可成交价格。MVP 使用订单簿逐档吃单：

```text
开仓：
  买入现货 = 吃 spot asks
  做空合约 = 吃 futures bids

平仓：
  卖出现货 = 吃 spot bids
  买回合约 = 吃 futures asks
```

### 开仓基差

```text
entry_basis = futures_short_vwap / spot_buy_vwap - 1
```

### 资金费率年化

```text
funding_apr = funding_rate * (24 / funding_interval_hours) * 365
```

### 预计 edge

```text
expected_edge =
  entry_basis
  + funding_rate * expected_funding_periods
  - spot_fee_rate
  - futures_fee_rate
```

默认：

```text
spot_fee_rate = 0.1%
futures_fee_rate = 0.06%
OPEN_EDGE_THRESHOLD = 0.3%
```

### 信号解释

```text
OPEN
  深度足够，合约相对现货有溢价，资金费率为正，扣费后 edge 达标。

HOLD
  正基差和正资金费率仍在，但新增开仓 edge 不够。

CLOSE
  资金费率归零/转负，或现货退出价格已经优于合约回补价格。

WAIT
  深度不足，或基差/资金费率不足以覆盖成本。
```

## 黑客松提交材料建议

提交时建议准备：

- Public GitHub 仓库。
- README，包含安装步骤、策略逻辑和 API 说明。
- 可访问 Demo 页面。
- Paper trading CSV/JSON，字段包含时间戳、交易标的、方向、价格、数量、账户余额变化。
- 3 分钟演示视频。
- X 发帖，带 `#BitgetHackathon` 并 @Bitget_AI。

Paper trading 样例：

```csv
timestamp,pair,action,spot_price,futures_price,notional_usd,base_quantity,balance_after,notes
2026-06-21T23:18:02+08:00,RSPCXUSDT/SPCXUSDT,OPEN,179.63,181.43,5000,27.84,9992.40,"买现货并空合约，资金费率为正"
2026-06-22T08:11:40+08:00,RSPCXUSDT/SPCXUSDT,CLOSE,183.17,181.61,5000,27.84,10043.10,"资金费率归零且现货反超合约，平仓"
```

## 后续路线

1. 增加历史资金费率和历史基差存储。
2. 将 `/paper-trades/preview` 扩展为真正的 paper trading 状态机。
3. 增加 WebSocket/SSE，让前端实时刷新。
4. 接入 Bitget Agent Hub 读取账户和模拟盘。
5. 增加 Python worker 做历史回测和更复杂的统计分析。
