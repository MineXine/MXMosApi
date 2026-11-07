# MXMosApi

说说后台的 REST API 服务。

| 项 | 说明 |
|---|---|
| 运行时 | Node.js ≥ 20 · TypeScript · Express 5 |
| 校验 | Zod（请求体 / 查询参数） |
| 鉴权 | JWT（`Authorization: Bearer <token>`） |
| 数据库 | MongoDB（Mongoose），另附内存驱动用于本地零依赖启动 |
| 共享代码 | [`MXMosShared`](https://github.com/MineXine/MXMosShared)（submodule） |

## 快速开始

```bash
git clone --recursive https://github.com/MineXine/MXMosApi.git
cd MXMosApi
cd server && npm install
```

配置 `server/.env`（参考 `server/.env.example`）：

```ini
PORT=4000
DB_DRIVER=memory          # 本地零依赖；生产改用 mongo
MONGO_URI=mongodb://127.0.0.1:27017/shuoshuo
JWT_SECRET=改成随机长字符串
```

启动：

```bash
npm run dev     # 开发模式（tsx 热重载）
npm run build   # 编译到 dist/
npm start       # 运行编译产物
```

## 目录结构

```
MXMosApi/
├── server/
│   ├── src/
│   │   ├── index.ts         # Express 启动入口
│   │   ├── config/env.ts    # 环境配置
│   │   ├── lib/             # 分词 / 设备解析 / 错误 / 参数助手
│   │   ├── middleware/      # JWT 鉴权、Zod 校验、全局错误处理
│   │   ├── repositories/    # 仓储抽象层
│   │   │   ├── repository.ts    # ★ 统一接口
│   │   │   ├── mongo/           # MongoDB (Mongoose) 实现
│   │   │   └── memory/          # 内存实现（本地/CI）
│   │   └── routes/           # REST 路由
│   └── scripts/             # 服务端测试脚本
└── shared/                  # MXMosShared submodule
```

## 数据访问层

API 层不直接依赖 MongoDB，而是依赖 `Repository` 接口：

```
server/src/repositories/
├── repository.ts   # 统一接口（所有能力都在这里声明）
├── mongo/          # Mongoose 实现
└── memory/         # 内存实现（本地体验 / CI）
```

新增一种数据库只需实现该接口并在 `repositories/index.ts` 注册，**API 层代码零改动**。

## 能力一览

- **记录**：创建 / 更新 / 删除 / 封存恢复 / 分页筛选（可见性、标签、关键词、地理位置）
- **可见性**：公开 / 私密，列表自动按「公开 + 自己的私密」过滤，越权直连返回 403
- **互动**：点赞、收藏（独立 reaction 集合 + 原子计数）
- **分享**：生成 token 链接，无需登录即可访问，可设有效期、可撤销
- **检索**：中文 bigram 二元组 + 英文前缀分词，写入多值索引用 `$all` 查询
- **组织**：标签体系、视图（筛选条件组合）、日历分桶、地图点位
- **附件**：图片 / 视频 / 音频 / PDF 上传
- **设备信息**：ua-parser-js 解析 UA，记录浏览器 / 系统 / 设备类型
- **草稿**：服务端保存，与本地 localStorage 双保险

## 文档

完整 API 契约见 [`MXMosPanel/docs/API.md`](https://github.com/MineXine/MXMosPanel/blob/main/docs/API.md)。

## 测试

```bash
npm run smoke              # 30 项冒烟测试（进程内启动，无需外部服务）
npm run e2e                # 27 项端到端 HTTP 验证（需先启动服务）
npm run typecheck          # 源码 TypeScript 全量检查
npm run typecheck:scripts  # scripts/ TypeScript 全量检查
```

> **类型检查说明**：主构建 `tsconfig.json` 只包含 `src/` 与 `../shared/`，不编译 `scripts/`
> （脚本通过 `tsx` 直接运行，无需编译产物）。若部署平台会连带检查 `scripts/`，
> 请用 `npm run typecheck:scripts` 单独校验。
>
> `@types/node@22` 中 `Response.json()` 返回 `Promise<unknown>`，
> 直接展开或取属性会被 TypeScript 拒绝；脚本内统一用
> `type Json = Record<string, any>` 收窄后再使用。
