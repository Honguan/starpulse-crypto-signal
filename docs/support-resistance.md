# Structure 與 Support / Resistance

## 已確認 Swing

每根 K 線的 high／low 與左右各兩根比較，嚴格大於／小於所有鄰居才成立；相同高低值不強行選 pivot。Pivot 的 `open_time` 是轉折時間，`confirmed_at` 是第二根右側 K 線的閉合時間。只能在確認後使用。

同側最近兩個 pivot 產生 HH／LH、HL／LL。收盤突破最近確認 high／low 時產生 BOS；相對上次結構方向反轉時產生 CHoCH。同一個 pivot 的 break 只記一次。所有事件包含突破級別、方向與確認時間。

## Zone 生成

來源：最近 40 個已確認 swings、前 20 根的最高／最低（排除當根）、EMA20／50／200、rolling VWAP20。VWAP 使用 `(high+low+close)/3 × volume`，不是交易所逐筆成交 VWAP；名稱與週期固定公開。

將價位排序；相距不超過 0.5 ATR 的來源聚合。區域上下各加 0.25 ATR buffer。以 midpoint 相對 close 區分 support／resistance；支撐依距離由近至遠，壓力由低至高。`strength` 是來源數，`sources` 公布原因；不是企劃 UI 示例的已校準「5/5」評級。

Zone 的價位來源一定包含結構／區間及指標；Entry 不能只由 EMA±固定比例生成。訊號另要求確認結構、同向趨勢及合適的回踩距離。Stop 優先結構失效邊界再加 ATR buffer；TP 使用實際對向 Zone，空間不足不產生可交易建議。

目前各時間級別獨立輸出區域；完整多級別 zone merge、成交量 cluster、round-number、retest 及 range 策略仍需獨立驗證，未把它們冒稱為已接入的支撐來源。

## 驗證

固定 fixture 覆蓋確認延遲、未來 K 線不改寫既有 pivot、BOS 單次、CHoCH、來源合流。缺失／亂序／重複／未閉合 candles 回傳明確不可用，不補零、插值或從不連續數列產生位置。
