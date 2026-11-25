# 部署到 GitHub Pages

本项目是纯静态站点，运行只需要 `index.html`、`styles.css`、`game.js` 三个文件，不需要构建、服务器或数据库。

- 仓库：<https://github.com/lynx-lin/SquareDish>
- 默认公开链接：<https://lynx-lin.github.io/SquareDish/>
- 自动部署工作流：`.github/workflows/pages.yml`

## 一、GitHub Pages 自动部署

### 1. 提交并推送

在项目目录执行：

```powershell
git init
git add .
git commit -m "Add GitHub Pages deployment"
git branch -M main
git remote add origin https://github.com/lynx-lin/SquareDish.git
git push -u origin main
```

如果推送时 Git Credential Manager 弹出 GitHub 登录窗口，完成登录即可。

### 2. 设置 Pages

1. 打开 <https://github.com/lynx-lin/SquareDish/settings/pages>。
2. 在 **Build and deployment** 下把 **Source** 设为 **GitHub Actions**。
3. 打开 <https://github.com/lynx-lin/SquareDish/actions>，等待 `Deploy game to GitHub Pages` 成功。
4. 打开 <https://lynx-lin.github.io/SquareDish/> 验收。

首次部署通常需要 1–3 分钟。这段时间访问链接可能返回 404，属于正常现象。

如果先推送、后设置 Pages，第一次工作流可能失败；设置好后在 Actions 页面点击 **Re-run jobs** 即可。

### 3. 更新

修改本地文件后：

```powershell
git add .
git commit -m "Update game"
git push
```

推送后会自动重新部署。如果浏览器还显示旧版本，使用 `Ctrl+F5` 强制刷新，或等待 GitHub Pages 缓存刷新。

### 4. 回滚

```powershell
git revert <要回滚的提交哈希>
git push
```

也可以在 GitHub Actions 中重新运行一次历史部署。

## 二、手动上传备用方案

如果不想用 Git 命令：

1. 在 GitHub 新建/打开仓库。
2. 点击 **Add file → Upload files**。
3. 只上传 `index.html`、`styles.css`、`game.js`。
4. 在仓库根目录新建一个空文件 `.nojekyll`。
5. 到 **Settings → Pages**，Source 选择 **Deploy from a branch**，分支选 `main`，目录选 `/ (root)`。
6. 等待部署完成后访问 `https://lynx-lin.github.io/SquareDish/`。

这种方式的缺点是每次更新都要重新上传文件，且不会自动部署。

## 三、Netlify Drop 备用方案

如果暂时不想使用 GitHub Pages：

1. 准备一个只包含 `index.html`、`styles.css`、`game.js` 的文件夹。
2. 打开 <https://app.netlify.com/drop>，把文件夹拖进去。
3. 登录并认领站点，得到形如 `https://随机名称.netlify.app` 的链接。
4. 以后可以重新拖拽更新，或连接 GitHub 仓库做自动部署。

## 四、存储与限制

- 存档使用浏览器 `localStorage`，键名为 `survivor-prototype-save-v1`，每个浏览器、每个域名各自独立。
- 更换仓库名、切换到自定义域名或清除站点数据，会得到一份新的空存档；旧存档不会自动迁移。
- 当前版本没有触屏操作，手机可以打开链接，但实际游玩需要桌面浏览器和键盘。
- 没有后端、账号系统、排行榜或多人联机；所有游戏逻辑都在浏览器本地运行。
- 公开仓库中的源码对访问者可见，这是客户端游戏的正常情况。

## 五、常见问题

**链接 404**

- 确认 Pages 的 Source 是 **GitHub Actions**。
- 确认 Actions 中 `Deploy game to GitHub Pages` 已成功。
- 确认工作流运行在 `main` 分支。
- 首次部署等待 1–3 分钟后再试。

**页面空白或资源 404**

- 确认 `index.html`、`styles.css`、`game.js` 都在部署产物根目录。
- 文件名大小写必须完全一致；GitHub Pages 在 Linux 上区分大小写。
- 打开浏览器控制台查看具体缺失的资源。

**更新后仍是旧版本**

- 使用 `Ctrl+F5` 强制刷新。
- 在 Actions 中确认最新一次部署成功。
- 等待几分钟让 CDN 缓存刷新。

**推送失败**

- 确认远程地址是 `https://github.com/lynx-lin/SquareDish.git`。
- 完成 Git Credential Manager 的 GitHub 登录。
- 如果远端已有提交，先执行 `git pull --rebase origin main` 再推送。
