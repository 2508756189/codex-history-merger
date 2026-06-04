import type { ConversationRecord } from './codexImport'

export type ProviderRecord = {
  id: string
  provider: string
  name: string
}

export type ProviderWorkspace = {
  providers: ProviderRecord[]
  conversations: ConversationRecord[]
}

export type ProviderOperationKind = 'create-provider' | 'rename-provider' | 'merge-providers'

export type ProviderOperation = {
  id: string
  kind: ProviderOperationKind
  before: ProviderWorkspace
  after: ProviderWorkspace
  summary: string
  writebackToCodex?: boolean
}

export function createProviderOperation(
  workspace: ProviderWorkspace,
  input: ProviderRecord,
): ProviderOperation {
  assertProviderIdAvailable(workspace, input.id)
  const after = cloneWorkspace(workspace)
  after.providers.push({ ...input })
  return operation('create-provider', workspace, after, `Create provider ${input.name}`)
}

export function renameProviderOperation(
  workspace: ProviderWorkspace,
  input: { providerId: string; provider?: string; name?: string },
): ProviderOperation {
  const provider = findProvider(workspace, input.providerId)
  const nextProvider = {
    ...provider,
    provider: input.provider ?? provider.provider,
    name: input.name ?? provider.name,
  }
  const after = {
    providers: workspace.providers.map((item) => (item.id === input.providerId ? nextProvider : { ...item })),
    conversations: workspace.conversations.map((conversation) =>
      ownerId(conversation) === input.providerId
        ? {
            ...conversation,
            providerId: input.providerId,
            provider: nextProvider.provider,
            providerName: nextProvider.name,
          }
        : { ...conversation },
    ),
  }

  return operation('rename-provider', workspace, after, `Rename provider ${provider.name} to ${nextProvider.name}`)
}

export function mergeProvidersOperation(
  workspace: ProviderWorkspace,
  input: { targetProviderId: string; sourceProviderIds: string[]; writebackToCodex?: boolean },
): ProviderOperation {
  const target = findProvider(workspace, input.targetProviderId)
  const sources = new Set(input.sourceProviderIds.filter((id) => id !== input.targetProviderId))
  if (sources.size === 0) {
    throw new Error('At least one source provider is required')
  }
  for (const sourceId of sources) {
    findProvider(workspace, sourceId)
  }

  const after: ProviderWorkspace = {
    providers: workspace.providers.filter((provider) => !sources.has(provider.id)).map((provider) => ({ ...provider })),
    conversations: workspace.conversations.map((conversation) => {
      if (!sources.has(ownerId(conversation))) return { ...conversation }
      return {
        ...conversation,
        providerId: target.id,
        provider: target.provider,
        providerName: target.name,
        codexImported: input.writebackToCodex && target.provider === 'Codex' ? true : conversation.codexImported,
      }
    }),
  }

  return {
    ...operation('merge-providers', workspace, after, `Merge ${sources.size} provider(s) into ${target.name}`),
    writebackToCodex: input.writebackToCodex,
  }
}

export function applyProviderOperation(_workspace: ProviderWorkspace, operation: ProviderOperation): ProviderWorkspace {
  return cloneWorkspace(operation.after)
}

export function rollbackProviderOperation(_workspace: ProviderWorkspace, operation: ProviderOperation): ProviderWorkspace {
  return cloneWorkspace(operation.before)
}

function operation(
  kind: ProviderOperationKind,
  before: ProviderWorkspace,
  after: ProviderWorkspace,
  summary: string,
): ProviderOperation {
  return {
    id: `${kind}-${Date.now()}`,
    kind,
    before: cloneWorkspace(before),
    after: cloneWorkspace(after),
    summary,
  }
}

function findProvider(workspace: ProviderWorkspace, id: string): ProviderRecord {
  const provider = workspace.providers.find((item) => item.id === id)
  if (!provider) throw new Error(`Provider not found: ${id}`)
  return provider
}

function assertProviderIdAvailable(workspace: ProviderWorkspace, id: string) {
  if (workspace.providers.some((provider) => provider.id === id)) {
    throw new Error(`Provider already exists: ${id}`)
  }
}

function ownerId(conversation: ConversationRecord): string {
  return conversation.providerId ?? conversation.sourceId
}

function cloneWorkspace(workspace: ProviderWorkspace): ProviderWorkspace {
  return {
    providers: workspace.providers.map((provider) => ({ ...provider })),
    conversations: workspace.conversations.map((conversation) => ({ ...conversation })),
  }
}
