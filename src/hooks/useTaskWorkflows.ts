import { useState } from 'react'
import type { Locale, Page, PublishDraft, Task } from '../domain/types'
import { tasks } from '../data/mockData'
import { copy } from '../i18n/copy'
import { localeFirstTask } from '../domain/utils'

type TaskWorkflowOptions = {
  locale: Locale
  pushLedger: (description: string, delta: string) => void
  pushToast: (message: string) => void
  setPage: (page: Page) => void
}

export function useTaskWorkflows({ locale, pushLedger, pushToast, setPage }: TaskWorkflowOptions) {
  const [taskList, setTaskList] = useState<Task[]>(tasks)
  const [selectedTask, setSelectedTask] = useState<Task>(() => localeFirstTask(tasks, copy.en))

  const publishTask = (draft: PublishDraft) => {
    const isZh = locale === 'zh'
    const newTask: Task = {
      id: Date.now(),
      title: draft.title || (isZh ? '未命名 AI 任务' : 'Untitled AI task'),
      category: draft.category || 'Video',
      budget: draft.reward.split('/')[0]?.trim() || draft.reward || (isZh ? '¥800' : '$120'),
      points: draft.reward.split('/')[1]?.trim() || (isZh ? '800 积分' : '800 pts'),
      status: 'Open',
      deadline: draft.deadline || (isZh ? '3 天' : '3 days'),
      proposals: 0,
      description: draft.details || (isZh ? '这是一条通过前端模拟发布的新 AI 需求。' : 'This AI request was created in the local front-end flow.'),
      publisher: 'you',
      assignee: 'Unassigned',
      requirements: isZh
        ? [
            draft.rules || '提交预览链接、最终文件、提示词和验收说明。',
            `可见范围：${draft.visibility}`,
            '这条内容由本地前端模拟流程创建。',
          ]
        : [
            draft.rules || 'Submit preview links, final files, prompts, and acceptance notes.',
            `Visibility: ${draft.visibility}`,
            'This item was created in the local front-end flow.',
          ],
      attachments: [isZh ? '本地模拟附件.md' : 'local-demo-attachment.md'],
      privateBrief: isZh ? '这是本地前端模拟发布的私密需求说明。' : 'Private brief created by the local front-end publish flow.',
      submission: isZh ? '等待接单者提交成果。' : 'Waiting for an assignee to submit deliverables.',
      resultLinks: [isZh ? '等待提交' : 'Waiting for submission'],
      reviewNote: isZh ? '发布成功，等待创作者接取。' : 'Published successfully. Waiting for a maker to claim it.',
      rights: isZh ? '按发布需求约定使用，当前为前端模拟数据。' : 'Usage follows the posted brief. This is front-end demo data.',
    }
    setTaskList((current) => [newTask, ...current])
    setSelectedTask(newTask)
    pushLedger(isZh ? `发布任务：${newTask.title}` : `Published task: ${newTask.title}`, '+20')
    pushToast(isZh ? `已发布任务：${newTask.title}` : `Task published: ${newTask.title}`)
    setPage('tasks')
  }

  const claimTask = (task: Task) => {
    const isZh = locale === 'zh'
    const updated = {
      ...task,
      status: 'Open',
      assignee: 'you',
      proposals: task.proposals + 1,
      submission: isZh ? '方案草稿已提交，等待发布方在个人中心选择。' : 'Proposal draft submitted. Waiting for the publisher to choose in My Tasks.',
      reviewNote: isZh ? '方案已提交。发布方选择后进入沟通与交付流程。' : 'Proposal submitted. Once selected, both sides move into discussion and delivery.',
    }
    setTaskList((current) => current.map((item) => (item.id === task.id ? updated : item)))
    setSelectedTask(updated)
    pushLedger(isZh ? `提交方案草稿：${task.title}` : `Submitted proposal draft: ${task.title}`, '+50')
    pushToast(isZh ? `方案已提交：${task.title}` : `Proposal submitted: ${task.title}`)
    setPage('mine')
  }

  const submitTask = (task: Task) => {
    const isZh = locale === 'zh'
    const updated = {
      ...task,
      status: 'Pending Review',
      assignee: task.assignee === 'Unassigned' ? 'you' : task.assignee,
      submission: isZh
        ? '已提交：预览链接、最终文件、提示词、修订说明和版权摘要。'
        : 'Submitted: preview links, final files, prompt notes, revision summary, and rights note.',
      resultLinks: isZh ? ['网盘/本地模拟交付包', '录屏/验收讲解'] : ['drive/local-demo-delivery', 'loom/local-review-walkthrough'],
      reviewNote: isZh ? '成果已提交，等待发布方验收。' : 'Deliverables submitted. Waiting for publisher review.',
    }
    setTaskList((current) => current.map((item) => (item.id === task.id ? updated : item)))
    setSelectedTask(updated)
    pushLedger(isZh ? `提交成果：${task.title}` : `Submitted deliverable: ${task.title}`, '+120')
    pushToast(isZh ? `已提交成果：${task.title}` : `Deliverable submitted: ${task.title}`)
    setPage('mine')
  }

  const approveTask = (task: Task) => {
    const isZh = locale === 'zh'
    const updated = {
      ...task,
      status: 'Completed',
      reviewNote: isZh ? '验收通过，积分已发放，贡献履历已更新。' : 'Accepted. Points released and contribution history updated.',
    }
    setTaskList((current) => current.map((item) => (item.id === task.id ? updated : item)))
    setSelectedTask(updated)
    pushLedger(isZh ? `验收通过：${task.title}` : `Accepted task: ${task.title}`, `+${task.points.replace(/[^\d]/g, '') || '500'}`)
    pushToast(isZh ? `验收通过：${task.title}` : `Task accepted: ${task.title}`)
    setPage('points')
  }

  const rejectTask = (task: Task) => {
    const isZh = locale === 'zh'
    const updated = {
      ...task,
      status: 'Rejected',
      reviewNote: isZh
        ? '已驳回：请补充更明确的交付链接、验收说明和版权确认后重新提交。'
        : 'Rejected: add clearer delivery links, acceptance notes, and rights confirmation before resubmitting.',
    }
    setTaskList((current) => current.map((item) => (item.id === task.id ? updated : item)))
    setSelectedTask(updated)
    pushToast(isZh ? `已驳回任务：${task.title}` : `Task rejected: ${task.title}`)
  }

  return {
    taskList,
    selectedTask,
    setSelectedTask,
    publishTask,
    claimTask,
    submitTask,
    approveTask,
    rejectTask,
  }
}
