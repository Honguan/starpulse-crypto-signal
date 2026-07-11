# StarPulse Crypto Signal

StarPulse 是部署在 GitHub Pages 的加密貨幣市場分析看板。它不下單、不保存持倉，只根據公開市場資料產生做多與做空計畫。

## 使用方式

- 預設顯示策略分數最高的 5 個幣種。
- 在「指定幣種」輸入 `BTC` 或 `BTCUSDT`，即可查看該幣種的雙向計畫。
- 按「加入最愛」保存幣種，再切換「最愛」查看收藏清單。
- 每張卡同時列出做多、做空的條件、進場區、停損與兩段止盈。
- 展開「K 線圖」查看最近 4h 蠟燭、EMA20／EMA50 與計畫價位。
- 「可執行」表示四項條件全部通過；「等待條件」不代表可以進場。

## 策略規則

做多與做空各自檢查四項條件：

1. 4h EMA20 與 EMA50 的趨勢方向。
2. 價格相對 1h EMA20 的位置。
3. 1h RSI14 區間：做多 45–60、做空 40–55。
4. 1h MACD 方向與柱狀體變化。

進場中心使用 1h EMA20，進場寬度使用最近 14 期平均絕對小時報酬的 0.25 倍。停損取最近 12 小時結構高低點與 1.5 倍波動距離中較嚴格者，止盈一與止盈二為 1.5R、2.5R。

## 資料更新

GitHub Actions 每 10 分鐘取得 CoinGecko 市值前 100，累積 1h 價格與 4h OHLC。動態結果寫入 `live-data` 分支，主分支的 `data/signals.json` 是讀取失敗時的備援快照。

啟用自動更新前，在 GitHub Repository Secrets 設定 `COINGECKO_API_KEY`。金鑰只會在 Actions 使用，不會送到瀏覽器。

Binance USDT 現貨幣種在頁面開啟時會透過公開 WebSocket 更新價格，並即時重新判定兩套計畫的狀態；其他幣種等待下一次快照。

## 本機檢查

```powershell
node scripts/strategy-check.mjs
node scripts/live-update-check.mjs
node scripts/candle-chart-check.mjs
node --no-warnings scripts/live-price-check.mjs
node scripts/check.mjs
```

## 風險提示

本工具僅提供市場資料整理與技術分析輔助，不構成投資建議。加密貨幣波動極高，任何訊號都可能失效。請自行控制倉位、停損與風險。
