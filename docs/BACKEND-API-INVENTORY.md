# 后端 API 清单

这份清单用于 `Phase 0` 保护层，来源于当前 [/_worker.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/_worker.js) 与前端真实调用面。后端重构期间，以下路径、HTTP 方法、鉴权语义和主要返回含义默认都视为冻结。

## 基本约束

- 不改 API 路径
- 不改请求方法
- 不改管理员 / 业务员权限边界
- 不主动改错误状态码和主要错误文案
- 不改前端现有查询参数和 JSON 字段命名

## 认证与文件

- `POST /api/login`
- `POST /api/change-password`
- `POST /api/upload`
- `GET /api/file/:key?orderId=...`

## 项目、人员与系统配置

- `GET /api/projects`
- `POST /api/projects`
- `POST /api/update-project`
- `GET /api/staff`
- `POST /api/staff`
- `POST /api/delete-staff`
- `POST /api/update-staff-role`
- `POST /api/set-target`
- `POST /api/update-staff-order`
- `POST /api/update-staff-sales-ranking`
- `POST /api/reset-password`
- `GET /api/accounts`
- `POST /api/add-account`
- `POST /api/delete-account`
- `GET /api/erp-config`
- `POST /api/save-erp-config`
- `POST /api/erp-sync-preview`
- `POST /api/erp-sync`
- `GET /api/order-field-settings`
- `POST /api/save-order-field-settings`
- `GET /api/industries`
- `POST /api/add-industry`
- `POST /api/delete-industry`

## 展位与价格

- `GET /api/prices`
- `POST /api/prices`
- `GET /api/booth-maps`
- `POST /api/create-booth-map`
- `POST /api/update-booth-map`
- `POST /api/delete-booth-map`
- `GET /api/booth-map-detail`
- `GET /api/booth-map-runtime-view`
- `POST /api/upload-booth-map-background`
- `POST /api/delete-booth-map-background`
- `GET /api/booth-map-asset/:key?mapId=...`
- `POST /api/save-booth-map-items`
- `GET /api/booths`
- `POST /api/add-booth`
- `POST /api/edit-booth`
- `POST /api/update-booth-status`
- `POST /api/delete-booths`
- `POST /api/import-booths`

## 订单、收款、支出与异常处理

- `GET /api/orders`
- `POST /api/submit-order`
- `POST /api/update-customer-info`
- `POST /api/change-order-booth`
- `POST /api/cancel-order`
- `GET /api/payments`
- `POST /api/add-payment`
- `POST /api/delete-payment`
- `POST /api/edit-payment`
- `POST /api/update-order-fees`
- `POST /api/resolve-overpayment`
- `GET /api/expenses`
- `POST /api/add-expense`
- `POST /api/delete-expense`

## 看板与统计

- `GET /api/order-dashboard-stats`
- `GET /api/home-dashboard`

## 当前重构分组建议

- `auth/files`: 登录、改密码、上传、下载
- `projects/staff/config`: 项目、人员、账户、ERP 配置、订单字段配置、行业配置
- `booths`: 展位与价格
- `orders`: 订单录入、编辑、换展位、退订
- `payments`: 收款、费用调整、超收处理
- `expenses`: 支出
- `dashboard`: `order-dashboard-stats` 与 `home-dashboard`

## 前端真实调用来源

- [public/js/auth.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/auth.js)
- [public/js/booth.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/booth.js)
- [public/js/config.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/config.js)
- [public/js/finance.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/finance.js)
- [public/js/home.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/home.js)
- [public/js/order.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/public/js/order.js)
