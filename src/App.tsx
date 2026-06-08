import { useMemo, useState } from 'react'
import './App.css'
import { RepairWorkspace } from './components/repair/RepairWorkspace'
import { RouteSelector } from './components/repair/RouteSelector'
import { SafetyPanel } from './components/repair/SafetyPanel'
import { WizardStepper } from './components/repair/WizardStepper'
import {
  buildMockDiagnosis,
  buildMockRepairPlan,
  canExecutePlan,
  createInitialWizardState,
  getWizardPrimaryAction,
  repairRoutes,
  repairSteps,
  selectRoute,
  type RepairRouteId,
} from './lib/repairWizard'

function App() {
  const [state, setState] = useState(createInitialWizardState)
  const [codexDesktopClosed, setCodexDesktopClosed] = useState(false)
  const activeRoute = useMemo(
    () => repairRoutes.find((route) => route.id === state.activeRouteId) ?? repairRoutes[0],
    [state.activeRouteId],
  )
  const canExecute = canExecutePlan(state.plan, { codexDesktopClosed })
  const primaryAction = getWizardPrimaryAction(state, canExecute)

  function handleRouteSelect(routeId: RepairRouteId) {
    if (routeId === state.activeRouteId) return

    const hasProgress = Boolean(state.diagnosis || state.plan || state.run)
    if (hasProgress && !window.confirm('切换路线会清空当前诊断和计划进度，确认切换？')) {
      return
    }

    setCodexDesktopClosed(false)
    setState((current) => selectRoute(current, routeId))
  }

  function handleInputChange(value: string) {
    setState((current) => ({ ...current, inputValue: value }))
  }

  function handleDiagnose() {
    setState((current) => {
      const diagnosis = buildMockDiagnosis(current.activeRouteId)

      return {
        ...current,
        activeStepId: 'cause',
        riskLevel: 'read-only',
        diagnosis,
        plan: null,
        run: null,
      }
    })
  }

  function handlePlan() {
    setState((current) => {
      if (!current.diagnosis) return current

      const plan = buildMockRepairPlan(current.diagnosis)

      return {
        ...current,
        activeStepId: 'backup',
        riskLevel: plan.riskLevel,
        plan,
        run: null,
      }
    })
  }

  function handleExecute() {
    setState((current) => {
      if (!current.plan) return current

      const plan = current.plan

      return {
        ...current,
        activeStepId: 'verify',
        run: {
          id: 'run-preview',
          planId: plan.id,
          status: 'completed',
          backupLocation: 'repairs/run-preview',
          events: ['已创建备份快照', '已应用计划变更', '已运行验证检查'],
          changedFiles: plan.writeSet,
          verificationResults: plan.verificationItems.map((item) => `已验证：${item}`),
          rollbackStatus: 'available',
        },
      }
    })
  }

  function handlePrimaryAction() {
    if (!state.diagnosis) {
      handleDiagnose()
      return
    }

    if (!state.plan) {
      handlePlan()
      return
    }

    if (canExecute) {
      handleExecute()
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Codex Desktop 历史修复</p>
          <h1>Codex 历史修复向导</h1>
        </div>
      </header>

      <section className="wizard-layout">
        <RouteSelector routes={repairRoutes} activeRouteId={state.activeRouteId} onSelect={handleRouteSelect} />
        <div className="wizard-main">
          <WizardStepper steps={repairSteps} activeStepId={state.activeStepId} />
          <RepairWorkspace
            route={activeRoute}
            inputValue={state.inputValue}
            onInputChange={handleInputChange}
            codexDesktopClosed={codexDesktopClosed}
            onCodexDesktopClosedChange={setCodexDesktopClosed}
            diagnosis={state.diagnosis}
            plan={state.plan}
            run={state.run}
            primaryAction={primaryAction}
            onPrimaryAction={handlePrimaryAction}
          />
        </div>
        <SafetyPanel riskLevel={state.riskLevel} plan={state.plan} run={state.run} />
      </section>
    </main>
  )
}

export default App
