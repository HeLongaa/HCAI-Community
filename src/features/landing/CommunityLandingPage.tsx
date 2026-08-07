import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Page } from '../../domain/types'
import './community-landing.css'

const ParticleMorphBackground = lazy(() => import('./ParticleMorphBackground').then((module) => ({ default: module.ParticleMorphBackground })))

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

type NetworkInformation = {
  saveData?: boolean
  effectiveType?: string
}

type NetworkNavigator = Navigator & {
  connection?: NetworkInformation
  deviceMemory?: number
}

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'
const prefersStaticVisual = () => {
  const device = navigator as NetworkNavigator
  const connection = device.connection
  return Boolean(
    connection?.saveData
    || connection?.effectiveType === 'slow-2g'
    || connection?.effectiveType === '2g'
    || (typeof device.deviceMemory === 'number' && device.deviceMemory <= 2)
    || (typeof device.hardwareConcurrency === 'number' && device.hardwareConcurrency <= 2),
  )
}

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.57-.3-5.27-1.29-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.15-1.18 3.15-1.18.64 1.58.24 2.75.12 3.04a4.46 4.46 0 0 1 1.19 3.09c0 4.41-2.71 5.39-5.29 5.68.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
  </svg>
)

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14M14 7l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const localizedScenes = {
  en: [
    {
      kicker: 'HCAI COMMUNITY',
      title: 'Turn ideas into tools.',
      text: 'No AI skills? No code? Bring the idea, HCAI connects the builders.',
    },
    {
      kicker: 'CONNECT THE ABILITY',
      title: 'Post the problem. Connect the ability.',
      text: 'Real needs meet real contributors in one open creation field.',
    },
    {
      kicker: 'HUMAN REQUESTS',
      title: 'Let real needs be seen by builders.',
      text: 'Good ideas should not stay buried in chats, and real contributions should not disappear.',
    },
    {
      kicker: 'REAL AI TOOLS',
      title: 'Bring AI into real work.',
      text: 'Start with one need, then build the next usable AI application.',
    },
    {
      kicker: 'BUILT IN THE OPEN',
      title: 'Make AI tools together.',
      text: 'Open source, shared creation, and a chance for every real need to be built.',
    },
  ],
  zh: [
    {
      kicker: 'HCAI COMMUNITY',
      title: '把想法变成工具。',
      text: '不会用 AI？不会写代码？有好想法却没人帮你实现？',
    },
    {
      kicker: 'CONNECT THE ABILITY',
      title: '来 HCAI，把问题发出来。',
      text: '把真实需求交给社区，让合适的能力在同一个现场相遇。',
    },
    {
      kicker: 'HUMAN REQUESTS',
      title: '让普通人的需求，被优秀开发者看见。',
      text: '不让好想法停在聊天框里，也不让贡献悄悄消失。',
    },
    {
      kicker: 'REAL AI TOOLS',
      title: '让 AI 能力真正进入业务现场。',
      text: '从一个需求开始，建设下一个能被使用、被验证、被奖励的 AI 应用。',
    },
    {
      kicker: 'BUILT IN THE OPEN',
      title: '一起把 AI 从想法做成工具。',
      text: '开源、共创、连接，让每一个真实需求都有被实现的机会。',
    },
  ],
}

type Language = keyof typeof localizedScenes

const renderDynamicTitle = (title: string) => (
  [...title].map((char, index) => (
    <span
      className="hcai-dynamic-char"
      key={`${char}-${index}`}
      style={{ '--char-index': index } as CSSProperties}
    >
      {char === ' ' ? '\u00A0' : char}
    </span>
  ))
)

export function CommunityLandingPage({
  language,
  onLogin,
  onOpenPage,
  onSearch,
  onLanguageChange,
  leaving = false,
}: {
  language: Language
  onLogin: () => void
  onOpenPage: (page: Page) => void
  onSearch: () => void
  onLanguageChange: (language: Language) => void
  leaving?: boolean
}) {
  const [progress, setProgress] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia(reducedMotionQuery).matches)
  const [staticVisualPreferred] = useState(prefersStaticVisual)
  const [visualEnhancementReady, setVisualEnhancementReady] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const started = true
  const scenes = localizedScenes[language]

  const progressLabel = useMemo(() => `${Math.round(progress * 100).toString().padStart(2, '0')}%`, [progress])
  const textProgress = useMemo(() => Math.min(scenes.length - 1, progress * (scenes.length - 1)), [progress, scenes.length])
  const textSceneIndex = useMemo(() => Math.min(scenes.length - 1, Math.round(textProgress)), [scenes.length, textProgress])

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    window.scrollTo({ top: 0, left: 0 })
    document.body.classList.add('hcai-landing-active')
    return () => {
      document.body.classList.remove('hcai-landing-active')
      window.history.scrollRestoration = previousScrollRestoration
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia(reducedMotionQuery)
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (reducedMotion || staticVisualPreferred) return
    const idleWindow = window as IdleWindow
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(() => setVisualEnhancementReady(true), { timeout: 1200 })
      return () => idleWindow.cancelIdleCallback?.(handle)
    }
    const handle = window.setTimeout(() => setVisualEnhancementReady(true), 160)
    return () => window.clearTimeout(handle)
  }, [reducedMotion, staticVisualPreferred])

  useEffect(() => {
    const updateProgress = () => {
      const available = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      const nextProgress = Math.min(1, Math.max(0, window.scrollY / available))
      setProgress(nextProgress)
      pageRef.current?.style.setProperty('--scroll-progress', nextProgress.toFixed(4))
    }

    updateProgress()
    window.addEventListener('scroll', updateProgress, { passive: true })
    window.addEventListener('resize', updateProgress)
    return () => {
      window.removeEventListener('scroll', updateProgress)
      window.removeEventListener('resize', updateProgress)
    }
  }, [])

  return (
    <div className={`hcai-landing hcai-cinema is-${language} ${started ? 'is-started' : 'is-waiting'}${leaving ? ' is-leaving' : ''}`} ref={pageRef}>
      {visualEnhancementReady && !reducedMotion && !staticVisualPreferred ? (
        <Suspense fallback={<div className="hcai-particle-background is-static" data-testid="landing-visual-fallback" aria-hidden="true" />}>
          <ParticleMorphBackground started={started} />
        </Suspense>
      ) : (
        <div className="hcai-particle-background is-static" data-testid="landing-static-visual" aria-hidden="true" />
      )}

      <header className="hcai-cinema-nav">
        <a className="hcai-cinema-brand" href="#promo" aria-label="HCAI Community 宣传页">
          <span>HCAI</span>
          <small>COMMUNITY</small>
        </a>
        <div className="hcai-cinema-meta">
          <span>OPEN SOURCE</span>
          <span>SCROLL FILM</span>
        </div>
        <div className="hcai-nav-actions">
          <button data-testid="discovery-search-trigger" className="hcai-nav-link-button" type="button" onClick={onSearch}>
            {language === 'en' ? 'Search' : '搜索'}
          </button>
          <button data-testid="policy-center-link" className="hcai-nav-link-button" type="button" onClick={() => onOpenPage('terms')}>
            {language === 'en' ? 'Policies' : '政策'}
          </button>
          <button data-testid="support-center-link" className="hcai-nav-link-button" type="button" onClick={() => onOpenPage('support')}>
            {language === 'en' ? 'Support' : '支持'}
          </button>
          <div className="hcai-language-toggle" aria-label="Language switch">
            <button className={language === 'en' ? 'is-active' : ''} type="button" onClick={() => onLanguageChange('en')}>EN</button>
            <button className={language === 'zh' ? 'is-active' : ''} type="button" onClick={() => onLanguageChange('zh')}>中文</button>
          </div>
          <button className="hcai-nav-enter" type="button" onClick={onLogin}>
            {language === 'en' ? 'Login' : '登录'}
            <ArrowIcon />
          </button>
        </div>
      </header>

      <main className="hcai-cinema-main" aria-live="polite">
        <section
          className="hcai-cinema-copy"
          aria-label="HCAI Community 介绍"
          style={{ '--text-progress': textProgress } as CSSProperties}
        >
          <div className="hcai-cinema-copy-window">
            <div className="hcai-cinema-copy-track">
              {scenes.map((scene, index) => (
                <article className={index === textSceneIndex ? 'is-active' : ''} key={scene.kicker} aria-hidden={index !== textSceneIndex}>
                  <p>{scene.kicker}</p>
                  <h1 aria-label={scene.title}>{renderDynamicTitle(scene.title)}</h1>
                  <span className="hcai-support-copy">{scene.text}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <div className="hcai-cinema-progress" aria-hidden="true">
          <span>{progressLabel}</span>
          <i style={{ transform: `scaleY(${Math.max(0.05, progress)})` }} />
        </div>

        <div className="hcai-cinema-actions">
          <a className="hcai-text-link" href="https://github.com/HeLongaa/HCAI-Community" target="_blank" rel="noreferrer">
            <GitHubIcon />
            {language === 'en' ? 'View source' : '查看源码'}
          </a>
        </div>
      </main>

      <div className="hcai-scroll-track" aria-hidden="true" />
    </div>
  )
}
