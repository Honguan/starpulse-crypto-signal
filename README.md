# StarPulse Crypto Signal

星脈加密貨幣訊號看板是一個可部署在 GitHub Pages 的靜態加密貨幣訊號展示專案。第一版使用 mock data，不連接交易所 API，也不做自動下單。

## 功能特色

- 市場總覽、資料狀態、LIVE 狀態與最後更新時間
- 做多推薦 Top 5、做空推薦 Top 5、觀望清單與高風險區
- 每張卡片顯示方向、信心、勝率、EV、RR、進場、停損、止盈與原因
- 每張卡片顯示 Vegas 隧道與神奇九轉狀態
- 詳細分數與分析可展開查看
- 手機版優先排版
- JSON 讀取失敗時顯示錯誤提示

## 專案架構

```text
starpulse-crypto-signal/
├── index.html
├── README.md
├── assets/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js
│       ├── signal-render.js
│       └── notification.js
└── data/
    └── signals.json
```

## 部署到 GitHub Pages

1. 將本專案推送到 GitHub repository。
2. 到 repository 的 Settings > Pages。
3. Source 選擇 `Deploy from a branch`。
4. Branch 選擇 `main`，資料夾選擇 `/root`。
5. 儲存後等待 GitHub Pages 建置完成。

## 修改 signals.json

前台資料來自 `data/signals.json`。可以直接修改：

- `market`：市場狀態與摘要
- `signals`：各幣種訊號
- `watchlist`：觀望清單
- `highRisk`：高風險清單

修改後重新整理網頁即可看到新資料。

## 啟用 GitHub Actions

MVP 尚未包含自動更新 workflow。第二版可新增 `.github/workflows/update-signals.yml`，設定每 15 分鐘執行一次 Python 腳本，產生 `data/signals.json` 後 commit 回 repository。

## 訊號計算邏輯

MVP 使用 mock data。訊號欄位保留後續真實計算需要的結構：

- 趨勢分
- Vegas 分
- 動能分
- 量能分
- 位置分
- 神奇九轉分
- 風險分
- 大盤分
- 多方分數與空方分數

判斷原則：

- `longScore >= 80` 且多空分差足夠：強烈做多
- `longScore >= 65` 且多空分差足夠：做多
- `shortScore >= 80` 且多空分差足夠：強烈做空
- `shortScore >= 65` 且多空分差足夠：做空
- 其他情況：觀望

RR 小於 1.5、EV 小於等於 0、BTC 方向不明、Vegas 隧道內震盪、九轉與趨勢衝突等情況會傾向觀望。

## Vegas 隧道與神奇九轉

本專案加入 Vegas 隧道交易與神奇九轉作為輔助判斷。

Vegas 隧道使用 EMA144 與 EMA169 作為趨勢隧道，EMA12 作為短線動能線。當價格與 EMA12 位於隧道上方時，市場偏多；當價格與 EMA12 位於隧道下方時，市場偏空；當價格在隧道內震盪時，系統傾向觀望。

神奇九轉用於判斷短線趨勢疲乏。上漲九轉 9 代表短線上漲可能過熱，不建議追多。下跌九轉 9 代表短線下跌可能過度，不建議追空。神奇九轉不單獨產生交易訊號，只作為反轉警告、追價風險與信心分數調整依據。

## 後續開發計畫

- GitHub Actions 定時更新
- Python 抓取公開市場資料
- 真實計算 EMA、RSI、MACD、ATR
- 真實計算 Vegas 隧道與神奇九轉
- 產生真實 `signals.json`
- 瀏覽器通知、Telegram 通知、Discord Webhook
- 訊號歷史紀錄與簡單回測

## 風險提示

本工具僅提供市場資料整理與技術分析輔助，不構成投資建議。加密貨幣波動極高，任何訊號都可能失效。請自行控制倉位、停損與風險。
