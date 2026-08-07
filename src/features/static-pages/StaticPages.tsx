import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  BadgeDollarSign,
  CircleHelp,
  Code2,
  Download,
  FileWarning,
  Flag,
  LoaderCircle,
  MessageSquareReply,
  RefreshCcw,
  Scale,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { Page, SimulateAction } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { isZhCopy, textFor } from '../../domain/utils'
import { publicPricingCatalog } from '../../config/publicPricing'
import { isApiClientError } from '../../services/apiClient'
import { complianceService } from '../../services/complianceService'
import type {
  ApiComplianceManifest,
  ApiSupportRequest,
  ModerationCaseDto,
  ModerationReportCategory,
  ModerationTargetType,
  CompliancePolicyId,
  SupportRelatedResourceType,
  SupportRequestCategory,
} from '../../services/contracts'
import { trustService } from '../../services/trustService'

export function PricingPage({
  t,
  billing,
  setBilling,
  requireAuth,
}: {
  t: Record<string, string>
  billing: 'year' | 'month'
  setBilling: (value: 'year' | 'month') => void
  requireAuth: () => void
}) {
  const isZh = isZhCopy(t)
  const plans = publicPricingCatalog?.plans ?? []
  return (
    <div className="stack pricing-page">
      <SectionHeader eyebrow={textFor(t, 'Plans', '套餐')} title={textFor(t, 'Plans and product access', '套餐与产品权益')} />
      {publicPricingCatalog && (
        <div className="billing-toggle">
          <button className={billing === 'year' ? 'active' : ''} type="button" onClick={() => setBilling('year')}>
            {t.billingYear}
          </button>
          <button className={billing === 'month' ? 'active' : ''} type="button" onClick={() => setBilling('month')}>
            {t.billingMonth}
          </button>
        </div>
      )}
      {!publicPricingCatalog && (
        <section className="pricing-unavailable" role="status">
          <div className="pricing-status-icon"><BadgeDollarSign size={22} /></div>
          <div className="pricing-status-copy">
            <span className="eyebrow">{textFor(t, 'Publishing status', '发布状态')}</span>
            <h2>{textFor(t, 'Public pricing is not published yet', '公开套餐价格尚未发布')}</h2>
            <p>{textFor(t, 'No price or purchase action is shown until the approved catalog is configured. Existing assigned access remains available.', '获批价格目录完成配置前，系统不会展示价格或购买入口；已分配的产品权益不受影响。')}</p>
          </div>
          <dl className="pricing-status-facts">
            <div><dt>{textFor(t, 'Pricing', '价格')}</dt><dd>{textFor(t, 'Not published', '未发布')}</dd></div>
            <div><dt>{textFor(t, 'Checkout', '购买')}</dt><dd>{textFor(t, 'Unavailable', '未开放')}</dd></div>
            <div><dt>{textFor(t, 'Current access', '当前权益')}</dt><dd>{textFor(t, 'Unchanged', '保持有效')}</dd></div>
          </dl>
        </section>
      )}
      <div className="plan-grid">
        {plans.map((plan) => (
          <article className={plan.badge ? 'plan-card featured' : 'plan-card'} key={plan.id}>
            {plan.badge && <span className="pill small">{isZh ? plan.badge.zh : plan.badge.en}</span>}
            <h3>{isZh ? plan.name.zh : plan.name.en}</h3>
            <strong>{new Intl.NumberFormat(isZh ? 'zh-CN' : 'en-US', { style: 'currency', currency: plan.currency }).format(billing === 'month' ? plan.monthlyPrice : plan.yearlyPrice)}</strong>
            <p>{isZh ? plan.summary.zh : plan.summary.en}</p>
            <ul>
              {plan.features.map((feature) => <li key={feature.en}>{isZh ? feature.zh : feature.en}</li>)}
            </ul>
            <button className="primary-button" type="button" disabled={!plan.checkoutAvailable} onClick={requireAuth}>
              {plan.checkoutAvailable ? textFor(t, 'Continue', '继续') : textFor(t, 'Not available', '暂未开放')}
            </button>
          </article>
        ))}
      </div>
    </div>
  )
}

export function ApiPage({
  t,
  requireAuth,
}: {
  t: Record<string, string>
  requireAuth: () => void
}) {
  const isZh = isZhCopy(t)
  const features = isZh
    ? ['图片生成', '视频生成', '音乐生成', 'AI 对话']
    : ['Image generation', 'Video generation', 'Music generation', 'AI chat']
  const [selectedFeature, setSelectedFeature] = useState(features[0])

  return (
    <div className="stack">
      <section className="api-hero">
        <div>
          <span className="eyebrow">{textFor(t, 'Developer platform', '开发者平台')}</span>
          <h1>{textFor(t, 'Audio, image, video, and chat APIs for creative apps.', '面向创作应用的音频、图片、视频和对话 API。')}</h1>
          <p>{textFor(t, 'Integrate generation, editing, transcription, and analysis with one consistent API surface.', '用统一接口接入生成、编辑、转写和分析能力。')}</p>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={requireAuth}>
              <BadgeDollarSign size={17} />
              {textFor(t, 'Sign in for access', '登录后查看权限')}
            </button>
            <a className="ghost-button" href="/api/openapi.json" target="_blank" rel="noreferrer">
              <Code2 size={17} />
              {t.docs}
            </a>
          </div>
        </div>
        <pre className="code-card">{`await hcai.generate({
  type: "music-video",
  prompt: "neon lofi lyric loop",
  duration: 8
})`}</pre>
      </section>
      <div className="tool-grid">
        {features.map((feature) => (
          <button
            className={selectedFeature === feature ? 'tool-card active' : 'tool-card'}
            type="button"
            key={feature}
            onClick={() => {
              setSelectedFeature(feature)
            }}
          >
            <Code2 size={19} />
            <span>{feature}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function EarnPage({ t, requireAuth }: { t: Record<string, string>; requireAuth: () => void }) {
  const plans = isZhCopy(t) ? ['Plus 年付', 'Pro 年付', 'Ultra 年付'] : ['Plus Yearly', 'Pro Yearly', 'Ultra Yearly']
  return (
    <div className="stack">
      <section className="hero-section slim">
        <div className="hero-copy">
          <span className="pill">
            <BadgeDollarSign size={16} />
            {textFor(t, 'Partner program', '合作伙伴计划')}
          </span>
          <h1>{textFor(t, 'Earn 20%-50% commission from AI creators.', '面向 AI 创作者获得 20%-50% 分成。')}</h1>
          <p>{textFor(t, 'Share HCAI with musicians, designers, video editors, prompt engineers, and agencies.', '把 HCAI 推荐给音乐人、设计师、视频剪辑师、提示词工程师和机构客户。')}</p>
          <button className="primary-button large" type="button" onClick={requireAuth}>
            {t.earn}
          </button>
        </div>
      </section>
      <div className="plan-grid compact">
        {plans.map((plan, index) => (
          <article className="plan-card" key={plan}>
            <h3>{plan}</h3>
            <strong>{20 + index * 15}%</strong>
            <p>{textFor(t, 'Recurring commission with dashboard tracking.', '循环分成，后台可跟踪转化和结算。')}</p>
          </article>
        ))}
      </div>
    </div>
  )
}

export function AboutPage({ t }: { t: Record<string, string> }) {
  const cards = isZhCopy(t)
    ? ['创作者计划', '任务广场', '商用授权']
    : ['Creator program', 'Hiring board', 'Commercial licensing']
  return (
    <div className="stack">
      <section className="panel readable">
        <span className="eyebrow">{t.about}</span>
        <h1>{textFor(t, 'HCAI is an AI creation and collaboration network.', 'HCAI 是一个 AI 创作与协作网络。')}</h1>
        <p>
          {textFor(
            t,
            'It combines generation studios, discovery, profiles, a task marketplace, and a forum-like community into one MusicGPT-inspired product experience.',
            '它把生成工作台、探索、个人主页、任务广场和论坛式社区整合成一个 MusicGPT 风格的产品体验。',
          )}
        </p>
      </section>
      <div className="content-grid three">
        {cards.map((item) => (
          <article className="metric-card" key={item}>
            <Sparkles size={22} />
            <strong>{item}</strong>
            <span>{textFor(t, 'Static page-ready content block', '静态页面内容模块')}</span>
          </article>
        ))}
      </div>
    </div>
  )
}

export function LegalPage({
  policyId,
  t,
  setPage,
}: {
  policyId: CompliancePolicyId
  t: Record<string, string>
  setPage: (page: Page) => void
}) {
  const isZh = isZhCopy(t)
  const [manifest, setManifest] = useState<ApiComplianceManifest | null>(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    complianceService
      .getManifest()
      .then((nextManifest) => {
        if (active) setManifest(nextManifest)
      })
      .catch((loadError) => {
        console.info('[legal-policy]', loadError)
        if (active) setError(textFor(t, 'The current policy text could not be loaded.', '无法加载当前政策文本。'))
      })
    return () => {
      active = false
    }
  }, [reloadKey, t])

  const policy = manifest?.policies.find((item) => item.id === policyId) ?? null
  const policyPage = (route: string): Page => route === 'acceptable-use'
    ? 'aup'
    : route === 'provider-disclosure'
      ? 'disclosures'
      : route as Page

  return (
    <div className="legal-page">
      <header className="legal-page-header">
        <div>
          <span className="eyebrow">{textFor(t, 'Policy center', '政策中心')}</span>
          <h1>{policy ? (isZh ? policy.title.zh : policy.title.en) : textFor(t, 'Current policies', '当前政策')}</h1>
          {policy && <p>{isZh ? policy.summary.zh : policy.summary.en}</p>}
        </div>
        {manifest && (
          <div className="legal-version-block">
            <span className="policy-draft-badge"><AlertTriangle size={15} /> {textFor(t, 'Legal review pending', '待法务审查')}</span>
            <small>{textFor(t, 'Policy set', '政策集')} {manifest.policySetVersion}</small>
            {policy && <small>{textFor(t, 'Version', '版本')} {policy.version}</small>}
          </div>
        )}
      </header>

      {error && (
        <div className="legal-error" role="alert">
          <span>{error}</span>
          <button className="ghost-button small" type="button" onClick={() => { setError(''); setReloadKey((value) => value + 1) }}>
            <RefreshCcw size={15} /> {textFor(t, 'Retry', '重试')}
          </button>
        </div>
      )}

      {!manifest && !error && (
        <div className="legal-loading"><LoaderCircle className="spin" size={20} /> {textFor(t, 'Loading current policy text', '正在加载当前政策文本')}</div>
      )}

      {manifest && policy && (
        <div className="legal-document-layout">
          <nav className="legal-policy-nav" aria-label={textFor(t, 'Policy documents', '政策文档')}>
            {manifest.policies.map((item) => (
              <button
                className={item.id === policy.id ? 'active' : ''}
                type="button"
                key={item.id}
                onClick={() => setPage(policyPage(item.route))}
              >
                <span>{isZh ? item.title.zh : item.title.en}</span>
                <small>{item.version}</small>
              </button>
            ))}
            <button type="button" onClick={() => setPage('support')}>
              <span>{textFor(t, 'Open support center', '打开支持中心')}</span>
              <small>{textFor(t, 'Reports, appeals, and data rights', '举报、申诉与数据权利')}</small>
            </button>
          </nav>

          <article className="legal-document">
            {!manifest.releaseReadiness.legalApproved && (
              <div className="legal-review-notice">
                <AlertTriangle size={18} />
                <p>{textFor(
                  t,
                  'This is the versioned engineering draft. Production publication remains blocked until the legal entity, jurisdiction, and policy text receive qualified legal approval.',
                  '这是已版本化的工程草案。运营实体、适用地区和政策文本获得合格法务批准前，生产发布仍处于阻断状态。',
                )}</p>
              </div>
            )}
            {policy.sections.map((section) => (
              <section id={section.id} key={section.id}>
                <h2>{isZh ? section.title.zh : section.title.en}</h2>
                {(isZh ? section.paragraphs.zh : section.paragraphs.en).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </section>
            ))}
            {policy.id === 'provider-disclosure' && (
              <section>
                <h2>{textFor(t, 'Candidate Provider register', '候选 Provider 登记')}</h2>
                <div className="provider-disclosure-table">
                  {manifest.providerDisclosures.map((provider) => (
                    <div key={provider.providerId}>
                      <strong>{provider.providerId}</strong>
                      <span>{provider.modality}</span>
                      <span>{provider.role}</span>
                      <span>{textFor(t, 'Production not approved', '生产未批准')}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </article>
        </div>
      )}
    </div>
  )
}

const supportCategoryIcons = {
  general_support: CircleHelp,
  content_report: Flag,
  moderation_appeal: Scale,
  privacy_request: ShieldCheck,
  data_export: Download,
  account_deletion: Trash2,
} satisfies Record<SupportRequestCategory, typeof CircleHelp>

const relatedResourceLabels: Record<SupportRelatedResourceType, [string, string]> = {
  none: ['No related resource', '无关联资源'],
  account: ['Account', '账号'],
  task: ['Task', '任务'],
  post: ['Post', '帖子'],
  comment: ['Comment', '评论'],
  media_asset: ['Media asset', '媒体资产'],
  creative_generation: ['Creative generation', '创作生成'],
  moderation_decision: ['Moderation decision', '审核决定'],
  moderation_case: ['Moderation case', '审核案件'],
}

const reportCategoryLabels: Record<ModerationReportCategory, [string, string]> = {
  harassment: ['Harassment', '骚扰'], hate: ['Hate', '仇恨'], sexual: ['Sexual content', '色情内容'], violence: ['Violence', '暴力'], self_harm: ['Self-harm', '自残'], child_safety: ['Child safety', '儿童安全'], impersonation: ['Impersonation', '冒充'], spam: ['Spam', '垃圾内容'], fraud: ['Fraud', '欺诈'], privacy: ['Privacy', '隐私'], copyright: ['Copyright', '版权'], other: ['Other', '其他'],
}

const reportTargetType = (value: SupportRelatedResourceType): ModerationTargetType | null => value === 'account'
  ? 'user'
  : ['post', 'comment', 'media_asset', 'creative_generation'].includes(value) ? value as ModerationTargetType : null

export function SupportPage({
  t,
  signedIn,
  requireAuth,
  simulateAction,
  initialAppeal,
  onInitialAppealConsumed,
}: {
  t: Record<string, string>
  signedIn: boolean
  requireAuth: () => void
  simulateAction: SimulateAction
  initialAppeal?: { moderationDecisionId: string } | null
  onInitialAppealConsumed?: () => void
}) {
  const isZh = isZhCopy(t)
  const [manifest, setManifest] = useState<ApiComplianceManifest | null>(null)
  const [requests, setRequests] = useState<ApiSupportRequest[]>([])
  const [moderationCases, setModerationCases] = useState<ModerationCaseDto[]>([])
  const [reportCategory, setReportCategory] = useState<ModerationReportCategory>('other')
  const [category, setCategory] = useState<SupportRequestCategory>(initialAppeal ? 'moderation_appeal' : 'general_support')
  const [subject, setSubject] = useState(initialAppeal ? textFor(t, 'Appeal a Chat safety decision', '申诉对话安全审核决定') : '')
  const [details, setDetails] = useState(initialAppeal ? textFor(t, 'Please review the Chat safety decision linked below and provide the reason for the final outcome.', '请复核下方关联的对话安全审核决定，并说明最终处理结果。') : '')
  const [relatedResourceType, setRelatedResourceType] = useState<SupportRelatedResourceType>(initialAppeal ? 'moderation_case' : 'none')
  const [relatedResourceId, setRelatedResourceId] = useState(initialAppeal?.moderationDecisionId ?? '')
  const [loadingHistory, setLoadingHistory] = useState(signedIn)
  const [submitting, setSubmitting] = useState(false)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [replyError, setReplyError] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    complianceService.getManifest().then((nextManifest) => {
      if (active) setManifest(nextManifest)
    }).catch((loadError) => {
      console.info('[support-manifest]', loadError)
      if (active) setError(textFor(t, 'Could not load support options.', '无法加载支持选项。'))
    })
    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    if (!signedIn) return
    let active = true
    Promise.all([complianceService.listSupportRequests({ limit: 10 }), trustService.listCases({ limit: 10 })]).then(([page, cases]) => {
      if (active) {
        setRequests(page.items)
        setModerationCases(cases)
      }
    }).catch((loadError) => {
      console.info('[support-history]', loadError)
    }).finally(() => {
      if (active) setLoadingHistory(false)
    })
    return () => {
      active = false
    }
  }, [signedIn])

  const selectedCategory = useMemo(
    () => manifest?.supportContract.categories.find((item) => item.id === category) ?? null,
    [category, manifest],
  )

  const submitRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!signedIn) {
      requireAuth()
      return
    }
    setSubmitting(true)
    setError('')
    const operation: Promise<{ kind: 'case'; item: ModerationCaseDto } | { kind: 'support'; item: ApiSupportRequest }> = (async () => {
      if (category === 'content_report') {
          const targetType = reportTargetType(relatedResourceType)
          if (!targetType) throw new Error(textFor(t, 'Select a reportable account or content resource.', '请选择可举报的账号或内容资源。'))
        const result = await trustService.createReport({ targetType, targetId: relatedResourceId, category: reportCategory, subject, statement: details, locale: isZh ? 'zh' : 'en' })
        return { kind: 'case', item: result.item }
      }
      if (category === 'moderation_appeal') {
        const item = await trustService.getCase(relatedResourceId)
        return { kind: 'case', item: await trustService.appeal(item.id, { reasonCode: 'support_center_appeal', statement: details, expectedVersion: item.version }) }
      }
      return { kind: 'support', item: await complianceService.createSupportRequest({ category, subject, details, relatedResourceType, relatedResourceId: relatedResourceType === 'none' ? undefined : relatedResourceId, locale: isZh ? 'zh' : 'en' }) }
    })()
    operation.then((result) => {
      if (result.kind === 'case') setModerationCases((current) => [result.item, ...current.filter((item) => item.id !== result.item.id)])
      else setRequests((current) => [result.item, ...current])
      setSubject('')
      setDetails('')
      setRelatedResourceType(category === 'content_report' ? 'post' : category === 'moderation_appeal' ? 'moderation_case' : 'none')
      setRelatedResourceId('')
      if (initialAppeal) onInitialAppealConsumed?.()
      simulateAction(isZh ? `请求已提交：${result.item.id}` : `Request submitted: ${result.item.id}`)
    }).catch((submitError) => {
      console.info('[support-request]', submitError)
      setError(isApiClientError(submitError)
        ? submitError.message
        : textFor(t, 'Could not submit this request.', '无法提交此请求。'))
    }).finally(() => setSubmitting(false))
  }

  const submitReply = (request: ApiSupportRequest) => {
    const message = replyBody.trim()
    if (!message || sendingReply) return
    setSendingReply(true)
    setReplyError('')
    complianceService.addSupportMessage(request.id, {
      message,
      expectedVersion: request.version,
      reasonCode: 'requester_follow_up',
    }).then((updated) => {
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item))
      setReplyingTo(null)
      setReplyBody('')
      simulateAction(textFor(t, 'Reply sent to support.', '回复已发送给支持团队。'))
    }).catch((replyFailure) => {
      console.info('[support-reply]', replyFailure)
      setReplyError(isApiClientError(replyFailure)
        ? replyFailure.message
        : textFor(t, 'Could not send this reply.', '无法发送此回复。'))
    }).finally(() => setSendingReply(false))
  }

  return (
    <div className="support-page">
      <header className="support-header">
        <div>
          <span className="eyebrow">{textFor(t, 'Help and rights', '帮助与权利')}</span>
          <h1>{textFor(t, 'Support center', '支持中心')}</h1>
          <p>{textFor(t, 'Get help, report content, appeal a decision, or start a privacy, export, or deletion request.', '获取帮助、举报内容、申诉决定，或发起隐私、导出和删除请求。')}</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}>
          <FileWarning size={17} /> {textFor(t, 'View my requests', '查看我的请求')}
        </button>
      </header>

      <div className="support-category-grid" role="list" aria-label={textFor(t, 'Request category', '请求类别')}>
        {manifest?.supportContract.categories.map((item) => {
          const Icon = supportCategoryIcons[item.id]
          return (
            <button className={category === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => {
              setCategory(item.id)
              setRelatedResourceType(item.id === 'content_report' ? 'post' : item.id === 'moderation_appeal' ? 'moderation_case' : 'none')
              setRelatedResourceId('')
            }}>
              <Icon size={19} />
              <span>{isZh ? item.label.zh : item.label.en}</span>
              <small>{item.initialResponseTarget.replaceAll('_', ' ')}</small>
            </button>
          )
        })}
      </div>

      <div className="support-workspace">
        <form className="support-request-form" onSubmit={submitRequest}>
          <div className="support-form-heading">
            <div>
              <span className="eyebrow">{selectedCategory ? (isZh ? selectedCategory.label.zh : selectedCategory.label.en) : textFor(t, 'Request', '请求')}</span>
              <h2>{textFor(t, 'Tell us what happened', '请说明发生了什么')}</h2>
            </div>
            {selectedCategory && <span>{selectedCategory.initialResponseTarget.replaceAll('_', ' ')}</span>}
          </div>
          <label>
            <span>{textFor(t, 'Subject', '主题')}</span>
            <input required minLength={5} maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>
          {category === 'content_report' && (
            <label>
              <span>{textFor(t, 'Safety category', '安全分类')}</span>
              <select value={reportCategory} onChange={(event) => setReportCategory(event.target.value as ModerationReportCategory)}>
                {(Object.entries(reportCategoryLabels) as Array<[ModerationReportCategory, [string, string]]>).map(([value, label]) => <option value={value} key={value}>{textFor(t, label[0], label[1])}</option>)}
              </select>
            </label>
          )}
          <label>
            <span>{textFor(t, 'Details', '详情')}</span>
            <textarea required minLength={10} maxLength={4000} rows={7} value={details} onChange={(event) => setDetails(event.target.value)} />
            <small>{details.length}/4000</small>
          </label>
          <div className="support-resource-fields">
            <label>
              <span>{textFor(t, 'Related resource', '关联资源')}</span>
              <select value={relatedResourceType} onChange={(event) => setRelatedResourceType(event.target.value as SupportRelatedResourceType)}>
                {(Object.entries(relatedResourceLabels) as Array<[SupportRelatedResourceType, [string, string]]>).filter(([value]) => category === 'content_report'
                  ? ['account', 'post', 'comment', 'media_asset', 'creative_generation'].includes(value)
                  : category === 'moderation_appeal' ? value === 'moderation_case' : !['moderation_case', 'moderation_decision'].includes(value)).map(([value, label]) => (
                  <option value={value} key={value}>{textFor(t, label[0], label[1])}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{textFor(t, 'Resource ID', '资源 ID')}</span>
              <input
                disabled={relatedResourceType === 'none'}
                required={relatedResourceType !== 'none'}
                maxLength={128}
                value={relatedResourceId}
                onChange={(event) => setRelatedResourceId(event.target.value)}
              />
            </label>
          </div>
          <div className="support-safety-note">
            <ShieldCheck size={18} />
            <p>{textFor(t, 'Do not include passwords, tokens, API keys, payment data, government IDs, private signed URLs, or raw Provider payloads.', '请勿提交密码、token、API key、支付数据、政府证件号、私有签名 URL 或原始 Provider payload。')}</p>
          </div>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button
            className="primary-button"
            type="submit"
            disabled={submitting || !manifest}
            onClick={(event) => {
              if (!signedIn) {
                event.preventDefault()
                requireAuth()
              }
            }}
          >
            <Send size={17} />
            {!signedIn
              ? textFor(t, 'Sign in to submit', '登录后提交')
              : submitting
                ? textFor(t, 'Submitting...', '正在提交...')
                : textFor(t, 'Submit request', '提交请求')}
          </button>
        </form>

        <aside className="support-policy-aside">
          <h2>{textFor(t, 'What happens next', '接下来会发生什么')}</h2>
          <ol>
            <li>{textFor(t, 'A stable tracking ID is created.', '系统创建稳定的跟踪 ID。')}</li>
            <li>{textFor(t, 'The request is routed to its owning queue.', '请求被路由到对应负责队列。')}</li>
            <li>{textFor(t, 'Identity or rights evidence may be requested.', '可能需要补充身份或权利证据。')}</li>
            <li>{textFor(t, 'Submission does not mean the requested action is complete.', '提交成功不代表所请求操作已经完成。')}</li>
          </ol>
          <div className="legal-review-notice">
            <AlertTriangle size={18} />
            <p>{manifest?.operator.emergencyNotice ? (isZh ? manifest.operator.emergencyNotice.zh : manifest.operator.emergencyNotice.en) : ''}</p>
          </div>
        </aside>
      </div>

      <section className="support-history" id="support-history">
        <div className="support-history-heading">
          <div>
            <span className="eyebrow">{textFor(t, 'Tracking', '跟踪')}</span>
            <h2>{textFor(t, 'My recent requests', '我的最近请求')}</h2>
          </div>
          {loadingHistory && <LoaderCircle className="spin" size={18} />}
        </div>
        {!signedIn && <p>{textFor(t, 'Sign in to view requests tied to your account.', '登录后可查看与你账号关联的请求。')}</p>}
        {signedIn && !loadingHistory && requests.length === 0 && moderationCases.length === 0 && <p>{textFor(t, 'No support requests yet.', '暂无支持请求。')}</p>}
        {moderationCases.map((item) => (
          <article key={item.id}>
            <div><strong>{item.report?.subject ?? item.id}</strong><span>{textFor(t, 'Trust & Safety case', '信任与安全案件')}</span></div>
            <code>{item.id}</code>
            <span className="status-badge">{item.status}</span>
            <time>{new Date(item.createdAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')}</time>
          </article>
        ))}
        {requests.map((request) => (
          <article key={request.id}>
            <div>
              <strong>{request.subject}</strong>
              <span>{isZh ? request.categoryLabel.zh : request.categoryLabel.en}</span>
            </div>
            <code>{request.id}</code>
            <span className="status-badge">{request.status}</span>
            <time>{new Date(request.submittedAt).toLocaleString(isZh ? 'zh-CN' : 'en-US')}</time>
            <button
              className="icon-button small"
              type="button"
              title={textFor(t, 'Reply to support', '回复支持团队')}
              aria-label={textFor(t, 'Reply to support', '回复支持团队')}
              disabled={request.status === 'closed'}
              onClick={() => {
                setReplyingTo((current) => current === request.id ? null : request.id)
                setReplyBody('')
                setReplyError('')
              }}
            >
              <MessageSquareReply size={16} />
            </button>
            {replyingTo === request.id && (
              <form className="support-user-reply" onSubmit={(event) => { event.preventDefault(); submitReply(request) }}>
                {Boolean(request.messages?.length) && (
                  <div className="support-user-thread">
                    {request.messages?.map((message) => (
                      <p key={message.id}>
                        <strong>{message.authorType === 'operator' ? textFor(t, 'Support', '支持团队') : textFor(t, 'You', '你')}</strong>
                        <span>{message.body}</span>
                      </p>
                    ))}
                  </div>
                )}
                <label>
                  <span>{textFor(t, 'Your reply', '你的回复')}</span>
                  <textarea
                    required
                    maxLength={4000}
                    rows={3}
                    value={replyBody}
                    onChange={(event) => setReplyBody(event.target.value)}
                    placeholder={textFor(t, 'Add information for the support team', '向支持团队补充信息')}
                  />
                </label>
                <button className="primary-button small" type="submit" disabled={sendingReply || !replyBody.trim()} onClick={(event) => { event.preventDefault(); submitReply(request) }}>
                  <Send size={15} />
                  {sendingReply ? textFor(t, 'Sending...', '发送中...') : textFor(t, 'Send reply', '发送回复')}
                </button>
                {replyError && <div className="auth-error" role="alert">{replyError}</div>}
              </form>
            )}
          </article>
        ))}
      </section>
    </div>
  )
}
