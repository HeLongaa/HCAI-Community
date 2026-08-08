# 生产镜像供应链安全

## 目标与边界

生产发布包含 `frontend`、`api`、`worker`、`migrate` 四个应用镜像。每个候选镜像必须绑定同一源码提交，生成 SPDX 与 CycloneDX SBOM，完成漏洞扫描，并以 registry manifest digest 进入部署清单。

基础 Node、Caddy、PostgreSQL、Redis、MinIO 和 MinIO Client 同时固定可读版本标签与 `sha256` digest。生产部署不得使用 `latest`、仅版本标签或重新解析后的可变引用。

## 本地证据

先构建 `config/production-supply-chain-contract.json` 中定义的四个本地镜像，然后执行：

```bash
npm run supply-chain:install-tools
npm run supply-chain:scan
node scripts/verify-production-supply-chain.mjs \
  --evidence-dir .artifacts/production-supply-chain \
  --write-manifest .artifacts/production-supply-chain/digest-manifest.json
```

安装器只接受 Trivy `0.73.0` 的固定官方发布 URL，并同时验证发布压缩包和解压二进制 SHA-256。支持 Linux/macOS 的 x64 与 arm64，不使用 `latest` 或未校验的下载脚本。每份摘要还记录漏洞数据库版本、更新时间和下载时间，扫描时数据库年龄不得超过 48 小时。

本地构建只扫描 runner 当前平台；registry 候选必须显式执行 `Trivy image --platform linux/amd64` 与 `--platform linux/arm64`。每个已扫描平台在 `platforms/<os>-<arch>/` 生成：

- `vulnerabilities.json`：完整漏洞报告。
- `sbom.spdx.json`：SPDX JSON SBOM。
- `sbom.cyclonedx.json`：CycloneDX JSON SBOM。

镜像根目录的 `summary.json` 记录 OCI index、每个平台的 manifest digest、源码提交、包数量、漏洞策略结果和全部文件 SHA-256。Registry 证据还包含原始 OCI index 与 GitHub API/OCI registry 两条验证路径的签名回执。

`.artifacts/` 已排除出 Git 和 Docker context。证据应由 CI Artifact 或受控归档保存，不应把扫描数据库和大体积 SBOM 提交到源码仓库。

## 漏洞策略

- `HIGH`、`CRITICAL` 且上游已提供修复版本：默认阻断发布。
- `HIGH`、`CRITICAL` 但尚无修复版本：不伪装为通过或忽略，逐条保留为 `trackedUnfixedFindings`，每次构建重新扫描。
- 操作系统 EOL：直接阻断。
- 需要暂时接受一个已有修复项时，只能修改 `config/production-vulnerability-exceptions.json`。例外必须精确匹配镜像、CVE、包名和已安装版本，记录理由、owner、审批人、批准与到期时间，最长 30 天。
- 例外过期、字段缺失、镜像未知、时间超限或重复都会使静态门禁失败。禁止使用 `.trivyignore` 隐藏生产发现。

当前本地候选镜像没有任何例外。四个镜像的可修复 `HIGH/CRITICAL` 均为 `0`；Debian 13.6 仍有每镜像 `22` 条尚无修复的上游高危/严重记录，均已保留在本地证据，不能理解为系统无漏洞。

## GitHub Actions

`.github/workflows/container-supply-chain.yml` 独立执行供应链门禁；仓库内全部工作流的第三方 Action 都固定完整 commit SHA。Checkout、Setup Node 和 Artifact 上传/下载均使用 Node 24 运行版，避免依赖 GitHub Runner 对 Node 20 Action 的临时兼容执行。

- Pull Request：在独立只读 job 中用 Buildx 构建并加载四个本地镜像，扫描构建出的精确镜像，不推送 registry；令牌只授予 `contents: read`。
- `main`、`master` 或手工运行：登录 GHCR，按提交 SHA 推送四个 `linux/amd64` + `linux/arm64` OCI index，启用 BuildKit `sbom: true` 和 `provenance: mode=max`。Frontend 构建必须把同一提交 SHA 注入 `VITE_APP_RELEASE`。
- Registry 扫描使用 `${image}@${indexDigest}`，再以 Trivy 的 `--platform` 分别选择 AMD64 与 ARM64，不会重新解析 tag 或默认采用 runner 架构。
- `actions/attest` 为 OCI index digest 生成来源证明，并将两份平台 SPDX 分别绑定到对应的平台 manifest digest；三份证明都作为 OCI 关联制品推送。
- `gh attestation verify` 对 index provenance 和两个平台 SPDX 分别验证，并同时从 GitHub Attestations API 与 OCI Registry 读取证明；验证绑定仓库、签发工作流、源码 commit/ref，拒绝自托管 runner 签发的证明。成功回执以 JSON 保存并写入摘要哈希。
- 每镜像完整扫描证据保留 30 天；聚合 digest manifest、摘要和签名验证回执保留 90 天。

`npm run check:production-supply-chain` 还执行隔离的负向证据测试。缺少 ARM64、缺少任一平台 SPDX、任一平台扫描失败或缺少任一平台签名回执时，聚合门禁必须失败。

仓库 Actions 必须允许 `GITHUB_TOKEN` 写入 Packages，并支持 `id-token: write`、`attestations: write` 和 `artifact-metadata: write`。最后一项用于让 `actions/attest` 创建 Artifact Metadata 存储记录；若组织策略禁止其中任一权限或 GHCR 写入，工作流会明确失败。不能在未实际推送和验证时把本地 image ID 当作生产 digest。

## 发布使用

只有 `registryReady=true` 的 `production-image-digest-manifest-v1` 才能进入 staging 或生产部署。部署系统应直接消费其中四个 digest，并验证：

1. manifest 的 `sourceRevision` 等于批准提交。
2. 每个镜像的 `platforms` 同时且仅包含 `linux/amd64` 与 `linux/arm64`，确保 GitHub runner 与当前 Oracle ARM 目标使用同一不可变 digest。
3. `platformManifests` 中两个平台各自绑定一个不可变 digest，四个镜像的顶层 digest 均为 registry OCI index digest，不是本地 config/image ID。
4. 供应链工作流成功，每个平台的漏洞报告和两种 SBOM 均可下载且 hash 匹配。
5. Index provenance 与两个平台的 SBOM attestation 均通过 GitHub API 和 OCI registry 验证。
6. 没有过期例外，所有仍有效例外已经进入发布变更审批。

历史本地 `90/90` 证据只覆盖当时的 ARM64 本地镜像，不满足当前双平台 registry 证据结构，也不替代首次多架构 GHCR 推送、远端 attestation 验证和目标部署平台的 digest 拉取演练。
