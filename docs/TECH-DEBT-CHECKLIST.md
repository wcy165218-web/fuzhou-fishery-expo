# 技术债清单

更新时间：2026-04-09

## 当前基线

- 当前版本已按 Cloudflare D1 Free 档约束补上第一波安全护栏。
- 当前基线检查已通过：
  - `npm run check`
  - `npm test`

## 本轮已完成

### 已补上的高优先级债

- 已完成：统一请求体限制。
  - 入口层现在会先按路径做 `Content-Length` 拦截。
  - JSON 默认上限 `256 KB`。
  - 合同上传入口上限 `7 MB`，业务层仍保留 `6 MB` 文件校验。
  - 展位图底图入口上限 `11 MB`，业务层仍保留 `10 MB` 文件校验。
  - 所有路由已切到共享 `readJsonBody / readFormDataBody`，不再直接调用 `request.json()` / `request.formData()`。

- 已完成：展位图保存和订单提交的爆量护栏。
  - `save-booth-map-items` 已限制 `items <= 300`、`deleted_booth_codes <= 300`。
  - 展位图保存前会按 D1 调用预算做预估，超预算直接拒绝。
  - `submit-order` 已限制 `selected_booths <= 20`。

- 已完成：项目清空的原子化删除。
  - `clear-project-rollout-data` 已改为单次 `env.DB.batch([...])` 执行。
  - 响应会返回每张表的 `deleted_counts`。

- 已完成：`/api/orders` 服务端分页和服务端筛选。
  - 新增 `page`、`pageSize`、`search`、`businessSearch`、`paymentStatus`、`salesName`。
  - 返回值已改为 `{ items, total, page, pageSize, totalPages, hasMore }`。
  - 前端订单页已切到服务端分页，不再本地持有全量订单后筛选。

- 已完成：导出与合同批量下载改为“按当前筛选结果”。
  - Excel 导出会自动分页抓取当前筛选结果后再导出。
  - 合同批量下载也改为按当前筛选结果打包。
  - 订单页勾选框和“全选当前页”交互已移除。

- 已完成：展位并发锁。
  - 新增 `BoothLocks` 表和迁移脚本。
  - `submit-order` 和 `change-order-booth` 现在会先按展位号排序抢锁，再做占用校验和写入。
  - 冲突统一返回可预期的 `409` 业务错误。
  - 锁释放放在 `finally`，TTL 默认 `30 秒`。

- 已完成：批量展位状态刷新和 ERP 同步分块。
  - 新增 `syncBoothStatusByBoothIds`，替代逐展位循环刷新。
  - `erp-sync` 已改为预取已存在 ERP 收款、汇总语句、分块 `batch` 执行。
  - 同步后的展位状态和超收状态也改为按批次刷新。

- 已完成：R2 下载异常处理与 admin 配置基础校验。
  - 合同下载路径已加显式异常处理。
  - 账户、行业、ERP 配置已补必填、长度、URL 等基础校验。

- 已完成：`home-dashboard` 的重复全量读取和部分重 CPU 聚合已先收两轮。
  - 非管理员场景不再重复查询全量订单和全量收款。
  - 当前改为“项目维度全局查一次，再按当前用户缩范围”。
  - 展馆概览已下推到 SQL 聚合。
  - 地区分布已改为数据库先按 `region` 聚合，再按既有口径映射到图表结构。
  - 销售概览已去掉按员工逐个过滤订单/收款的重复扫描。
  - 管理员场景下的付款聚合已改成 SQL 聚合，首笔付款日期也已改成 SQL `MIN(payment_time) GROUP BY order_id`。

### 本轮新增自动化

- `tests/request-guards.test.mjs`
  - 覆盖请求体上限、非法 JSON、表单读取异常。

- `tests/booth-locks.test.mjs`
  - 覆盖锁归一化、冲突释放、过期锁清理、跨项目并存。

- `tests/order-list-helpers.test.mjs`
  - 覆盖订单分页参数归一化和展位图 D1 调用预算估算。

- `tests/route-main-chain.test.mjs`
  - 覆盖 6 个主链路接口的成功、权限拒绝、并发冲突、金额边界。

- `tests/write-rate-limit.test.mjs`
  - 覆盖已认证 POST 限流、31 次超限、GET 不计入、未认证 POST 不计入。

## 已移出的问题

- 已移出：`booth-maps` 的 `DB.batch` 未分块。
- 已移出：`booths` 的 `IN` 子句超过参数限制。
- 已移出：改密码后旧 JWT 仍有效。
- 已移出：`/api/orders` GET 无分页。
- 已移出：`save-booth-map-items` 的 `items` 数组无上限。
- 已移出：`submit-order` 的 `selected_booths` 无上限。
- 已移出：项目清空 8 条 `DELETE` 非原子执行。
- 已移出：ERP 同步逐条查询、逐条 `batch`，容易超过调用预算。

## 当前剩余债点

### Critical

- 已无未完成 Critical 项。

### High

#### H1. `_worker.js` 鉴权每请求查一次 `token_index`

- ✅ 已完成：加入 30 秒 TTL 内存缓存（`staffAuthCache`），在缓存有效期内跳过 Staff 查库。密码重置 / 强制下线场景最长 30 秒生效，可接受。

#### H2. 前端大文件和全局状态仍偏重

文件：

- `public/js/booth-map.js`（3461 行 / 159 个 `window.*`）
- `public/js/finance.js`（1657 行 / 107 个）
- `public/js/order.js`（1326 行 / 87 个）
- `public/js/home.js`（1576 行 / 82 个）

现状：

- 当前仓库约有 583 个 `window.*` 赋值位点；除上述 4 个核心文件外，`api.js / config.js / auth.js / booth.js` 也仍有较多全局暴露。
- 所有页面脚本仍通过全局命名空间隐式耦合。
- 完整模块化需要引入构建工具（Vite / esbuild）并逐文件迁移为 ES Module，非单轮可完成。

阶段化计划：

1. **Phase 1**：引入构建入口，让 `api.js` 导出为 ES Module，其他文件逐步 import。
2. **Phase 2**：按域拆分（order / finance / booth-map），抽出"状态""请求""渲染""弹窗行为"。
3. **Phase 3**：移除 `window.*`，改为模块内部状态 + 显式导出。

### Medium

#### M1. 中国时间处理统一

- ⚠️ 主干已完成：新增 `getChinaDateNow()` 作为单点时区转换函数；`formatChinaDateTime` 内部改用它；`getChinaTimestamp` 改为 `formatChinaDateTime` 的别名；`dashboard.mjs` 主路径的手写 `+8` 偏移已替换。
- 仍有少量时区字面量残留在 `parseChinaDateTime()`、部分 SQL `datetime('now', '+8 hours')`、以及个别前端日期构造中，后续还需继续收口。

#### M2. 外部 CDN 依赖收口

- ⚠️ 部分完成：JSZip CDN 已加 SRI integrity hash + `crossorigin`。Tailwind CDN 是开发模式 JIT（动态内容，SRI 不适用），后续应迁移为构建产物。

#### M3. 备份、回滚与恢复文档

- ✅ 已完成：新增 `docs/BACKUP-AND-RECOVERY.md`，覆盖 D1 备份 / Time Travel、R2 文件备份、Worker 版本回滚、迁移回滚策略、灾难恢复场景和高风险操作检查清单。

## 下一轮建议顺序

1. Tailwind CDN 迁移为构建产物（需引入构建工具）。
2. 前端模块化 Phase 1（构建入口 + api.js ES Module 化）。
3. 前端模块化 Phase 2-3（按域拆分 + 移除 `window.*`）。
4. 收掉剩余时区字面量，完成时间处理统一。
