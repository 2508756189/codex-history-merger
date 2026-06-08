import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

describe('Codex History Repair Wizard app', () => {
  it('shows symptom-first repair routes and the primary preview diagnosis action', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Codex 历史修复向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /找回隐藏历史/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /修复 Provider 迁移/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /恢复项目侧栏/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /导入备份历史/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始预览诊断/ })).toBeInTheDocument()
  })

  it('shows the shared six-step workflow and read-only safety state before diagnosis', () => {
    render(<App />)

    const workflow = within(screen.getByRole('list', { name: '修复流程' }))
    for (const label of ['诊断', '原因', '计划', '备份', '执行', '验证']) {
      expect(workflow.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('风险等级')).toBeInTheDocument()
    expect(screen.getByText('只读')).toBeInTheDocument()
    expect(screen.getByText('确认修复计划前不会修改任何文件。')).toBeInTheDocument()
    expect(screen.getByText('修复详情将在生成预览计划后显示。')).toBeInTheDocument()
  })

  it('switches routes and resets to diagnosis state', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)

    await user.click(screen.getByRole('button', { name: /开始预览诊断/ }))
    await user.click(screen.getByRole('button', { name: /生成预览计划/ }))
    await user.click(screen.getByRole('button', { name: /导入备份历史/ }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '导入备份历史' })).toBeInTheDocument()
    expect(screen.getByText('外部 .codex 路径')).toBeInTheDocument()
    expect(screen.getByText('诊断').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('只读')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始预览诊断/ })).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('runs preview diagnosis and then shows a preview repair plan', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /开始预览诊断/ }))
    expect(screen.getByRole('button', { name: /生成预览计划/ })).toBeInTheDocument()
    expect(screen.getByText('当前为交互预览，未扫描真实 Codex 文件。')).toBeInTheDocument()
    expect(screen.getByText(/发现 3 个可能被项目过滤隐藏的线程/)).toBeInTheDocument()
    expect(screen.getByText('SQLite 线程')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /生成预览计划/ }))
    expect(screen.getByText(/修复工作区提示/)).toBeInTheDocument()
    expect(screen.getAllByText('.codex-global-state.json projectless-thread-ids').length).toBeGreaterThan(0)
    expect(screen.getByText('需要关闭 Codex Desktop')).toBeInTheDocument()
  })

  it('keeps preview execution disabled with an inline reason when Codex Desktop must be closed', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /开始预览诊断/ }))
    await user.click(screen.getByRole('button', { name: /生成预览计划/ }))

    expect(screen.getByRole('button', { name: /运行预览执行/ })).toBeDisabled()
    expect(screen.getByText('需要先关闭 Codex Desktop')).toBeInTheDocument()
  })

  it('allows backup import execution preview because it writes only the local merge database in phase one', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /导入备份历史/ }))
    await user.click(screen.getByRole('button', { name: /开始预览诊断/ }))
    await user.click(screen.getByRole('button', { name: /生成预览计划/ }))

    const executeButton = screen.getByRole('button', { name: /运行预览执行/ })
    expect(executeButton).toBeEnabled()
    await user.click(executeButton)
    expect(screen.getByText('已验证：导入运行具备回滚快照')).toBeInTheDocument()
    expect(screen.getByText('上一次运行可回滚。')).toBeInTheDocument()
  })
})
