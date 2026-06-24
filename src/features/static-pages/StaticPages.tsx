import { useState } from 'react'
import { BadgeDollarSign, Check, Code2, Sparkles } from 'lucide-react'
import type { SimulateAction } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { apiFeatures, planCards } from '../../data/mockData'
import { isZhCopy, pointText, textFor } from '../../domain/utils'

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
  const plans = isZh
    ? [
        { name: '免费版', price: '500 积分', credits: '10 首/月', songs: '基础', badge: '' },
        { name: 'Plus', price: '60K 积分', credits: '100 首/月', songs: '标准', badge: '' },
        { name: 'Pro', price: '300K 积分', credits: '500 首/月', songs: '最受欢迎', badge: '最受欢迎' },
        { name: 'Ultra', price: '不限量积分', credits: '不限量生成', songs: '旗舰', badge: '' },
      ]
    : planCards
  const comparison = isZh
    ? ['音乐生成', '图片生成', '视频生成', '商用授权', '任务广场加权', 'API 访问']
    : ['Music generation', 'Image generation', 'Video generation', 'Commercial use', 'Task Plaza boost', 'API access']

  return (
    <div className="stack">
      <SectionHeader eyebrow={textFor(t, 'Plans', '套餐')} title={textFor(t, 'Unlock the full AI creative platform', '解锁完整 AI 创作平台')} />
      <div className="billing-toggle">
        <button className={billing === 'year' ? 'active' : ''} type="button" onClick={() => setBilling('year')}>
          {t.billingYear}
        </button>
        <button className={billing === 'month' ? 'active' : ''} type="button" onClick={() => setBilling('month')}>
          {t.billingMonth}
        </button>
      </div>
      <div className="plan-grid">
        {plans.map((plan) => (
          <article className={plan.badge ? 'plan-card featured' : 'plan-card'} key={plan.name}>
            {plan.badge && <span className="pill small">{plan.badge}</span>}
            <h3>{plan.name}</h3>
            <strong>{pointText(plan.price)}</strong>
            <p>{plan.credits}</p>
            <ul>
              <li>{textFor(t, 'Music generation', '音乐生成')}: {plan.credits}</li>
              <li>{textFor(t, 'Image generation', '图片生成')}</li>
              <li>{textFor(t, 'Video generation queue', '视频生成队列')}</li>
              <li>{textFor(t, 'Chat assistant usage', '对话助手额度')}</li>
              <li>{textFor(t, 'Community and Task Plaza', '社区与任务广场')}</li>
            </ul>
            <button className="primary-button" type="button" onClick={requireAuth}>
              {textFor(t, 'Get plan', '选择套餐')}
            </button>
          </article>
        ))}
      </div>
      <section className="panel comparison">
        <SectionHeader title={textFor(t, 'Feature comparison', '功能对比')} />
        {comparison.map((feature) => (
          <div className="compare-row" key={feature}>
            <span>{feature}</span>
            <Check size={18} />
            <Check size={18} />
            <Check size={18} />
            <Check size={18} />
          </div>
        ))}
      </section>
    </div>
  )
}

export function ApiPage({
  t,
  requireAuth,
  simulateAction,
}: {
  t: Record<string, string>
  requireAuth: () => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const features = isZh
    ? [
        '音乐 AI',
        '图片生成',
        '文生视频',
        '声音生成器',
        '文本朗读',
        'AI 翻唱',
        '分轨拆分',
        '歌词生成',
        'BPM 检测',
      ]
    : apiFeatures
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
              {textFor(t, '$20 credit', '¥140 测试额度')}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() =>
                simulateAction(isZh ? '已打开 API 文档目录：音乐、图片、视频、对话接口' : 'API docs opened: music, image, video, and chat endpoints')
              }
            >
              <Code2 size={17} />
              {t.docs}
            </button>
          </div>
        </div>
        <pre className="code-card">{`await museflow.generate({
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
              simulateAction(isZh ? `已选择 API 能力：${feature}` : `API capability selected: ${feature}`)
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
        <h1>{textFor(t, 'HCAI is a front-end prototype for an AI creative network.', 'HCAI 是一个 AI 创作协作网络的前端原型。')}</h1>
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

export function LegalPage({ title, t }: { title: string; t: Record<string, string> }) {
  return (
    <section className="panel readable">
      <span className="eyebrow">{textFor(t, 'Legal', '法律')}</span>
      <h1>{title}</h1>
      <p>
        {textFor(
          t,
          'This prototype includes static legal content placeholders for product terms, privacy language, usage rights, commercial licensing, task marketplace rules, and community moderation policies.',
          '这个原型包含服务条款、隐私说明、使用权、商用授权、任务广场规则和社区治理政策的静态占位内容。',
        )}
      </p>
    </section>
  )
}
