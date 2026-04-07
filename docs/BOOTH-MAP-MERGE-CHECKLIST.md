# 展位图功能合并到 main 前的数据迁移清单

## 结论先说

- 不建议先清空 `Orders`
- 不建议直接清空整张 `Booths`
- 正确做法是：让新展位图里的 `展位号` 与旧展位库里的 `Booths.id` 保持一致，再保存展位图

当前代码在保存展位图时会把展位同步到 `Booths`：

- 如果 `Booths` 里已经存在同项目同展位号的旧记录：
  - 会把这条旧记录升级为展位图来源
  - 会写入 `booth_map_id`
  - 会把 `source` 改成 `map`
  - 会更新馆号、类型、面积、长宽、开口
  - 不会覆盖旧的 `base_price`
  - 不会覆盖旧的 `status`
- 如果 `Booths` 里不存在：
  - 会新增一条展位库记录

这意味着，只要新展位图使用的展位号和旧展位库一致，旧订单、旧收款、旧合同都可以继续挂在原来的展位号上，不需要清空历史数据。

## 为什么不要清空 Orders

`Orders.booth_id` 目前就是按展位号关联 `Booths.id`。

如果直接清空订单：

- 会丢失历史成交记录
- 会丢失付款、超收、合同等业务痕迹
- 展位状态也会一起被重算为初始状态

除非你明确要放弃历史业务数据，否则不建议这样做。

## 为什么通常也不要整表清空 Booths

旧展位库里可能已经有：

- 独立单价
- 锁定状态
- 历史订单引用

如果整表清空：

- 订单会变成悬挂引用风险
- 单价和锁定状态会全部丢失
- 需要再重新人工补录

而现在这版同步逻辑已经支持“同展位号覆盖升级”，所以没有必要先把整张表删掉。

## 推荐迁移方案

### 第一步：先备份

至少备份：

- D1 数据库
- R2 合同文件
- 当前 `main` 分支代码

### 第二步：按旧展位号绘制展位图

每个项目/每张画布里：

- 展位图中的展位号必须与旧展位库中的展位号完全一致
- 例如旧库是 `1A01`，新图里也必须是 `1A01`

这是平滑迁移的关键。

### 第三步：保存展位图，让系统自动同步到 Booths

保存后会发生：

- 旧的同号展位记录被升级为 `map` 来源
- 旧订单仍继续引用原展位号
- 展位库数据开始由展位图维护

### 第四步：检查“未纳入展位图”的旧手工展位

需要重点排查两类残留：

1. 旧展位库里有，但展位图里没有的手工展位
2. 已被订单引用，但展位图里还没画出来的旧展位

处理建议：

- 如果该手工展位没有任何订单引用：可以后续删除
- 如果该手工展位已有订单引用：不要删，先把它补画进展位图，并保持展位号一致

### 第五步：最后再做清理

当你确认某个项目的展位图已经完整覆盖旧展位库后，再清理那些：

- `source = 'manual'`
- `booth_map_id IS NULL`
- 且没有任何订单引用

的残留手工展位。

## 不建议的做法

### 方案 A：先清空 Orders 再上线

不建议。代价太大，业务数据直接丢失。

### 方案 B：先清空 Booths 再靠展位图重建

通常也不建议。因为旧单价、锁定状态和订单关联会很难恢复。

### 方案 C：展位图里改成一套新展位号

不建议。如果展位号变了，旧订单不会自动迁移到新编号。

## 上线前人工核对清单

每个项目至少核对以下几项：

1. 展位图中的展位号是否与旧展位库一致
2. 已有订单引用的展位，是否都已经出现在展位图中
3. 展位库里的独立单价是否仍保留
4. 手工锁定的展位是否仍保持 `已锁定`
5. 终版预览里的颜色状态是否与订单/收款一致

## 可执行 SQL 排查思路

### 查未纳入展位图的旧手工展位

```sql
SELECT b.id, b.hall, b.type, b.area, b.status
FROM Booths b
LEFT JOIN BoothMapItems bmi
  ON bmi.project_id = b.project_id
 AND bmi.booth_code = b.id
WHERE b.project_id = ?
  AND (b.source IS NULL OR b.source = 'manual')
  AND b.booth_map_id IS NULL
  AND bmi.booth_code IS NULL
ORDER BY b.id;
```

### 查未纳入展位图但已被订单引用的旧展位

```sql
SELECT b.id, COUNT(o.id) AS order_count
FROM Booths b
JOIN Orders o
  ON o.project_id = b.project_id
 AND o.booth_id = b.id
 AND o.status = '正常'
LEFT JOIN BoothMapItems bmi
  ON bmi.project_id = b.project_id
 AND bmi.booth_code = b.id
WHERE b.project_id = ?
  AND (b.source IS NULL OR b.source = 'manual')
  AND b.booth_map_id IS NULL
  AND bmi.booth_code IS NULL
GROUP BY b.id
ORDER BY b.id;
```

## 最推荐的上线顺序

1. 先在当前分支完成代码收尾
2. 用真实项目数据做一次迁移预演
3. 确认展位图展位号与旧展位号对齐
4. 保存展位图并核对 Booths / Orders / 终版预览
5. 清理“未被订单引用的残留手工展位”
6. 再合并到 `main`
7. 最后部署生产

## 这版代码对迁移最重要的前提

不是“先清库”，而是：

`展位图中的展位号必须复用旧展位号`

只要这一点成立，现有数据就能最大程度平滑接入新逻辑。
