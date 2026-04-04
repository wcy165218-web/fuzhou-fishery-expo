# 后端回归清单

这份清单用于后端渐进重构期间的 `Phase 0` 验证。目标不是一次性全测，而是确保每个小阶段都有明确的最小回归动作。

## 自动检查

每次提交前至少执行：

```bash
npm run check
node --check src/utils/response.mjs
node --check src/utils/crypto.mjs
node --check src/utils/helpers.mjs
node --check src/services/order-fields.mjs
node --check src/services/booth-sync.mjs
node --check src/services/overpayment.mjs
node --check src/services/erp.mjs
node --check src/routes/auth.mjs
node --check src/routes/files.mjs
node --check src/routes/projects.mjs
node --check src/routes/staff.mjs
node --check src/routes/config.mjs
node --check src/routes/booths.mjs
node --check src/routes/expenses.mjs
node --check src/routes/orders.mjs
node --check src/routes/payments.mjs
node --check src/routes/dashboard.mjs
```

如改动涉及 ERP 逻辑，再执行：

```bash
npm run test:erp-sync
```

## 基线说明

- 2026-04-04 当前基线下，`npm run check` 已通过。
- 2026-04-04 当前基线下，`npm run test:erp-sync` 已通过。
- ERP 同步测试已按现行业务规则更新：允许 ERP 导入后形成超收，并通过 `overpaid_pending_count` 标记后续异常处理。

## 每阶段最小冒烟

- 登录成功，能进入系统
- 首页看板正常加载
- 财务管理列表正常加载
- 新录入一笔订单
- 新增一笔收款
- ERP 预检查可以返回结果
- 合同上传成功，合同下载成功

## 涉及订单 / 财务主链路时加测

- 多展位订单录入
- 无展位订单录入
- 联合参展录入
- 编辑客户资料
- 编辑收款
- 删除收款
- 调整订单费用
- 换展位
- 退订
- 超收处理
- 新增支出
- 删除支出

## 涉及配置与权限时加测

- 新增业务员
- 修改业务员角色
- 重置密码
- 业务员排序调整
- 销冠统计开关调整
- ERP 配置保存
- 订单字段配置保存
- 账户配置增删
- 行业配置增删

## 部署前门槛

- 语法检查通过
- 本阶段影响面的最小回归通过
- 若改到高风险主链路，再做一轮人工复核后部署
