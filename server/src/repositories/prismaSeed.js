import { createHash } from 'node:crypto'
import { permissions, rolePermissions } from '../auth/permissions.js'
import { seedStore } from '../data/seed.js'
import {
  buildAdminReviewRecord,
  buildLedgerRecord,
  buildLibraryItemRecord,
  buildPostRecord,
  buildProfileRecord,
  buildTaskRecord,
} from './prismaTransforms.js'

const getHandle = (value) => {
  if (!value || value === 'Unassigned') {
    return null
  }
  return typeof value === 'string' ? value : value.handle ?? null
}

const uniqueHandles = () => {
  const handles = new Set()
  for (const account of seedStore.demoAccounts) {
    handles.add(account.handle)
  }
  for (const profile of seedStore.profiles) {
    handles.add(profile.handle)
  }
  for (const task of seedStore.tasks) {
    handles.add(getHandle(task.publisher))
    handles.add(getHandle(task.assignee))
  }
  for (const post of seedStore.posts) {
    handles.add(getHandle(post.author))
  }
  return [...handles].filter(Boolean)
}

const buildHandleMap = () => {
  const handleToUserId = new Map()

  for (const account of seedStore.demoAccounts) {
    handleToUserId.set(account.handle, account.id)
  }

  for (const profile of seedStore.profiles) {
    if (!handleToUserId.has(profile.handle)) {
      handleToUserId.set(profile.handle, `profile-${profile.handle}`)
    }
  }

  for (const handle of uniqueHandles()) {
    if (!handleToUserId.has(handle)) {
      handleToUserId.set(handle, `user-${handle}`)
    }
  }

  return handleToUserId
}

export const toTokenHash = (token) => createHash('sha256').update(token).digest('hex')

const seedPermissionPolicy = async (client) => {
  await client.permission.createMany({
    data: permissions.map((permission) => ({
      id: permission,
      description: null,
    })),
    skipDuplicates: true,
  })

  await client.rolePermission.createMany({
    data: Object.entries(rolePermissions).flatMap(([role, rolePermissionIds]) =>
      rolePermissionIds.map((permissionId) => ({ role, permissionId })),
    ),
    skipDuplicates: true,
  })
}

export const seedPrismaDatabase = async (client) => {
  await seedPermissionPolicy(client)

  if ((await client.user.count()) > 0) {
    return
  }

  const handleToUserId = buildHandleMap()
  const userRows = []

  for (const account of seedStore.demoAccounts) {
    userRows.push({
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      avatarUrl: null,
      role: account.role,
      status: 'active',
    })
  }

  for (const profile of seedStore.profiles) {
    const userId = handleToUserId.get(profile.handle)
    if (seedStore.demoAccounts.some((account) => account.id === userId)) {
      continue
    }
    userRows.push({
      id: userId,
      email: null,
      displayName: profile.name?.en ?? profile.handle,
      avatarUrl: null,
      role: 'member',
      status: 'active',
    })
  }

  for (const task of seedStore.tasks) {
    const publisherHandle = getHandle(task.publisher)
    const publisherId = handleToUserId.get(publisherHandle)
    if (!userRows.some((row) => row.id === publisherId)) {
      userRows.push({
        id: publisherId,
        email: null,
        displayName: publisherHandle,
        avatarUrl: null,
        role: 'member',
        status: 'active',
      })
    }
    const assigneeHandle = getHandle(task.assignee)
    const assigneeId = assigneeHandle ? handleToUserId.get(assigneeHandle) : null
    if (assigneeId && !userRows.some((row) => row.id === assigneeId)) {
      userRows.push({
        id: assigneeId,
        email: null,
        displayName: assigneeHandle,
        avatarUrl: null,
        role: 'member',
        status: 'active',
      })
    }
  }

  for (const post of seedStore.posts) {
    const authorHandle = getHandle(post.author)
    const authorId = handleToUserId.get(authorHandle)
    if (!userRows.some((row) => row.id === authorId)) {
      userRows.push({
        id: authorId,
        email: null,
        displayName: authorHandle,
        avatarUrl: null,
        role: 'member',
        status: 'active',
      })
    }
  }

  await client.user.createMany({ data: userRows, skipDuplicates: true })

  for (const profile of seedStore.profiles) {
    await client.profile.create({
      data: buildProfileRecord(profile, { id: handleToUserId.get(profile.handle) }),
    })
  }

  for (const account of seedStore.demoAccounts) {
    await client.authAccount.create({
      data: {
        userId: account.id,
        provider: 'demo',
        providerUserId: account.handle,
        passwordHash: null,
      },
    })
  }

  for (const task of seedStore.tasks) {
    const publisherHandle = getHandle(task.publisher)
    const assigneeHandle = getHandle(task.assignee)
    await client.task.create({
      data: buildTaskRecord(
        task,
        { id: handleToUserId.get(publisherHandle) },
        assigneeHandle ? { id: handleToUserId.get(assigneeHandle) } : null,
      ),
    })
  }

  for (const post of seedStore.posts) {
    await client.post.create({
      data: buildPostRecord(post, { id: handleToUserId.get(getHandle(post.author)) }),
    })
  }

  for (const [index, item] of seedStore.inspirationItems.entries()) {
    const account = seedStore.demoAccounts[index % seedStore.demoAccounts.length]
    await client.libraryItem.create({
      data: buildLibraryItemRecord({
        title: item.title,
        content: item.text,
        sourceType: 'post',
        sourceId: null,
        metadata: {
          type: item.type,
          source: item.source,
          saves: item.saves,
          text: item.text,
        },
      }, { id: account.id }),
    })
  }

  for (const [index, entry] of seedStore.pointsLedger.entries()) {
    const account = seedStore.demoAccountByHandle.get(entry.userHandle) ?? seedStore.demoAccounts[index % seedStore.demoAccounts.length]
    await client.pointLedger.create({
      data: buildLedgerRecord(entry, { id: account.id }, index),
    })
  }

  for (const review of seedStore.adminReviewQueue) {
    await client.adminReview.create({
      data: buildAdminReviewRecord(review),
    })
  }

  for (const account of seedStore.demoAccounts) {
    await client.refreshToken.create({
      data: {
        userId: account.id,
        tokenHash: toTokenHash(account.tokens.refreshToken),
        expiresAt: new Date('2099-12-31T23:59:59.000Z'),
        revokedAt: null,
      },
    })
  }

  await client.auditEvent.create({
    data: {
      actorType: 'system',
      actorId: null,
      action: 'seed:initialized',
      resourceType: 'system',
      resourceId: null,
      metadata: { source: 'seedPrismaDatabase' },
    },
  })
}
