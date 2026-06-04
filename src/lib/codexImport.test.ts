import { describe, expect, it } from 'vitest'
import {
  buildDashboardStats,
  computeConversationKey,
  createImportPreview,
  parseCodexJsonl,
  rollbackImportedRun,
} from './codexImport'

const sampleJsonl = [
  JSON.stringify({
    timestamp: '2026-06-03T01:00:00.000Z',
    type: 'user_message',
    payload: { text: '帮我修复订单统计' },
  }),
  JSON.stringify({
    timestamp: '2026-06-03T01:00:01.000Z',
    type: 'assistant_message',
    payload: { message: { content: [{ type: 'text', text: '先查数据库。' }] } },
  }),
].join('\n')

describe('parseCodexJsonl', () => {
  it('extracts searchable messages from timestamp/type/payload events', () => {
    const result = parseCodexJsonl({
      sourceId: 'local',
      filePath: 'C:/Users/me/.codex/sessions/rollout-abc.jsonl',
      archived: false,
      content: sampleJsonl,
    })

    expect(result.conversation.rolloutId).toBe('rollout-abc')
    expect(result.conversation.provider).toBe('Codex')
    expect(result.conversation.title).toBe('帮我修复订单统计')
    expect(result.messages).toEqual([
      expect.objectContaining({ role: 'user', content: '帮我修复订单统计' }),
      expect.objectContaining({ role: 'assistant', content: '先查数据库。' }),
    ])
  })

  it('keeps malformed lines as parse errors without dropping valid messages', () => {
    const result = parseCodexJsonl({
      sourceId: 'local',
      filePath: 'C:/Users/me/.codex/archived_sessions/rollout-bad.jsonl',
      archived: true,
      content: `${sampleJsonl}\n{bad json`,
    })

    expect(result.conversation.archived).toBe(true)
    expect(result.messages).toHaveLength(2)
    expect(result.errors).toEqual([
      expect.objectContaining({ line: 3, message: expect.stringContaining('Invalid JSON') }),
    ])
  })
})

describe('dedupe and import preview', () => {
  it('prefers thread id, then rollout id, then path, then sha hash for conversation keys', () => {
    expect(computeConversationKey({ threadId: 'thread-1', rolloutId: 'rollout-1', filePath: 'a', contentHash: 'h' })).toBe(
      'thread:thread-1',
    )
    expect(computeConversationKey({ rolloutId: 'rollout-1', filePath: 'a', contentHash: 'h' })).toBe('rollout:rollout-1')
    expect(computeConversationKey({ filePath: 'C:\\A\\B.jsonl', contentHash: 'h' })).toBe('path:c:/a/b.jsonl')
    expect(computeConversationKey({ contentHash: 'h' })).toBe('hash:h')
  })

  it('counts new, duplicate, conflict, and failed items before import', () => {
    const preview = createImportPreview({
      existingKeys: new Set(['thread:known']),
      parsed: [
        {
          conversation: { id: 'a', key: 'thread:new', sourceId: 'local', provider: 'Codex', title: 'A', archived: false },
          messages: [],
          errors: [],
        },
        {
          conversation: { id: 'b', key: 'thread:known', sourceId: 'local', provider: 'Codex', title: 'B', archived: false },
          messages: [],
          errors: [],
        },
        {
          conversation: { id: 'c', key: 'thread:new', sourceId: 'backup', provider: 'Codex', title: 'C', archived: false },
          messages: [],
          errors: [],
        },
        {
          conversation: { id: 'd', key: 'thread:error', sourceId: 'backup', provider: 'Codex', title: 'D', archived: false },
          messages: [],
          errors: [{ line: 1, message: 'Invalid JSON' }],
        },
      ],
    })

    expect(preview.stats).toEqual({ newCount: 1, duplicateCount: 1, conflictCount: 1, failedCount: 1 })
  })
})

describe('dashboard stats and rollback', () => {
  it('summarizes sources, conversations, projects, archived conversations, tokens, and model providers', () => {
    const stats = buildDashboardStats({
      sources: [
        { id: 'local', label: 'Local Codex', path: 'C:/Users/me/.codex', provider: 'Codex' },
        { id: 'backup', label: 'Backup Codex', path: 'D:/backup/.codex', provider: 'Codex' },
      ],
      conversations: [
        { id: '1', key: 'thread:1', sourceId: 'local', provider: 'Codex', title: 'One', cwd: 'C:/repo/a', modelProvider: 'openai', tokensUsed: 100, archived: false },
        { id: '2', key: 'thread:2', sourceId: 'backup', provider: 'Codex', title: 'Two', cwd: 'C:/repo/a', modelProvider: 'openai', tokensUsed: 50, archived: true },
        { id: '3', key: 'thread:3', sourceId: 'backup', provider: 'Codex', title: 'Three', cwd: 'C:/repo/b', modelProvider: 'anthropic', tokensUsed: 25, archived: false },
      ],
    })

    expect(stats).toEqual({
      sourceCount: 2,
      conversationCount: 3,
      projectCount: 2,
      archivedCount: 1,
      tokenTotal: 175,
      modelProviders: [
        { name: 'openai', count: 2 },
        { name: 'anthropic', count: 1 },
      ],
    })
  })

  it('removes conversations and messages belonging to a rolled back import run', () => {
    const result = rollbackImportedRun({
      runId: 'run-1',
      conversations: [
        { id: '1', importRunId: 'run-1', key: 'thread:1', sourceId: 'local', provider: 'Codex', title: 'One', archived: false },
        { id: '2', importRunId: 'run-2', key: 'thread:2', sourceId: 'local', provider: 'Codex', title: 'Two', archived: false },
      ],
      messages: [
        { id: 'm1', conversationId: '1', role: 'user', content: 'remove me' },
        { id: 'm2', conversationId: '2', role: 'user', content: 'keep me' },
      ],
    })

    expect(result.conversations.map((item) => item.id)).toEqual(['2'])
    expect(result.messages.map((item) => item.id)).toEqual(['m2'])
  })
})
