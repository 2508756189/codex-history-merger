import { describe, expect, it } from 'vitest'
import { assertTauriRuntime, commandNames } from './tauriApi'

describe('tauriApi', () => {
  it('documents the command surface used by the desktop shell', () => {
    expect(commandNames).toEqual([
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
    ])
  })

  it('rejects command calls outside the Tauri runtime', () => {
    expect(() => assertTauriRuntime()).toThrow('Tauri runtime is not available')
  })
})
