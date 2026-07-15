export function RiskNotes() {
  return (
    <section className="panel risk-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">风控规则</div>
          <p className="panel-subtitle">这些规则直接影响“有机会/无机会”的判定。</p>
        </div>
      </div>
      <div className="risk-grid">
        <div>
          <strong>严格配对</strong>
          <span>RToken 只配同名 USDT 永续；双合约只连接 Bitget RWA 与 Hyperliquid xyz 的同名、同价格尺度合约。</span>
        </div>
        <div>
          <strong>深度优先</strong>
          <span>订单簿不能覆盖 5,000 USDT，就算 ticker 有价差也标记深度不足。</span>
        </div>
        <div>
          <strong>扣费后 edge</strong>
          <span>信号必须覆盖双边完整往返手续费、订单簿滑点和比较窗口内的资金费率差。</span>
        </div>
        <div>
          <strong>保证金隔离</strong>
          <span>双合约需要在两个交易所分别留足保证金，价差收敛不代表过程中不会单边强平。</span>
        </div>
        <div>
          <strong>不自动下单</strong>
          <span>当前只做行情扫描和 paper trading 预览，不碰真实账户。</span>
        </div>
      </div>
    </section>
  );
}
