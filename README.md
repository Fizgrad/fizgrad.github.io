# fizgrad.github.io

David 的个人主页,托管在 GitHub Pages:https://fizgrad.github.io

## 简介

深色极简科技风的个人主页,展示个人信息、GitHub Pages 在线项目与其他开源仓库。

- Hero 区:头像、姓名、打字机标语、社交链接(GitHub / Email / B站)
- GitHub Pages 项目区:可直接访问的在线 Demo 卡片
- 更多仓库区:其他开源项目,链接到 GitHub
- 中英双语切换,自动记忆语言偏好
- Systems Lab：系统编程练习、DeepSeek 静态评审与 Linux 本地测试
- 博客按主题文件夹浏览，主题内支持文章列表、搜索和分页
- 粒子连线背景、卡片悬浮渐变描边、滚动渐入动画
- 响应式布局,支持 `prefers-reduced-motion`

## 技术栈

纯原生 HTML / CSS / JavaScript,无构建工具、无依赖。

## 项目结构

```
index.html              页面主结构
assets/css/style.css    样式
assets/js/main.js       i18n 字典、项目数据、卡片渲染、动画背景
assets/js/blog-catalog.js  博客主题定义与共用导航逻辑
assets/js/blog-list.js   文章列表、主题切换、搜索与分页
blog/index.html         主题文章列表
blog/posts.json         文章元数据与 category 分类
blog/<slug>.md          中文博客正文
blog/<slug>.en.md       对应英文正文
tools/translate-blog.mjs  博客翻译、断点续跑与结构校验
systems-lab.html        系统编程练习与 AI 评审页面
tools/systems-lab/      题目契约、本地 runner、测试与参考实现
```

## 本地预览

```bash
python3 -m http.server 8000
# 访问 http://127.0.0.1:8000
```

## 部署

推送到 `main` 分支后,GitHub Pages 自动构建发布。

## 博客双语正文

博客语言按钮会在 `blog/<slug>.md` 和 `blog/<slug>.en.md` 之间切换。英文文件缺失时页面会明确提示并回退到中文，不会把 API Key 发送到浏览器。

在本地生成英文稿：

```bash
export DEEPSEEK_API_KEY='...'
node tools/translate-blog.mjs --dry-run
node tools/translate-blog.mjs
node tools/translate-blog.mjs --check
```

也可以通过 `DEEPSEEK_API_KEY_FILE` 指向一个仓库外、权限为 `0600` 的密钥文件，避免把密钥写进 Shell 历史。

翻译工具会保护普通代码块、公式、行内代码和链接目标，保留 Mermaid 结构并翻译其中的可读标签。中间结果保存在已忽略的 `tools/.translation-cache/`，失败后可以断点续跑。单篇更新可以使用 `--slug <slug>`，源文变更后使用 `--force` 重新生成。

## 自定义

- 个人信息 / 社交链接:编辑 `index.html`
- 项目数据与描述(中英文):编辑 `assets/js/main.js` 中的 `pagesProjects` 与 `otherRepos`
- UI 文案翻译:编辑 `assets/js/main.js` 中的 `I18N` 字典
- 博客分类：在 `assets/js/blog-catalog.js` 中维护主题，在 `blog/posts.json` 中给文章设置 `category`。每篇文章只有一个主分类，未分类文章会自动进入“其他文章”，不会从列表丢失。

分类与导航检查：`node tools/check-blog-catalog.mjs`。本机安装 Chrome 后可加 `--browser`，验证页面导航、双语、搜索、分页和手机布局。
