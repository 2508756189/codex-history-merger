import { describe, expect, it } from 'vitest'
import {
  applyProviderOperation,
  createProviderOperation,
  mergeProvidersOperation,
  renameProviderOperation,
  rollbackProviderOperation,
  type ProviderWorkspace,
} from './providerOperations'

const workspace: ProviderWorkspace = {
  providers: [
    { id: 'codex', provider: 'Codex', name: '本机 Codex' },
    { id: 'work-codex', provider: 'Codex', name: '工作电脑 Codex 备份' },
    { id: 'disk-codex', provider: 'Codex', name: '移动硬盘 Codex 备份' },
  ],
  conversations: [
    { id: 'c1', key: 'thread:c1', sourceId: 'codex', providerId: 'codex', provider: 'Codex', providerName: '本机 Codex', title: 'Codex task', archived: false },
    { id: 'c2', key: 'thread:c2', sourceId: 'work-codex', providerId: 'work-codex', provider: 'Codex', providerName: '工作电脑 Codex 备份', title: '工作电脑 Codex task', archived: false },
    { id: 'c3', key: 'thread:c3', sourceId: 'disk-codex', providerId: 'disk-codex', provider: 'Codex', providerName: '移动硬盘 Codex 备份', title: '移动硬盘 Codex task', archived: true },
  ],
}

describe('provider operations', () => {
  it('creates a provider and rolls it back', () => {
    const operation = createProviderOperation(workspace, { id: 'study-codex', provider: 'Codex', name: '软考备份 Codex' })
    const applied = applyProviderOperation(workspace, operation)

    expect(applied.providers.map((item) => item.id)).toEqual(['codex', 'work-codex', 'disk-codex', 'study-codex'])

    const rolledBack = rollbackProviderOperation(applied, operation)

    expect(rolledBack).toEqual(workspace)
  })

  it('renames provider key or display name and updates all conversations under it', () => {
    const operation = renameProviderOperation(workspace, {
      providerId: 'work-codex',
      provider: 'Codex',
      name: '统一导入到 Codex',
    })
    const applied = applyProviderOperation(workspace, operation)

    expect(applied.providers.find((item) => item.id === 'work-codex')).toEqual({
      id: 'work-codex',
      provider: 'Codex',
      name: '统一导入到 Codex',
    })
    expect(applied.conversations.find((item) => item.id === 'c2')).toEqual(
      expect.objectContaining({ provider: 'Codex', providerName: '统一导入到 Codex' }),
    )

    expect(rollbackProviderOperation(applied, operation)).toEqual(workspace)
  })

  it('merges other providers into the selected provider and can roll back the move', () => {
    const operation = mergeProvidersOperation(workspace, {
      targetProviderId: 'codex',
      sourceProviderIds: ['work-codex', 'disk-codex'],
    })
    const applied = applyProviderOperation(workspace, operation)

    expect(applied.providers.map((item) => item.id)).toEqual(['codex'])
    expect(applied.conversations).toEqual([
      expect.objectContaining({ id: 'c1', providerId: 'codex', provider: 'Codex', providerName: '本机 Codex' }),
      expect.objectContaining({ id: 'c2', providerId: 'codex', provider: 'Codex', providerName: '本机 Codex' }),
      expect.objectContaining({ id: 'c3', providerId: 'codex', provider: 'Codex', providerName: '本机 Codex' }),
    ])

    expect(rollbackProviderOperation(applied, operation)).toEqual(workspace)
  })

  it('builds a Codex writeback operation that marks conversations as imported to the selected Codex provider', () => {
    const operation = mergeProvidersOperation(workspace, {
      targetProviderId: 'codex',
      sourceProviderIds: ['work-codex'],
      writebackToCodex: true,
    })
    const applied = applyProviderOperation(workspace, operation)

    expect(applied.conversations.find((item) => item.id === 'c2')).toEqual(
      expect.objectContaining({
        providerId: 'codex',
        provider: 'Codex',
        providerName: '本机 Codex',
        codexImported: true,
      }),
    )

    expect(rollbackProviderOperation(applied, operation)).toEqual(workspace)
  })
})
