import { FileSearch, Play, Wrench } from 'lucide-react'
import type { DiagnosisResult, RepairPlan, RepairRoute, RepairRun } from '../../lib/repairWizard'

export function RepairWorkspace(props: {
  route: RepairRoute
  diagnosis: DiagnosisResult | null
  plan: RepairPlan | null
  run: RepairRun | null
  canExecute: boolean
  onDiagnose: () => void
  onPlan: () => void
  onExecute: () => void
}) {
  return (
    <section className="repair-workspace">
      <header className="workspace-header">
        <div>
          <p>{props.route.primaryInputLabel}</p>
          <h2>{props.route.title}</h2>
        </div>
        <button className="secondary-button" type="button" onClick={props.onDiagnose}>
          <FileSearch aria-hidden="true" />
          运行诊断
        </button>
      </header>

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

      <footer className="workspace-actions">
        <button className="secondary-button" type="button" onClick={props.onPlan} disabled={!props.diagnosis}>
          <Wrench aria-hidden="true" />
          生成计划
        </button>
        <button className="primary-button" type="button" onClick={props.onExecute} disabled={!props.canExecute}>
          <Play aria-hidden="true" />
          确认备份并执行
        </button>
      </footer>

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
