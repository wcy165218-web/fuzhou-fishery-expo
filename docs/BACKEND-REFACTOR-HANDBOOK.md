# 项目整体情况与后端重构最终方案

本文档用于：

- 让新线程或新协作者快速理解当前项目全貌
- 作为 `_worker.js` 后端重构的统一起点
- 约束后续重构过程中的测试、提交、部署工作流

适用场景：

- 在新线程中继续推进后端模块化重构
- 在不破坏当前线上业务的前提下，逐步拆解当前单体 Worker

---

## 1. 当前项目整体情况

### 1.1 项目定位

这是一个面向展会销售与财务流程的内部业务系统，核心能力包括：

- 展位与项目管理
- 订单录入与订单变更
- 财务收款、代付/返佣、退订、换展位
- ERP 收款同步
- 首页数据看板与业务员销售统计
- 系统配置、字段配置、人员目标管理
- 合同 PDF 上传与下载

当前系统已经不是原型，而是**正在真实业务中使用的线上系统**。因此，后端重构必须遵守：

- 不改变现有 API 路径
- 不改变统计口径
- 不改变权限语义
- 不改变数据库含义
- 不影响现有 Cloudflare + D1 + R2 + 香港 VPS 入口的部署模式

### 1.2 当前运行架构

- 业务后端：Cloudflare Workers
- 数据库：Cloudflare D1
- 文件存储：Cloudflare R2
- 外部访问入口：香港 VPS + Nginx 反向代理
- 前端：静态 HTML + 多个原生 JS 模块

线上入口：

- 香港入口：`http://45.152.65.100`
- Worker 入口：`https://fuzhou-fishery-expo.wcy165218.workers.dev`

### 1.3 当前代码结构概览

#### 后端

- 入口文件：[/_worker.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/_worker.js)
- ERP 核心逻辑已单独拆分为：[erp-sync-core.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/erp-sync-core.mjs)

当前后端特点：

- `_worker.js` 约 3231 行
- 约 49 个基于 `url.pathname` 的路由判断
- 约 66 个顶层函数/函数式定义
- 路由、权限、工具函数、数据库读写、业务规则仍混在一个文件中

#### 前端

- 主页面：[public/index.html](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/index.html)
- 模块脚本：
  - [public/js/api.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/api.js)
  - [public/js/app.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/app.js)
  - [public/js/auth.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/auth.js)
  - [public/js/booth.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/booth.js)
  - [public/js/config.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/config.js)
  - [public/js/finance.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/finance.js)
  - [public/js/home.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/home.js)
  - [public/js/order.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/order.js)

当前前端特点：

- 无框架
- 无构建型组件系统
- 通过模块脚本配合全局 DOM 管理页面
- `home.js`、`finance.js` 体积也已明显偏大

### 1.4 当前数据库与迁移状态

迁移目录在：

- [migrations](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/migrations)

当前关键迁移包括：

- `20260320-1200-local-test-bootstrap.sql`
- `20260323-0900-erp-payment-sync.sql`
- `20260325-0900-login-rate-limit.sql`
- `20260331-0930-order-overpayment-issues.sql`
- `20260331-1500-staff-order-and-order-field-settings.sql`
- `20260401-0900-order-booth-changes.sql`
- `20260404-0900-staff-token-index.sql`

当前数据库已支撑的关键能力：

- ERP 收款同步记录
- 登录失败限制
- 超收异常处理
- 业务员排序和销售看板参与开关
- 订单字段配置
- 换展位记录
- JWT `token_index` 即时失效机制

### 1.5 当前已经完成的重要安全与稳定性改进

以下能力已经在当前代码中落地：

- 密码从旧的简单哈希升级为 `PBKDF2-SHA256`，并兼容老密码迁移
- JWT 增加 `token_index` 校验，可在改密码/重置密码/改角色后即时失效
- ERP 配置中的 `session_cookie` 已支持加密存储，并带旧数据迁移
- 登录态由 `localStorage` 改为 `sessionStorage`
- API 增加了基础 `Cache-Control: no-store` 等安全收口
- 运行时 DDL 主体已迁回 migration，不再依赖 `ensure*` 动态补表
- 收款、支出已改为软删除
- 删除业务员、删除展位已补引用保护

### 1.6 当前最主要的技术债

虽然系统已经可用，但后端仍有明显重构压力：

- `_worker.js` 过大，理解成本高
- 路由链过长，继续加功能风险越来越高
- dashboard 与订单财务逻辑耦合较深
- 服务层边界不清晰
- 公共工具函数分散
- 回归测试仍偏少，重构需要更谨慎

---

## 2. 重构目标与原则

### 2.1 重构目标

把当前单体 [_worker.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/_worker.js) 拆成清晰、可测试、可渐进维护的结构，同时保持：

- API 路径零变更
- 业务逻辑零重写
- 统计口径零主动改动
- 数据结构零破坏
- Cloudflare Workers 原生兼容

### 2.2 重构原则

1. **渐进式拆分，不做一次性推倒**
2. **每个阶段都可单独测试、提交、部署**
3. **优先拆低耦合模块，最后拆高耦合主链路**
4. **先抽工具层和服务层，再拆路由层**
5. **dashboard 最后拆，不抢跑**
6. **前端暂不随本轮后端重构一起大改**

---

## 3. 最终版后端重构方案

### 3.1 最终目标目录结构

```text
_worker.js
src/
  router.mjs
  middleware.mjs
  utils/
    response.mjs
    crypto.mjs
    helpers.mjs
  services/
    booth-sync.mjs
    overpayment.mjs
    erp.mjs
    order-fields.mjs
  routes/
    auth.mjs
    files.mjs
    projects.mjs
    staff.mjs
    config.mjs
    booths.mjs
    orders.mjs
    payments.mjs
    dashboard.mjs
    expenses.mjs
erp-sync-core.mjs
```

说明：

- `_worker.js` 最终变成“瘦入口”
- `src/router.mjs` 保持零依赖轻路由器
- `src/middleware.mjs` 只放请求级逻辑，不变成复杂框架
- `erp-sync-core.mjs` 保持现状，不强行并回

### 3.2 推荐执行顺序

#### Phase 0：重构前保护层

目标：先把“拆之前必须守住的行为”固定下来。

要做的事：

- 列出当前所有 API 路径
- 列出核心回归流程
- 明确每次拆分后必须回归的关键业务

当前至少要回归：

- 登录 / 退出
- 订单录入
- 多展位订单
- 无展位订单
- 联合参展
- 收款 / 编辑收款 / 删除收款
- 代付返佣 / 删除代付返佣
- 订单费用变更
- 换展位
- 退订
- ERP 预检查 / 正式同步
- 超收处理
- 首页看板
- 合同上传与下载

#### Phase 1：先拆最安全的工具层

先提取纯函数，不改路由行为：

- `src/utils/response.mjs`
  - `errorResponse`
  - `internalErrorResponse`
  - `buildCorsHeaders`
  - `buildSecurityHeaders`
  - `withResponseHeaders`

- `src/utils/crypto.mjs`
  - 密码哈希
  - JWT 签发/验证
  - ERP 配置加解密

- `src/utils/helpers.mjs`
  - 时间/金额/省份/数值/费用解析等纯工具函数

这是第一阶段最推荐的起点，风险最低。

#### Phase 2：拆服务层，不先拆路由

优先抽离已经相对成型的业务块：

- `src/services/booth-sync.mjs`
- `src/services/overpayment.mjs`
- `src/services/erp.mjs`
- `src/services/order-fields.mjs`

这一步完成后，`_worker.js` 会明显瘦一点，但对外行为不变。

#### Phase 3：先拆低耦合路由

按风险从低到高拆：

1. `src/routes/auth.mjs`
2. `src/routes/files.mjs`
3. `src/routes/projects.mjs`
4. `src/routes/staff.mjs`
5. `src/routes/config.mjs`

原因：

- 这几个模块边界比较清晰
- 对订单和首页统计的耦合相对较低

#### Phase 4：拆中风险路由

继续拆：

1. `src/routes/booths.mjs`
2. `src/routes/expenses.mjs`

#### Phase 5：最后拆高风险主链路

最后再拆：

1. `src/routes/orders.mjs`
2. `src/routes/payments.mjs`
3. `src/routes/dashboard.mjs`

其中：

- `dashboard.mjs` 必须最后拆
- 不建议太早动 `home-dashboard`
- 推荐在 `dashboard.mjs` 文件内部再拆成 4 到 6 个命名函数，而不是继续碎成很多文件

### 3.3 不建议现在做的事

这轮后端重构中，不建议同时做：

- 前端框架迁移
- Tailwind 正式构建改造
- 全站 UI 组件系统重造
- 数据库表结构大改
- API 路径改名
- 统计口径重算

换句话说：

**本轮只做后端模块化，不做功能重写。**

---

## 4. 推荐的验证与回归方式

### 4.1 基础检查

每次拆分后至少运行：

```bash
node --check _worker.js
```

如果改了新模块：

```bash
node --check src/router.mjs
node --check src/middleware.mjs
node --check src/utils/response.mjs
```

以及总检查：

```bash
npm run check
```

### 4.2 现有测试

当前已有可直接复用的测试入口：

```bash
npm run test:erp-sync
```

这个测试主要覆盖 ERP 核心逻辑，不足以兜底全部重构，但至少应保持持续通过。

### 4.3 手工回归清单

每个阶段部署前建议最少回归：

1. 登录
2. 首页数据看板加载
3. 订单与财务管理列表加载
4. 订单录入提交一单
5. 新增一笔收款
6. ERP 预检查
7. 合同上传与下载

如果本次改动涉及订单/财务主链路，再额外回归：

8. 换展位
9. 超收处理
10. 退订
11. 无展位订单
12. 多展位订单

### 4.4 preview 验证

当阶段性重构完成后，可以继续使用现有 preview 工作流：

```bash
npm run dev:preview
```

用于连接真实 D1/R2 做更接近生产的验证。

---

## 5. 提交、部署、推送工作流

本项目后续继续沿用当前成熟工作流。

### 5.1 开发策略

建议在重构线程里采用：

- 小步改动
- 小步验证
- 小步提交

不要一次性把 `_worker.js` 全拆完再看是否能跑。

### 5.2 推荐提交粒度

建议按 Phase 或按模块提交，例如：

- `refactor: extract worker response utils`
- `refactor: move crypto helpers into module`
- `refactor: extract erp service from worker`
- `refactor: split auth routes from worker`

不要提交为：

- `refactor everything`
- `big cleanup`

### 5.3 推荐部署节奏

只有在满足下面条件时才部署：

- `node --check` 通过
- `npm run check` 通过
- 关键回归至少过一轮

部署继续沿用当前命令：

```bash
HOME=/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/.wrangler-home npm run deploy
```

### 5.4 GitHub 推送策略

当前项目的实际协作习惯是：

- 本地先整理
- 确认稳定后再统一 push / 推 GitHub

因此本轮重构也建议继续保持：

- 先本地 commit
- 通过验证后再决定是否 push

### 5.5 新线程协作建议

你准备开一个新线程专门做后端重构，这是非常合适的。  
建议新线程按这个顺序推进：

1. 先让新线程阅读本文档
2. 明确当前要做的 Phase
3. 每次只推进一个小阶段
4. 每个阶段结束后：
   - 语法检查
   - 最少回归
   - 再提交
5. 需要时再回到当前线程或新线程中继续让我帮你：
   - 对比改动
   - 补回归清单
   - 做 commit
   - 做 deploy
   - 做 push

---

## 6. 当前阶段的最终建议

一句话版：

**现在适合开始后端渐进式重构，但不适合全面推倒重来。**

最佳起点不是直接拆 `dashboard`，而是：

1. 先做 `Phase 0` 的回归保护
2. 再拆 `utils`
3. 再拆 `services`
4. 然后拆低耦合路由
5. 最后才动 `orders / payments / dashboard`

这是目前对你这个项目**最稳、最现实、最不容易把线上业务搞乱**的一条路线。

---

## 7. 新线程建议开场白

你在新线程里可以直接这样开头：

```text
先阅读 docs/BACKEND-REFACTOR-HANDBOOK.md。
我们按里面的最终版方案推进后端重构。
这次只做 Phase 0 / Phase 1，不要超范围。
要求保留现有 API 路径、业务逻辑、统计口径和部署方式不变。
每完成一个小阶段，就做语法检查和最小回归，再提交。
```

这样新线程就能比较快进入正轨。
