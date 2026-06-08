export type RepairRouteId = 'hidden-history' | 'provider-migration' | 'project-sidebar' | 'backup-import'

export type RepairStepId = 'diagnosis' | 'cause' | 'plan' | 'backup' | 'execute' | 'verify'

export type RiskLevel = 'read-only' | 'will-write' | 'requires-desktop-closed'

export type DiagnosisStatus = 'not-run' | 'clean' | 'issues-found'

export type RepairRoute = {
  id: RepairRouteId
  title: string
  description: string
  primaryInputLabel: string
  inputPlaceholder: string
}

export type RepairStep = {
  id: RepairStepId
  label: string
}

export type DiagnosisEvidence = {
  label: string
  value: string
}

export type DiagnosisResult = {
  routeId: RepairRouteId
  status: Exclude<DiagnosisStatus, 'not-run'>
  summary: string
  evidence: DiagnosisEvidence[]
  affectedItems: string[]
  warnings: string[]
  nextActions: string[]
}

export type RepairPlan = {
  id: string
  routeId: RepairRouteId
  summary: string
  readSet: string[]
  writeSet: string[]
  backupSet: string[]
  preconditions: string[]
  verificationItems: string[]
  riskLevel: RiskLevel
}

export type RepairRun = {
  id: string
  planId: string
  status: 'not-started' | 'running' | 'completed' | 'failed'
  backupLocation: string
  events: string[]
  changedFiles: string[]
  verificationResults: string[]
  rollbackStatus: 'unavailable' | 'available' | 'completed'
}

export type RepairWizardState = {
  activeRouteId: RepairRouteId
  activeStepId: RepairStepId
  riskLevel: RiskLevel
  inputValue: string
  diagnosis: DiagnosisResult | null
  plan: RepairPlan | null
  run: RepairRun | null
}

export type WizardPrimaryAction = {
  label: string
  disabled: boolean
  disabledReason?: string
  tone: 'primary' | 'blocked' | 'complete'
  previewNotice: string
}

export const wizardPreviewNotice = '当前为交互预览，未扫描真实 Codex 文件。'

export const repairRoutes: RepairRoute[] = [
  {
    id: 'hidden-history',
    title: '找回隐藏历史',
    description: '历史线程还在磁盘上，但没有显示在 Codex Desktop。',
    primaryInputLabel: '线程标题或项目路径',
    inputPlaceholder: '例如：thread-deploy 或 C:/projects/parking-platform',
  },
  {
    id: 'provider-migration',
    title: '修复 Provider 迁移',
    description: '修正数据库和 rollout 元数据里的 Provider 分组不一致。',
    primaryInputLabel: '源 Provider key 和目标 Provider key',
    inputPlaceholder: '例如：openai -> custom',
  },
  {
    id: 'project-sidebar',
    title: '恢复项目侧栏',
    description: '项目配置存在，但没有出现在 Codex Desktop 侧栏。',
    primaryInputLabel: '项目根路径',
    inputPlaceholder: '例如：C:/projects/parking-platform',
  },
  {
    id: 'backup-import',
    title: '导入备份历史',
    description: '扫描外部 .codex 目录，去重后导入到本地合并库。',
    primaryInputLabel: '外部 .codex 路径',
    inputPlaceholder: '例如：D:/backup/work-laptop/.codex',
  },
]

export const repairSteps: RepairStep[] = [
  { id: 'diagnosis', label: '诊断' },
  { id: 'cause', label: '原因' },
  { id: 'plan', label: '计划' },
  { id: 'backup', label: '备份' },
  { id: 'execute', label: '执行' },
  { id: 'verify', label: '验证' },
]

export function createInitialWizardState(): RepairWizardState {
  return {
    activeRouteId: 'hidden-history',
    activeStepId: 'diagnosis',
    riskLevel: 'read-only',
    inputValue: '',
    diagnosis: null,
    plan: null,
    run: null,
  }
}

export function selectRoute(state: RepairWizardState, routeId: RepairRouteId): RepairWizardState {
  return {
    ...state,
    activeRouteId: routeId,
    activeStepId: 'diagnosis',
    riskLevel: 'read-only',
    inputValue: '',
    diagnosis: null,
    plan: null,
    run: null,
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled repair route: ${value}`)
}

export function buildMockDiagnosis(routeId: RepairRouteId): DiagnosisResult {
  switch (routeId) {
    case 'hidden-history':
      return {
        routeId,
        status: 'issues-found',
        summary: '发现 3 个可能被项目过滤隐藏的线程。',
        evidence: [
          { label: 'SQLite 线程', value: 'threads.cwd 指向所选项目根目录' },
          { label: 'Rollout 元数据', value: 'session_meta id 与已存储的线程 id 匹配' },
          { label: '全局状态', value: '线程 id 出现在 projectless-thread-ids 中' },
        ],
        affectedItems: ['thread-refund', 'thread-deploy', 'thread-essay'],
        warnings: ['确认计划后，此路线可能写入 .codex-global-state.json。'],
        nextActions: ['生成修复计划'],
      }

    case 'provider-migration':
      return {
        routeId,
        status: 'issues-found',
        summary: '发现 SQLite 与 rollout 元数据之间的 Provider 不一致。',
        evidence: [
          { label: 'SQLite Provider', value: 'openai：18 个线程' },
          { label: 'Rollout Provider', value: 'custom：18 个 rollout 文件' },
          { label: '配置标签', value: 'model_providers name 不会迁移历史' },
        ],
        affectedItems: ['openai -> custom'],
        warnings: ['Provider 迁移必须同时更新 SQLite 和 rollout 元数据。'],
        nextActions: ['生成 Provider 迁移计划'],
      }

    case 'project-sidebar':
      return {
        routeId,
        status: 'issues-found',
        summary: '项目已存在于配置中，但缺失于 Desktop 侧栏状态。',
        evidence: [
          { label: 'config.toml', value: '[projects] 已包含项目根目录' },
          { label: '已保存根目录', value: 'electron-saved-workspace-roots 缺少项目根目录' },
          { label: '项目排序', value: 'project-order 缺少项目根目录' },
        ],
        affectedItems: ['C:/projects/parking-platform'],
        warnings: ['写入全局状态前必须关闭 Codex Desktop。'],
        nextActions: ['生成项目侧栏修复计划'],
      }

    case 'backup-import':
      return {
        routeId,
        status: 'issues-found',
        summary: '外部 .codex 根目录去重后可以导入。',
        evidence: [
          { label: 'sessions', value: '42 个 rollout JSONL 文件' },
          { label: 'archived_sessions', value: '11 个已归档 rollout JSONL 文件' },
          { label: 'state_5.sqlite', value: '48 个已索引线程' },
        ],
        affectedItems: ['D:/backup/work-laptop/.codex'],
        warnings: ['导入前必须明确处理冲突。'],
        nextActions: ['生成导入计划'],
      }

    default:
      return assertNever(routeId)
  }
}

export function buildMockRepairPlan(diagnosis: DiagnosisResult): RepairPlan {
  switch (diagnosis.routeId) {
    case 'hidden-history':
      return {
        id: 'plan-hidden-history',
        routeId: diagnosis.routeId,
        summary: '修复工作区提示，并移除误标为无项目的线程 id。',
        readSet: ['state_5.sqlite', '.codex-global-state.json', 'sessions/**/rollout-*.jsonl'],
        writeSet: [
          '.codex-global-state.json projectless-thread-ids',
          '.codex-global-state.json thread-workspace-root-hints',
        ],
        backupSet: ['.codex-global-state.json'],
        preconditions: ['写入 .codex-global-state.json 前请关闭 Codex Desktop'],
        verificationItems: [
          '线程 id 不再出现在 projectless-thread-ids 中',
          '工作区提示指向项目根目录',
        ],
        riskLevel: 'requires-desktop-closed',
      }

    case 'provider-migration':
      return {
        id: 'plan-provider-migration',
        routeId: diagnosis.routeId,
        summary: '迁移 SQLite 与 rollout session 元数据中的 Provider key。',
        readSet: ['state_5.sqlite', 'sessions/**/rollout-*.jsonl'],
        writeSet: ['state_5.sqlite threads.model_provider', 'sessions/**/rollout-*.jsonl 首行 session_meta'],
        backupSet: ['state_5.sqlite', '受影响的 rollout JSONL 文件'],
        preconditions: ['核对源 Provider key 和目标 Provider key'],
        verificationItems: ['数据库 Provider 数量与 rollout 元数据一致', '受影响线程仍可被索引'],
        riskLevel: 'will-write',
      }

    case 'project-sidebar':
      return {
        id: 'plan-project-sidebar',
        routeId: diagnosis.routeId,
        summary: '将项目根目录加入已保存工作区根目录和项目排序。',
        readSet: ['config.toml', '.codex-global-state.json'],
        writeSet: [
          '.codex-global-state.json electron-saved-workspace-roots',
          '.codex-global-state.json project-order',
        ],
        backupSet: ['.codex-global-state.json'],
        preconditions: ['写入 .codex-global-state.json 前请关闭 Codex Desktop'],
        verificationItems: ['全局状态 JSON 可解析', '项目根目录出现在已保存根目录和项目排序中'],
        riskLevel: 'requires-desktop-closed',
      }

    case 'backup-import':
      return {
        id: 'plan-backup-import',
        routeId: diagnosis.routeId,
        summary: '去重后将外部 .codex 历史导入本地合并数据库。',
        readSet: [
          '外部 .codex state_5.sqlite',
          '外部 sessions/**/rollout-*.jsonl',
          '外部 archived_sessions/**/rollout-*.jsonl',
        ],
        writeSet: ['本地合并数据库'],
        backupSet: ['本地合并数据库'],
        preconditions: ['处理重复项和冲突分类'],
        verificationItems: [
          '新增、重复、冲突和失败数量均可解释',
          '导入运行具备回滚快照',
        ],
        riskLevel: 'will-write',
      }

    default:
      return assertNever(diagnosis.routeId)
  }
}

export function canExecutePlan(plan: RepairPlan | null, environment: { codexDesktopClosed: boolean }): boolean {
  if (!plan) return false
  if (plan.riskLevel === 'requires-desktop-closed' && !environment.codexDesktopClosed) return false
  return true
}

export function getWizardPrimaryAction(state: RepairWizardState, canExecute: boolean): WizardPrimaryAction {
  if (state.run) {
    return {
      label: '预览执行已完成',
      disabled: true,
      tone: 'complete',
      previewNotice: wizardPreviewNotice,
    }
  }

  if (!state.diagnosis) {
    return {
      label: '开始预览诊断',
      disabled: false,
      tone: 'primary',
      previewNotice: wizardPreviewNotice,
    }
  }

  if (!state.plan) {
    return {
      label: '生成预览计划',
      disabled: false,
      tone: 'primary',
      previewNotice: wizardPreviewNotice,
    }
  }

  const disabledReason =
    state.plan.riskLevel === 'requires-desktop-closed' && !canExecute ? '需要先关闭 Codex Desktop' : undefined

  return {
    label: '运行预览执行',
    disabled: !canExecute,
    disabledReason,
    tone: disabledReason ? 'blocked' : 'primary',
    previewNotice: wizardPreviewNotice,
  }
}
