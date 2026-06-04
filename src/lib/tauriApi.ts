import { invoke } from '@tauri-apps/api/core'

export const commandNames = [
  'scan_sources',
  'preview_import',
  'run_import',
  'list_import_runs',
  'rollback_import',
  'search_conversations',
  'get_conversation',
  'list_provider_workspace',
  'create_provider',
  'rename_provider',
  'merge_providers',
  'writeback_to_codex',
  'rollback_provider_operation',
] as const

export type TauriCommandName = (typeof commandNames)[number]

export function assertTauriRuntime() {
  if (!('__TAURI_INTERNALS__' in window)) {
    throw new Error('Tauri runtime is not available')
  }
}

export function isTauriRuntime() {
  return '__TAURI_INTERNALS__' in window
}

export async function callTauri<T>(command: TauriCommandName, args?: Record<string, unknown>): Promise<T> {
  assertTauriRuntime()
  return invoke<T>(command, args)
}

export function scanSources(paths: string[]) {
  return callTauri('scan_sources', { paths })
}

export function previewImport(sourceIds: string[]) {
  return callTauri('preview_import', { sourceIds })
}

export function runImport(planId: string) {
  return callTauri('run_import', { planId })
}

export function listImportRuns() {
  return callTauri('list_import_runs')
}

export function rollbackImport(runId: string) {
  return callTauri('rollback_import', { runId })
}

export function searchConversations(query: Record<string, unknown>) {
  return callTauri('search_conversations', { query })
}

export function getConversation(id: string) {
  return callTauri('get_conversation', { id })
}

export function listProviderWorkspace() {
  return callTauri('list_provider_workspace')
}

export function createProvider(provider: string, name: string) {
  return callTauri('create_provider', { provider, name })
}

export function renameProvider(providerId: string, provider?: string, name?: string) {
  return callTauri('rename_provider', { providerId, provider, name })
}

export function mergeProviders(targetProviderId: string, sourceProviderIds: string[], writebackToCodex = false) {
  return callTauri('merge_providers', { targetProviderId, sourceProviderIds, writebackToCodex })
}

export function writebackToCodex(providerId: string) {
  return callTauri('writeback_to_codex', { providerId })
}

export function rollbackProviderOperation(operationId: string) {
  return callTauri('rollback_provider_operation', { operationId })
}
