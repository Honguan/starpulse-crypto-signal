# StarPulse 介面設計

參考 [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 的
[Coinbase](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/coinbase/DESIGN.md) 與
[Linear](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)。
採用清楚的金融資訊層級、簡潔邊框與一致間距；以下為 StarPulse 自身規格，並非品牌介面的複製。

- 白色工作面搭配淺灰藍背景 `#f4f6fa`，主要操作使用藍色 `#2454cf`。
- 正文 `#18243a`，次要文字 `#58667c`，邊框 `#dce3ee`；不靠大陰影或裝飾圖片分層。
- 多方綠 `#087f5b`、空方紅 `#be2944`，必須同時提供方向或狀態文字。
- 沿用系統字型，不載入第三方字型；價格採等寬數字，保留 USD 單位。
- 內容最大寬度 1240px；桌面兩張計畫卡並排，1000px 以下單欄，430px 以下多空方案改為上下排列。
- 卡片圓角 12px，操作元件 8px；採 4px 間距級距，觸控目標至少 44px。
- 閱讀順序：資料狀態 → 市場總覽 → 搜尋與篩選 → 多空計畫。風險說明與策略推導可展開。
- 明確區分行情串流與策略快照；排序與方向篩選使用快照，不隨每次行情跳動改變卡片位置。
- 保留焦點框、跳至計畫連結、動態狀態通知與圖表文字摘要。價格 tick 不朗讀。
- 載入、失敗、空結果、未收藏、K 線不足與儲存受限都需要可理解的說明與下一步。
- 不將條件分數稱為勝率，不顯示虛构績效；觀望或過期計畫不展示主要 RR。
