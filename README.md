# StarPulse Crypto Signal

StarPulse 是部署在 GitHub Pages 的加密貨幣市場分析看板。它不下單、不保存持倉，只根據公開市場資料產生做多與做空計畫。

## 使用方式

- 預設顯示策略分數最高的 5 個幣種。
- 在「指定幣種」輸入 `BTC`、`bitcoin` 或 `BTCUSDT`，即可查看該資產的雙向計畫；同代號資產以 CoinGecko ID 區分。
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

只有單一方向四項條件全數通過（100 分），且尚未停損或到達止盈區時，才會成為主要方向；其他分數、平手或雙向同時通過一律顯示「觀望」，市場多空統計也忽略這些未達標計畫。

進場中心使用 1h EMA20，進場寬度使用最近 14 期平均絕對小時報酬的 0.25 倍。停損取最近 12 小時結構高低點與 1.5 倍波動距離中較嚴格者，止盈一與止盈二為 1.5R、2.5R。

1h 指標只使用帶 UTC 時間戳的 CoinGecko hourly 資料，4h 趨勢與結構價位使用官方 OHLC。最近 220 個 1h 點或 50 根 4h K 線若有缺口，該幣種不產生交易計畫。

EMA20／EMA50 使用前 N 筆 SMA 作為種子；RSI14 使用 Wilder smoothing（無跌幅時為 100）；MACD 使用 EMA(12,26,9)，至少 34 筆資料後才輸出完整 signal／histogram。固定測試資料與 `technicalindicators` 3.1.0 比對，EMA／MACD 容許誤差 `1e-9`，該參考實作將 RSI 四捨五入至小數二位，因此 RSI 容許誤差 `0.005`。

畫面的「條件」是四項策略條件的加權分數（40／20／20／20），不是勝率。「主要 RR」以進場區中心、停損及第二段止盈計算；條件未完成或計畫停損失效時不顯示。詳細資料逐項標示來源與計算模式，不代表歷史績效、機率或期望值；未實作的 Vegas Tunnel 與 TD Sequential 不會顯示。

## 資料更新

GitHub Actions 每 10 分鐘取得 CoinGecko 市值前 100、對齊整點的 1h 價格與官方 4h OHLC。公開的 `live-data` 分支永遠只有一個 orphan snapshot commit，包含最多 180 KiB 的 compact `data/signals.json` 與每資產一份、最多 60 根 4h K 線的 `data/candles/<coinId>.json`。初始載入只下載 compact index；展開單一圖表才下載該資產的 candle snapshot。主分支的 `signals.json` 是讀取失敗時的無 K 線備援快照。內部 `price-history.json` 不公開也不進 Git，而以 Actions cache 保存；未存取 7 天的 cache 會淘汰，repository 預設 cache 上限 10 GB，滿額時由最舊項目開始逐出。

CoinGecko 請求每次最多等待 15 秒，429／5xx／網路或 timeout 最多重試 2 次，採 bounded exponential backoff 並遵守最多 30 秒的 `Retry-After`。永久 4xx 與 malformed JSON 不重試。歷史補齊明確維持 concurrency 1 以控制 demo API 配額；payload 的 `dataQuality` 公布成功、失敗、缺歷史與逐資產失敗分類，任何 partial failure 都使整體狀態降級。若中斷多個窗口，下一次成功 run 會重新取得 CoinGecko 30 日 hourly 與官方 OHLC，再驗證連續區間，不會自行把缺口接成連續資料。

所有 `live-data` 發布共用單一 GitHub Actions concurrency group，一次只允許一個 run 寫入；job 最長執行 15 分鐘。每次發布以開始時的 remote SHA 執行 `--force-with-lease`，把舊 snapshot 替換成新的單一 commit；lease 不符即失敗，不會覆蓋外部更新。這讓 routine update 只保留一組目前的 compact index／per-asset candles，不累積每 10 分鐘一份永久 blob。每次取得新的前 100 清單後，已離開清單的 hourly／4h state 會立即刪除。

既有 `live-data` 歷史的清理方式是成功執行一次新版 `Update Live Signals`：首次 single-commit 發布會讓舊 commit 全部不可達，之後由 GitHub 依服務端排程回收物件。若 repository size 在服務端垃圾回收後仍未下降，請攜帶 `live-data` 最新 commit SHA 聯絡 GitHub Support；不要在 `main` 重寫歷史。

所有第三方 Actions 固定至完整 commit SHA，並在旁註記已審查版本。token 權限僅設於個別 job：健康檢查只有 `contents: read`，Pages 只有 `contents: read`／`pages: write`／`id-token: write`，只有 `live-data` 發布 job 可寫 repository contents。所有 checkout 均不持久化 Git credential，發布 step 才以 `GITHUB_TOKEN` 驗證單次 push；每個 job 也有明確 timeout。`workflow-security-check.mjs` 由 freshness workflow 持續驗證這些限制。

Pages workflow 在 pull request 與 main push 執行相同的 deterministic regression、fallback schema 與全 JavaScript syntax 檢查，不需要 production API secrets。部署 job 以 `needs: validate` 為硬閘門，驗證失敗即不會啟動；PR 只執行驗證，合併後才部署。Repository branch protection 可將 `validate` 設為 required check。

更新 SLO 是每 10 分鐘發布一次，GitHub Actions cron 僅視為 best-effort。資料年齡達 20 分鐘（連續缺 2 個預期窗口）即顯示延遲／degraded，超過 60 分鐘顯示 stale 並停用計畫。獨立的 `Live Data Freshness` workflow 每 15 分鐘直接驗證已發布 payload 的 schema 與 `updatedAt`；超出 SLO 會產生失敗 Action 與 job summary，藉此區分「更新 workflow 曾成功」和「目前資料仍新鮮」。若 10 分鐘硬 SLA 是產品必要條件，需改用具排程 SLA 的外部 runtime，不能把 GitHub cron 當保證。

compact 訊號 payload 使用 `schemaVersion: 2`，per-asset candle snapshot 使用獨立的 `schemaVersion: 1`；瀏覽器會先驗證版本、必要欄位、陣列與有限數值，才替換最後一次有效快照。網路、JSON、schema、時間與 render 錯誤會分別提示。

Fallback 用來保護回訪者免受短暫的 live publication 或上游讀取故障：每個瀏覽器只在 schema 與 render 驗證成功後，於 localStorage 覆寫 1 份 last-known-good snapshot，不建立 Git 版本。資料超過 24 小時便刪除且不顯示為可用交易快照；首次造訪、清除瀏覽器資料或所有來源同時失效時不保證有 fallback。

啟用自動更新前，在 GitHub Repository Secrets 設定 `COINGECKO_API_KEY`。金鑰只會在 Actions 使用，不會送到瀏覽器。

只有明確對應 CoinGecko ID、且由 Binance `exchangeInfo` 確認仍可交易的 USDT 現貨，才會透過公開 WebSocket 更新價格。若兩來源價格相差超過 5%，或資產沒有已驗證配對，畫面明示快照模式並等待下一次 CoinGecko 快照。

## 本機檢查

```powershell
node scripts/strategy-check.mjs
node scripts/indicator-check.mjs
node scripts/freshness-check.mjs
node scripts/signal-schema-check.mjs
node scripts/payload-size-check.mjs
node scripts/live-update-check.mjs
node scripts/candle-chart-check.mjs
node scripts/render-security-check.mjs
node scripts/workflow-security-check.mjs
node --no-warnings scripts/live-price-check.mjs
node --no-warnings scripts/notification-check.mjs
node scripts/check.mjs
```

## 風險提示

本工具僅提供市場資料整理與技術分析輔助，不構成投資建議。加密貨幣波動極高，任何訊號都可能失效。請自行控制倉位、停損與風險。
