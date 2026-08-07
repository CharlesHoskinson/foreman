# 站点抓取模式经验库

每次成功抓取新类型站点后，Agent 应提示用户是否将**去敏感化后的通用经验**追加到此文件。

> 公司内站点、私有 API、登录态细节、CSRF header、真实 cookie 字段或不可公开域名，请写入本地未提交的 `site-patterns.local.md`，不要提交到公共仓库。

---

## Discourse 论坛 (linux.do, meta.discourse.org 等)

**站点特征**: Cloudflare 保护 + Ember.js SPA + 登录态区分
**推荐 Fetcher**: StealthyFetcher
**关键参数**:
- `solve_cloudflare=True` — 必须
- `network_idle=True` — 等待 Ember 渲染完成
- `timeout=60000` — CF 验证耗时长，至少 60 秒（毫秒单位）
**登录 cookie 字段**: `_forum_session`, `_t`
**不需要**: `cf_clearance`（StealthyFetcher 自动获取）
**JSON API**: `/t/topic/{id}.json`（需过 CF 后才可用）
**选择器参考**:
- 帖子列表: `.topic-post`
- 作者: `[data-user-card]::attr(data-user-card)`
- 内容: `.cooked` → `.get_all_text(strip=True)`

---

## 静态博客/文档站 (GitHub Pages, Hugo, Jekyll)

**站点特征**: 纯静态 HTML，无 JS 渲染依赖，无反爬
**推荐 Fetcher**: Fetcher（最快）
**关键参数**: `impersonate='chrome'`, `timeout=30`
**选择器参考**: `article`, `.content`, `.post-body`

---

## SPA 应用 (React/Vue/Next.js)

**站点特征**: JS 渲染，内容不在初始 HTML 中
**推荐 Fetcher**: DynamicFetcher
**关键参数**:
- `network_idle=True` — 等待 API 请求完成
- `wait_selector='.content-loaded'` — 等待关键元素（按实际调整）
- `disable_resources=True` — 跳过字体/图片加速
**备注**: 优先检查是否有 API 端点可直接用 Fetcher 请求（更快更稳定）

---

## API 端点 (REST/GraphQL)

**站点特征**: 返回 JSON，无需解析 HTML
**推荐 Fetcher**: Fetcher
**关键参数**: `impersonate='chrome'`, 自定义 `headers`
**处理方式**: `page.text` 获取 JSON → `json.loads()` 解析
**备注**: 如果 API 有反爬，可能需要带 Referer/Origin 等 header

---

## 企业 React SPA + CSRF + 懒加载工作台（泛化模式）

**站点特征**: React SPA + 企业登录态 + 分页懒加载（例如“展开更多”按钮）
**推荐方案**: Playwright 直接控制（非 scrapling Fetcher）
**原因**: DynamicFetcher 可渲染首屏但无法点击交互；直接调 API 可能因浏览器环境、CSRF 或 interceptor 校验返回空响应 / 500
**关键流程**:
1. Playwright + cookies 加载页面，`wait_until='networkidle'`
2. 循环点击"展开更多"按钮加载全部数据
3. `page.inner_text('body')` 提取纯文本，按行解析
**Cookie 格式**: `list[dict]`，必填 `name/value/domain/path`
**CSRF**: 如果站点要求 cookie 中的 CSRF token 同步到 header，优先让真实浏览器 / 页面 interceptor 自动添加
**已知限制**: 这类站点常需要用户授权、登录态和本地 site pattern；具体域名、API endpoint、cookie 字段写入 `site-patterns.local.md`
**数据结构**: 常见为文本按行排列，类型前缀 → 标题 → 状态 → 优先级 → ...

---

## Microsoft Learn 文档站 (learn.microsoft.com)

**站点特征**: 服务端渲染的技术文档，无反爬，内容在初始 HTML 中
**推荐方案**: CLI quick path `scrapling extract get URL out.md --ai-targeted`（无需 StealthyFetcher）
**备注**: 页面含大量导航/页脚噪音（"This browser is no longer supported"、Ask Learn 侧栏等），但正文表格/代码块保留完整，--ai-targeted 输出可直接用。URL 重定向常见（如 `/wsl2-faq` → `/faq`），留意实际落地 URL 作为引用来源。

---

## arXiv 摘要页 (arxiv.org/abs/*)

**站点特征**: 服务端渲染的公开学术元数据页，无登录或 JavaScript 依赖。
**推荐方案**: CLI quick path `scrapling extract get URL out.md --ai-targeted`。
**可可靠提取**: 标题、作者、摘要、学科、arXiv/DOI 标识、精确提交版本和 UTC 时间、PDF/HTML/TeX 链接。
**备注**: `--ai-targeted` 仍会保留部分导航和第三方工具链接；下游应按标题至 submission-history 区间限域。论文正文应从公开 `/pdf/<id>vN` 版本另行下载并记录 SHA-256，不要把摘要页当作定理陈述的最终证据。

---

## GitHub Issue/PR 正文 vs 评论（重要区分）

**站点特征**: Issue/PR 详情页由 React 前端渲染；纯 HTTP 抓取（Fetcher/scrapling CLI）只能拿到 **issue 描述本体**（服务端渲染），**评论列表不会出现**（客户端异步加载，且长线程会分页/懒加载）
**推荐方案**: 若只需 issue 正文/元数据（labels/state/closedAt）→ scrapling CLI 足够；若需要**评论内容**（尤其是长期 tracking thread，例如年代跨度大的 bug 讨论）→ 改用 `gh` CLI（`gh issue view <N> --repo <owner>/<repo> --comments`，或 `gh api repos/<owner>/<repo>/issues/<N>/comments --paginate` 取结构化 JSON 含时间戳）
**踩坑经验**: 曾对 microsoft/WSL 的长期 issue（数年、上百评论）用 scrapling 抓取，结果只拿到 issue 描述和 metadata 骨架，完全遗漏了数百条评论和关键的"已修复/关闭"更新——必须用 `gh` 才能拿到真实讨论历史和时间线
**备注**: `gh` 对 GitHub 是比通用网页抓取更可靠、更结构化的入口，公开仓库无需鉴权

---

## GitHub Raw 源码端点 (raw.githubusercontent.com)

**站点特征**: 公开静态源码，无登录、JavaScript 或反爬要求。
**推荐 Fetcher**: CLI quick path `scrapling extract get`。
**关键陷阱**: 对 C/C++ 等包含尖括号 include 或模板语法的源码，`.txt` 输出和
`--ai-targeted` 可能把源码误当 HTML 清洗并截断。
**保真方案**: 将输出文件扩展名设为 `.html` 以保存原始响应字节，不使用
`--ai-targeted`；随后用 `rg` 或其他窄范围本地抽取，只把必要声明和代码段交给模型。
**备注**: Markdown、MediaWiki 等普通文本仍可优先使用 `.md`/`.txt` 与
`--ai-targeted`。此模式只用于公开源码，不涉及 cookie。

---

## 模板：添加新站点模式

复制以下模板，替换具体内容后追加到此文件：

```markdown
## 站点名称/类型 (代表域名)

**站点特征**: 描述
**推荐 Fetcher**: Fetcher / StealthyFetcher / DynamicFetcher
**关键参数**:
- `参数名=值` — 说明
**选择器参考**: CSS 选择器示例
**备注**: 踩坑经验
```
