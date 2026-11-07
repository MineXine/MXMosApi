# 测试脚本

本目录只保留**服务端**测试脚本。前端相关脚本（渲染器单测、浏览器交互验证、截图）位于 `web/scripts/`。

| 命令 | 内容 | 前置条件 |
|---|---|---|
| `npm run smoke` | 30 项冒烟测试（进程内启动 Express，覆盖全部 API 与权限规则） | 无 |
| `npm run e2e` | 27 项端到端 HTTP 验证（打真实 HTTP 接口） | 需先 `npm run dev:api` |
| `npm run typecheck:scripts` | 本目录脚本的 TypeScript 全量检查 | 无 |

前端侧（`web/`）：

| 命令 | 内容 | 前置条件 |
|---|---|---|
| `npm run test:render` | 24 项渲染器单元测试（Markdown / MDC / XSS 转义） | 无 |
| `npm run test:ui` | 36 项浏览器交互验证（Playwright 驱动 Edge） | 需先启动前后端 |
| `npm run typecheck:scripts` | 前端脚本的 TypeScript 全量检查 | 无 |

## 类型检查说明

服务端主构建（`tsconfig.json`）只包含 `src/` 与 `../shared/`，**不编译 scripts/**——
脚本通过 `tsx` 直接运行，不需要编译产物。

若部署平台会连带检查 `scripts/`，用 `tsconfig.scripts.json` 单独校验：

```bash
npm run typecheck:scripts
```

> **注意**：`@types/node@22` 中 `Response.json()` 返回 `Promise<unknown>`，
> 直接展开或取属性会被 TypeScript 拒绝。脚本内统一用
> `type Json = Record<string, any>` 收窄后再使用。
