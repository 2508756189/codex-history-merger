# Codex 历史修复向导

这是一个桌面工具，用于诊断和修复 Codex Desktop 历史记录可见性、Provider 元数据、项目侧栏状态以及备份历史导入问题。

## 当前范围

第一阶段实现的是修复向导：

- 隐藏历史诊断
- Provider 迁移计划
- 缺失项目侧栏计划
- 备份历史导入计划
- 带有读取范围、写入范围、备份状态和验证清单的安全面板

后端写入型修复会被有意放在修复计划之后。执行前，界面必须明确展示将读取什么、将写入什么，以及会备份什么。

## 开发

```powershell
npm install
npm run dev
npm test
npm run build
```

## 发布通道

- 开发版：推送到 `develop` 分支，GitHub Actions 会运行测试和前端构建。
- Release 版：从 `main` 分支打 `v0.1.0` 这类版本标签，GitHub Actions 会构建 Windows Tauri 安装包并创建 GitHub Release。

## 产品模型

应用遵循 `codex-desktop-history-repair` 技能模型：

```text
只读诊断 -> 原因分析 -> 修复计划 -> 备份预览 -> 确认执行 -> 验证
```

不要添加直接写入的界面操作。先添加诊断结果和修复计划，再通过共享向导状态控制执行。
