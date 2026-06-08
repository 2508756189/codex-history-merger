import { FileSearch, Play, Wrench } from 'lucide-react'
import type { DiagnosisResult, RepairPlan, RepairRoute, RepairRun, WizardPrimaryAction } from '../../lib/repairWizard'

export function RepairWorkspace(props: {
  route: RepairRoute
  inputValue: string
  onInputChange: (value: string) => void
  codexDesktopClosed: boolean
  onCodexDesktopClosedChange: (closed: boolean) => void
  diagnosis: DiagnosisResult | null
  plan: RepairPlan | null
  run: RepairRun | null
  primaryAction: WizardPrimaryAction
  onPrimaryAction: () => void
}) {
  const ActionIcon = !props.diagnosis ? FileSearch : !props.plan ? Wrench : Play
  const needsDesktopClosed = props.plan?.riskLevel === 'requires-desktop-closed'

  return (
    <section className="repair-workspace">
      <div className="preview-banner" role="status">
        {props.primaryAction.previewNotice}
      </div>

      <section className="primary-action-panel" aria-label="下一步操作">
        <div className="route-context">
          <p className="eyebrow">当前任务</p>
          <h2>{props.route.title}</h2>
          <p>{props.route.description}</p>
          <label className="route-input-field">
            <span>{props.route.primaryInputLabel}</span>
            <input
              type="text"
              value={props.inputValue}
              placeholder={props.route.inputPlaceholder}
              onChange={(event) => props.onInputChange(event.target.value)}
            />
          </label>
        </div>
        <div className="primary-action-controls">
          {needsDesktopClosed && (
            <label className="desktop-closed-toggle">
              <input
                type="checkbox"
                checked={props.codexDesktopClosed}
                onChange={(event) => props.onCodexDesktopClosedChange(event.target.checked)}
              />
              我已关闭 Codex Desktop
            </label>
          )}
          <button
            className={`primary-button primary-action-button action-${props.primaryAction.tone}`}
            type="button"
            onClick={props.onPrimaryAction}
            disabled={props.primaryAction.disabled}
          >
            <ActionIcon aria-hidden="true" />
            {props.primaryAction.label}
          </button>
          {props.primaryAction.disabledReason && <p className="blocked-reason">{props.primaryAction.disabledReason}</p>}
        </div>
      </section>

      <section className="workspace-section">
        <h3>诊断结果</h3>
        {props.diagnosis ? (
          <div className="result-block">
            <strong>{props.diagnosis.summary}</strong>
            <ul>
              {props.diagnosis.evidence.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <p>{item.value}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="empty-state">先运行只读诊断，收集证据后再规划修复。</p>
        )}
      </section>

      <section className="workspace-section">
        <h3>修复计划</h3>
        {props.plan ? (
          <div className="result-block">
            <strong>{props.plan.summary}</strong>
            <ul>
              {props.plan.writeSet.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="empty-state">诊断后生成修复计划。计划可见前，写入操作保持禁用。</p>
        )}
      </section>

      {props.run && (
        <section className="workspace-section">
          <h3>验证</h3>
          <ul>
            {props.run.verificationResults.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
