# 生产容器部署

## 交付内容

根目录 `Dockerfile` 提供四个独立 target：

- `frontend`：只包含哈希静态资源、压缩旁路文件和静态交付进程。
- `api`：非 root API 运行时，不包含 Prisma CLI、TypeScript 或开发依赖。
- `worker`：继承 API 运行时，使用独立进程执行持久化任务。
- `migrate`：一次性迁移镜像，唯一允许包含 Prisma CLI 的运行制品。

`infra/production.compose.yml` 还编排固定版本的 Caddy、PostgreSQL、Redis、MinIO 和 MinIO 初始化任务。浏览器只访问网关；`/api/*` 与 `/health` 转发到 API，其余路径转发到前端，因此线上保持同源访问。

## 安全边界

- 前端、API、Worker、迁移和网关使用只读根文件系统，仅 `/tmp` 等明确路径可写。
- API、Worker 和前端以 Node 镜像内的 `node` 用户运行；网关显式使用 `1000:1000`。
- 应用容器清除 Linux capabilities、启用 `no-new-privileges`，并限制 CPU、内存、PID 和停止宽限期。
- 后端网络为 Docker internal 网络；数据库、Redis、MinIO 和 Worker不发布宿主机端口。
- API 禁止嵌入式 Worker，独立 Worker 使用数据库任务记录和租约。
- 生产依赖层执行 `npm ci --omit=dev --omit=peer`，Prisma CLI 只保留在迁移镜像。
- Node、Caddy、PostgreSQL、Redis、MinIO 和 MinIO Client 均使用“版本标签 + SHA-256 digest”，不会在重建或部署时重新解析可变标签。
- 前端、API、Worker 和迁移运行层移除全局 npm、npx、Corepack 与 Yarn；迁移镜像直接调用本地 Prisma CLI 入口。
- Compose 不包含真实密钥。所有敏感值必须由部署平台、受保护环境变量或已批准的 Secret Manager 注入。

当前网关只提供内部 HTTP。正式域名的 TLS、HSTS、证书续期、WAF/CDN 和 CSP 仍由外层 Ingress 负责，不能直接把 Compose 的 `8080` 暴露为公网生产入口。

## 环境变量

Compose 会在缺少以下变量时失败：

```text
DATABASE_URL
POSTGRES_PASSWORD
ACCESS_TOKEN_SECRET
STORAGE_ACCESS_KEY_ID
STORAGE_SECRET_ACCESS_KEY
RATE_LIMIT_REDIS_URL
REDIS_PASSWORD
```

可覆盖 `STORAGE_ENDPOINT`、`STORAGE_REGION`、`STORAGE_BUCKET`、`STORAGE_KEY_PREFIX`、`SECRET_MANAGER_PROVIDER`、`APP_PORT` 和 `APP_RELEASE`。`ACCESS_TOKEN_SECRET` 至少 32 字符。真实密码如包含 URL 特殊字符，`DATABASE_URL` 与 `RATE_LIMIT_REDIS_URL` 中必须使用 URL 编码值。

本地 MinIO 是可重复演练默认值。目标环境使用既有对象存储时，设置 `STORAGE_ENDPOINT=https://storage.example.com` 及对应桶、区域和凭据；目标环境也可以在平台层移除未使用的 MinIO 服务。

## 机器门禁

```bash
npm run check:production-containers
```

该命令使用 `docker compose config --format json` 验证固定镜像、独立 target、非 root/只读运行、资源限制、健康检查、迁移顺序、后端网络隔离、同源网关和优雅退出接线。它已纳入 `check:pr`。

供应链静态合同和真实镜像证据分别执行：

```bash
npm run check:production-supply-chain
npm run supply-chain:install-tools
npm run supply-chain:scan
```

漏洞策略、SBOM、GHCR、签名证明和 digest manifest 详见 `docs/PRODUCTION_SUPPLY_CHAIN_SECURITY.md`。

## 完整演练

```bash
npm run rehearse:production-containers
```

演练会使用明显的临时 fixture 密钥和随机宿主机端口，执行镜像构建、114 组迁移、权限种子、MinIO 建桶、健康探针、前端深链、管理员未授权拒绝、无 demo 用户检查、Worker 双任务执行、只读文件系统检查，以及 API/Worker 的 `SIGTERM` 排空。成功或失败后默认删除容器和临时卷。

调试失败现场时可临时保留容器：

```bash
CONTAINER_REHEARSAL_KEEP=true npm run rehearse:production-containers
```

本地演练证明镜像和编排可以工作，但不替代受保护 staging 的真实密钥、外部对象存储、域名 TLS、CDN、备份恢复、真实 Provider 和发布回滚证据。

## 部署顺序

1. 为候选版本构建四个 target，生成双格式 SBOM、漏洞报告和签名来源证明；只接受聚合 manifest 中的 registry digest。
2. 启动 PostgreSQL、Redis 和对象存储依赖，等待健康。
3. 运行 `migrate`，要求退出码为 `0`。
4. 启动 API，等待 `/health` 通过。
5. 启动 Worker，确认启用任务均出现 `completed`，没有唯一约束、租约或连接失败。
6. 启动前端和同源网关，验证 `/`、深链、`/api/*` 和未授权边界。
7. 外层 Ingress 完成 TLS、HSTS、CSP、域名和发布流量切换；运行面继续使用已批准 digest，不切回 tag。

回滚前先停止新流量和 Worker。若迁移保持向后兼容，可回退 API、Worker、前端和网关制品；若不兼容，必须执行发布前批准的数据库恢复方案，不能对生产数据库直接运行 `migrate dev`。
