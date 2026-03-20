# Cloudflare 一次性配置清单

这份清单是为了把项目补成“可本地联调、可标准部署”的状态。

## 1. 当前代码里已经写死/依赖的绑定名

后端代码 [_worker.js](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/_worker.js) 目前依赖这 3 个绑定名：

- `DB`：Cloudflare D1
- `BUCKET`：Cloudflare R2
- `ASSETS`：静态资源

以后如果要接入 `wrangler.toml` 正式配置，这 3 个名字最好保持不变。

## 2. 当前已登记的 Cloudflare 信息

我已经根据你提供的信息生成了正式配置文件 [wrangler.toml](/Users/wangchuanyi/Downloads/fuzhou-fishery-expo-main/wrangler.toml)：

1. Worker 项目名称：`fuzhou-fishery-expo`
2. D1 数据库名称：`exhibition_db`
3. D1 数据库 ID：`c190ca96-3fa2-48bf-aade-0b995f4f02bd`
4. R2 bucket 名称：`expo-contracts`

如果你以后想改 Worker 名称，可以再调整，但建议不要频繁改。

## 3. 你去哪里找这些信息

### D1

Cloudflare 控制台 -> Workers & Pages -> D1 -> 进入对应数据库

你能看到：

- 数据库名称
- 数据库 ID

### R2

Cloudflare 控制台 -> R2 -> Buckets -> 进入对应 bucket

你能看到：

- bucket 名称

## 4. Worker 项目名称怎么定

Worker 名称基本可以自己定，但建议遵守这几个原则：

- 只用英文、小写、数字、短横线
- 不要用下划线
- 尽量和项目含义一致
- 尽量固定，不要经常改

我这次先统一用：

`fuzhou-fishery-expo`

这更适合后续 Git、Wrangler、本地联调和 Cloudflare 后台统一识别。

## 5. 我拿到这些值后会做什么

我会：

1. 生成正式的 `wrangler.toml`
2. 帮你把本地联调流程接通
3. 后面每次改动尽量先本地预览，再发线上
