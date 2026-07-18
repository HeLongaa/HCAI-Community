import { HttpError } from '../common/errors/httpError.js'

export const communityModerationTargetTypes = Object.freeze(['post', 'comment'])
export const communityModerationStates = Object.freeze(['visible', 'hidden'])
export const communityModerationActions = Object.freeze(['retain', 'hide', 'uphold', 'restore'])

export const communityModerationTransition = ({ targetType, currentState, stage, outcome }) => {
  if (!communityModerationTargetTypes.includes(targetType)) return null
  if (!communityModerationStates.includes(currentState)) throw new HttpError(409, 'COMMUNITY_MODERATION_STATE_INVALID', 'Community moderation projection is invalid')

  if (stage === 'original') {
    const hidden = ['restrict_content', 'remove_content', 'suspend_account'].includes(outcome)
    return {
      action: hidden ? 'hide' : 'retain',
      fromState: currentState,
      toState: hidden ? 'hidden' : currentState,
    }
  }

  if (stage === 'appeal') {
    const restored = ['overturn', 'partially_overturn'].includes(outcome)
    return {
      action: restored ? 'restore' : 'uphold',
      fromState: currentState,
      toState: restored ? 'visible' : currentState,
    }
  }

  throw new HttpError(409, 'COMMUNITY_MODERATION_STAGE_INVALID', 'Community moderation decision stage is invalid')
}

export const serializeCommunityModerationAction = (item) => ({
  id: item.id,
  decisionId: item.decisionId,
  targetType: item.targetType,
  targetId: item.targetId,
  action: item.action,
  fromState: item.fromState,
  toState: item.toState,
  reasonCode: item.reasonCode,
  actorId: item.actorId,
  createdAt: new Date(item.createdAt).toISOString(),
})
