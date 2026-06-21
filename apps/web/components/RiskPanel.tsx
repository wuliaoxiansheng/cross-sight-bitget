export function RiskPanel() {
  return (
    <section className="panel">
      <div className="panel-header">
        <div className="panel-title">风控边界</div>
      </div>
      <div className="panel-body">
        <div className="risk-list">
          <p>只监控白名单 RSPCXUSDT / SPCXUSDT，不按 SPCX 关键词自动匹配，避免误碰锁仓或 Earn 类产品。</p>
          <p>信号使用订单簿 VWAP，不用 last price，避免薄深度场景下把纸面价差误判成可成交机会。</p>
          <p>第一版只做只读行情和 paper trading，不接真实下单；真实交易前必须补账户权限隔离和最大亏损限制。</p>
          <p>资金费率可能快速归零或反向，OPEN 信号必须结合下次结算时间和可成交规模看。</p>
        </div>
      </div>
    </section>
  );
}

