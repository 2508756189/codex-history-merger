import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Codex History Repair Wizard app', () => {
  it('shows the four repair routes on the first screen', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Codex 历史修复向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /隐藏历史/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Provider 迁移/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /缺失项目侧栏/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /备份历史导入/ })).toBeInTheDocument()
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
  })

  it('switches routes and resets to diagnosis state', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /备份历史导入/ }))

    expect(screen.getByRole('heading', { name: '备份历史导入' })).toBeInTheDocument()
    expect(screen.getByText('外部 .codex 路径')).toBeInTheDocument()
    expect(screen.getByText('诊断').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('只读')).toBeInTheDocument()
  })

  it('runs read-only diagnosis and then shows a repair plan preview', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /运行诊断/ }))
    expect(screen.getByText(/发现 3 个可能被项目过滤隐藏的线程/)).toBeInTheDocument()
    expect(screen.getByText('SQLite 线程')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /生成计划/ }))
    expect(screen.getByText(/修复工作区提示/)).toBeInTheDocument()
    expect(screen.getAllByText('.codex-global-state.json projectless-thread-ids').length).toBeGreaterThan(0)
    expect(screen.getByText('需要关闭 Codex Desktop')).toBeInTheDocument()
  })

  it('keeps execution disabled when Codex Desktop must be closed', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /运行诊断/ }))
    await user.click(screen.getByRole('button', { name: /生成计划/ }))

    expect(screen.getByRole('button', { name: /确认备份并执行/ })).toBeDisabled()
    expect(screen.getByText('写入 .codex-global-state.json 前请关闭 Codex Desktop')).toBeInTheDocument()
  })

  it('allows backup import execution preview because it writes only the local merge database in phase one', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /备份历史导入/ }))
    await user.click(screen.getByRole('button', { name: /运行诊断/ }))
    await user.click(screen.getByRole('button', { name: /生成计划/ }))

    const executeButton = screen.getByRole('button', { name: /确认备份并执行/ })
    expect(executeButton).toBeEnabled()
    await user.click(executeButton)
    expect(screen.getByText('已验证：导入运行具备回滚快照')).toBeInTheDocument()
    expect(screen.getByText('上一次运行可回滚。')).toBeInTheDocument()
  })
})
