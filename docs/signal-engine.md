# Trend Pullback / Signal Engine

Signal 是可解釋的假設性計畫，不是交易所訂單。Setup Quality 與市場 Risk 分別保存；分數只用排序。

## Setup

只有健康且當時已取得的四級別 Features、Funding／OI，以及可用的 Market Regime，才可建立候選。1h 與 4h 趨勢必須同向；多頭配 bullish／strong_bullish，空頭配 bearish／strong_bearish，neutral 不啟用 Trend Pullback。4h 結構需同向且有已確認 pivot。

價格距最近合適 zone 中心不超過 2 ATR；1h RSI 多方 40–65、空方 35–60，避免已完全反轉的 momentum。Entry 取 zone，SL 取結構與 zone 外側再加 0.25 ATR。TP1／TP2 取兩個真實對向區域；不足兩個不生成候選；TP1 RR<1.5 為 NO_TRADE，不能以遠處 TP2 掩飾近處障礙。

快照保存 Features、market、derivatives、zone、stop、targets、trigger volume threshold、建立／到期時間。相同 anchor 不反覆建立新訊號；新 anchor 才有新 ID。初始紀錄後不重新計算舊位置。

## 狀態

`SCANNING → SETUP_FOUND → WAITING_TRIGGER → ENTRY_ZONE → TRIGGERED → ACTIVE → TP1 → TP2`。

SCANNING／SETUP_FOUND 與等待狀態可在同次 evaluation 記錄多個事件。ENTRY_ZONE 是價位觸及，不表示成交。15m 收盤收復 zone 邊界、K 線方向與交易方向一致、volume 至少達建立時的 VolumeMA20 才 TRIGGERED。這是 Core 的固定可回放 rejection trigger；不是未實作的即時 order flow 判定。

TRIGGERED 的下一根 15m open 才模擬進場，加入 adverse slippage 後重新檢查 RR。開盤跳空使 RR<1.5 或價格越過失效位置即 CANCELLED，不回填理想 Entry 價。

未進場時價格破 SL → INVALIDATED；24h 尚未進場 → EXPIRED；缺失必要的後續 K 線 → CANCELLED／資料不確定，不假造結果。ACTIVE／TP1 不受 Setup 的 24h 到期影響，直到 TP／SL。Extreme／stale 禁止新建議，歷史保留。

## 假設性成交與結果

- 固定 entry／exit adverse slippage 5bps，每邊 fee 4bps；與 snapshot 同存。
- TP1 平倉 50%，TP2 平剩餘 50%，不默默把 SL 移至損益平衡。
- 同根 candle 同時觸及 TP/SL，先算 SL；開盤越過 SL 使用更不利的開盤價。
- `realized_r` 扣除手續費；`mfe_r`／`mae_r` 是 OHLC 級近似值，包含退出整根 candle，不是精確成交前路徑。
- 保存 events、fills、entry_time、exit_time、remaining，重啟後只消費尚未處理的 bars。

這些規則是可重現的研究假設，未宣稱反映真實交易所撮合。改策略／成本參數前應新增明確版本與比較報告，保留既有快照。
