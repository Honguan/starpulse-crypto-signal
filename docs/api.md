# v2 Core API

FastAPI `/docs` 提供實際 OpenAPI。Base：`http://127.0.0.1:8000`。只提供 GET，不下單、不保存交易所私鑰。

| Endpoint | 參數／結果 |
|---|---|
| `/health` | 程序與 DB 存活；DB 失敗 503 |
| `/api/v1/health` | 各來源 updated_at、age_ms、status、error |
| `/api/v1/market/regime` | score、regime、risk、components、coverage、timeframe_trends |
| `/api/v1/symbols/{symbol}` | 四級別 Features、structure、zones、derivatives、最近 20 筆 signals |
| `/api/v1/symbols/{symbol}/candles` | timeframe=15m/1h/4h/1d；limit 1–1000，預設 240；按時間遞增 |
| `/api/v1/scanner` | direction=LONG/SHORT、setup=trend_pullback、minScore=0–100；依 setup_score 排序 |
| `/api/v1/signals` | symbol 可選；limit 1–1000，預設 100；offset≥0；依 created_at DESC,id 分頁 |
| `/api/v1/signals/{id}` | snapshot 原始快照與 payload 目前狀態；tracking=hypothetical |
| `/api/v1/backtest/summary` | 已保存 signal outcomes 的統計；不是自動產生的 90 天研究報告 |

所有行情符號使用 `BTCUSDT` 等 Binance 永續 symbol。未設定 symbol／不存在 id 回 404；不合法 timeframe、direction、分數／分頁回 422；分析尚未建立回 503。沒有行情時不放示範資料。

分析回應包含 source、updated_at、age_ms、stale、status；最新 materialization 超過 120 秒會動態標 stale。前端不可把歷史 signal 的存在視為現在可以進場，必須同步檢查資料健康與 signal 狀態。Scanner 排除 stale 資產。

來源一旦回報失敗，API 立即覆核 source health，即使 analysis 尚未重算也會標 stale。歷史列表的 `data_quality` 依 symbol 公開當前資料狀態；不改寫原始 signal snapshot。Extreme Risk 與資料 stale 分開，健康資料也可能具有 extreme risk。

Schema 用 snake_case；價格／指標是 JSON number，缺值是 null，時間是 UTC 毫秒，狀態是大寫枚舉。Core 不把旧 `data/signals.json` schemaVersion 或 v1 compact schema 拿來作 v2 API 版本。

`profit_factor=null` 表示沒有負報酬可作分母；沒有已結束樣本時 win_rate／expectancy 等為 null，不顯示 0% 勝率。所有績效依 R 計算，詳見 [Backtest](backtest.md)。

WebSocket `/ws/*`、marketCap filter、通知寫入與 UI v2 不在第 42 節 Core；加入前先定事件序號／斷線恢復契約。API 預設只綁 localhost；正式前端跨來源部署另設明確來源與存取政策。
