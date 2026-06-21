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
          <span>只用 rToken → 同名 USDT 永续映射，不扫 Earn、锁仓或债券型产品。</span>
        </div>
        <div>
          <strong>深度优先</strong>
          <span>订单簿不能覆盖 5,000 USDT，就算 ticker 有价差也标记深度不足。</span>
        </div>
        <div>
          <strong>扣费后 edge</strong>
          <span>信号必须覆盖现货手续费、合约手续费和预计滑点。</span>
        </div>
        <div>
          <strong>不自动下单</strong>
          <span>当前只做行情扫描和 paper trading 预览，不碰真实账户。</span>
        </div>
      </div>
    </section>
  );
}

