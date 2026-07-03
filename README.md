# fizgrad.github.io

David 的个人主页,托管在 GitHub Pages:https://fizgrad.github.io

## 简介

深色极简科技风的个人主页,展示个人信息、GitHub Pages 在线项目与其他开源仓库。

- Hero 区:头像、姓名、打字机标语、社交链接(GitHub / Email / B站)
- GitHub Pages 项目区:可直接访问的在线 Demo 卡片
- 更多仓库区:其他开源项目,链接到 GitHub
- 中英双语切换,自动记忆语言偏好
- 粒子连线背景、卡片悬浮渐变描边、滚动渐入动画
- 响应式布局,支持 `prefers-reduced-motion`

## 技术栈

纯原生 HTML / CSS / JavaScript,无构建工具、无依赖。

## 项目结构

```
index.html              页面主结构
assets/css/style.css    样式
assets/js/main.js       i18n 字典、项目数据、卡片渲染、动画背景
```

## 本地预览

```bash
python3 -m http.server 8000
# 访问 http://127.0.0.1:8000
```

## 部署

推送到 `main` 分支后,GitHub Pages 自动构建发布。

## 自定义

- 个人信息 / 社交链接:编辑 `index.html`
- 项目数据与描述(中英文):编辑 `assets/js/main.js` 中的 `pagesProjects` 与 `otherRepos`
- UI 文案翻译:编辑 `assets/js/main.js` 中的 `I18N` 字典
