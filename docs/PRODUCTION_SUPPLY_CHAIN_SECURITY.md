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

每个镜像生成：

- `vulnerabilities.json`：完整漏洞报告。
- `sbom.spdx.json`：SPDX JSON SBOM。
- `sbom.cyclonedx.json`：CycloneDX JSON SBOM。
- `summary.json`：镜像身份、源码提交、包数量、漏洞策略结果和以上文件的 SHA-256。

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
- `main`、`master` 或手工运行：登录 GHCR，按提交 SHA 推送四个镜像，启用 BuildKit `sbom: true` 和 `provenance: mode=max`。
- Registry 扫描使用 `${image}@${digest}`，不会重新解析 tag。
- `actions/attest` 分别为镜像生成 GitHub/Sigstore 来源证明和 SPDX SBOM 证明，并将证明作为 OCI 关联制品推送。
- `gh attestation verify` 必须分别验证 SLSA provenance 和 SPDX 2.3，并同时从 GitHub Attestations API 与 OCI Registry 读取证明；验证绑定仓库、签发工作流、源码 commit/ref，拒绝自托管 runner 签发的证明。
- 每镜像证据保留 30 天，聚合 digest manifest 和摘要保留 90 天。

仓库 Actions 必须允许 `GITHUB_TOKEN` 写入 Packages，并支持 `id-token: write`、`attestations: write` 和 `artifact-metadata: write`。最后一项用于让 `actions/attest` 创建 Artifact Metadata 存储记录；若组织策略禁止其中任一权限或 GHCR 写入，工作流会明确失败。不能在未实际推送和验证时把本地 image ID 当作生产 digest。

## 发布使用

只有 `registryReady=true` 的 `production-image-digest-manifest-v1` 才能进入 staging 或生产部署。部署系统应直接消费其中四个 digest，并验证：

1. manifest 的 `sourceRevision` 等于批准提交。
2. 四个镜像均为 registry manifest digest，不是本地 config/image ID。
3. 供应链工作流成功，漏洞报告和两个 SBOM 可下载且 hash 匹配。
4. GitHub provenance 与 SBOM attestation 可验证。
5. 没有过期例外，所有仍有效例外已经进入发布变更审批。

本地 `90/90` 证据证明扫描链和当前 ARM64 镜像通过策略，但不替代首次主分支 GHCR 推送、远端 attestation 验证和目标部署平台的 digest 拉取演练。
