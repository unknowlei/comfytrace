# ComfyTrace · 离线工作流诊断台

**在消耗显卡时间之前，看清 ComfyUI 工作流的结构、依赖和版本变化。**

[在线体验](https://unknowlei.github.io/comfytrace/) · [下载便携版](https://github.com/unknowlei/comfytrace/releases/latest) · [持续集成](https://github.com/unknowlei/comfytrace/actions/workflows/ci.yml)

[English](README.md) · [架构与规范](docs/ARCHITECTURE.md) · [简历与面试材料](docs/PORTFOLIO.zh-CN.md)

![ComfyTrace 工作台](docs/screenshot.png)

## 直接使用

双击便携包里的 **`ComfyTrace.html`**。无需安装运行环境、启动服务器或配置账号。
界面自带原创示例，可直接体验完整流程。

1. 导入工作流 JSON、API prompt JSON，或带工作流元数据的原始 PNG。
2. 通过拓扑图和搜索定位节点，查看实际参数及连接关系。
3. 在诊断中查断线、环、端口不一致等结构问题，点击问题定位相关节点。
4. 查看模型与节点依赖；可导入 `/object_info` JSON 快照核对节点可用性。
5. 导入另一版工作流，查看参数、模式、节点和接线差异；画布移动不干扰结果。
6. 导出 Markdown 诊断报告或 JSON 依赖清单。

## 技术内容

- **多格式归一化**：兼容 UI 0.4、UI 1.0、API prompt 与 `{ prompt: ... }` 请求包装。
- **图静态分析**：独立 TypeScript 核心，可由浏览器和 CLI 共同调用。
- **防御性 PNG 解析**：长度检查、CRC、解压预算，支持多种文本元数据块。
- **语义差异**：基于稳定节点 ID 比较参数、类型、模式、接线与 `properties`，
  保留修改前后证据；`properties` 保守包含包元数据与未知配置。
- **离线交付**：单 HTML 内联脚本和样式；无远程字体、遥测或文件上传。
- **质量工程**：单元测试、真实浏览器测试、无障碍检查、CI 和回归用例。

## 从源码启动

Node.js 22.12+：

```powershell
$ErrorActionPreference = 'Stop'
npm ci
npm run dev
```

`npm run build` 构建 `dist/index.html`，可以直接用浏览器打开。
`npm run package` 整理便携文件、使用说明、许可证和 SHA-256 校验摘要。

CLI 用法：

```powershell
$ErrorActionPreference = 'Stop'
npm run inspect -- examples/platform-workflow.json --compare examples/platform-revision.json --format json
```

批处理读取纯 JSON 输出时，可使用 `npx tsx src/cli.ts <文件> --format json`。
CLI 返回码：0 为低于诊断阈值，1 为触发阈值，2 为输入错误或格式不可比较。

## 使用边界

- 库存只说明节点类型是否出现在提供的 `/object_info` 快照中；模型可用性始终
  待核对。模型引用来自已知加载器字段和显式模型元数据，不推测任意自定义
  加载器的依赖。已知前端辅助节点不要求出现在后端库存中。
- 子图实例保留为外层连接端点；内部节点、连线和依赖不展开，也不参与差异
  比较。悬浮连接不纳入分析，并给出覆盖范围提示。
- 诊断针对存储的原始连接图，不重写静音或旁路接线。输出节点识别限于已知
  类型和库存证据；自定义节点动态行为、模型兼容性与显存需求需运行时验证。
- 对比要求相同格式和稳定节点 ID；重编号视为删除与新增。`properties` 的
  元数据变化也可能被报告；零差异不保证生成结果相同。
- JSON 文件最多 8 MiB，PNG 最多 50 MiB，展开后的元数据最多 8 MiB；
  外层图最多 2,000 个节点（含子图实例）和 10,000 条连接。

文件仅在浏览器中处理，关闭页面后不保留。导出报告可能包含提示词、模型名、
本地路径等内容，分享前应自行检查。

示例模型名是虚构占位符，示例 PNG 是带元数据的程序生成色块。
本项目独立开发，采用 MIT 许可证。
