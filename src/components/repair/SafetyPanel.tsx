import { ShieldCheck, TriangleAlert, Undo2 } from 'lucide-react'
import type { RepairPlan, RepairRun, RiskLevel } from '../../lib/repairWizard'

const riskLabels: Record<RiskLevel, string> = {
  'read-only': '只读',
  'will-write': '将写入文件',
  'requires-desktop-closed': '需要关闭 Codex Desktop',
}

const rollbackMessages: Record<NonNullable<RepairRun['rollbackStatus']>, string> = {
  unavailable: '修复运行完成前不可回滚。',
  available: '上一次运行可回滚。',
  completed: '上一次运行已完成回滚。',
}

export function SafetyPanel(props: { riskLevel: RiskLevel; plan: RepairPlan | null; run: RepairRun | null }) {
  const plan = props.plan
  const rollbackMessage = props.run ? rollbackMessages[props.run.rollbackStatus] : rollbackMessages.unavailable

  return (
    <aside className="safety-panel" aria-label="安全状态">
      <section>
        <h2>
          <ShieldCheck aria-hidden="true" />
          安全
        </h2>
        <div className={`risk-pill risk-${props.riskLevel}`}>
          <TriangleAlert aria-hidden="true" />
          <span>风险等级</span>
          <span>{riskLabels[props.riskLevel]}</span>
        </div>
        {!plan && (
          <>
            <p>确认修复计划前不会修改任何文件。</p>
            <p>修复详情将在生成预览计划后显示。</p>
          </>
        )}
      </section>

      {plan && (
        <>
          <SafetyList title="读取范围" items={plan.readSet} />
          <SafetyList title="写入范围" items={plan.writeSet} />
          <SafetyList title="备份" items={plan.backupSet} />
          <SafetyList title="执行前置条件" items={plan.preconditions} />
          <SafetyList title="验证" items={plan.verificationItems} />

          <section>
            <h3>
              <Undo2 aria-hidden="true" />
              回滚
            </h3>
            <p>{rollbackMessage}</p>
          </section>
        </>
      )}
    </aside>
  )
}

function SafetyList(props: { title: string; items: string[] }) {
  return (
    <section>
      <h3>{props.title}</h3>
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}
