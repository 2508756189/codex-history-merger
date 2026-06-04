import type { RepairStep, RepairStepId } from '../../lib/repairWizard'

export function WizardStepper(props: { steps: RepairStep[]; activeStepId: RepairStepId }) {
  const activeIndex = props.steps.findIndex((step) => step.id === props.activeStepId)

  return (
    <ol className="wizard-stepper" aria-label="修复流程">
      {props.steps.map((step, index) => (
        <li
          aria-current={step.id === props.activeStepId ? 'step' : undefined}
          className={index <= activeIndex ? 'step-item active' : 'step-item'}
          key={step.id}
        >
          <span>{index + 1}</span>
          <strong>{step.label}</strong>
        </li>
      ))}
    </ol>
  )
}
