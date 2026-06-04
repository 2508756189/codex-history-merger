export type ProviderName = string

export type SourceRecord = {
  id: string
  label: string
  path: string
  provider: ProviderName
  name?: string
  scannedAt?: string
}

export type ConversationRecord = {
  id: string
  key: string
  sourceId: string
  providerId?: string
  provider: ProviderName
  providerName?: string
  title: string
  rolloutId?: string
  threadId?: string
  filePath?: string
  cwd?: string
  modelProvider?: string
  createdAt?: string
  updatedAt?: string
  archived: boolean
  tokensUsed?: number
  importRunId?: string
  codexImported?: boolean
}

export type MessageRecord = {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'tool' | 'event'
  content: string
  timestamp?: string
  eventType?: string
}

export type ParseErrorRecord = {
  line: number
  message: string
}

export type ParsedConversation = {
  conversation: ConversationRecord
  messages: MessageRecord[]
  errors: ParseErrorRecord[]
}

export type CodexJsonlInput = {
  sourceId: string
  filePath: string
  archived: boolean
  content: string
  threadMeta?: Partial<ConversationRecord>
}

export type ConversationKeyInput = {
  threadId?: string
  rolloutId?: string
  filePath?: string
  contentHash?: string
}

export type ImportPreview = {
  stats: {
    newCount: number
    duplicateCount: number
    conflictCount: number
    failedCount: number
  }
  newItems: ParsedConversation[]
  duplicateItems: ParsedConversation[]
  conflictItems: ParsedConversation[]
  failedItems: ParsedConversation[]
}

export function computeConversationKey(input: ConversationKeyInput): string {
  if (input.threadId) return `thread:${input.threadId}`
  if (input.rolloutId) return `rollout:${input.rolloutId}`
  if (input.filePath) return `path:${normalizePath(input.filePath)}`
  return `hash:${input.contentHash ?? 'unknown'}`
}

export function parseCodexJsonl(input: CodexJsonlInput): ParsedConversation {
  const rolloutId = extractRolloutId(input.filePath)
  const contentHash = stableHash(input.content)
  const lines = input.content.split(/\r?\n/).filter((line) => line.length > 0)
  const errors: ParseErrorRecord[] = []
  const messages: MessageRecord[] = []

  lines.forEach((line, index) => {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      errors.push({ line: index + 1, message: 'Invalid JSON line' })
      return
    }

    const record = event as { timestamp?: string; type?: string; payload?: unknown }
    const text = extractPayloadText(record.payload)
    if (!text) return

    messages.push({
      id: `${rolloutId || contentHash}-${index + 1}`,
      conversationId: rolloutId || contentHash,
      role: inferRole(record.type),
      content: text,
      timestamp: record.timestamp,
      eventType: record.type,
    })
  })

  const firstUserMessage = messages.find((message) => message.role === 'user')
  const title = input.threadMeta?.title || firstUserMessage?.content || rolloutId || 'Untitled Codex conversation'
  const threadId = input.threadMeta?.threadId
  const key = computeConversationKey({
    threadId,
    rolloutId,
    filePath: input.filePath,
    contentHash,
  })

  return {
    conversation: {
      id: rolloutId || contentHash,
      key,
      sourceId: input.sourceId,
      providerId: input.sourceId,
      provider: 'Codex',
      providerName: 'Codex',
      title,
      rolloutId,
      threadId,
      filePath: input.filePath,
      cwd: input.threadMeta?.cwd,
      modelProvider: input.threadMeta?.modelProvider,
      createdAt: input.threadMeta?.createdAt || messages[0]?.timestamp,
      updatedAt: input.threadMeta?.updatedAt || messages[messages.length - 1]?.timestamp,
      archived: input.archived,
      tokensUsed: input.threadMeta?.tokensUsed,
    },
    messages,
    errors,
  }
}

export function createImportPreview(input: { existingKeys: Set<string>; parsed: ParsedConversation[] }): ImportPreview {
  const seenNewKeys = new Set<string>()
  const preview: ImportPreview = {
    stats: { newCount: 0, duplicateCount: 0, conflictCount: 0, failedCount: 0 },
    newItems: [],
    duplicateItems: [],
    conflictItems: [],
    failedItems: [],
  }

  for (const item of input.parsed) {
    if (item.errors.length > 0) {
      preview.failedItems.push(item)
      preview.stats.failedCount += 1
      continue
    }

    if (input.existingKeys.has(item.conversation.key)) {
      preview.duplicateItems.push(item)
      preview.stats.duplicateCount += 1
      continue
    }

    if (seenNewKeys.has(item.conversation.key)) {
      preview.conflictItems.push(item)
      preview.stats.conflictCount += 1
      continue
    }

    seenNewKeys.add(item.conversation.key)
    preview.newItems.push(item)
    preview.stats.newCount += 1
  }

  return preview
}

export function buildDashboardStats(input: { sources: SourceRecord[]; conversations: ConversationRecord[] }) {
  const projects = new Set(input.conversations.map((item) => item.cwd).filter(Boolean).map((cwd) => normalizePath(cwd!)))
  const providerCounts = new Map<string, number>()
  let tokenTotal = 0
  let archivedCount = 0

  for (const conversation of input.conversations) {
    const provider = conversation.modelProvider || 'unknown'
    providerCounts.set(provider, (providerCounts.get(provider) || 0) + 1)
    tokenTotal += conversation.tokensUsed || 0
    if (conversation.archived) archivedCount += 1
  }

  return {
    sourceCount: input.sources.length,
    conversationCount: input.conversations.length,
    projectCount: projects.size,
    archivedCount,
    tokenTotal,
    modelProviders: [...providerCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count),
  }
}

export function rollbackImportedRun(input: {
  runId: string
  conversations: ConversationRecord[]
  messages: MessageRecord[]
}) {
  const removedConversationIds = new Set(
    input.conversations.filter((conversation) => conversation.importRunId === input.runId).map((conversation) => conversation.id),
  )

  return {
    conversations: input.conversations.filter((conversation) => conversation.importRunId !== input.runId),
    messages: input.messages.filter((message) => !removedConversationIds.has(message.conversationId)),
  }
}

function inferRole(type?: string): MessageRecord['role'] {
  const normalized = (type || '').toLowerCase()
  if (normalized.includes('user')) return 'user'
  if (normalized.includes('assistant') || normalized.includes('agent')) return 'assistant'
  if (normalized.includes('system')) return 'system'
  if (normalized.includes('tool') || normalized.includes('function')) return 'tool'
  return 'event'
}

function extractPayloadText(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim()
  if (!payload || typeof payload !== 'object') return ''

  const value = payload as Record<string, unknown>
  const direct = [value.text, value.content, value.message]
  for (const candidate of direct) {
    const text = extractContentText(candidate)
    if (text) return text
  }

  return extractContentText(value)
}

function extractContentText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(extractContentText).filter(Boolean).join('\n').trim()
  if (!value || typeof value !== 'object') return ''

  const object = value as Record<string, unknown>
  if (typeof object.text === 'string') return object.text.trim()
  if (typeof object.content === 'string') return object.content.trim()
  if (Array.isArray(object.content)) return object.content.map(extractContentText).filter(Boolean).join('\n').trim()
  if (object.message) return extractContentText(object.message)
  return ''
}

function extractRolloutId(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, '/')
  const fileName = normalized.split('/').pop() || ''
  return fileName.replace(/\.jsonl$/i, '') || undefined
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

function stableHash(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
