# 技术债清单

更新时间：2026-04-08

## 当前判断

- 当前项目不是“结构失控”状态，后端拆分主线已基本完成。
- 现阶段最主要的债，集中在自动化回归、前端可维护性、统计口径保护和发布稳定性。
- 当前基线检查已确认通过：
  - `npm run check`
  - `npm run test:erp-sync`
  - `node --check public/js/*.js`

## 本周必做

### 1. 补主链路自动化回归

目标：

- 给订单、收款、换展位、超收处理补最小自动化测试。
- 先覆盖最容易出业务回归的主链路，不追求一次补全。

建议优先顺序：

- `submit-order`
- `add-payment`
- `edit-payment`
- `delete-payment`
- `change-order-booth`
- `resolve-overpayment`

完成标准：

- 至少能覆盖成功路径
- 至少能覆盖 1 个权限拒绝路径
- 至少能覆盖 1 个金额边界路径

原因：

- 当前测试文件只有 [erp-sync-core.test.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/tests/erp-sync-core.test.mjs)
- 高风险业务链路当前仍主要依赖人工冒烟

### 2. 给统计看板补固定数据回归

目标：

- 锁住首页看板与订单统计看板的核心统计口径。
- 降低后续改 SQL、改聚合逻辑时的误伤风险。

建议覆盖：

- 展位完成数统计
- 已收/应收/未收金额
- 按时间维度的 `today/week/month/total`
- 按业务员筛选后的统计结果
- 超收异常相关展示口径

重点文件：

- [dashboard.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/dashboard.mjs)

### 3. 把前端语法检查纳入统一检查

目标：

- 把当前单独执行过的前端语法检查合并进统一脚本。

建议动作：

- 更新 [package.json](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/package.json)
- 将 `public/js/api.js`
- `public/js/auth.js`
- `public/js/config.js`
- `public/js/booth.js`
- `public/js/booth-map.js`
- `public/js/order.js`
- `public/js/finance.js`
- `public/js/home.js`
- `public/js/app.js`
  纳入 `npm run check`

原因：

- 当前 `check` 只覆盖后端文件
- 前端脚本体量已大，最少应纳入语法级保护

### 4. 固化人工冒烟记录

目标：

- 不只保留“要测什么”，还要记录“这轮谁测了、结果如何、是否阻塞部署”。

建议最小模板：

- 日期
- 执行人
- 分支/提交
- 冒烟范围
- 结果
- 阻塞项

建议沿用的冒烟顺序：

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

参考：

- [BACKEND-REFACTOR-PROGRESS.md](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/docs/BACKEND-REFACTOR-PROGRESS.md)
- [BACKEND-REGRESSION-CHECKLIST.md](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/docs/BACKEND-REGRESSION-CHECKLIST.md)

### 5. 先整理当前未提交改动的目标

当前工作区存在未提交改动：

- [public/index.html](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/index.html)
- [public/js/api.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/api.js)
- [public/js/booth-map.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/booth-map.js)
- [public/js/finance.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/finance.js)
- [public/js/order.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/order.js)
- [src/routes/payments.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/payments.mjs)

建议动作：

- 先确认这些改动分别属于哪个需求
- 避免多个需求混在同一批提交里
- 在补测试前，先明确这些改动的预期行为

## 中期优化

### 6. 先拆前端 `order` / `finance` 域

目标：

- 优先降低订单和财务页面的维护成本。

现状信号：

- 页面仍通过串行脚本加载共享状态
- 跨文件共享大量全局变量

参考文件：

- [index.html](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/index.html)
- [api.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/api.js)
- [order.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/order.js)
- [finance.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/finance.js)

建议拆法：

- 先按业务域拆，不急着引入框架
- 先把“状态”“请求”“渲染”“弹窗行为”分开
- 优先减少 `window.*` 与 `var` 共享状态

### 7. 抽离 dashboard 聚合逻辑

目标：

- 把统计口径从路由处理流程中继续抽离到 service 层。

原因：

- `dashboard` 当前既负责查数据，也负责聚合和格式化
- 后续只要改统计逻辑，风险面会过大

建议方向：

- 路由只保留参数解析、权限、响应输出
- 聚合逻辑迁到独立 service
- 用固定输入数据做纯逻辑测试

### 8. 给 orders / payments 再拆一层纯逻辑

目标：

- 降低主链路接口文件的测试成本和理解成本。

建议优先抽离：

- 订单费用分摊
- 展位分配与校验
- 收款金额变更校验
- 超收状态刷新前后的规则判断

参考文件：

- [orders.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/orders.mjs)
- [payments.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/payments.mjs)
- [overpayment.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/services/overpayment.mjs)

### 9. 收口外部 CDN 依赖

目标：

- 提升页面构建可复现性和外部依赖稳定性。

当前依赖：

- Tailwind CDN
- JSZip CDN

建议方向：

- 逐步转为项目内受控依赖
- 至少保证离线调试和长期可维护性

## 可延期但建议收口

### 10. 更新重构文档口径

目标：

- 让文档反映现在的真实状态，减少误判。

现状：

- 手册仍保留“`_worker.js` 过大”等历史表述
- 但实际入口文件已明显瘦身

建议动作：

- 更新 [BACKEND-REFACTOR-HANDBOOK.md](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/docs/BACKEND-REFACTOR-HANDBOOK.md)
- 更新 [BACKEND-REFACTOR-PROGRESS.md](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/docs/BACKEND-REFACTOR-PROGRESS.md)
- 区分“已解决的旧债”和“仍存在的新债”

### 11. 决定 `middleware.mjs` / `permissions.mjs` 是否继续落地

目标：

- 收口路线图，不让设计目标长期悬空。

现状：

- 文档里仍提到 `middleware.mjs`
- 进度文档也还提到可以继续迁走残留逻辑

建议动作：

- 如果要做，就列出明确迁移范围
- 如果不做，就直接更新路线图

### 12. 给大文件设体量门槛

目标：

- 防止大文件继续膨胀。

建议规则：

- 单文件超过 600 到 800 行时，默认进入拆分评估
- 高风险文件优先

建议重点关注：

- [booth-map.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/booth-map.js)
- [home.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/home.js)
- [finance.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/finance.js)
- [order.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/order.js)
- [dashboard.mjs](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/src/routes/dashboard.mjs)

### 13. 补数据口径说明

目标：

- 在改报表、改统计、改前端展示前，有统一依据。

建议覆盖：

- 展位数如何换算
- 已收/应收/未收如何定义
- 超收异常待处理如何进入和退出
- 业务员维度和管理员视角的区别

## 建议推进顺序

1. 先补自动化保护，再改主链路
2. 先收口前端高风险域，再考虑更大范围重构
3. 先更新文档与流程，再推进下一轮迭代

## 完成后预期收益

- 改订单和财务逻辑时更敢动
- 看板统计回归更容易发现
- 提交和部署边界更清晰
- 新人接手成本更低
