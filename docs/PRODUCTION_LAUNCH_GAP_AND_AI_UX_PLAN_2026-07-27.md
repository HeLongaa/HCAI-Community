# 正式上线差距与 AI 体验实施方案

检查日期：2026-07-27 至 2026-07-30
检查角色：普通用户、运营管理员
当前结论：**不建议正式上线，可继续作为受控开发/测试环境使用。**

## 一、已完成并验证的项目

1. 生产包门禁已按真实 API 失败状态校正，`npm run test:v1-production-bundle` 通过。
2. Provider 403/429/5xx 已按余额、鉴权、限流、超时、内容拒绝和上游故障分类；余额不足不再统一伪装为 502。
3. 余额不足、配额阻断和 Provider 状态阻断会向运营角色发送去重告警，普通用户只看到安全文案。
4. 全局 Error Boundary、`window.error`、未处理 Promise 拒绝上报已接入。仅上报 SHA-256 指纹和受限标识，不上报提示词、页面内容、原始错误或堆栈。
5. E2E 服务默认隔离，不再静默复用一套配置不同的本地后端。
6. 内容安全预检已在 Provider 派发前生效：`review` 请求不会占用额度、不会扣积分、不会产生输出，并自动创建 Trust 案件；管理员可作出决定，所有者可申诉。
7. 到期账户删除 Worker 已接入持久租约和有界批处理，可自动处理宽限期已结束且身份已核验的请求，并复用现有 15 个数据域删除、对象清理和备份回执链路。
8. 页面已按业务域动态拆包。登录后主入口由 1,777.14 kB（gzip 452.70 kB）降至 393.83 kB（gzip 121.28 kB）；Lint 和生产构建通过。
9. 最新完整服务端套件共 1,239 项，1,189 项通过、50 项按环境跳过、0 项失败；本轮 Creative 输入安全、默认私有对象读取和路由聚焦回归 136/136 通过。
10. 生成结果已增加独立输出安全分类：生产环境分类器缺失、网络失败、响应畸形或未知判定均转为 `review`；结果只有同时满足输出安全 `allow` 和媒体扫描 `clean` 才能下载。
11. 外部 Provider 删除已接入到期账户删除链路：先调用显式启用的 HTTPS 隐私网关，再执行站内删除；仅保留 Provider、数量和哈希回执，不保存原始操作引用、Provider 回执或响应体。
12. 最新本地隔离 Docker 发布基础设施演练已带迁移 `0098/0099` 完成，18/18 检查通过，RTO 22.806 秒、RPO 0 秒；数据库恢复 5.457 秒、Redis 0.427 秒、对象恢复 0.011 秒。
13. 修复灵感模块数据契约漂移：5 个新增 Prisma 模型已纳入治理清单，3 个 JSON 字段补充 schema version 和增量迁移；101 项数据模式契约检查通过。
14. 直接安全阻断现会保存生成记录和自动原始决定，用户可立即申诉但原请求永不恢复派发；批准的 `review` 请求可由所有者带匹配原请求幂等恢复，并重新执行风险、路由、权益、配额、积分、Provider 预算和熔断检查。
15. 到期数据导出包清理 Worker 已完成：只删除固定 Bucket 下受约束的 `exports/data-rights/subject_<24hex>/<request-id>.json`，先删对象再在维护事务中移除 locator，失败保留定位信息重试，成功保留 hash-only 审计回执；真实 PostgreSQL Prisma 演练验证了普通业务删除仍被拒绝、维护事务可完成清理。
16. 修复了 Seed 运行时账号的生成审核目标错误 404：已持久化且确属当前认证用户的 `CreativeGeneration` 可建立 Trust 案件，其他账号仍得到 `MODERATION_TARGET_NOT_FOUND`，避免输入预检正确阻断后却无法申诉。
17. Image/Video 参考资产已增加独立输入分类并接入正式路由默认读取器：从固定 S3 Bucket 使用短时扫描签名读取，拒绝重定向，严格校验声明长度和流上限；分类发生在配额、积分、Provider 预算与派发之前，失败或未知判定进入 `review`，响应和安全证据不包含对象键、原始字节、签名 URL 或存储密钥。Chat 附件输入和流式分段输出也已采用有界缓冲与 fail-closed 分类。
18. 修复游客首屏固定定位根容器错误：移除 660vh 根节点动画遗留的 `transform/filter` 包含块，并将滚动场景文案改为视口叠层切换。`1280 x 720` 下 H1 从 `y=2348px` 回到 `y=333px`；`390 x 844` 下 H1 和 Login 均完整位于视口内。
19. 修复登录任务顺序：邮箱表单和提交按钮移动到 OAuth 之前，开发账号默认折叠，生产仍不渲染测试账号。`1280 x 720` 下邮箱提交按钮位于 `y=418px`，无需滚动即可操作。
20. 管理员中心已按运营、内容、安全、平台、财务分成 5 组，移动端使用吸顶分区选择器；Overview 与 Release 分离，其他业务区块不再占用当前标签布局。移动 Overview 从 `27,264px` 降至 `2,364px`，桌面为 `1,169px`，且修复了错误的 `Tasks / Admin` 父级。
21. 搜索诊断现在区分无查询样本、未建立索引基线和真实队列积压：比例与 P95 无样本时显示“暂无样本”，无索引无队列显示“未建立基线”，当前真实积压以“积压 · 22.6天”展示，不再显示 `1,956,487s`。Inspiration 与客户端异常上报同时补入 ARC-02 路由导航契约，46 项检查覆盖 561 条路由并全部通过。
22. 账户删除已增加有期限、按数据域生效的法律保留：只保存授权依据哈希，事件不可变，释放或到期后同一删除请求可从已有回执继续执行。法律保留创建和删除截止点现共享主体级 PostgreSQL 事务锁；真实并发测试证明保留先提交时跳过对应域，删除先进入 `processing` 时保留创建得到确定 `409`，不会产生假保护状态。
23. 修复外部 Provider 删除成功后无法写入回执的数据库约束漂移：运行时使用 `externally_erased`，旧约束却只允许三种本地处置。前向迁移 `0101` 已补齐该值，从空库执行全部 95 个迁移及真实 Provider 回执集成测试通过。
24. 删除 Worker 现会恢复超过 300 秒仍停留在 `processing` 的请求，避免进程在持久化删除截止点后崩溃导致永久卡住；新鲜处理中请求不会被重放，恢复继续使用同一 Provider 幂等键。
25. `observability_bounded` 保留策略已自动化：原始 Trace 7 天、日志 30 天、匿名日聚合 90 天。聚合只包含经过低基数校验的 service、module、event、outcome、HTTP 状态族、数量和总耗时，不包含请求、Trace、资源或用户标识；可疑维度统一折叠为 `other`，仓库批次硬限制为最多 1,000 条。聚合写入与候选原始记录删除在同一事务内，由默认关闭、带跨实例租约和批量上限的 Worker 执行。空库执行全部 96 个迁移到 `0102`，真实 PostgreSQL 事务验收 1/1 通过。
26. 完整服务端回归发现并修复法律保留权限测试契约漂移：`admin:data-rights:legal-hold` 已是受保护的资源授权权限，但 RBAC 分层测试期望列表仍为旧版本。同步后权限聚焦测试 3/3、权限注册表门禁和完整服务端 1,251 项测试均通过（1,200 通过、51 项按环境跳过）。
27. `notification_created_plus_180d` 保留策略已自动化：按 `createdAt + id` 最旧优先、每批默认 250 条且仓库硬限制最多 1,000 条，父通知删除与投递、投递尝试级联删除在同一 Prisma 事务中完成；Worker 默认关闭并使用跨实例租约。Seed 聚焦测试 52/52、治理和数据操作策略门禁通过；空库执行全部 97 个迁移到 `0103`，真实 PostgreSQL 级联、排序和批次验收 1/1 通过。目标环境验收仍是发布前置条件。
28. 通知保留完成后的完整服务端回归为 1,257 项：1,205 通过、52 项按环境跳过、0 失败；Prisma 校验、ESLint、生产构建、生产包门禁和 `git diff --check` 均通过。构建体积问题没有消失：全局 CSS 424.49 kB、Landing JS 529.76 kB、Admin JS 580.74 kB，Tasks 仍因静态引用导致动态拆包无效。
29. `lease_expiry_plus_7d` 保留策略已实现：已释放租约按 `releasedAt`、未释放租约按 `expiresAt` 在七天后进入清理，双索引候选合并后按触发时间最旧优先，仓库批次最多 1,000 条；删除前再次校验到期条件，避免并发恢复后的活跃租约被旧候选误删。Worker 默认关闭并使用独立跨实例租约；聚焦测试 56/56 通过，空库执行全部 98 个迁移到 `0104`，真实 PostgreSQL 排序、批次和近期租约保留验收 1/1 通过。目标环境验收仍是发布前置条件。
30. 通知与租约两项保留组合后的完整服务端回归为 1,262 项：1,209 通过、53 项按环境跳过、0 失败；ESLint、Prisma schema、数据治理、数据操作策略、生产包和差异格式门禁均通过。权威 `retentionAutomationComplete=false`、`backupDeletionRehearsed=false`、`productionApproved=false` 保持不变。
31. Provider 原生内容安全映射已实装到 OpenAI Image、Replicate、Router Video 和 Router Music 适配器：只允许 `pending/refused/flagged/allowed/unknown` 闭集证据，并校验 Provider 身份与生成状态一致；异步终态会覆盖早期 `pending`，应用策略合并不再丢失 Provider 证据。OpenAI Chat 的流式拒绝继续映射为无原始拒绝文本的安全错误。当前 Provider/生成聚焦回归 116/116 通过；真实 Provider 策略版本和目标环境结果证据仍未验收，因此不提升生产批准状态。
32. Provider 原生安全映射完成后的完整服务端回归为 1,265 项：1,212 通过、53 项按环境跳过、0 失败。内容安全 251 项、当时的数据治理 452 项、数据操作策略 534 项检查全部通过；ESLint、Prisma schema、生产构建、生产包门禁和 `git diff --check` 通过。
33. 24 项保留策略现已增加一对一 `retentionAutomationInventory`，区分已实现、部分实现、待实现、前置缺失和政策冲突。审计确认搜索同步成功后队列证据立即删除，已满足 7 天上限；Provider replay 同时受 `append_only + hardDelete=false` 约束，不能直接实现 180 天删除。审计当时发现 Private Library 缺少删除时间和恢复契约，随后已在第 34 项解除。
34. `private_library_delete_plus_30d` 已实现并同时修复私有收藏越权：旧 `/api/library` 无需认证且可能跨用户列出数据，现改为认证后仅返回当前所有者活动项。用户删除后立即从列表、Chat 上下文、转任务和发送工作台路径隐藏，30 天内可带 CAS 版本恢复；之后由默认关闭、带跨实例租约、批次硬上限 1,000 的 Worker 按 `deletedAt + id` 最旧优先硬删除，并在删除时重查截止时间。空库 99 个迁移执行到 `0105`、真实 PostgreSQL 集成测试 1/1、路由 16/16 和完整服务端 1,272 项均通过（1,218 通过、54 项按环境跳过、0 失败）。当前数据治理门禁为 479 项，数据操作策略 534 项；主 JS 为 394.12 kB（gzip 121.31 kB），其他构建体积债务不变。
35. `auth_expiry_plus_30d` 已实现：OAuth 授权请求、Refresh Token 和 API Key 凭据在终止 30 天后按全局最旧顺序硬删除，删除事务内会重查截止时间；会话仅保留哈希化安全证据，Webhook 签名密钥继续执行独立的退役策略。Worker 默认关闭、使用跨实例租约，批次硬上限 1,000。空库全部 100 个迁移执行到 `0106`、真实 PostgreSQL 集成 1/1、聚焦测试 59/59、数据治理门禁 480 项均通过；完整服务端 1,278 项中 1,223 通过、55 项按环境跳过、0 失败。状态仅提升为 `implemented_pending_target_environment_acceptance`，不代表生产验收。
36. 普通用户实测 Mock Image 时发现真实缺陷：Provider 生命周期显示 `Completed`，但媒体扫描仍为 `pending`，页面却直接渲染 `mock://creative/...`，形成破损图片并弱化下载受限原因。现已将 Provider 完成与输出检查拆开：扫描前显示“输出检查中/正在检查图片”，不创建 `<img>` 且禁用下载；`rejected` 显示拦截状态；只有 `scanStatus=clean` 且 URL 为浏览器可渲染协议时才显示图片。扫描通过但仅有 Mock 内部 URL 时明确显示“暂不支持预览”，并保留“在资产中查看”。Image Studio 聚焦 E2E 2/2、实页 DOM 与截图复核、Lint、TypeScript 和生产构建均通过。
37. `configuration_superseded_plus_365d` 最初经审计确认存在完整值、不可变触发器和 `RESTRICT` 链之间的政策冲突；该冲突已由第 65 项的不可逆最小证据方案解除。当前权威状态为 `implemented_pending_target_environment_acceptance`，活动配置和待审批/已审批回滚目标均不得按年龄处理，全局完成状态仍保持 `false`。
38. 修复 Tasks 动态拆包失效：通用 `StatusBadge` 已移出 Tasks 业务模块，Notification 和 Admin 不再静态导入 Tasks；Profile 的 `MyTasksPage` 改为懒加载。生产构建不再出现 `INEFFECTIVE_DYNAMIC_IMPORT`，新增独立 Tasks chunk `42.43 kB`（gzip `13.37 kB`），主入口由 `394.12 kB / 121.31 kB gzip` 降至 `355.78 kB / 110.62 kB gzip`。生产包门禁现强制要求独立 Tasks chunk，并限制入口 gzip 不超过 `125 KiB`，当前门禁实测 `106.64 KiB`；管理员、通知深链、个人中心桌面/移动和主导航 E2E 5/5 通过。
39. 第一阶段横向仓库门禁复核通过：Provider 决策矩阵 341 项、内容安全 251 项、数据治理 480 项、发布基础设施 5/5、可观测性基线 4/4、生产包门禁、Lint、TypeScript、生产构建和差异格式检查均为绿色。该结果只证明仓库级契约与本地演练可执行；Provider 矩阵仍明确 `realProviderCallsApproved=false`、`productionEnablementApproved=false`，内容安全和数据治理的生产批准状态也保持 `false`。
40. 修复游客 Landing 核心 chunk 被 Three.js 阻塞：`ParticleMorphBackground` 已从顶层静态依赖改为首屏后空闲加载，Landing 文案、导航和登录核心由 `529.76 kB / 134.43 kB gzip` 降为 `7.48 kB / 3.24 kB gzip`；生产包门禁实测为 `3.10 KiB gzip` 并限制不得超过 `20 KiB`。`prefers-reduced-motion: reduce` 现在完全不挂载 Canvas/WebGL，也不下载粒子模块或模型；正常模式仍保留独立的 523.50 kB 粒子增强 chunk。桌面与移动测试在同一渲染帧读取有界 WebGL framebuffer，均确认超过 100 个非透明像素并生成截图；游客登录、退出回首页、低动效和双视口粒子测试 4/4 通过。
41. 修复 Admin 单体包和测试导航契约：22 个独立管理面板改为按当前业务分区懒加载，Admin 内部使用局部加载边界，切换分区时导航保持可见；Security 和 Audit 下原本位于 `hidden` 容器但仍会挂载的面板改为仅在激活时加载。无消费者的 `admin/index.ts` 面板聚合导出已移除，动态导入抵消告警清零。Admin 核心由 `580.91 kB / 128.41 KiB gzip` 降至 `180.30 kB / 42.95 KiB gzip`，Model Control 独立为 `71.98 kB / 15.91 KiB gzip`；生产包门禁要求 Admin 核心不超过 `60 KiB gzip`、Model Control 不超过 `25 KiB gzip`，并校验 Landing 粒子增强层保持独立。管理员、moderator、模型治理和灵感桌面/移动回归 13/13 通过；同时修复测试依赖默认隐藏分区和严格比较浏览器亚像素高度的问题。
42. `audit_event_plus_730d` 自动化链路已实现：新增默认关闭、带跨实例租约和三次重试的专用 Worker，复用 730 天、有界连续前缀和最少近期事件保留策略。每轮先将完整链事件写入非 Mock 持久归档，再在审计链事务锁内复核 preview，写入不可变 disposition 后才删除；Mock/上传失败、法律保留、未批准 prune、空前缀和快照漂移均不会删除。环境配置在 Worker 启用时强制要求 `PRUNE_ENABLED=true`、法律保留关闭和 `STORAGE_DRIVER=s3`，成功后记录 `system.audit.retention_executed`。权威状态提升为 `implemented_pending_target_environment_acceptance`，但目标环境 S3、保留前缀验证和全局治理批准尚未完成，因此 `retentionAutomationComplete=false`、`productionApproved=false` 不变。
43. `community_delete_plus_30d` 自动化链路已实现：帖子和评论在接受删除 30 天后改挂固定删除身份，私密标题、正文、JSON 元数据和点赞不可逆清除，同时保留帖子/评论 ID 与回复层级。开放审核、仍在 30 天申诉窗口内的决定、待裁决申诉及作者级 `community` 法律保留均阻止处置；候选扫描有 1,000 条硬上限，CAS 漂移会回滚整批事务。Worker 默认关闭、使用跨实例租约和三次重试；空库全部 101 个迁移执行到 `0107`，真实 PostgreSQL 对匿名化、点赞清除、案件排除和法律保留排除验收 1/1 通过。目标环境迁移和并发验收仍未完成，权威全局状态继续保持 No-Go。
44. 社区匿名化并发边界已补强并完成本地 PostgreSQL 验收：候选发现与处置事务分离，事务先复用数据权利主体锁和新增的审核目标锁，再以 `READ COMMITTED` 重新读取候选、法律保留和案件，避免等待锁前固定快照导致漏见新保留；举报创建复用同一目标锁。法律保留先持锁的竞态测试证明匿名化会等待并跳过受保护内容。最终完整服务端为 1,289 项，1,233 通过、56 项按环境跳过、0 失败；Lint、TypeScript、Prisma、生产构建、生产包、数据治理 482 项、数据操作策略 534 项和数据模式 101 项检查均通过。目标 staging 证据仍未完成，因此结论不变。
45. `security_event_365d` 的安全事件表链路已实现：安全事件新增显式哈希 `subjectRef`，不从邮箱、IP 或旧 `identity` 猜测主体；新增持久 `SecurityIncident`，支持管理员创建、追加事件和 CAS 关闭。普通事件在 365 天后删除，已关闭且确认重大的事故事件保留 730 天，开放事故和匹配 `audit/safety` 法律保留均阻止删除；无主体旧事件在存在相关有效法律保留时 fail-closed。数据库候选查询先排除当前保留项，避免最老保留项长期占满批次导致后续记录饥饿；持锁事务仍会二次复核竞态。Worker 默认关闭、带跨实例租约和三次重试。空库全部 102 个迁移执行到 `0108`，真实 PostgreSQL 对普通/重大/开放事故、主体保留、无主体保守阻断和法律保留持锁竞态验收 1/1 通过。
46. 同一策略下的账户生成风险记录匿名化链路已实现：迁移 `0109` 将 `RiskCase.userId` 和 `RiskAppeal.appellantId` 改为可空 `SET NULL`，为案件增加与数据权利一致的短期 `subjectRef` 和 `retentionRedactedAt`，并为历史案件回填引用。仅 `recovered/closed` 终态满 365 天的案件可处理；`restricted/appealed/open`、有效 `audit/safety` 法律保留和 CAS 漂移均阻止匿名化。Worker 清除案件主体、信号主体和含原用户 ID 的去重键、申诉人/裁决人、事件操作员与预览，保留 hash-only 信号、申诉 hash、决定状态和结构化证据；候选查询排除已保留记录，持锁事务二次复核，避免饥饿和法律保留竞态。管理员案件转移同时修复为真实数据库 CAS，避免两个并发转移都成功。空库 103 个迁移执行到 `0109`，原账户风险和新保留 PostgreSQL 验收各 1/1 通过；完整服务端 1,299 项中 1,241 通过、58 项按环境跳过、0 失败。权威策略状态提升为 `implemented_pending_target_environment_acceptance`，但全局 `retentionAutomationComplete=false` 和 No-Go 不变。
47. `moderation_close_plus_730d` 的审核案件族脱敏链路已实现：无申诉案件以原决定后 30 天申诉窗为终态，有申诉案件以申诉决定为终态，待决申诉永不处理；终态满 730 天后清除受影响用户、举报人、提交人、审核人、申诉人、队列经办人/负责人、社区动作经办人、安全信号创建人以及报告、决定、申诉和目标引用中的自由文本，保留类别、hash、阶段、结果、reason code 和时间链。有效 `audit/safety` 法律保留、无主体旧记录的保守阻断、跨实例案件/主体锁和持锁后二次复核防止竞态；普通更新继续由不可变触发器拒绝，仅专用维护事务可脱敏。测试同时发现并修复 `assign` 队列事件脱敏后违反旧 shape check、导致整笔事务回滚的问题。空库全部 104 个迁移执行到 `0110`，真实 PostgreSQL 新保留及原审核/安全运营集成测试 3/3 通过；完整服务端 1,304 项中 1,245 通过、59 项按环境跳过、0 失败，数据治理 485 项、数据操作策略 537 项、数据 Schema 101 项、Prisma、Lint、生产构建、生产包和差异格式门禁均通过。该状态仅为案件族 partial：全局规则转换和批量操作仍缺保留契约，目标环境验收未完成，`retentionAutomationComplete=false`、`productionApproved=false` 和 No-Go 不变。
48. 审核全局规则转换和批量操作的 730 天保留链路已补齐：规则版本仅以最后一次 `retired` 转换为终态，活动、灰度、草稿和重新激活版本永不处理；到期后清除创建人及全部转换操作人，并将该版本永久退休，禁止脱敏后再次激活。批量操作以完成创建时间为终态，到期后清除操作人、原始幂等键和案件 ID 明细，只保留 action、target/request hash、目标数、成功/跳过计数和时间；新增不可逆 `idempotencyHash`，因此原请求在脱敏后仍只会命中重放，不会重复执行。规则创建/转换、批量执行、案件队列写入与 Worker 共享数据库 advisory lock，持锁后重新检查规则状态和案件可操作状态；有效 `audit/safety` 法律保留继续阻断，无主体旧记录 fail-closed。空库全部 105 个迁移执行到 `0111`，运营保留、案件保留和原安全运营 PostgreSQL 回归 3/3 通过；完整服务端 1,308 项中 1,248 通过、60 项按环境跳过、0 失败，数据治理 486 项、数据操作策略 537 项、数据 Schema 101 项、Prisma、Lint、生产构建、生产包和差异格式门禁均通过。权威 `moderation_close_plus_730d` 提升为 `implemented_pending_target_environment_acceptance`，但目标环境迁移与 Worker 验收尚未完成，全局 `retentionAutomationComplete=false`、`productionApproved=false` 和 No-Go 不变。
49. `generation_terminal_365d` 双阶段最小化链路已实现：终态 30 天清除提示词和错误预览，365 天清除主体、资产引用、Provider 请求/任务标识及非白名单 JSON，只保留 prompt hash、模型/价格引用、终态、政策版本和计量摘要。活动审核/申诉、`audit/safety` 法律保留、未终结 Provider operation/retry/ingestion/mutation、未结算配额、积分或成本均阻止处置；数据库触发器让全部生成写路径与 Worker 共享 `creative-generation:<id>` 锁，并永久禁止脱敏后恢复主体数据。空库全部 106 个迁移执行到 `0112`，隔离 PostgreSQL 验收 1/1 通过；目标环境验收和全局治理批准仍未完成。
50. `marketplace_close_plus_730d` 的可变任务族链路已实现，但策略仍是 partial：未发布且无提案/交付的草稿在 30 天后硬删除；任务及争议终结 730 天后，清除任务、提案、交付、争议审核、通知、搜索投影和作品集来源中的参与者与自由文本。开放争议、待审核/待修订交付、未结算 escrow/会计异常及 `tasks` 法律保留均阻止处置；所有任务族写入与 Worker 共享 `task:<id>` 数据库锁，脱敏后禁止恢复身份或正文。最终审查确认 `TaskLifecycleMutation`、`DomainEventOutbox`、`PointLedger`/内部会计事实和规范化 `TaskSubmissionAsset` 关系在权威操作策略中属于 append-only/immutable evidence，现有契约不允许 Worker 改写或删除，因此没有用维护开关伪造完整闭环。Worker 默认关闭、使用跨实例租约和三次重试；空库 107 个迁移执行到 `0113`，隔离 PostgreSQL 验收 1/1、Marketplace 聚焦测试 73/73、完整服务端 1,319 项中 1,257 通过、62 项按环境跳过、0 失败，数据治理 488 项、数据操作 537 项、数据 Schema 101 项、Prisma、Lint、生产构建、生产包和差异格式门禁均通过。权威状态为 `partial_mutable_task_redaction_implemented_immutable_lifecycle_event_ledger_and_asset_evidence_contract_required`，全局 `retentionAutomationComplete=false`、`productionApproved=false` 和 No-Go 不变。
51. 关键生成业务监控已进入持久 SLO 告警链路：新增生成成功率、首个持久结果 120 秒达标率、免重试率和免放弃率，均提供 5 分钟/60 分钟燃尽告警和 30 天基线；无样本返回未知且不触发。指标直接读取 `CreativeGeneration`、最早完成的输出入库/资产关系和成功用户取消 mutation；Provider 或系统取消不会冒充用户放弃，且指标不包含用户、提示词、资产 URL 或 Provider payload。告警复用版本化阈值、值班通知、确认/静默/升级/恢复和不可变复盘。OpenAPI、Admin 控制面和运行手册已同步，聚焦 25/25、隔离 PostgreSQL 持久告警 1/1、完整服务端 1,314 项中 1,253 通过/61 环境跳过/0 失败，Lint、TypeScript、生产构建和生产包门禁通过。生产阈值、真实流量基线和外部通知仍需目标环境验收。
52. 前端异常监控已补齐可运营链路：浏览器在首次进入和路由切换时上报匿名访问基线，Error Boundary、`window.error` 和未处理拒绝继续只上传 SHA-256 指纹；后端按 release、route、errorCode 提供 30 天聚合，并用真实路由访问量作为 `frontend-error-rate` 分母。5 分钟/60 分钟燃尽触发时记录受影响 release 和人工发布回滚入口，自动回滚保持关闭。匿名入口限制为 4 KiB 并使用独立 `client_telemetry` 限流桶。浏览器对全局异常和懒加载失败验收 2/2、可观测性/限流/环境配置聚焦 69/69、契约、Lint 和生产构建通过；真实流量阈值与目标环境回滚演练仍待完成。
53. Router Music 的 403 分类漂移已修复：适配器现在有界读取最多 16 KiB 错误体并仅提取受限 reason code，`403 + NOT_ENOUGH_BALANCE` 与 Video 一致映射为 `PROVIDER_BALANCE_INSUFFICIENT/provider_balance`，不再误报为认证配置失败，也不保留响应消息。Provider 分类、Music/Video 和运营告警聚焦回归 41/41 通过。
54. 多模态外部内容分类器边界已加固：输入与输出分类不再先完整读取响应后检查大小，而是按流累计并在 16 KiB 处立即取消，声明超限时不读取响应体；外部响应的 category 只能来自冻结的 20 项 policy taxonomy，未知类别、未知判定、网络错误、非 JSON、畸形 schema 和超限响应全部 fail-closed 到 `review`，且不保留原始响应。`test:v1-safety-policy` 已从单纯配置/源码检查升级为 251 项策略契约加 12 项运行时边界测试，覆盖四种 modality 分区、输入、输出和 Chat fail-closed 行为。完整服务端回归为 1,326 项，1,264 通过、62 项按环境跳过、0 失败；Lint、TypeScript、生产构建、生产包和差异格式门禁通过。该结果仍只是仓库级证据，不替代目标 staging 分类器部署与故障注入验收，`enforcementComplete=false`、`productionApproved=false` 保持不变。
55. `retired_secret_30d` 已实现为独立的 Provider 推理密钥生命周期 Worker：只处理 `inference`、`chat-inference`、`image-inference`、`video-inference` 和 `music-inference` 五种闭集用途，轮换后先通过固定 HTTPS Secret Manager 网关禁用旧版本，后继版本创建满 30 天且已有禁用回执时才删除；加密、解密和签名用途默认排除。迁移 `0114` 新增 append-only `ProviderSecretLifecycleReceipt`，仅保存目标 SHA-256、回执 SHA-256、动作和时间，原 `ProviderSecretRef` 不更新、不删除；稳定幂等键、动作唯一约束、不可变触发器、跨实例租约和三次重试保证失败可恢复。空库全部 108 个迁移执行到 `0114`，当时的本地隔离发布基础设施演练 18/18 通过（RTO 26.168 秒、RPO 0），真实 PostgreSQL 集成 1/1、Provider Secret/环境/Worker 聚焦 77/77、完整服务端 1,332 项中 1,270 通过、62 项按环境跳过、0 失败；数据治理 489 项、数据操作策略 540 项、数据 Schema 101 项、Prisma、Lint、生产构建、生产包和差异格式门禁均通过。权威状态仅提升为 `implemented_pending_target_environment_acceptance`；目标环境网关、真实 Secret Manager 版本状态与 Worker 重放仍未验收，`retentionAutomationComplete=false`、`productionApproved=false` 和 No-Go 不变。
56. 修复 Prisma PostgreSQL adapter 的 `pg@9` 前向兼容缺陷：模型版本创建、AI Evaluation run、Provider Legal review、promotion 校验和 Release 申请/审批/部署/回滚原先会在同一事务 client 上通过 `Promise.all` 或多 relation `include` 并发执行 SQL，`pg@8` 仅给出弃用警告，`pg@9` 将直接移除该行为。现已改为锁后顺序读取和显式水合，Release DTO 的字段、证据排序、乐观锁、Serializable 边界及 promotion 原子门禁保持不变；Secret retention 同样在锁后分别重读 SecretRef、后继版本和回执。集成测试会主动捕获该警告，`node --throw-deprecation` 的真实 PostgreSQL promotion 全生命周期 1/1、聚焦 43/43、完整服务端 1,332 项、Lint、生产构建、生产包、数据治理 489 项、数据 Schema 101 项和差异格式门禁均通过。该兼容性债务已解除，不改变 Router、目标 staging、内容安全和数据治理外部 P0 的 No-Go 结论。
57. Internal Ledger 新写入已完成主体假名化止血，Prisma 与 Seed 保持一致：用户可用余额 movement 的 `accountRef`、`InternalAccountingOperation.actorRef`、漂移问题键、缺失账户来源和 reconciliation evidence 不再复制用户 ID 或 handle，统一使用既有稳定 `subject_<24hex>` 引用；余额更新事务仍可在内存中使用 `ownerUserId`，但不将其写入 movement。真实 PostgreSQL 已覆盖并发额度、幂等结算、漂移、双人修复和匿名引用 1/1；完整服务端 1,333 项中 1,271 通过、62 项按环境跳过、0 失败，数据治理 490 项和数据操作策略 540 项通过。历史 `PointLedger`、`InternalAccountingOperation`、`InternalAccountingMovement` 属于不可变事实，未经批准不得原地改写，因此权威状态仅为 `partial_new_writes_pseudonymized_historical_immutable_fact_anonymization_contract_pending`；历史匿名化投影或加密擦除契约仍是 P0，`retentionAutomationComplete=false`、`productionApproved=false` 和 No-Go 不变。
58. 补齐本地隔离备份删除/过期的 restore-negative 演练：RELEASE-01 证据升级为 `release-infrastructure-rehearsal-evidence-v2`，在 PostgreSQL 和媒体对象成功恢复后模拟 `rolling_backup_35d` 到期，删除数据库备份对象、媒体备份对象和本地恢复副本，并分别通过 HEAD 不存在与 GET 恢复被拒绝验证不可恢复。真实 Docker 演练 23/23 通过，RTO 25.721 秒、RPO 0，证据收据为 SHA-256 `49ee5b12ccd7e9ee90091696200f47b96124dfdb62308343b757cfe705d14d34`；RELEASE-01 静态契约 41 项、证据单元测试 6/6、数据治理 491 项通过。证据显式保留 `targetScheduleVerified=false` 和 `managedKeyDestructionVerified=false`，因此权威状态仅提升为 `local_restore_negative_expiry_rehearsal_implemented_pending_target_environment_schedule_and_kms_acceptance`，`backupDeletionRehearsed=false`、`retentionAutomationComplete=false`、`productionApproved=false` 和 No-Go 不变。
59. 全局结构化日志持久化边界已改为事件级白名单：Prisma 与 Seed 仓库在写入 `ObservabilityLog` 前统一调用同一 projector，顶层只接受数据库模型定义的 22 个字段，`attributes` 只接受 `http.request.completed`、`client.route.view` 和 `client.runtime.error` 各自批准的平面标量；未知顶层字段、未知属性、嵌套对象、非法 SHA-256、非法 HTTP 状态族、控制字符和越界数值均 fail-closed。非法日志在事务写入前即被拒绝，不会留下日志，也不会连带写入 Trace span；正常 HTTP、客户端异常、Trace、SLO、告警 CAS 和保留聚合行为保持不变。聚焦回归 21/21、隔离 PostgreSQL Observability/retention 2/2、可观测性契约 24 项、数据治理 492 项均通过；最终完整服务端 1,336 项中 1,274 通过、62 项按环境跳过、0 失败，Lint、生产构建、生产包、可观测性搜索/基线、数据操作策略和差异格式门禁全部通过。该项解除“可借无害字段名持久化任意日志 JSON”的仓库级缺口，但不替代目标环境日志平台、保留调度和访问控制验收，No-Go 结论不变。
60. `support_close_plus_730d` 的政策冲突已收敛为两阶段最小证据契约并实现：工单关闭 365 天后清除全部消息正文，730 天后清除请求人、经办人、消息作者、案件关联创建人及其稳定主体引用，同时清除主题、详情、关联资源和语言上下文；只保留类别、终态、优先级、SLA/生命周期时间和不可变 typed case ID。有效 `support/audit` 法律保留和未终结数据权利请求均阻断两阶段处理；Support 写路径与 Worker 共用 `support-ticket:<id>` PostgreSQL 事务锁，最小化后禁止回复、转派、状态变更或新增案件关联。迁移 `0115` 回填 `subject_<24hex>` 并将人员外键改为可安全 `SET NULL`；空库 109 个迁移全部应用成功。严格 `--throw-deprecation` 的原 Support 与 retention PostgreSQL 集成 2/2 通过，并顺带修复了 Support 多关系 `include` 在交互式事务内触发 `pg@9` 并发查询弃用的问题，现改为顺序批量水合。完整服务端 1,341 项中 1,278 通过、63 项按环境跳过、0 失败；Support 契约 34 项、Support 路由/领域 9/9、数据治理 493 项、数据操作策略 540 项和数据 Schema 101 项均通过。权威状态提升为 `implemented_pending_target_environment_acceptance`，但目标环境迁移、Worker 重放、法律保留并发和访问控制验收仍未完成，`retentionAutomationComplete=false`、`productionApproved=false` 和 No-Go 不变。
61. `provider_lifecycle_terminal_180d` 的政策与实现冲突已解除：审计确认 Replay 会经历 claim、applied/rejected 和 side-effect result 更新，因此操作策略从错误的 `append_only` 修正为受控 `state_transition`，继续禁止硬删除。迁移 `0116` 为 Provider operation、mutation、replay、output ingestion 和 retry state 增加 `retentionRedactedAt`、候选索引和数据库不可逆触发器；五类写路径与 Worker 共用 `creative-generation:<id>` PostgreSQL 事务锁。仅生成与全部五类记录均已终结满 180 天、无开放审核/申诉、`audit/safety` 法律保留、成本/积分/配额悬挂或开放账务对账时才处理；到期后清除 Provider job/event、原始幂等/来源键、请求人、备注、资产/存储/claim 引用、自由 JSON 和错误预览，JSON 只保留 SHA-256、操作计数和状态证据。Worker 默认关闭、使用跨实例租约和三次重试，脱敏后数据库拒绝恢复关联字段。空库 110 个迁移全部应用成功，严格 `--throw-deprecation` PostgreSQL 对五类最小化、开放对账、法律保留和不可逆恢复验收 1/1 通过；完整服务端 1,346 项中 1,282 通过、64 项按环境跳过、0 失败，数据治理 494 项、数据操作策略、数据 Schema、管理员资源、Prisma、Lint、生产构建、生产包和差异格式门禁均通过。权威状态仅提升为 `implemented_pending_target_environment_acceptance`，目标环境迁移、调度、重放、告警和访问控制验收仍未完成，全局 `retentionAutomationComplete=false`、`productionApproved=false` 和 No-Go 不变。
65. `configuration_superseded_plus_365d` 已实现不可逆最小证据方案：迁移 `0117` 允许且只允许受控保留事务清除旧 `SystemSettingRevision`、`ConfigResourceRevision` 和终态 `SystemSettingChange` 的完整值、标题/描述、diff、人员引用和备注；版本、事件、content hash、前序/来源关系和最多 128 路径、8 层深度的 SHA-256 类型/计数摘要保留。当前 revision 与待审批/已审批 rollback target 排除，发布和 Worker 共用 `configuration-system-setting:<key>` / `configuration-resource:<id>` advisory lock；数据库闭集校验摘要并永久拒绝恢复，运行时回滚返回 `REVISION_REDACTED`。Worker 默认关闭、跨实例租约、三次重试。真实 PostgreSQL 18 空库 111 个迁移全部通过，严格 `--throw-deprecation` 集成覆盖并发锁、排除、摘要不泄漏、非法维护、不可逆恢复和审计原子回滚并通过 1/1；测试过程中修复了 SQL 运算符优先级和 Prisma adapter 下 `SET LOCAL` 与 ORM 更新脱节两个真实缺陷，受保护更新现以单条 CTE `set_config` 执行。最终服务端 `1356` 项中 `1291` 通过、`65` 项按外部环境跳过、`0` 失败；治理 `495` 项、Schema `104` 项、操作策略 `540` 项以及 Lint、构建、RELEASE-01/02、生产包、fixture production smoke 和差异格式门禁均通过。权威状态提升为 `implemented_pending_target_environment_acceptance`，目标 staging 迁移、调度、告警与访问控制仍未验收，`retentionAutomationComplete=false`、`productionApproved=false` 和 No-Go 不变。
62. 发布/恢复证据的源码归属缺陷已修复：旧回执只记录 HEAD commit，在脏工作树运行时无法证明实际受测代码与该 commit 一致。RELEASE-01 现升级为 `release-infrastructure-rehearsal-evidence-v3`，回执新增 tracked diff SHA-256/字节数、untracked manifest SHA-256/文件数/字节数、clean 状态和组合 source snapshot SHA-256，并校验组合摘要一致性。目标环境 preflight 只接受 clean checkout，写入带回执的 `target-preflight.json`；execute 在触碰资源前强制校验同一 commit、同一 source snapshot、回执未篡改且未超过两小时，缺失或漂移均 fail-closed。当前 110/110 迁移的真实隔离 Docker 演练 23/23 通过，RTO 23.853 秒、数据库恢复 5.645 秒、Redis 0.431 秒、对象 0.011 秒、RPO 0，SHA-256 回执为 `4bcc8db6d3eda5a9ff03fb171a18310976dd428707c591b33920c845a7c08e5f`；静态契约 43 项、证据单元/负向测试 8/8 通过。本地证据明确记录 `clean=false`，只证明该哈希绑定快照可执行，不冒充已提交制品或目标环境验收；`targetScheduleVerified=false`、`managedKeyDestructionVerified=false` 和 No-Go 不变。
63. 应用级发布/回滚演练缺口已形成可执行 RELEASE-02 契约：目标 staging 必须从同一 clean checkout 依次完成 candidate 部署、制品身份绑定的 `/health`、OpenAPI、公开政策和未登录 401 冒烟，再恢复明确 SHA-256 的 previous artifact 并重复同一套冒烟；candidate 失败也不会跳过 rollback。preflight 绑定 commit、完整源码快照、候选/上一制品 SHA-256、HTTPS staging/rehearsal 域名和 30 分钟时限；命令只接受 allowlist argv 数组，不使用 shell，凭据必须从受保护环境注入。GitHub Actions 已增加同 job、固定顺序的 `application-rehearsal` 手动门禁；`/health` 可用 `RELEASE_ARTIFACT_SHA256` 在 body/header 证明实际服务制品。当前静态契约 22 项、证据/负向测试 6/6、真实健康路由 2/2、本地无外部副作用夹具 12/12 通过；完整服务端 1,348 项中 1,284 通过、64 项按环境跳过、0 失败，Lint、TypeScript、生产构建、workflow YAML 和差异格式检查通过。本地夹具不部署 NewChat，权威状态仅为 `implemented_pending_protected_staging_acceptance`，不能替代真实制品、流量切换和受保护环境回执，No-Go 不变。
64. 生产 smoke 的 Provider 批准门禁漂移已修复：Video 和 Music capability 曾把历史受控单次 staging 调用误表示为常驻 `realProviderCallsApproved=true`，而 fixture smoke 又错误地要求该值为 true，导致“Provider-disabled”检查在未获新授权时仍显示绿色。两项 runtime 标志和 smoke 断言现统一恢复为 `false`，并补入 capability 单测；`productionEnablementApproved=false`、模型 `enabled=false`、生命周期开关关闭和 fail-closed 行为不变。后续真实 Router 调用仍必须使用新的短时单次审批信封，历史成功证据或管理员凭据不能转化为常驻调用批准。
66. 修复 production smoke 对后台任务的系统性假绿：旧门禁只要求 Chat retention、媒体扫描/对象清理和过期投稿四个 Worker，账户删除、审计归档、配置历史、Provider 生命周期等已实现链路即使全部关闭也会通过；账户删除 Worker 即使启用，外部 Provider 删除网关完全缺失也不会失败。现建立 8 项核心 Worker 与 20 项 retention Worker 的闭集清单，fixture 表示真实可运行的生产 Worker 拓扑，env profile 任一开关关闭都会点名失败；Provider polling 因真实调用未批准而明确不在启用清单。Provider 删除网关的显式确认、固定 HTTPS URL、无凭据/query/fragment 和最短 Token 校验已由运行时与 smoke 共享，安全摘要只输出布尔状态。负向测试逐项关闭 28 个开关并全部正确失败，网关缺失/HTTP/query/短 Token 负向测试通过，fixture smoke 和 Lint 通过。该修复只消除配置假绿，目标环境实际调度、网关请求/回执和告警仍需 staging 验收，No-Go 不变。
67. `media_asset_delete_plus_30d` 的 `RESTRICT` 外键冲突已采用最小结构墓碑方案解除：迁移 `0118` 将 `MediaAsset.ownerId` 及相关证据关系的 `ownerId` 改为可空并回填稳定主体引用；对象状态必须先确认 `deleted`，删除/拒绝资产满 30 天或废弃 pending 上传满 1 天后，Worker 删除可变的 Private Library 副本，但保留任务提交、生成、Chat 输入和资产 lineage 的不可变结构证据，仅清除 owner 与自由上下文；作品集和扫描记录按状态转换最小化，并从父表旧资产数组移除该 ID。资产本身清除所有者、主体、文件名、对象键、校验值、内容类型、大小和 JSON 元数据，只保留墓碑主键、对象已删除事实及最小化计数。有效 `media/audit/safety` 法律保留和活动扫描阻断处理；所有媒体及引用写入共享 `media-asset:<id>` advisory lock，数据库永久拒绝墓碑恢复和重新挂接。Worker 默认关闭、带跨实例租约、三次重试和批次硬上限 500，production smoke 已将其列为必需项。纠正后的 PostgreSQL 18 全新空库 112 个迁移全部通过；严格 `--throw-deprecation` 的 Data Rights、MediaAsset retention 和原媒体生命周期集成 3/3 通过；完整服务端 1,361 项中 1,295 通过、66 项按外部环境跳过、0 失败。聚焦单测 82/82、治理 496 项、Schema 105 项/80 JSON 字段、操作策略 540 项/176 模型、Prisma 校验、Lint、生产构建、生产包、负向与 fixture production smoke 和差异格式门禁均通过。权威状态仍为 `implemented_pending_target_environment_acceptance`，目标环境对象删除回执、调度、告警与访问控制仍未验收，`retentionAutomationComplete=false`、`productionApproved=false` 和 No-Go 不变。
68. 2026-07-29 完成普通用户与管理员双角色实操复核。普通用户完成登录、政策确认、进入 Music Studio、确认权利声明并创建一条 Mock 音乐任务；任务记录成功生成，但界面同时显示 `Completed`、`application/json · pending`，播放器、下载和后续使用均不可用，证明“Provider 终态”与“可交付资产终态”存在真实契约缺陷。该缺陷已在 Music/Video Studio 同步修复：只有 `completed + clean` 显示“已完成”和成功状态色；`completed + pending/无输出` 显示“正在处理输出”；`completed + rejected/failed` 显示“输出不可用”。聚焦 Music/Video E2E 4/4、TypeScript 和同一浏览器记录热更新复验通过。管理员完成登录、政策确认、进入 Overview 和 AI config；控制面明确显示 `No production traffic · 0 routes`、`Chat production is not ready / no_active_route_policy`，Provider 列表为空，页面控制台无错误。`1280 x 720` 与 `390 x 844` 下未发现横向溢出或控件重叠，但桌面 Music Studio 的生成主操作低于首屏，移动端参数流程明显过长。该实操仅使用本地 Seed/Mock 环境，不冒充 staging、真实 Router 或生产验收。
69. 完整浏览器 E2E 首轮为 91 项中 73 项通过、18 项失败。根因主要是移动端 Admin 已采用 `Current section` 下拉选择器，旧测试仍操作隐藏的桌面分区按钮；同时发现媒体生命周期用例依赖固定文件名、Community 移动举报依赖共享 Seed/执行顺序，以及 Observability SLO 数量断言落后于当前 7 个真实控件。现已增加桌面/移动统一的 Admin 分区测试 helper，为移动选择器补充明确 `aria-label`，让 Community 用例自建唯一帖子，并将媒体资产 fixture 改为运行时唯一文件名。修复后聚焦回归 17/17、完整 Playwright E2E 91/91 通过（单 worker、3.7 分钟），Lint、生产构建和差异格式检查通过。该结果证明本地 Seed 浏览器流程可重复执行，但不替代真实 Provider、目标 staging、真实设备和生产数据验收。
70. 第一阶段门禁复核发现 fallback 契约存在全局状态误导：旧 `test:v1-production-fallbacks` 在 14 个 UI/运行时 fallback 都已处置时输出 `productionReady=true`，但 Provider、内容安全、数据治理和目标环境仍明确 No-Go。现将该字段与策略统一改为范围明确的 `fallbackDispositionComplete=true`，增加 `runtime_surface_fallback_disposition_only` scope 和全局批准来源声明；旧 `--require-ready` 参数会直接失败并提示迁移。新增四项负向测试覆盖模糊全局字段回归、scope 边界、完成状态与 blocker 矛盾及旧 CLI，且已接入现有 PR 快速门禁。fallback 处置完成不再能够被解释为全局生产批准。
71. 同轮 `test:v1-surfaces` 首次复跑暴露 7 项盘点漂移：Task、Community、Points 和 unavailable 文案仍引用旧源码 marker，Prisma autoseed 调用签名已变化，直接 Mock 导入 allowlist 仍为旧 13 项，且审计归档、输入/输出安全与 Provider 删除网关四个新增 fixture/Mock 防线未归属。现已按真实源码更新 API-only marker、7 项生产 alias 导入清单及 Provider/安全/存储边界，运行时 surface 门禁恢复为 152/152。2026-07-29 的 env metadata preflight 同时确认 Image、Router Video 和 Router Music 均未注入 dedicated staging 配置；RELEASE-01/02 目标 preflight 因工作树不是 clean checkout 在资源操作前 fail-closed。RELEASE-02 本地候选/回滚夹具通过 12/12，回执 `cb59b8b15f8f589285da25552daa7366a1c613fbfad320b055ed1af18848c07d`；RELEASE-01 本轮在拉取固定 MinIO 镜像时遇到 Docker Hub `502 Bad Gateway`，未进入迁移或恢复阶段、无残留容器，因此不能记为新的基础设施演练通过，继续沿用此前已通过但不代表目标环境的本地证据。
72. 余额不足、配额耗尽和 Provider 状态不可用三类站内运营告警已补齐 API 路由级证据，不再只由仓库单测间接证明。测试从 `/api/creative/generations` 注入三类受控失败，确认分别生成 `creative.provider_balance.insufficient`、`creative.provider_quota.dispatch_blocked` 和 `creative.provider_status.dispatch_blocked`，且通知失败不会替换原始生成错误。测试同时发现通知清洗器会丢弃 `providerStatus`、`providerCategory`、`statusCode` 和 `retryable`，导致运营界面无法区分 403 余额故障与 502 上游故障；现已保留这四个受类型和长度约束的字段，仍丢弃 prompt、原始错误文本、Provider URL 和密钥。进一步验证确认这三类通知会复用统一 `NotificationDelivery`：在邮件通道和 Worker 启用时原子排入持久队列，经过租约、重试/死信边界后送达运营邮箱并保存 hash-only 回执；API 到邮件 Worker 的聚焦测试不包含提示词和原始 Provider 错误。路由、通知目标与生命周期聚焦回归现为 60/60，Image 生产 UX 契约 24 项及其服务端 13 项、Lint 和全工作树差异格式检查均通过。该结果关闭三类生成故障的站内与邮件触达代码链路；Provider 预算阈值专用的 Slack/Webhook/邮件模块仍未生产化。
73. 修复 Provider 专用外部告警的 production smoke 假绿：旧门禁只在 `CREATIVE_PROVIDER_ALERTS_ENABLED=true` 时检查至少一个 URL/邮箱地址存在，即使运行时明确 `realDeliveryAvailable=false`、只允许 fixture client 且没有生产调用方也会通过。Smoke 现直接读取正式 delivery wiring；显式启用时必须同时满足 `mode=production` 和 `realDeliveryAvailable=true`，仅配置 URL 会以 `provider_alert_real_delivery_not_implemented` fail-closed。安全摘要新增 mode、reason code 和真实送达布尔值，不输出 URL、收件人或 Secret。fixture production smoke、负向 smoke 和 Provider 外部告警边界 19/19 通过。该修复消除了假绿，但没有伪造生产客户端或目标环境回执。
74. Provider 预算事件已从测试/文档计划接入真实生成路由：成功 Provider 成本 closeout 后会从安全 `providerCost` 快照生成预算阈值和成本异常计划，持久化去重审计并向审计运营角色创建通知；预算 guard 或持久预算窗口在派发前阻断时会生成 `creative.provider_budget.dispatch_blocked`。实现同时修复了 Replicate guard 使用 `details.reason`、路由只读取 `reasonCode` 导致 `over_budget` 退化为笼统 `dispatch_blocked` 的契约漂移。阻断错误附带的成本快照为不可枚举内部证据，不进入 JSON/HTTP 响应；审计或通知失败不会绕过预算 kill switch、调用 Provider、替换原始 429 或把成功生成改成失败。成功阈值/异常、阻断和审计故障隔离的 API 证据均已加入，Provider 预算、生成服务与路由组合回归 123/123，Lint 和差异格式检查通过。预算事件现在可经统一邮件通知队列触达，但专用 Slack/Webhook 外发仍保持未实现和 fail-closed。
75. Provider 预算专用外发的队列复用审计已完成。`DomainEventPublication` 发布层没有最大尝试或死信终态，把 HTTP 发送放入 publisher 会对永久故障无限重试，不可用于外部告警；`DomainEventConsumerInbox` 虽有租约、有界重试、逐次 attempt、死信和管理员 replay，但当前事件注册表与 handler 仅覆盖既有领域事件，预算事实仍由独立审计仓库产生，强行接入会扩大事务、排序和幂等边界。上线实现应新增独立 `ProviderAlertDelivery` 持久投递模型，按 `sourceKey + channel` 唯一，复用现有 Webhook/NotificationDelivery 的租约、退避、死信、replay 与 hash-only receipt 模式。完成该模型及迁移前，专用 Slack/Webhook 继续由 production smoke 以 `provider_alert_real_delivery_not_implemented` fail-closed；现有站内和统一邮件可靠投递不受影响。
76. Provider 预算专用外发的仓库级可靠投递已实现：新增 `ProviderAlertDelivery`、Attempt、Replay 三张持久表和迁移 `0119`，Prisma/Seed 仓库按 `sourceKey + channel` 去重，支持租约与过期回收、有界指数退避、最大尝试、死信、幂等 replay 和 hash-only receipt。独立 Worker 从受保护环境读取 URL/Secret，要求 HTTPS 与显式 hostname allowlist，使用 timestamp、HMAC 和稳定幂等头；401/403 为永久失败，408/425/429/5xx/网络错误可重试，数据库不保存 URL、收件人或 Secret。预算事件已在既有生成路由的 best-effort 隔离边界入队，外发失败不会替换生成结果或绕过预算 kill switch。管理员已可通过受 `admin:webhooks:read/manage` 保护的 list/replay API 筛选死信并以 expectedVersion、reasonCode 和 idempotencyKey 重放；普通用户访问返回 403。Admin Webhook 运营面板现已加入独立 Provider Alert 区，可按状态和通道筛选，显示通道、动作、来源键、尝试次数、HTTP/错误码和更新时间，并对死信执行幂等 replay；Provider Alert 读取失败也不会拖垮既有 Webhook 管理。本轮进一步发现管理员 API 曾直接返回 Worker 内部 `payload`，虽然 UI 未渲染但仍违反最小披露；现已在路由边界改为显式字段 allowlist 投影，list 和 replay 响应均不含 payload、URL、收件人或 Secret，Worker claim 仍保留发送所需 payload。两条 Provider Alert 管理 API 已纳入 OpenAPI 和 Webhook 契约，聚焦门禁由 71 项提升至 75 项，领域、Worker、路由组合测试 17/17 通过；桌面重放流程和 `390 x 844` 移动边界 E2E 与既有用户/管理员 Webhook 流程共 3/3 通过。PostgreSQL 18 全新空库 113/113 迁移通过，真实 Prisma 集成覆盖并发重复入队、竞争 claim、重试、死信、幂等 replay 和最后一次尝试崩溃后的租约过期死信，1/1 通过。最终完整服务端 1,378 项中 1,311 通过、67 项按环境跳过、0 失败；Lint、生产构建、生产包、正负 smoke、Prisma 和差异格式门禁通过。尚未完成目标 staging 通道送达/故障演练，因此状态为 `implemented_pending_target_environment_acceptance`，全局 No-Go 不变。
77. 2026-07-29 对 Router 管理控制台执行了无生成调用的只读复核：余额仍为 `$163.41`，总请求数仍为 `225`，当日任务日志为 `0`；管理员“渠道”和“模型元信息”页面均显示总计 `0`。因此首页“网关在线/路由健康”只能证明站点可访问，不能证明模型路由可用。当前不仅缺上游恢复证据，Router 控制面还没有可用于 `seedance-2.0-fast` 或音乐模型的渠道和模型映射；在补齐上游渠道密钥、模型元信息并完成健康检查前，再次发起受控生成没有技术意义，也不应消耗新的单次调用授权。
78. 数据治理复核发现 `ProviderAlertDelivery`、Attempt、Replay 三个 `0119` 新模型未进入治理清单，且内部 payload 没有自动过期路径；这不是文档遗漏，而是生产数据保留缺陷。现已将三模型归入 `notification_records`，新增 `0120_provider_alert_retention`：仅删除 `succeeded/dead_lettered/cancelled` 终态满 180 天的告警，活动投递始终保留，Attempt/Replay 先于父 Delivery 清理，通知与 Provider Alert 候选按时间全局排序并共享批次上限。`ProviderAlertDelivery.payload` 同时补充非空 `payloadSchemaVersion`，Admin/export 继续排除 payload、目标、收件人和 Secret。数据治理恢复为 496 项、179/179 Prisma 模型，数据操作策略 549 项，通知保留测试 83/83，Prisma schema、Lint 和生产构建通过；PostgreSQL 18 全新空库 114/114 迁移到 `0120`，通知/告警保留与 Provider Alert 并发、死信、replay 两项真实 Prisma 验收各 1/1 通过。该结果关闭仓库级缺陷，但 Worker 调度和目标环境清理回执仍未验收，因此 `retentionAutomationComplete=false`、`productionApproved=false` 和 No-Go 不变。
79. 基于包含 `0120` 的当前源码快照重新执行本地发布与恢复演练：RELEASE-01 在隔离 PostgreSQL、Redis AOF 和 MinIO 上通过 23/23，源库及恢复库均为 114/114 迁移，数据库/对象备份上传、SHA-256、恢复、过期删除和 HEAD/GET restore-negative 全部成立；RTO 21.754 秒，其中数据库恢复 5.267 秒、Redis 0.418 秒、对象 0.013 秒，RPO 0，回执为 `15d80a6952fe80d192cc32a87b0daa39a1e1677e798a49f912391e7879ea3234`。RELEASE-02 本地候选/回滚夹具通过 12/12，两阶段均验证 `/health`、OpenAPI、公开政策和未认证 401，候选与上一制品摘要独立，回执为 `fb3dda439dec36a7768958191347162cdf871a371a5f720a8b2d969ebec51863`。两份证据都绑定 commit、tracked diff、untracked manifest 和组合源码快照；当前工作树为 `clean=false`，应用夹具明确 `targetEnvironmentVerified=false`，因此只关闭“最新代码是否可执行本地演练”的缺口，不替代 clean checkout 制品、目标 staging 流量切换或受保护环境回执。
80. 第一阶段最终本地回归覆盖完整服务端 1,380 项：1,313 通过、67 项按外部数据库/Provider 环境跳过、0 失败；管理员运营概览、客户端异常、Error Boundary、Image/Video/Music 生命周期、Webhook 用户/Admin 和 Provider Alert replay 的关键浏览器流程 12/12 通过。无真实调用的 Router env preflight 明确显示当前 `runtimeEnv=unset`，Video/Music 的 HTTP、网络、凭据、端点/模型、生命周期及授权证据均未配置；目标 RELEASE-01/02 preflight 也因非 clean checkout 在任何资源操作前 fail-closed。复核同时修复 Video preflight 的运维文案：旧输出在失败项后打印期望值 `credentialConfigured=true`，会与实际安全摘要 `false` 冲突；现改为逐项输出实际布尔值，并新增 2 项负向/脱敏测试。当前不能合法执行 Router acceptance 或目标部署，且本轮未触发任何真实 Provider 调用或目标环境变更。
81. 2026-08-08 完成受保护 staging 的 RELEASE-01 与 RELEASE-02：RELEASE-02 在 run `31236680969` 对不可变候选制品完成部署、四项冒烟、明确上一制品回滚及相同冒烟，12/12 通过；RELEASE-01 在 run `31238305998` 通过 forced-command SSH 对 clean SHA `874ffb17429abc6a2f4d1066daeadfd11010aecf` 执行隔离 PostgreSQL、Redis AOF 和真实 `storage.hctopup.com` 双桶恢复，114/114 migrations、权限种子、764,069-byte 数据库备份 checksum、Redis 重启恢复、对象删除/恢复和 restore-negative 到期模拟均通过，23/23、RPO 0、总 RTO 25.507 秒。CI 上传回执经独立验证 `valid=true`、敏感字段路径为空，receipt 为 `18d9d574ed565b4c02548b3ea6cd5191a97fecd9f0e7b396b64acb33a98bfeed`。演练过程中实际修复了远端工作目录、专属 TMPDIR、shell-safe JSON、日志权限、stdout JSON 污染和 GitHub Secret 写入问题。两项 RELEASE 门禁现已关闭，但生产 35 天真实生命周期/KMS、Provider/法律批准、通知投递、Secret Manager 和 OAuth 公网回调仍独立保持 No-Go。

## 二、正式上线阻断项（P0）

### 1. 上游安全责任契约与应用失败关闭未验收

权威配置仍为 `enforcementComplete=false`、`providerNativeSafety=assurance_contract_implemented_real_provider_evidence_pending`、`productionApproved=false`。Image/Video 参考资产输入分类、Chat 附件与流式分段分类、Provider 原生结果闭集映射、人工审核案件、原决定和所有者申诉已经存在。2026-08-04 业务责任人确认，生成输出内容安全和媒体技术安全由 Router/上游 Provider 承接，本系统不再建设重复分类器或扫描服务。逐产物证明合同现已固定 Provider、操作引用、上游策略引用、证据哈希、来源和时间，并明确 Staging 人工证明不能用于 Production。剩余缺口收窄为：基于脱敏真实响应完成各 Provider 字段映射，验收拒绝/未知/超时/畸形/不可用的闭集映射与失败关闭，并继续对应用自有的输入、Chat、权限和申诉流程负责。

上线前必须实现：

- 归档 Router/上游 Provider 的输出内容安全、媒体技术安全、策略版本、拒绝状态、变更通知和责任人契约；契约缺失时不启用生产路由。
- 在目标 staging 验收 Provider 拒绝、未知状态、超时、畸形响应和上游不可用；这些情况均不得发布、预览或下载输出。
- 在目标 staging 继续验收应用自有的输入安全、Chat 流式分段、权限隔离、人工审核和申诉链路；这些职责不因上游输出限制而取消。

### 2. 数据治理自动化未完成

权威配置现为 `providerDeletionAutomationImplemented=true`，法律保留状态为 `implemented_pending_target_environment_migration_acceptance`，但 `backupDeletionRehearsed=false`、`retentionAutomationComplete=false`、`productionApproved=false`。站内到期删除、外部 Provider 网关、7 天到期导出包清理、按域法律保留、删除截止点并发互斥、观测 Trace/日志/匿名聚合的 7/30/90 天清理、通知、Provider Alert 和 Provider 生命周期 180 天最小化、操作租约 7 天清理、Private Library 30 天清理、认证凭据终止后 30 天清理、Provider 推理密钥轮换后禁用并在 30 天后删除、审计事件归档后清理、社区内容 30 天匿名化、安全事件 365/730 天删除、账户风险终态 365 天主体匿名化，以及审核案件、规则转换和批量操作终态 730 天脱敏已自动化；Marketplace 仅完成可变任务族部分。ObservabilityLog 的 Prisma/Seed 写入边界现已统一执行事件级字段白名单，未知顶层字段和任意嵌套 attributes 不再能够持久化。本地隔离环境已能在恢复成功后删除数据库/媒体备份并验证不可恢复，但目标环境真实 35 天生命周期调度和托管密钥销毁尚无证据。这仍不等于全局 24 项字段级保留策略和备份介质已闭环。

逐项状态已写入 `retentionAutomationInventory`。Private Library、认证凭据、审计事件、社区内容、安全事件、账户风险记录、支持工单、Provider 生命周期、配置历史、媒体资产元数据和审核案件/运营证据链路已完成仓库实现，所有项目仍需目标环境验收。MediaAsset 采用对象先删、关系最小化、主键保留的结构墓碑：Private Library 副本可删除；任务、生成、Chat 和 lineage 的不可变证据行保留，仅清除 owner；作品集和扫描记录保留终态并清除人员、来源及自由文本，父表旧资产数组同步清理。资产本身清除所有者、主体、文件、对象键与业务元数据，并由数据库共享锁永久拒绝恢复或重新挂接；有效 `media/audit/safety` 法律保留会阻断。Internal Ledger 的 Prisma/Seed 新写入已统一使用稳定 `subject_<24hex>` 引用，不再向 movement、actorRef 和 reconciliation evidence 复制用户 ID/handle，但历史 `PointLedger`、`InternalAccountingOperation` 和 `InternalAccountingMovement` 仍是不可变事实；在匿名化投影或加密擦除契约获批并演练前，该项只能保持 partial。Marketplace 生命周期/事件/账务/资产关系也仍缺批准后的最小证据契约。上述问题不能通过关闭数据库保护来伪造完成。

上线前必须实现：

- 在生产同构环境验收对象存储、搜索索引、缓存和外部 Provider 删除传播，并核验失败重试与回执。
- 在目标环境部署迁移 `0100` 至 `0120` 后，复验法律保留创建、释放、自然到期、Provider 回执、断点续删、观测保留、通知级联保留、Provider Alert 终态保留、Provider 生命周期、配置历史与媒体资产元数据最小化、Provider Alert 投递、租约保留、Private Library、认证凭据、Provider 推理密钥禁用/30 天删除、社区内容、安全事件、账户风险、审核案件/运营证据、生成终态、Marketplace 与支持工单保留 Worker，并保存迁移、并发与清理证据。
- 对失败删除任务保留可重试、告警和人工接管能力。
- 在目标环境执行真实 35 天生命周期过期和托管密钥销毁，保存备份清单、HEAD/GET restore-negative、KMS 回执、时间和执行人证据；本地模拟过期只能验证执行器。

### 3. Router 当前派发可用性回归

仓库保留了 2026-07-21 的成功全链路证据：一次 4 秒 `seedance-2.0-fast` 任务约 129 秒完成，Router 计费 $0.484，应用完成 MP4 校验、私有入库、媒体扫描、所有者下载隔离、积分结算和配额提交。

基于该成功回执，视频生成产品能力现标记为**可用**：`capabilityAvailable=true`、`runtimeAvailableWhenConfigured=true`。这里的“可用”表示生成、入库、安全隔离和结算链路已有成功案例；具体部署仍须具备有效 Provider 配置。整站生产批准保持独立，当前仍为 `productionAvailable=false`，不会用历史回执绕过生产 Secret、健康检查、内容安全和发布门禁。

2026-07-27 充值后复验时，控制台余额为 **$163.41**，启用中的专用视频 staging 密钥和 9 项本地预检全部通过；唯一一次 4 秒请求在应用派发阶段返回 `502 / PROVIDER_UNAVAILABLE`。Router 任务日志、通用日志、总请求数 225 和余额均无变化，说明请求未进入 Router 任务登记或计费。不得继续重试，应由 Provider 方核对 `/v1/video/generations` 当前路由、模型映射和网关故障日志；恢复后再建立一份新的单次调用审批。

2026-07-29 只读复核进一步确认 Router 控制台的渠道总数为 `0`、模型元信息总数为 `0`、当日任务日志为 `0`。这已经构成比 502 更直接的控制面阻断：必须先由 Router 运维提供有效上游渠道凭据并建立目标模型映射，再执行渠道健康检查；应用侧不得把首页“路由健康”或账户余额充足解释为模型已接入。仓库中继续保持 `realProviderCallsApproved=false`，本轮未发起新的真实生成。

2026-07-30 管理控制台状态已变化：余额仍为 **$163.41**，现有 10 个渠道和 93 项模型元信息；MiniMax Official Media #7 的连接测试约 505 ms，Jiekou AI Seedance #11 与 Vidu Official #12 已启用但仍显示“未测试”，两者优先级和权重均为 `0`。应用已新增 MiniMax Hailuo 2.3 异步适配器并接入共享视频生命周期、成本预留/对账、私有入库和 Worker Provider 路由。首次直连 Router 上游原生 `/v1/video_generation` 返回 404，定位到协议层错误：Router 对客户端暴露统一 `/v1/video/generations`，再由渠道转换为 MiniMax 原生请求。适配器已改用统一创建/轮询接口和鉴权内容代理，不再接触或保存 Provider CDN URL。

修正后，一次受限的 `MiniMax-Hailuo-2.3`、6 秒、768P、16:9 请求真实完成：任务经历 `queued -> IN_PROGRESS -> SUCCESS`，鉴权内容代理返回 2,241,258 字节 `video/mp4`，检测为 H.264、1366x768、容器时长 5.875 秒，SHA-256 校验通过；Router 扣减 136,986 quota，约 USD 0.274。两个临时 Key 随即禁用，本地凭据随后清理。MiniMax 适配器因此标记为 `availability=staging_available`、`stagingTransportAccepted=true`；当前部署仍保持 `runtimeEnabled=false`，因为本次只验证 Router 传输和下载，没有经过目标环境的应用私有入库、输出分类、媒体扫描、所有者隔离及积分/配额结算。生产批准仍为 `productionApproved=false`，Vidu 仍未适配。

何龙批准的一次受控复验使用了单模型、1 小时、USD 1.20 的临时 Key 和 4 秒生成上限。首次执行在 Provider 请求前因本地 PostgreSQL 未启动而以 `P1001` 停止；恢复空库并应用 114/114 迁移后，又发现 `NODE_USE_ENV_PROXY=1` 将 Router 请求送往不可达的 `127.0.0.1:6152`，Router 侧任务/通用日志、Key 最后使用时间和额度均未变化。该预检假绿已修复：环境代理启用时，Video preflight 现在要求 `router.hctopup.com` 明确进入 `NO_PROXY`，且安全摘要只报告布尔状态，不输出代理地址。

修正网络路径后的唯一一次外部 API 请求返回 `PROVIDER_AUTH_CONFIGURATION`（应用 HTTP 503），没有创建 Router 任务、没有 MP4、没有进入私有入库/扫描/所有者隔离，也没有积分、配额或 Provider 成本结算。Router 任务日志仍为 0，临时 Key 额度仍为 USD 1.20 且“最后使用时间”未推进；两个临时 Key 均已禁用，本地凭据文件和页面剪贴板已清除。由于单次调用审批已经消耗，不再自动重试。下一次验收前必须由 Router 管理员确认 #11 的渠道测试通过、非零路由权重、`default` 分组和 `seedance-2.0-fast` 映射，并签发新的单次审批。生产结论继续为 **No-Go**。

同日最新本地 env preflight 进一步确认运行机器没有注入 Video/Music staging 配置：Video 安全摘要为 `runtimeEnv=""`、`credentialConfigured=false`、`endpointConfigured=false`、`modelConfigured=false`、生命周期与 Worker 均关闭；Music 也因生产语义、staging、网络、凭据、权利/训练退出和许可证据八项缺失而 fail-closed。即使 Router 控制台恢复渠道和模型，也必须先在专用 staging 注入短时 SecretRef 和新的单次审批信封，preflight 全绿后才允许运行 acceptance。

### 4. 登录恢复路径与 OAuth 目标回调未完成

邮箱注册和密码登录的 API、限流、会话与浏览器流程已经通过，但当前没有邮箱所有权验证和密码找回链路，不能把邮箱表单视为完整的生产账户恢复方案。Google/GitHub 的现有回调仍指向本机，`chat.hctopup.com` 当前也不是本系统 API，不能冒充可用回调。Production smoke 因此继续要求至少一个 HTTPS 外部 OAuth Provider；未配置 Provider 在登录页完全隐藏，不再留下四个禁用按钮或无意义分隔线。

上线前必须二选一完成并验收：为至少一个 OAuth Provider 配置目标 HTTPS 回调并执行真实登录/绑定/冲突/撤销验收；或实现邮箱验证、一次性密码重置、可靠邮件投递、令牌过期/单次消费、全会话撤销和滥用限流。两条路径均未完成前不得放宽 OAuth 门禁。

### 5. 目标环境发布与回滚演练未完成

最新本地隔离 Docker 演练已基于 114/114 迁移和源码快照绑定的 v3 回执通过 23/23 检查，证明迁移、PostgreSQL/Redis/对象备份恢复、备份删除和 restore-negative 脚本及证据链可执行；RELEASE-02 本地无副作用夹具也已完成 candidate/rollback 两阶段 12/12 检查，证明制品绑定、冒烟、回滚和回执执行器可运行。两类本地证据都明确记录工作树非 clean 或 `targetEnvironmentVerified=false`，不冒充 commit 制品部署或 staging 验收。目标环境仍须在受保护 job 以 clean checkout 完成真实不可变制品部署、健康检查、冒烟、回滚后复验、密钥轮换、真实备份生命周期和恢复，并保存环境回执。

### 6. Provider 预算专用外部告警待目标环境验收

余额、配额和 Provider 状态阻断已经能够生成去重、脱敏的站内运营通知，并在统一邮件通道启用时进入持久投递队列。预算阈值、预算派发阻断和成本异常也会进入独立 `ProviderAlertDelivery`：专用 Webhook、Slack 和邮件中继共用持久租约、重试、死信、逐次 attempt、人工 replay 仓库能力和 hash-only 回执。生产客户端要求 HTTPS、显式 hostname allowlist、timestamp、HMAC 与稳定幂等头；URL、收件人和 Secret 仅从受保护环境读取，不写入投递表或日志。Production smoke 只在 Worker、通道、allowlist 和显式批准完整时承认 production wiring。

上线前仍必须完成：

- 在目标部署清单和运维手册确认 `runtime.ai` SecretRef 注入、Worker 实例数、Secret Manager 轮换及 hostname allowlist 变更审批流程；生产 Worker inventory 已能在功能启用但 Worker 关闭时 fail-closed。
- 在目标 staging 验收成功、401/403、429、5xx、超时、DNS 失败、签名错误、重复投递和死信恢复，并证明值班人员能够从通知到达对应 Admin 生成/审计证据。

### 7. 局部页面与 CSS 性能仍需收敛

路由级拆包已完成第一轮收敛：Tasks 独立为 42.43 kB（gzip 13.37 kB），生产包门禁实测登录后入口 gzip 106.79 KiB；Landing 核心 gzip 3.10 KiB，Three.js 粒子增强层为独立 524.05 kB（门禁实测 gzip 127.61 KiB）chunk，低动效不请求该层；Admin 核心门禁实测 gzip 42.80 KiB，Model Control 和其余面板均独立加载。当前主要静态体积债务转为全局 CSS 427.09 kB（gzip 68.27 kB）以及 Three.js 增强层在低端设备上的解析、GPU 和耗电成本。

上线门禁仍应以真实设备为准：移动网络下 LCP < 2.5 秒、INP < 200 ms、登录后首屏 gzip JS < 250 kB。下一步按页面拆 CSS，并在真实低端设备测量游客页空闲加载后的 CPU、内存和耗电；必要时进一步减少粒子数量或改成按设备能力启用。源码、Canvas 像素和构建体积门禁只能防止明显回退，不能替代真实设备 Web Vitals。

服务端 PostgreSQL 集成测试曾出现 `pg@8` 关于“同一 client 正在查询时再次调用 `client.query()`”将在 `pg@9` 移除的弃用警告；现已定位到 Prisma 多 relation 写后水合与交互式事务内并发查询，并改为顺序读取。严格 `--throw-deprecation` 回归已通过，集成测试也会主动捕获同类警告；后续升级 `pg@9` 时仍需执行完整 PostgreSQL 集成套件，不以静态版本升级代替运行时验证。

### 8. 实页复核缺陷已完成第一轮修复

2026-07-27 在本地运行环境 `1280 x 720` 与 `390 x 844` 视口复核后，游客首屏、登录主操作、管理员任务隔离和搜索指标语义均已修复，并加入 E2E 几何/状态断言：

- 游客页核心文案不再依赖 Canvas 成功或滚动位置，桌面和移动首屏均可见；移动端收起次级导航，品牌、语言和登录入口无溢出。
- 登录页邮箱、密码、主提交按钮均在常见桌面高度首屏内；测试账号仅开发环境可见且默认折叠。
- 管理员标签按业务域分组，桌面无横向溢出，移动端可直接选择当前业务域；每个标签只显示相关面板，Release 独立成页。
- 搜索诊断对无样本、未建基线和积压使用不同文案，真实积压仍保留告警含义但改为人类可读时长。

聚焦 E2E 3/3、桌面/移动浏览器几何检查、TypeScript、Lint 和生产构建均通过。上述 P1 不再作为当前阻断；P0 `No-Go` 仍由内容安全部署证据、数据治理、登录恢复路径、Router 可用性和目标环境演练决定。

## 三、AI 风格与用户体验结论

### 总体判断

页面不是粗糙，而是**登录后的创作端和运营端都过于接近同一套深色中性企业工具界面**。一致性和可扫描性尚可，但 AI 的价值主要由标题、模型选择器和图标表达。实际 AI Workspace 首屏没有图片、视频、波形或生成结果作为视觉证据，主要仍是一张普通参数表单；用户缺少“系统理解了什么、正在做什么、为什么得到这个结果、下一步能怎么迭代”的直接感知。

游客首页与登录后页面需要分开评价：游客首页已有明确的 AI 视觉和品牌记忆点，不属于“太平淡”，但滚动叙事较重，桌面完整页面约 `4,752px`、`390 x 844` 移动端约 `5,570px`，首屏之后仍需要真实作品承接；登录后的 Home、Workspace、Generation Center 和 Inspiration 才是 AI 价值感不足的主要区域。管理员页面无需追求强烈 AI 风格，其目标应是更紧凑地呈现风险、待办和恢复动作。

不建议用大面积紫色渐变、发光球体或更多装饰图标制造 AI 感。更有效的 AI 风格来自可观察的智能行为、真实生成资产和清晰的模型证据。

建议采用统一基础组件下的双层表达：创作与品牌页面参考 Runway 式“真实作品优先、界面退后、无装饰渐变”的影像语言；管理员页面保持 Linear 式紧凑、任务导向和高信息密度。两者共享字体、间距、状态色和交互规则，不把管理员后台也做成营销页。

2026-07-27 实页复核的直接观察：

- 桌面 Home 的任务结构已经清楚，但“Start your first work”仍用占位图标承担最大视觉区域，第一屏没有任何真实产出，品牌记忆点弱。
- Image/Music Studio 将完整参数表单置于结果之前；桌面页面约 `1,788px`，移动端约 `2,563px`，用户要经过模型、模式、提示词、参数和权益确认后才能看到结果区，AI 反馈的存在感被表单长度吞没。
- Generation Center 的空状态主动作清楚，但首屏只能证明“系统里没有任务”，无法证明产品能产出什么；应展示可启动的模板或经授权的示例结果，同时明确它们不是当前用户资产。
- Inspiration 在本地 Seed 环境显示 `0 resources`，筛选器占据主要视觉区域；这既暴露内容冷启动风险，也使用户无法通过真实案例理解 AI 工作台的能力边界。
- 桌面 Admin 的五域导航和数据层级已经可用，不需要追求强烈 AI 视觉；移动端 Overview 约 `2,318px`，四个指标拆成四张纵向卡片，审查队列和异常上下文被推到更下方。
- 当前蓝色同时承担主操作、选中态和部分智能含义，用户无法仅凭颜色区分“可以执行”“模型正在工作”“需要审核”。
- 普通用户 Mock Image 实测曾出现“任务已完成但结果图破损”：根因是 Provider 完成、输出安全检查和媒体扫描在视觉上被压成一个状态，并无条件渲染内部 `mock://` URL。本轮已修复破损预览和 pending 状态文案；Mock 环境仍不提供真实浏览器预览 URL，因此扫描通过后会诚实提示前往资产库，而不是伪造图片能力。

2026-07-28 以普通用户和管理员再次实页复核的补充结论：

- 登录后 Home 的信息结构清楚，但最大内容位仍是 `SVG+XML`/空状态占位，Studio 入口也是图标加文字行；第一屏几乎没有可检查的真实图片、视频帧或音频波形，因此视觉上更像通用深色 SaaS。AI 风格缺失的根因是缺内容证据，不是颜色或动效不够。
- Home 的单个淡紫主操作与全黑界面没有形成稳定品牌系统；不建议继续扩大紫色，而应让真实作品承担色彩，并用青绿、琥珀、红色分别表达就绪、审核和故障。
- Admin Center 的 Overview 已能在首屏同时展示待审核、告警、恢复和失败操作，适合作为克制的运营工具；顶部 20 余个胶囊标签仍显得密集，下一步应改为左侧二级导航或可搜索命令菜单，而不是增加 AI 装饰。
- 浏览器标题曾使用 `MuseFlow AI Studio`，界面使用 `HCAI`，About 仍称产品为“front-end prototype”。本轮已将用户可见标题、描述和 About 改为 `HCAI AI Studio/AI creation and collaboration network`；法律政策中的 `HCAI / MuseFlow` 双名称仍需在生产品牌和运营主体批准时最终统一。
- 推荐创作端采用 Runway 式内容优先方向：中性无渐变界面、8px 以内圆角、零装饰阴影，图片/视频/波形成为主要层级；管理员继续保持 Linear 式任务密度。两者共享排版、状态色和交互，不做两套互不相干的产品。

2026-07-29 双角色实操的新增结论：

- 游客页的粒子电脑与电影式排版已经具备鲜明 AI 品牌感，问题不是全站都平淡，而是从游客页进入 Home 和 AI Workspace 后，真实作品、过程反馈和结果证据突然消失，形成明显的品牌体验断层。
- `1280 x 720` 的 Music Studio 首屏只能看到参数区上半部，权利声明、费用摘要、生成按钮和结果全部需要滚动；`390 x 844` 没有横向溢出，但在到达提示词输入前已经消耗约一个视口，核心任务路径过长。
- 本地任务完成后曾同时出现 `Completed`、`pending` 和全部不可用操作，普通用户无法判断是生成失败、扫描未完成还是 Mock 不可交付；该终态文案和状态色已在 Music/Video Studio 修复。剩余问题是工作台尚未把预检、Provider、输出分类、媒体扫描和入库完整呈现为可观察阶段。
- 首次登录政策弹窗把四份长文完整放进同一个阻断对话框，合规证据完整但阅读负担很高；建议保留逐版本确认和完整原文入口，把默认视图改成政策摘要、重大变化和分别展开。
- Admin Overview 的首屏密度和任务优先级合理，AI config 也诚实展示无生产路由；顶部 20 余个胶囊按钮依然抢占垂直空间，后台优化应聚焦二级导航和搜索，不需要加入粒子、渐变或作品墙。

### 主要体验问题

| 优先级 | 问题 | 用户影响 | 建议 |
| --- | --- | --- | --- |
| P1 | AI Workspace 缺少输入理解与生成过程反馈 | 点击生成后像普通异步表单 | 展示“理解输入、策略检查、排队、生成、扫描、入库”阶段，并给出耗时与可取消状态 |
| P1 | 生成生命周期缺少完整阶段条 | 终态文案已修，但用户仍看不到预检、Provider、分类、扫描和入库分别进行到哪里 | 使用统一状态机展示阶段、耗时、扣费点和唯一恢复动作；只有可交付资产进入最终成功 |
| P1 | 创作端结果区在长表单之后 | 移动端看不到产出目标与即时反馈 | 桌面采用输入/结果双栏；移动端使用吸顶“设置/结果”切换，生成后自动切到结果但保留返回编辑入口 |
| P1 | 灵感页内容以文字行和大空白为主 | 无法快速判断资源质量和产出形态 | 使用真实图片/视频帧/音频波形作为第一视觉信号，并提供“一键带入工作台”预览 |
| P1 | 管理员灵感编辑是超长单页表单 | 易漏填、难定位错误、长距离滚动 | 拆成内容、分类、方法、权利、发布五个分区；增加吸顶目录、分区校验和草稿状态 |
| P1 | 移动端投稿过长，完成度在页面底部 | 用户直到最后才知道缺什么 | 顶部显示完成度与缺失项，底部固定保存/提交操作栏，支持自动保存 |
| P1 | 生成历史强调 Provider ID，弱化结果和下一步 | 普通用户难以理解技术标识 | 主信息改为结果缩略图、状态、时间和“继续编辑/变体/下载”；Provider 放入详情证据区 |
| P2 | 黑灰加蓝色构成近乎单一色调 | 页面层级弱，长时间使用疲劳 | 保持中性色基底，用青绿表示就绪、琥珀表示审核、红色表示故障；只在状态与关键动作使用颜色 |
| P2 | 中英文和积分文案混用 | 产品成熟度感下降 | 所有 API reason code 与 UI copy 通过同一 i18n 映射，禁止服务端英文直接透传 |
| P2 | 空状态只说明“没有内容” | 用户不知道下一步 | 根据角色提供唯一主动作：创建、调整筛选、刷新或查看失败原因 |
| P2 | AI 星光按钮含义不稳定 | 用户不知道是自动补全、改写还是生成 | 使用明确 tooltip、运行中状态、撤销和“查看变更”，重要 AI 操作使用图标加动词 |
| P2 | Toast 覆盖右上方操作区 | 管理员连续操作时遮挡账户与按钮 | Toast 下移到内容区右下，限制堆叠数量，并让成功信息自动消退、错误可展开 |
| P2 | 移动 Admin 指标卡纵向占用过大 | 待处理任务和异常上下文离开首屏 | 将四项 KPI 改为紧凑 2x2 指标带，首屏优先展示需要动作的队列 |
| P2 | 首次政策确认以完整长文阻断工作台 | 新用户在开始任务前面对高认知负担 | 默认展示版本、重大变化和摘要，完整原文可展开；仍保留逐版本、时间和明确勾选证据 |

## 四、后续实现方案

### 阶段 A：上线安全闭环（先做，约 1-2 个迭代）

1. 归档上游输出/媒体安全责任契约，在目标 staging 对拒绝、超时、非 JSON、畸形 schema、未知结果和服务不可用执行故障注入；同时验收应用自有的 Image/Video 输入、Chat 附件/流式和审核申诉链路。
2. 扩展审核 SLA、批量队列操作和安全回归集，覆盖自动阻断、普通审核、申诉推翻和恢复失败后的运营处置。
3. 完成字段级保留策略 Worker、Provider 删除生产同构验收和备份删除专项演练证据。
4. 在目标 staging 执行 `0100` 至 `0120` 迁移并复验法律保留、Provider 删除回执、断点续删、观测数据保留、通知与 Provider Alert 保留、Provider 生命周期、配置历史与媒体资产元数据最小化、Provider Alert 投递、租约保留、Private Library、认证凭据、Provider 推理密钥禁用/30 天删除、审计归档、社区匿名化、安全事件、账户风险、审核案件/运营记录、生成终态、Marketplace 与支持工单保留。
5. 在隔离 staging 完成 Router 单次验收和发布/回滚演练。

验收：所有 P0 配置由运行时证据驱动，不允许只修改 JSON 状态；负向用例和恢复演练全部通过。

### 阶段 B：AI 工作台体验（约 1 个迭代）

1. 将生成生命周期做成紧凑阶段条，失败阶段显示安全原因、是否扣费和建议动作。
2. 提示词输入增加结构化意图预览、参数建议和可撤销改写，不自动覆盖用户原文。
3. 结果区支持版本对比、基于结果继续生成、来源/模型/策略/费用证据抽屉。
4. 历史列表改为资产优先视图，技术字段收进详情。
5. 首屏加入最近结果或经过授权的示例资产：图片显示真实缩略图，视频显示关键帧，音乐显示波形和封面，Chat 显示可继续的会话；没有用户资产时使用明确的模板起点，不保留大块空黑区域。
6. 桌面重排为约 40/60 的输入与结果工作区；移动端用“设置/结果”吸顶切换代替从表单滚动到结果，生成开始后自动进入结果和阶段视图。

验收：用户能在 5 秒内回答“系统正在做什么、有没有扣费、失败后怎么办、结果如何继续使用”。

具体实施边界：

- `AI Workspace`：在现有 Image/Video/Music/Chat 切换和参数表单上增加“输入理解摘要”，仅展示可编辑的意图、主体、风格、约束和风险提示，不自动覆盖原提示词。
- `Generation Center`：用统一阶段状态机呈现预检、排队、Provider、上游检查和入库；异常只给一个主恢复动作，并明确是否扣费。
- 结果与历史：以可查看的结果资产为主信息，Provider ID、策略版本、费用和哈希收进证据抽屉；支持变体、继续编辑和版本对比。
- `Chat`：后端已有有界流式分段分类，目标环境验收前不得标记为生产可用；界面应区分“模型正在生成”和“上游检查与入库中”。

### 阶段 C：视觉与内容层级（约 1 个迭代）

已完成基础可用性修复：游客首页核心文案和登录入口已回到首屏，邮箱登录主操作已前置且生产环境不显示测试账号；管理员导航已按 5 个任务域重组，Overview 与 Release 分离，无样本指标语义已校正。这些结果已有桌面/移动浏览器证据和聚焦 E2E 保护。

本阶段剩余工作：

1. 灵感、首页、生成中心引入真实产出缩略图和多模态预览，不使用纯装饰背景；灵感卡片必须能预判输入、结果类型和适用模型。
2. 游客页粒子动画已降级为首屏后空闲加载的增强层，`prefers-reduced-motion` 使用无 Canvas 静态模式；剩余工作是加入经过授权的真实社区作品或生成结果承担第一视觉信号，并补真实低端设备性能证据。
3. 管理员独立面板已按当前分区懒加载；下一步将 AdminPage 内仍内联的通知、权限、安全、账务、生成和审计区块继续组件化，确保非活动分区不初始化数据请求，并为异常、审核和恢复建立统一状态色。
4. 重构管理员长表单和移动投稿，增加吸顶分区导航、自动保存和固定操作栏。
5. 完成中文/英文文案清理、关键页面无障碍检查和动效降级；保留克制、中性、以内容为中心的工作台气质。
6. 将移动 Admin Overview 的指标改为 2x2 紧凑指标带，并把待审核、告警和恢复队列置于指标之后的首个内容区。

视觉实施顺序：先用真实产出建立内容层级，再调整颜色和动效。创作端以中性黑白界面承载高饱和真实作品，只给“就绪/审核/故障”状态使用青绿、琥珀、红色；避免紫蓝渐变、玻璃拟态和纯装饰粒子成为 AI 身份的主要来源。

验收：桌面 1440/1280、移动 390/375 下无重叠和横向滚动；键盘可完成主流程；文本对比度达到 WCAG AA。

以下视觉验收断言已加入聚焦 E2E：

- 游客首页首次可交互时，品牌、主标题、价值说明和登录入口均在视口内且非透明；Canvas 失败不影响核心内容。
- `1280 x 720` 登录弹窗无需滚动即可看到邮箱、密码和主提交按钮；测试账号不抢占生产登录层级。
- 管理员在桌面和移动端都能在两次操作内到达任一一级业务域，当前分组和当前页面始终可见。
- 所有监控指标同时展示数据时间；无采样显示未知状态，不得以 `0` 或超大秒数替代。

仍需补充真实设备、键盘操作、屏幕阅读器和 WCAG AA 对比度验收，不能仅以几何 E2E 代替。

### 阶段 D：性能与可观测性（与 B/C 并行）

1. Tasks、创作工作台和 22 个管理员面板已形成独立 chunk；下一步拆分 AdminPage 内联区块和全局 CSS，并用资源请求断言确认非活动分区不会预加载数据或样式。
2. Landing 重型 Three.js 场景已延迟加载且有低动效静态降级；真实媒体仍需统一响应式尺寸、延迟加载和占位，避免布局跳动。
3. 前端已上报匿名路由访问基线与错误指纹，按 release、route、errorCode 聚合并接入 `frontend-error-rate` 多窗口阈值告警；触发告警时记录受影响 release 和发布回滚入口，但自动回滚保持关闭，需有发布权限的管理员核验后执行。目标环境仍需接入真实流量基线并完成告警到回滚的演练。
4. 生成成功率、首个持久结果时间、重试率和放弃率已接入持久 SLO 告警；剩余工作是将真实 Web Vitals 和上述 SLO 的目标环境基线、阈值与发布/回滚判定接入受保护发布看板。

## 五、暂时跳过并记录

1. Router 当前可用性：MiniMax Official Media #7 已完成一次受限真实生成和 MP4 下载，MiniMax 适配器现为 `staging_available`；剩余缺口从“模型能否生成”收敛为目标环境应用全链路验收、内容安全部署证据和生产法律/运维批准。当前部署仍为 `runtimeEnabled=false`、`productionApproved=false`。Jiekou AI Seedance #11、Vidu #12 仍未完成连接测试且路由权重为 0；Seedance 仍需完成健康测试、非零路由权重、分组/模型映射和网关鉴权核验，Vidu 尚未适配。任何 Provider 均不得使用既有无限额 Key 绕过门禁。
2. 目标环境发布/回滚：RELEASE-01 隔离基础设施恢复和 RELEASE-02 不可变候选部署/回滚均已在受保护 staging 通过并保留回执，此项不再是上线阻断。生产发布仍必须在合并提交上生成 GHCR 制品、签名与 Attestation，并遵循相同受保护发布路径；本次 staging 证据不能替代生产变更审批。
3. 安全责任边界：Image/Video 参考资产输入分类、Chat 附件与流式分段分类、Provider 原生安全闭集映射、直接阻断申诉和审批后幂等恢复已落地。输出内容安全和媒体技术安全改由 Router/上游 Provider 承接，不再建设重复服务；上游责任契约、策略版本/拒绝状态证据、目标环境故障注入和最终批准仍未完成。
4. 数据治理：Provider 删除、到期导出包清理、按域法律保留、删除截止点并发互斥、观测 7/30/90 天保留、通知、Provider Alert 与 Provider 生命周期 180 天最小化、配置历史 365 天不可逆最小化、媒体资产对象先删与 1/30 天元数据墓碑、租约 7 天、Private Library 30 天、认证凭据 30 天、Provider 推理密钥轮换后禁用与 30 天删除、审计归档清理、社区内容 30 天匿名化、安全事件表 365/730 天保留、账户风险终态 365 天匿名化、支持工单 365/730 天双阶段最小化、审核案件/规则转换/批量操作和 Marketplace 终态 730 天脱敏，以及生成记录 30/365 天双阶段最小化 Worker 已落地；Prisma/Seed 的 ObservabilityLog 也已统一执行事件级持久化白名单。MediaAsset 会排除对象未删、活动扫描和 `media/audit/safety` 法律保留，墓碑后数据库拒绝恢复与重新挂接；Provider Alert 保留只处理 `succeeded/dead_lettered/cancelled` 终态并排除活动投递；Provider 生命周期保留会排除开放审核/申诉、法律保留、未终结五类状态、悬挂成本/积分/配额和开放对账；配置保留排除当前 revision 和待审批/已审批 rollback target；生成、Marketplace 与支持工单保留也分别执行其业务阻断。Internal Ledger 新写入已假名化，Prisma/Seed 的 movement、actorRef 和 reconciliation evidence 不再复制用户 ID/handle；历史不可变账务事实的匿名化投影或加密擦除契约仍待批准，因此该项只处于 partial。受保护 staging 的隔离恢复、备份删除和 restore-negative 模拟已通过 23/23，但生产真实 35 天调度与 KMS 销毁仍未验收。`retentionAutomationComplete` 仍为 `false`，目标环境日志/保留调度与访问控制、Secret Manager 网关/版本状态验收、目标备份生命周期/KMS、媒体对象删除回执与 Worker 调度、历史内部账务事实处置、生产处理方披露和法律批准仍未完成。
5. 保留政策结构冲突：Provider replay、配置 revision 和媒体元数据已分别通过受控状态机或不可逆最小证据链路解除；Marketplace 不可变生命周期、Domain Event、账务事实和提交资产关系仍在权威逐项清单中保持 partial，需批准匿名化投影或最小证据例外。
6. Provider Alert 目标环境启用：可靠队列、生产客户端、管理员 list/replay API、Admin 可视化面板、条件式生产 Worker inventory、`0119` 投递迁移、`0120` 终态保留迁移及并发/崩溃恢复/保留验收已完成；目标环境 Secret Manager/allowlist 变更流程和 staging 真实送达、签名错误及故障恢复证据未完成，暂不启用生产通道。

在以上 P0 项完成前，最终上线结论保持 **No-Go**。
