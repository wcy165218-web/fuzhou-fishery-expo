# 后端渐进重构修改日志与进度

更新时间：2026-04-04

## 当前结论

- `Phase 0` 到 `Phase 5` 已完成。
- 当前后端已从单文件 Worker 逐步拆成 `utils / services / routes` 结构。
- [\_worker.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/_worker.js) 已收敛为入口、鉴权与少量共享辅助函数，不再承载主要业务路由实现。
- 自动检查基线当前通过：
  - `npm run check`
  - `npm run test:erp-sync`

## 本线程完成的阶段

### Phase 0：保护层

已完成：

- 新增 API 清单文档 [BACKEND-API-INVENTORY.md](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/docs/BACKEND-API-INVENTORY.md)
- 新增回归清单文档 [BACKEND-REGRESSION-CHECKLIST.md](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/docs/BACKEND-REGRESSION-CHECKLIST.md)
- 固定每阶段最小回归动作与自动检查基线

### Phase 1：工具层抽离

已完成：

- 抽离响应与安全头工具 [response.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/utils/response.mjs)
- 抽离密码/JWT/ERP 敏感信息处理 [crypto.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/utils/crypto.mjs)
- 抽离时间、数值、地区、费用解析等纯函数 [helpers.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/utils/helpers.mjs)

### Phase 2：服务层抽离

已完成：

- 展位状态同步服务 [booth-sync.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/services/booth-sync.mjs)
- ERP 配置与同步辅助服务 [erp.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/services/erp.mjs)
- 订单字段配置服务 [order-fields.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/services/order-fields.mjs)
- 超收异常服务 [overpayment.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/services/overpayment.mjs)

### Phase 3：低耦合路由拆分

已完成：

- 认证路由 [auth.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/auth.mjs)
- 文件上传与合同下载 [files.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/files.mjs)
- 项目管理 [projects.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/projects.mjs)
- 员工与权限配置 [staff.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/staff.mjs)
- 系统配置与 ERP/行业/账户配置 [config.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/config.mjs)

补充：

- 合同上传 key 已改为 `crypto.randomUUID()` 生成，避免继续使用 `Math.random()`

### Phase 4：中风险路由拆分

已完成：

- 展位与价格路由 [booths.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/booths.mjs)
- 支出路由 [expenses.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/expenses.mjs)

说明：

- `/api/prices` 已并入 `booths` 域
- `change-order-booth / update-order-fees / resolve-overpayment` 当时刻意留在主链路阶段处理

### Phase 5：高风险主链路拆分

已完成：

- 订单主链路 [orders.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/orders.mjs)
- 收款与超收主链路 [payments.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/payments.mjs)
- 订单与首页统计看板 [dashboard.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/dashboard.mjs)

补充：

- `change-order-booth` 中原来对 `BOOTH_UNIT_AREA` 的潜在运行时隐患已收口，现统一走 `toBoothCount()` 口径

## 当前目录结构

已形成：

```text
src/
  utils/
    response.mjs
    crypto.mjs
    helpers.mjs
  services/
    booth-sync.mjs
    erp.mjs
    order-fields.mjs
    overpayment.mjs
  routes/
    auth.mjs
    files.mjs
    projects.mjs
    staff.mjs
    config.mjs
    booths.mjs
    expenses.mjs
    orders.mjs
    payments.mjs
    dashboard.mjs
```

## 入口文件现状

- [\_worker.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/_worker.js) 负责：
  - 非 API 资源转发
  - CORS 与安全头
  - JWT 鉴权
  - 登录状态校验
  - 少量共享权限/金额辅助函数
  - 路由分发

- [\_worker.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/_worker.js) 不再直接承载：
  - 登录逻辑细节
  - 展位管理逻辑
  - 订单录入/换展位/退订逻辑
  - 收款增删改与超收处理
  - 统计看板计算

## 测试与校验记录

本线程内已确认：

- `npm run check` 当前通过
- `npm run test:erp-sync` 当前通过

ERP 相关额外说明：

- 测试已按现行业务规则同步更新
- 当前业务规则为：ERP 收款允许导入后形成超收，再由后续超收异常处理链路消化
- 对应断言更新在 [erp-sync-core.test.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/tests/erp-sync-core.test.mjs)

## 本线程涉及的关键文件

已修改或新增的主要文件：

- [\_worker.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/_worker.js)
- [package.json](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/package.json)
- [erp-sync-core.test.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/tests/erp-sync-core.test.mjs)
- [BACKEND-API-INVENTORY.md](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/docs/BACKEND-API-INVENTORY.md)
- [BACKEND-REGRESSION-CHECKLIST.md](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/docs/BACKEND-REGRESSION-CHECKLIST.md)
- [BACKEND-REFACTOR-PROGRESS.md](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/docs/BACKEND-REFACTOR-PROGRESS.md)
- [src/utils/response.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/utils/response.mjs)
- [src/utils/crypto.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/utils/crypto.mjs)
- [src/utils/helpers.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/utils/helpers.mjs)
- [src/services/booth-sync.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/services/booth-sync.mjs)
- [src/services/erp.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/services/erp.mjs)
- [src/services/order-fields.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/services/order-fields.mjs)
- [src/services/overpayment.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/services/overpayment.mjs)
- [src/routes/auth.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/auth.mjs)
- [src/routes/files.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/files.mjs)
- [src/routes/projects.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/projects.mjs)
- [src/routes/staff.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/staff.mjs)
- [src/routes/config.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/config.mjs)
- [src/routes/booths.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/booths.mjs)
- [src/routes/expenses.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/expenses.mjs)
- [src/routes/orders.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/orders.mjs)
- [src/routes/payments.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/payments.mjs)
- [src/routes/dashboard.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/dashboard.mjs)

## 当前剩余事项

结构性重构层面：

- 本轮计划内的 `Phase 0` 到 `Phase 5` 已完成
- 若继续推进，重点会从“拆结构”转为“人工冒烟回归、提交整理、部署验证”

建议的手动冒烟顺序：

- 登录
- 新增订单
- 多展位订单
- 换展位
- 新增收款
- 编辑收款
- 删除收款
- 超收处理
- 支出新增/删除
- 首页看板
- 订单统计看板
- 合同上传与下载

## 建议的下一步

- 若准备提交代码，先做一轮人工冒烟
- 若准备继续整理代码，可以把 `_worker.js` 中残留的共享权限与金额辅助函数继续迁往 `src/middleware.mjs` 或 `src/utils/permissions.mjs`
- 若准备部署，先基于 [BACKEND-REGRESSION-CHECKLIST.md](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/docs/BACKEND-REGRESSION-CHECKLIST.md) 完成最小回归
