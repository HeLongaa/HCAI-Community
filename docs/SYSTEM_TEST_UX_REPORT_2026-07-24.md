# 系统管理员与普通用户协同测试报告

测试日期：2026-07-24（Asia/Shanghai）

复测日期：2026-07-25（Asia/Shanghai）

## 测试结论

- 已分别使用管理员 `@opsplus` 和普通创作者 `@promptlin` 完成浏览器实测。
- HCAI Router 的 Provider、模型、版本、部署、SecretRef、路由和运营策略已配置；路由预演可选择 `seedance-2.0-fast`。
- 普通用户请求可以通过登录、路由、SecretRef、Provider 控制、预算、Credit 和配额链路，并持久化失败记录及退款结果。
- Router 直连对完全相同的视频请求返回 HTTP 403：`NOT_ENOUGH_BALANCE / insufficient balance`，因此无法完成成功视频产物验收。
- API 密钥仅注入测试进程环境，未写入仓库、日志或报告。

## 已修复问题

1. Prisma 无 fallback 时登录态接口可能因空对象访问返回 500。
2. 管理员健康成功率输入单位不清晰，现统一显示百分比并转换为 basis points。
3. `global` 部署不能服务 `us` 请求，现按区域通配处理。
4. `secret://env/CREATIVE_ROUTER_VIDEO_API_KEY` 一类大写下划线 SecretRef 无法解析。
5. 不受支持的 Router 模型或非 HTTPS endpoint 可被启用。
6. Provider 控制平面错误使用适配器 ID，而非管理员配置的 Provider key。
7. Provider 控制平面的 model family 与模型路由结果不一致。
8. Router 视频请求错误使用 `metadata` 和复数 `images`；现使用 `width`、`height`、单数 `image` 和 `response_format`。
9. Provider HTTP 状态与分类未安全持久化；现保存并在管理员生成详情中展示。
10. 视频工作台默认选择不可用 Mock；现优先选择已启用且已配置的真实 Provider。
11. Provider 目录加载失败后无法恢复；视频工作台现提供重试操作。
12. 管理员刷新后回到概览；现通过会话状态保留当前管理员标签。
13. Operations、健康证据和外部门槛下拉框看似有值但实际为空；现加载后设置真实默认值。
14. Operations 门禁展示和 API 已补全策略、SecretRef、预算、控制、健康、速率与并发证据。
15. 管理员选中视频版本后，能力、部署和价格表单仍默认图片配置；现自动使用 `video`、`router_video` 和 `generated_seconds`。
16. 已停用但保留 runtime 配置的部署仍显示“runtime enabled”；现显示“configured, inactive”。
17. 普通用户只能看到内部错误“Creative Provider HTTP request failed”；现按安全错误码显示是否消耗额度、稍后重试或联系管理员。

## 用户体验审查

### 已优化

- 视频工作台首次进入即选择可工作的 Router 模型，减少用户主动排查模型的步骤。
- 模型目录加载失败时可直接重试，不再要求刷新整个页面。
- 管理员刷新后保留 AI 配置标签，降低长配置流程中的上下文丢失。
- 管理员运营表单的默认 Provider 和策略与实际提交值一致。
- 失败任务详情显示安全的 Provider 分类和 HTTP 状态，不展示响应正文、密钥或原始 Provider 数据。
- 管理员已通过 UI 停用遗留的无效部署 `router-video-enabled-87153504`；Seedance 部署保持唯一有效路由目标。
- 普通用户失败后获得可执行提示，且历史记录与账户额度可立即核对。

### 仍需优化

- Router 的安全错误分类仍无法区分账户余额不足与其他 Provider 拒绝；需要 Provider 提供稳定、可公开映射的原因码。
- “Configured”只表示模型已配置，不能代表健康证据、余额、熔断和预算均可用；建议改为完整就绪状态。
- 健康证据 TTL 为 300 秒，管理员刚完成配置后很快再次被阻断；建议接入自动探测或明确倒计时。
- 刷新后无法对失败任务进行精确重试，当前只能根据安全预览重新填写。
- 本地测试账号没有普通 member，仅有 Creator、Publisher、Moderator 和 Admin，无法覆盖最低权限用户体验。
- 管理员 AI 配置页历史路由决策数量较多，缺少默认时间范围和分页聚焦。
- 前端构建主包约 1.77 MB，Vite 已提示超过 500 KB；建议按管理中心和工作台拆包。
- 测试环境存在 Statsig 超时和批处理队列告警，虽不影响业务操作，但会增加诊断噪声。

## 暂时跳过的问题

1. Router 账户余额不足：直连 `POST /v1/video/generations` 返回 HTTP 403 和 `NOT_ENOUGH_BALANCE`，无法验证成功生成、轮询、视频下载、媒体扫描和资产入库。
2. 完整服务进程的 Router 外呼被安全折叠为 `provider_5xx / HTTP 502`，而同机隔离适配器对同一请求得到 `provider_rejected / HTTP 403`。请求契约与映射单测均通过，仍需在补充余额后结合部署网络代理继续排查。
3. Prisma auth integration test 依赖特定数据库环境而跳过；浏览器实际登录恢复已覆盖本次空 fallback 修复。

## 验证记录

- `npm run lint`：通过。
- `npm run build`：通过。
- Router 视频 Provider 与适配器契约：24/24 通过。
- Generation Service 与 Creative Routes：76/76 通过。
- Model Control：21/21 通过。
- Admin Routes：90/90 通过。
- 浏览器管理员验证：运营策略 `1/1 policies ready`、`0 blocked`，所有门禁通过时可正常提交。
- 浏览器普通用户验证：默认选择 Router，真实提交可持久化失败任务，Credit 与配额均退款/释放。

## 2026-07-25 管理员与用户复测

- 管理员 UI 确认 Provider、模型和版本均为 active。
- 有效部署：`router-video-seedance-fast-20260724`，模型 `seedance-2.0-fast`，endpoint `https://router.hctopup.com`。
- 遗留占位部署 `router-video-enabled-87153504` 已通过管理员 UI 停用并记录原因 `invalid_router_model_cleanup`。
- SecretRef 为 `secret://env/CREATIVE_ROUTER_VIDEO_API_KEY`，staging、inference，未展示密钥值。
- Router `/v1/models` 当前返回 HTTP 200，并包含 `seedance-2.0-fast`。
- 健康证据补录后运营状态为 `1 / 1 policies ready`、`0 blocked`，所有门禁 Passed。
- `creator + us` 路由预演结果为 `selected / primary_selected / router-video-seedance-fast-20260724`。
- 普通创作者进入视频工作台时默认选择 Seedance；确认版权后生成按钮可用。
- 真实提交失败后显示“The video service is temporarily unavailable. No credits were consumed; try again later.”，账户仍为 600 Credit，失败记录正常增加。

## 2026-08-01 MiniMax Staging 基础设施复测

### 结论

- 本地 PostgreSQL 已完成全部迁移，MiniMax Provider、Model、Version、Capability、Deployment、按生成秒计价和独立优先级路由均为 `active`。
- provisioning 可重复执行，不会覆盖现有 Seedance 路由；配置漂移会失败关闭。
- 使用真实 PostgreSQL、真实 S3/MinIO 和 `images/` 物理前缀完成一次零付费应用验收。Router 创建、轮询和 MP4 下载使用 fixture，未产生模型费用。
- 生命周期完成，MP4 入库、SHA-256、owner 下载、非 owner 隔离、Credit 结算、配额提交和成本待对账状态均通过。
- Router 首页仍返回 HTTP 502，尚不能创建新的短期 MiniMax Key，因此没有执行新的六秒真实模型调用。
- 输出安全与媒体扫描按本阶段要求使用测试替身，生产保持 `no_go`。

### 本阶段修复

1. 新增幂等 MiniMax Staging Model Control provisioner 和受控 CLI，SecretRef 仅保存环境变量引用与摘要。
2. 修复数据库路由验收未向动态 MiniMax 客户端注入 fixture transport、可能误访问真实 Router 的问题。
3. 修复 Cloudflare 拒绝签名 HEAD 时对象确认失败的问题；仅在 403、405 或 501 时改用签名 GET 流式计算 SHA-256，大小、类型和摘要仍全部严格校验。

### 后续状态（2026-08-04）

1. 已创建一次性、1 小时、USD 1.20 限额的 MiniMax Key，并仅写入忽略版本控制的 `server/.env`。
2. 已通过 `npm run minimax-video:provision:secret` 登记 SecretRef，env preflight 全部通过。
3. 已完成且仅完成一次六秒真实 Staging 调用；调用后立即禁用 Key，并从本地环境和临时文件中移除凭据。
4. 本次应用验收仍使用临时输出安全和媒体扫描替身；2026-08-04 经业务责任人确认，这两项由 Router/上游 Provider 已有安全限制承接，本系统不重复建设独立分类与扫描服务。

## 2026-08-04 MiniMax 六秒真实 Staging 验收

### 最终结论

- MiniMax 视频生成已验证可用，可在能力矩阵中标记为 `available`，适配器为 `router_minimax_video`。
- 本次严格执行 1 次 Provider 创建调用和 1 次输出下载，没有重试付费创建。
- 生成时长为 6 秒，真实 MP4 大小为 748,679 字节，SHA-256 为 `63a2af314cb2a8b0c22bf05e9487a80dc592aaa0dc0948083410a4bf3e5907e1`。
- 使用本地 PostgreSQL、真实 `chat.hctopup.com` MinIO 存储桶和 `images/` 前缀完成持久化。
- 生命周期、输出入库、摘要校验、mock 媒体扫描、临时 allow 输出安全判定、owner 下载和非 owner 隔离全部通过。
- Credit 已结算，配额已提交，应用侧用量为 8；Provider 成本状态为 `reconciliation_required`。
- Router 限额从 USD 1.20 降至 USD 0.926，本次实际消耗约 USD 0.274。
- 临时 Key 已在 Router 管理端标记为“已禁用”，本地 Key 已置空，HTTP、网络、生命周期和 worker 开关均已关闭。
- 生产发布继续保持 `no_go`；本次成功只解除“视频生成模型不可用”的阻断，不代表生产安全门禁已经完成。

### 本次发现与处理

1. 本地 PostgreSQL 容器未启动，首次 provision 返回数据库不可达；启动既有 `newchat-postgres` 后通过。
2. Staging 环境仍使用 `NODE_ENV=development`，无法满足生产语义预检；已切换为 `production`。
3. 环境代理未绕过 Router，preflight 报 `proxySafe=false`；已将 Router 和对象存储域名加入 `NO_PROXY`。
4. Router 页面密钥操作在浏览器自动化中存在点击定位不稳定；最终使用 Router 受认证 API 完成密钥读取和禁用，并在 UI 刷新后复核状态。

### 正式上线前剩余问题

1. 取得并归档 Router/上游 Provider 已执行输出内容安全和媒体技术安全限制的契约证据，明确拒绝状态、故障语义、版本变更通知和责任人；本系统只做响应闭集校验和不可用时的失败关闭。
2. 完成 Provider 账单回传与内部成本对账，使 `reconciliation_required` 可自动收口并触发预算告警。
3. 将 MiniMax 密钥迁移到正式 Secret Manager，完成自动轮换、吊销回执和过期告警；不得依赖 `.env` 长期保存。
4. 增加 Staging 数据库和对象存储的启动探针、依赖健康检查与值班告警，避免本地容器停止后才在 provision 阶段发现。
5. 在目标 Staging 完成不可变制品部署、数据库迁移、对象存储、Worker、告警、冒烟和回滚全链路演练。
6. 前端继续执行内容优先的 AI 工作台优化：输入/结果双栏、移动端设置/结果切换、真实缩略图/视频关键帧/音频波形和资产优先的历史列表。
7. 在上游安全责任证据、Secret Manager、成本对账、目标 Staging 发布/回滚和数据治理 Worker 验收全部通过后，再单独作出 `production go/no-go` 决策。

## 2026-08-04 视频生成长任务体验优化

### 已完成

1. 视频结果区新增“排队、生成、取回、检查、完成”五阶段生命周期轨道，不再只显示笼统的运行状态。
2. 处理中显示实时耗时、同步状态和通常 1-3 分钟的时间范围；输出取回后单独显示检查阶段。
3. 完成、失败和取消状态使用不同阶段语义；成功时显示总用时，失败时显示停止阶段与已用时。
4. 刷新后无法精确重试时，新增“用安全预览重建”入口，自动恢复可公开的提示词预览、模式和 Provider，并强制用户重新确认素材权利。
5. 阶段轨道支持 `aria-current`、状态实时播报和 `prefers-reduced-motion`，桌面与 390×844 移动端均无文字溢出或布局重叠。

### 验证

- `npm run lint`：通过。
- `npm run build`：通过；现有 `ParticleMorphBackground` 仍超过 500 kB，属于后续拆包任务。
- `npx playwright test e2e/video-capability.spec.ts`：2/2 通过，覆盖阶段状态、失败恢复、私有预览和移动端边界。
- 已在隔离 E2E 后端完成桌面和 390×844 移动端截图复核，不连接真实模型或生产数据库。

### 下一优先级

1. 完成上游输出安全和媒体安全责任契约归档，并对拒绝、超时、未知状态和上游不可用执行失败关闭验收；不自建重复扫描链路。
2. 完成 Provider 成本自动对账和预算告警，解除 `reconciliation_required`。
3. 完成 Secret Manager、目标 Staging 发布/回滚、依赖健康探针与数据治理 Worker 验收。
4. 实施 AI 工作台结果优先布局和真实多媒体内容展示，继续降低“通用深色 SaaS”感。
