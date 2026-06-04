import { describe, expect, it } from 'vitest'
import {
  buildMockDiagnosis,
  buildMockRepairPlan,
  canExecutePlan,
  createInitialWizardState,
  repairRoutes,
  repairSteps,
  selectRoute,
} from './repairWizard'
import type { RepairRouteId, RiskLevel } from './repairWizard'

const routeExpectations: Record<RepairRouteId, RiskLevel> = {
  'hidden-history': 'requires-desktop-closed',
  'provider-migration': 'will-write',
  'project-sidebar': 'requires-desktop-closed',
  'backup-import': 'will-write',
}

describe('repair wizard model', () => {
  it('defines the four repair routes from the design spec', () => {
    expect(repairRoutes.map((route) => route.id)).toEqual([
      'hidden-history',
      'provider-migration',
      'project-sidebar',
      'backup-import',
    ])
  })

  it('defines the shared six-step workflow', () => {
    expect(repairSteps.map((step) => step.id)).toEqual([
      'diagnosis',
      'cause',
      'plan',
      'backup',
      'execute',
      'verify',
    ])
  })

  it('starts in read-only diagnosis state', () => {
    const state = createInitialWizardState()

    expect(state.activeRouteId).toBe('hidden-history')
    expect(state.activeStepId).toBe('diagnosis')
    expect(state.riskLevel).toBe('read-only')
    expect(state.diagnosis).toBeNull()
    expect(state.plan).toBeNull()
    expect(state.run).toBeNull()
  })

  it('resets diagnosis, plan, and run when switching routes', () => {
    const initial = createInitialWizardState()
    const state = selectRoute(
      {
        ...initial,
        activeStepId: 'plan',
        riskLevel: 'will-write',
        diagnosis: {
          routeId: 'hidden-history',
          status: 'issues-found',
          summary: 'Found hidden threads',
          evidence: [],
          affectedItems: [],
          warnings: [],
          nextActions: [],
        },
        plan: {
          id: 'plan-1',
          routeId: 'hidden-history',
          summary: 'Repair hidden threads',
          readSet: [],
          writeSet: [],
          backupSet: [],
          preconditions: [],
          verificationItems: [],
          riskLevel: 'will-write',
        },
        run: {
          id: 'run-1',
          planId: 'plan-1',
          status: 'completed',
          backupLocation: 'repairs/run-1',
          events: [],
          changedFiles: [],
          verificationResults: [],
          rollbackStatus: 'available',
        },
      },
      'backup-import',
    )

    expect(state.activeRouteId).toBe('backup-import')
    expect(state.activeStepId).toBe('diagnosis')
    expect(state.riskLevel).toBe('read-only')
    expect(state.diagnosis).toBeNull()
    expect(state.plan).toBeNull()
    expect(state.run).toBeNull()
  })
})

describe('mock repair route actions', () => {
  it('builds matching diagnosis and repair plan details for every route', () => {
    expect(repairRoutes.map((route) => route.id).sort()).toEqual(Object.keys(routeExpectations).sort())

    for (const route of repairRoutes) {
      const diagnosis = buildMockDiagnosis(route.id)
      const plan = buildMockRepairPlan(diagnosis)

      expect(diagnosis.routeId).toBe(route.id)
      expect(diagnosis.evidence.length).toBeGreaterThan(0)
      expect(diagnosis.affectedItems.length).toBeGreaterThan(0)
      expect(diagnosis.warnings.length).toBeGreaterThan(0)
      expect(diagnosis.nextActions.length).toBeGreaterThan(0)

      expect(plan.routeId).toBe(route.id)
      expect(plan.riskLevel).toBe(routeExpectations[route.id])
      expect(plan.readSet.length).toBeGreaterThan(0)
      expect(plan.writeSet.length).toBeGreaterThan(0)
      expect(plan.backupSet.length).toBeGreaterThan(0)
      expect(plan.preconditions.length).toBeGreaterThan(0)
      expect(plan.verificationItems.length).toBeGreaterThan(0)
    }
  })

  it('rejects unhandled runtime route ids instead of using backup-import details', () => {
    const routeId = 'future-route' as RepairRouteId

    expect(() => buildMockDiagnosis(routeId)).toThrow('Unhandled repair route: future-route')
  })

  it('builds hidden-history diagnosis evidence from the skill model', () => {
    const diagnosis = buildMockDiagnosis('hidden-history')

    expect(diagnosis.status).toBe('issues-found')
    expect(diagnosis.summary).toContain('项目过滤')
    expect(diagnosis.evidence.map((item) => item.label)).toEqual([
      'SQLite 线程',
      'Rollout 元数据',
      '全局状态',
    ])
    expect(diagnosis.affectedItems).toHaveLength(3)
  })

  it('builds a provider migration plan with database and rollout writes', () => {
    const diagnosis = buildMockDiagnosis('provider-migration')
    const plan = buildMockRepairPlan(diagnosis)

    expect(plan.routeId).toBe('provider-migration')
    expect(plan.riskLevel).toBe('will-write')
    expect(plan.readSet).toContain('state_5.sqlite')
    expect(plan.writeSet).toContain('state_5.sqlite threads.model_provider')
    expect(plan.writeSet).toContain('sessions/**/rollout-*.jsonl 首行 session_meta')
    expect(plan.verificationItems).toContain('数据库 Provider 数量与 rollout 元数据一致')
  })

  it('requires Codex Desktop to be closed for project sidebar repair plans', () => {
    const diagnosis = buildMockDiagnosis('project-sidebar')
    const plan = buildMockRepairPlan(diagnosis)

    expect(plan.riskLevel).toBe('requires-desktop-closed')
    expect(plan.preconditions).toContain('写入 .codex-global-state.json 前请关闭 Codex Desktop')
    expect(canExecutePlan(plan, { codexDesktopClosed: false })).toBe(false)
    expect(canExecutePlan(plan, { codexDesktopClosed: true })).toBe(true)
  })
})
