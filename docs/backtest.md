# Historical Replay 與績效

Core 提供可重用的 `services.backtest.replay` 與 `summary`，以及已保存訊號的 summary API。完整「過去 90 天策略是否有效」需要對應期間的 K 線與當時可用的 derivatives；沒有那些資料不產生績效主張。

## 回放契約

`replay(candles, feature_provider, market_provider, derivatives_provider)`：按 close_time 排序，同時間所有 symbol／timeframe 先加入歷史，再在 close_time+1 逐 15m 決策。Provider 只收到截至當時的 copied history 與 as_of；四級別分析、跨資產市場與衍生資訊必須符合當時可取得的條件。使用與 live 相同的 detect_setup／advance，按穩定 signal ID 去重。

Feature provider 呼叫 analyze 時使用實際收盤邊界（Binance close_time+1）；不得讀 callback 以外的未來資料。衍生歷史須同時滿足 timestamp／available_at≤決策時間；今日取得的舊統計不能假裝昨日已可用。

Swing 的 confirmed_at 才是可用時刻；禁止使用 pivot 本身的 open_time 提前決策。Trigger bar 關閉後，下一根 open 才可進場，禁止同根回填進場並取全部高低點獲利。重複衝突、缺口與成交順序必須測試，不能藉排序掩飾資料缺漏。

## 統計定義

全部報酬以每筆 initial risk=`abs(entry−SL)` 標準化為 R；扣 4bps 每邊 fee 與 5bps adverse slippage。TP1 一半、TP2 剩餘。只用有 exit_time 的結束交易計算勝負；未進場、未結束與資料不確定的取消不算輸贏。

| 指標 | 定義 |
|---|---|
| count／trigger_rate | 訊號總數；有 TRIGGERED event 的占比 |
| win_rate／loss_rate | 淨 realized R>0／<0 的結束交易占比 |
| profit_factor | 正 R 加總 / 負 R 絕對值加總；分母零為 null |
| expectancy_r | 結束交易平均淨 R |
| average_rr | 結束交易實際假設進場後的 TP1 RR 平均 |
| max_drawdown_r | 依 exit_time 排序的累積 realized R 從峰值最大回落 |
| mfe_r／mae_r | 結束交易平均整根 OHLC 最大順／逆向幅度（R） |
| holding_time_ms | exit_time−entry_time 平均 |

Drawdown 是等初始風險的閉倉序列，不是含浮盈浮虧的帳戶淨值／保證金回撤。不得把它改標為實際帳戶百分比。沒有 closed samples 時平均值／勝率為 null。

分組：symbol、setup、direction、market_regime、timeframe、UTC month、volatility_regime。波動分組依 1h ATR/price：<2% low、2–<4% normal、4–<8% high、≥8% extreme，獨立於包含 Funding 的 Risk。樣本數須一起展示，不只挑最好看的分組。未加入歷史 funding settlement、流動性／市場衝擊的成本模型需在完整 MVP 研究前補齊。

## 驗收

Deterministic fixtures 覆蓋：當時 history 不含未来、相同時間批次、排序／重複、next-open Entry、gap、保守 TP/SL、部分止盈與成本、無樣本／無虧損分母。真實 DB 測試驗證 snapshot 不被後續 state update 改寫及 available_at 過濾。

上線累積的訊號歷史可以直接回答「這些已保存計畫後來如何」，但不可冒稱 unbiased 全市場回測。正式 90 天報告另需固定 universe、成本版本、策略版本、warmup、資料覆蓋與樣本外區間。
