# Market Regime v1

Market Regime 直接使用 BTC／ETH 與設定資產的 Features，不聚合單幣 signal 數量。分數是方向性條件強度，沒有勝率含義。

## Core 公式

| Component | 權重 | 標準化值 |
|---|---:|---|
| BTC 趨勢 | 25 | 可用級別 bullish=1、neutral=0、bearish=-1 的平均 |
| ETH 趨勢 | 20 | 同上 |
| 市場廣度 | 25 | 設定資產／級別方向平均；不是全市場占比 |
| Momentum | 20 | 0.5 × clip((RSI−50)/50) + 0.5 × sign(MACD histogram) |
| Funding | 10 | clip(−平均 funding_rate / 0.001, −1, 1) |

`score = round(50 + 50 × Σ(value × weight) / Σ(available weight), 2)`。缺資料會列入 `missing`／`coverage`，權重只對可用 component 正規化；BTC 或 ETH 完全缺失則 `available=false`、`score=null`、`regime=unavailable`、`risk=extreme`。Pipeline 額外要求該資產四級別與 Funding／OI 都健康才可建立 Setup。

| 分數 | Regime |
|---|---|
| <25 | strong_bearish |
| 25–<45 | bearish |
| 45–55 | neutral |
| >55–<76 | bullish |
| ≥76 | strong_bullish |

這是 Core 的可檢驗初始假說，不沿用企劃中尚無來源的資金流／Sentiment 權重。未接入的 component 不填假數值。

## 趨勢與風險

各級別 `close > EMA20 > EMA50 > EMA200` 為 bullish，反向為 bearish，其他為 neutral，warmup 不足為 unknown。`timeframe_trends` 提供每個資產的四級別結果。所有 EMA 用前 N 根 SMA 當種子。

風險獨立於方向分數，依可用級別最大 ATR/price、最大絕對 Funding、最大絕對 OI 小時變化判定：

| Risk | 任一條件 |
|---|---|
| extreme | BTC/ETH 不可用；ATR/price ≥8%；Funding ≥0.003；OI ≥30% |
| high | component 缺失；ATR/price ≥4%；Funding ≥0.001；OI ≥15% |
| medium | ATR/price ≥2%；Funding ≥0.0005；OI ≥5% |
| low | 其餘 |

Funding 是小數比例；0.001=0.1%。`oi_change_1h=0.05` 表示 5%，輸出的 `oi_change_pct=5`。Funding 過熱偏向擁擠警訊，不作更強的多頭確認。OI 只用於風險與解釋，不把 OI 上升直接等同新增多頭，因每張期貨合約同時有多空雙方。

參數需經 [回測](backtest.md) 驗證再調整版本；不從展示分數推導收益。衍生資料欄位依 [Binance 官方 Market Data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) 查核。
