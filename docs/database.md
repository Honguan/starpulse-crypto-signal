# Core Database

使用 PostgreSQL／TimescaleDB；migration 在 API／Collector 啟動時套用，advisory transaction lock 防止競爭，每份檔案存 SHA256 checksum，已套用檔案被改動會拒絕啟動。變更 schema 必須新增 migration。

## Tables

| Table | Key | 用途 |
|---|---|---|
| candles | exchange,symbol,timeframe,open_time | USD-M OHLCV，7 天整數毫秒 chunk 的 hypertable |
| derivatives | exchange,symbol,timestamp | 每次觀察的 JSONB、available_at，索引支援 point-in-time |
| signals | id | 首次建立的不可覆寫 snapshot、symbol、created_at |
| signal_results | signal_id FK | 目前完整假設性狀態與結果 |
| signal_events | signal_id,sequence | 逐狀態事件，冪等 append |
| latest_analysis | key | 每資產／market 最新 materialization |
| data_health | key | 每来源最近有效時間、狀態與失敗原因 |
| metadata | symbol | 額外資產 metadata 的儲存界面，Core 未接 CoinGecko |
| schema_migrations | name | 已套用版本與 checksum |

`signals.snapshot` 包含四級別 Features、market、derivatives、entry_zone、SL、TP、策略版本所用固定費率及觸發條件。Core 用 JSONB 保留完整快照，不先把尚未穩定的 feature contract 展開成數十個欄位。

Signal ID 對 symbol／direction／setup／已確認 anchor 決定性雜湊。插入衝突不更新初始快照；更新結果與追加事件同一 transaction 完成。重試不重複事件；較舊 candle cursor 不覆蓋較新結果。API 詳情同時返回初始 snapshot 與目前 payload。

## 時間與資料邊界

全部時間為 UTC 毫秒。Binance candle close_time=`open_time+interval−1`；collector 僅在 interval 結束後寫入。歷史 derivatives 查詢同時限制 `timestamp<=T AND available_at<=T`，避免今天補抓的統計被放回昨天。

衍生觀察另保存 `received_at` 與 `clock_skew_ms`。來源領先本機不超過 5 秒時，`available_at=max(received_at, 所有納入的來源時間)`，保守延後可使用時點；超過 5 秒拒收。這不改寫來源時間，也不把尚未到達的本機時刻當作已可用資料。

OHLC 必須正數且 low≤open/close≤high，volume 有限且非負。SQL 使用參數綁定，DB 亦有基本約束。Candle／derivative 主鍵衝突不覆寫首次已保存資料，維持可重播輸入；交易所資料修訂應另建有審计紀錄的修訂流程。

## 維運與資料保存

訊號、事件與結果沒有自動刪除政策；Docker named volume 永久保存至管理者明確刪除。這不等同備份：正式運行需安排 `pg_dump` 與外部保存、定期還原演練。Core 未執行遠端部署或建立外部備份服務。

整合測試只接受名為 `starpulse_test` 的獨立 DB，會清空該測試 DB 的 Core tables；嚴禁指向實際市場歷史庫。驗證 migration 冪等、candles 去重、available_at 過濾、snapshot 不可覆寫、重開連線後資料仍存在。
