import { useState } from 'react'
import type { NavigateOptions, Page, PlaygroundMode } from '../domain/types'

const parentPages = {
  playground: 'home',
  chat: 'home',
  explore: 'home',
  tasks: 'home',
  publish: 'tasks',
  mine: 'tasks',
  community: 'home',
  inspiration: 'home',
  points: 'home',
  admin: 'tasks',
  pricing: 'home',
  api: 'home',
  earn: 'home',
  about: 'home',
  playlist: 'explore',
  profile: 'community',
  terms: 'about',
  privacy: 'about',
} satisfies Record<Exclude<Page, 'home'>, Page>

export function useNavigationState() {
  const [page, setPage] = useState<Page>('home')
  const [playgroundWorkspace, setPlaygroundWorkspace] = useState<PlaygroundMode>('music')
  const [pageReturnTargets, setPageReturnTargets] = useState<Partial<Record<Page, Page>>>({})

  const navigateToPage = (target: Page, workspace?: PlaygroundMode, options: NavigateOptions = {}) => {
    const sourcePage = page
    let destination = target
    if (target === 'chat') {
      setPlaygroundWorkspace('chat')
      destination = 'playground'
    } else if (target === 'playground' && workspace) {
      setPlaygroundWorkspace(workspace)
    }
    setPageReturnTargets((current) => {
      const next = { ...current }
      if (destination === 'home' || options.resetReturn || options.returnTo === null) {
        delete next[destination]
      } else if (options.returnTo && options.returnTo !== destination) {
        next[destination] = options.returnTo
      } else if (sourcePage !== destination) {
        next[destination] = sourcePage
      }
      return next
    })
    setPage(destination)
  }

  const navigatePrimary = (target: Page, workspace?: PlaygroundMode) => {
    navigateToPage(target, workspace, { resetReturn: true })
  }

  const parentPage = page === 'home' ? null : pageReturnTargets[page] ?? (page === 'inspiration' ? null : parentPages[page])

  const navigateBackToParent = () => {
    if (!parentPage) return
    const target = parentPage
    setPageReturnTargets((current) => {
      const next = { ...current }
      delete next[page]
      return next
    })
    setPage(target)
  }

  const rememberReturnTarget = (target: Page, source: Page) => {
    if (source === target) return
    setPageReturnTargets((current) => ({ ...current, [target]: source }))
  }

  return {
    page,
    setPage,
    playgroundWorkspace,
    setPlaygroundWorkspace,
    parentPage,
    navigateToPage,
    navigatePrimary,
    navigateBackToParent,
    rememberReturnTarget,
  }
}
