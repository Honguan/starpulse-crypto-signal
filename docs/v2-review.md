# StarPulse v2 企劃審查與里程碑

## 審查結果

方向可落實，但原稿混合 Core、MVP 與最終產品。這次依確認的三項工作完成審查、7 份設計文件及第 42 節 Core；後續能力依企劃原順序開發，不先重做 UI。

| 原稿問題 | 本次決定 |
|---|---|
| Core 3 幣、Phase 1 5 幣、MVP 6 幣 | Core 預設 BTC／ETH／ENA，可明確配置其餘三幣 |
| MVP 2 策略、Signal phase 3 策略 | Core 先完整 Trend Pullback；Breakout Retest 下一里程碑；Range Reversal 再後 |
| spot 價格與 futures 衍生混用風險 | 全部 Core 市場與成交假設使用 USD-M 永續 |
| Regime 權重有尚無資料來源項目 | 公開 Core 公式與 missing/coverage，不填假的中性值 |
| 76 範例同時標 Bullish／Strong Bullish | ≥76 統一 strong_bullish，其他邊界照表 |
| ACTIVE 易誤認使用者已下單 | 一律 hypothetical tracking，無真實下單或持倉 |
| Trigger close 和 Entry 時序未定 | close 確認，next open 加滑價，RR 再檢查 |
| 只說最低 RR，未指定 TP1／TP2 | TP1 最低 1.5，第二個目標必須真有結構空間 |
| Backtest 只列指標、未定成交規則 | 明確成本、部分出場、同根保守 SL、缺口與資料不可用 |
| timestamp≤T 不足以防資料洩漏 | source timestamp 與 available_at 同時≤T |
| 「永久保存」缺少備份區分 | 無自動刪除、named volume；正式備份另需維運落地 |

## Core 驗收清單

- Docker Compose 可啟動 FastAPI、TimescaleDB／PostgreSQL、獨立 Collector。
- 三個預設市場、四級別 closed OHLCV 持續更新與分頁補齊；Funding／OI 保存來源與接收時間。
- EMA／RSI／MACD／ATR、rolling VWAP、VolumeMA、Trend、確認結構、zones 可輸出。
- Market Regime 與單幣分離；stale／extreme fail closed。
- Trend Pullback 可進入狀態機；history／immutable snapshot／events／結果重啟後仍保留。
- 基本 REST、deterministic tests、DB/API 整合驗證與 v1 regressions。
- 回放／統計引擎提供可測基礎；不虛構實際歷史績效。

## 後續產品工作

| 里程碑 | 完成條件 |
|---|---|
| 完整 Data MVP | 6 幣、CoinGecko／Fear & Greed、衍生完整欄位與持續服務監測 |
| 完整 Signal MVP | Breakout Retest、跨級別 zones、版本化歷史研究 |
| 90 天 Backtest | 真實 point-in-time dataset、historical replay report、coverage、樣本外驗證 |
| Frontend v2 | React/TypeScript/Vite、scanner/detail/history/backtest、桌機手機可用 |
| Alerts | 指定 Telegram/ntfy/Discord 接收設定、事件去重、投遞狀態；實際傳訊需使用者授權 |
| Advanced Data / AI | 來源配額與權限就緒後才加；AI 只解釋結構化量化結果 |

文件的完成不等於這些後續功能已交付。部署、遠端推送／PR／merge 不包含在本次本機實作中。

## 本機驗收紀錄（2026-09-07）

- Core 63 項測試通過：45 項 deterministic、18 項真實 TimescaleDB／API／Pipeline；完整套件已在 Linux 容器執行，最後 API 調整也重跑 7 項通過。
- v1 README 的 12 項檢查及全部已追蹤 JavaScript syntax checks 通過。
- Docker image build、Compose 三服務啟動、migration、API health、OpenAPI 與 `actionlint` 的 v2 workflow 驗證通過。
- 實際 Binance 三幣 × 四級別完成初始 2,640 根，跨下一次 15m 收盤持續更新至 2,643 根；Funding／OI 多輪持續保存。實際 DB restart 前後皆為 2,643 根，API 恢復 healthy。
- 已驗證選填 hourly 統計舊 baseline 不誤判最新資料 stale、最多 5 秒 clock skew 延後 availability、來源故障立即阻擋新建議，以及 outage 沒有新 K 線也會到期。
- 測試依賴會輸出 Starlette/httpx、AnyIO 的 deprecation warnings；測試通過，未隱藏警告。未執行遠端 CI 或發布。

本機驗證 API 使用 `http://127.0.0.1:18081/docs`；8000 在此 Windows 主機被限制，透過既有 `API_PORT` 設定改用 18081。一般安裝仍預設 8000。驗證用資料庫密碼與 `.venv` 不進 Git。

變更檔案範圍：`README.md`、本組 8 份文件、`services/` 6 個模組、`apps/api/main.py`、`database/migrations/001_core.sql`、`tests/` 8 個檔案，以及 Dockerfile、Compose、`.dockerignore`、`requirements.txt`、`.github/workflows/v2-core.yml`。
