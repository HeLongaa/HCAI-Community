const dto = (row) => ({
  ...row,
  requestedAt: row.requestedAt.toISOString(),
  approvedAt: row.approvedAt?.toISOString() ?? null,
  appliedAt: row.appliedAt?.toISOString() ?? null,
  rolledBackAt: row.rolledBackAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  evidence: (row.evidence ?? []).map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
})

const evidenceCreate = (changeId, evidence, nested = false) => ({
  id: evidence.id,
  ...(nested ? {} : { releaseChangeId: changeId }),
  eventType: evidence.eventType,
  actorRef: evidence.actorRef,
  reasonCode: evidence.reasonCode,
  evidence: evidence.evidence,
  evidenceHash: evidence.evidenceHash,
})

export const createPrismaReleaseRepository = (client) => ({
  create: async (payload) => dto(await client.releaseChange.create({
    data: {
      id: payload.id,
      changeType: payload.changeType,
      status: payload.status,
      sourceEnvironment: payload.sourceEnvironment,
      targetEnvironment: payload.targetEnvironment,
      artifactVersion: payload.artifactVersion,
      rollbackVersion: payload.rollbackVersion,
      secretRef: payload.secretRef,
      secretVersion: payload.secretVersion,
      summary: payload.summary,
      reasonCode: payload.reasonCode,
      requestedByRef: payload.requestedByRef,
      evidence: { create: evidenceCreate(payload.id, payload.evidence, true) },
    },
    include: { evidence: { orderBy: { createdAt: 'asc' } } },
  })),
  find: async (id) => {
    const row = await client.releaseChange.findUnique({ where: { id: String(id) }, include: { evidence: { orderBy: { createdAt: 'asc' } } } })
    return row ? dto(row) : null
  },
  list: async (query = {}) => {
    const rows = await client.releaseChange.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.targetEnvironment ? { targetEnvironment: query.targetEnvironment } : {}),
        ...(query.changeType ? { changeType: query.changeType } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { evidence: { orderBy: { createdAt: 'asc' } } },
    })
    const items = rows.slice(0, query.limit)
    return { items: items.map(dto), limit: query.limit, nextCursor: rows.length > query.limit ? items.at(-1)?.id ?? null : null }
  },
  transition: async (id, expectedVersion, patch) => client.$transaction(async (tx) => {
    const changed = await tx.releaseChange.updateMany({
      where: { id: String(id), version: expectedVersion },
      data: {
        status: patch.status,
        approvedByRef: patch.approvedByRef,
        approvedAt: patch.approvedAt,
        appliedByRef: patch.appliedByRef,
        appliedAt: patch.appliedAt,
        rolledBackByRef: patch.rolledBackByRef,
        rolledBackAt: patch.rolledBackAt,
        version: { increment: 1 },
      },
    })
    if (changed.count !== 1) return null
    await tx.releaseEvidence.create({ data: evidenceCreate(String(id), patch.evidence) })
    return dto(await tx.releaseChange.findUnique({ where: { id: String(id) }, include: { evidence: { orderBy: { createdAt: 'asc' } } } }))
  }),
})
