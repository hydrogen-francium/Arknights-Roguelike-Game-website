# 蟑螂杯#3 赛事官网

## 本地运行

服务器启动前必须提供后台凭据，不再存在默认密码。PowerShell 示例：

```powershell
$env:ADMIN_USERNAME = 'admin'
$env:ADMIN_PASSWORD = '替换为至少16位随机强密码'
$env:COOKIE_SECURE = 'false'
$env:PORT = '3100'
npm run dev
```

- 官网：`http://localhost:3100/`
- 后台：`http://localhost:3100/admin`
- 健康检查：`http://localhost:3100/health`

后台的“页面发布”页分别控制首页、规则、日程和排名是否对观众公开。关闭后，公开接口不返回该页内容，官网只显示“页面筹备中”。

## Docker Compose 部署

### Windows 本地验证

```powershell
Copy-Item .env.example .env
# 编辑 .env，至少替换 ADMIN_PASSWORD，并将 COOKIE_SECURE 设为 false
docker compose up -d --build
docker compose logs -f website
```

Compose 将容器端口映射到本机 `127.0.0.1:3101`，避免占用已有的 3000 端口。需要直接访问时使用 `http://localhost:3101/`。

### Ubuntu 24.04 服务器

```bash
sudo mkdir -p /srv/cockroach-cup-3
sudo chown -R "$USER":"$USER" /srv/cockroach-cup-3
cd /srv/cockroach-cup-3
git clone <你的 GitHub 仓库地址> .
cp .env.example .env
openssl rand -base64 32
nano .env
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3101/health
```

`.env` 至少需要配置：

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=这里填上面生成的随机密码
COOKIE_SECURE=true
PORT=3100
```

域名和证书已经由现有反向代理管理时，将站点上游指向 `127.0.0.1:3101`，不要把 Node 容器端口直接暴露到公网。反向代理需要允许 `/`、`/admin`、`/api/`、`/素材/` 正常转发。

更新版本：

```bash
cd /srv/cockroach-cup-3
git pull
docker compose up -d --build
docker compose logs --tail=100 website
```

## 数据、上传和备份

- `data/competition.json` 是赛事状态的唯一持久化数据源。
- `素材/上传/` 保存后台上传的头像、抓位图和其他图片；文件名由服务器随机生成。
- `backups/` 保存每次后台保存前的 JSON 快照，容器通过卷挂载持久化。
- 服务器备份示例：

```bash
cd /srv/cockroach-cup-3
tar -czf "/srv/cockroach-cup-3-backup-$(date +%F-%H%M%S).tar.gz" data 素材/上传 backups .env
```

恢复数据前先停止容器，替换 `data/` 或 `素材/上传/`，再执行 `docker compose up -d`。`.env` 属于敏感凭据，不要提交到 GitHub。

## 实现边界

- `scoring.js` 是前后端共用的计分规则模块；服务端计算的 `computedScores` 是官网展示和排名的权威结果。
- `/api/public/:page` 按页面投影数据；未发布页返回 `content: null`。
- `/api/admin/competition` 和 `/api/assets` 仅接受有效后台会话。
- 管理后台支持分页编辑赛事信息、页面发布状态、规则、赛程、队伍、选手、头像、抓位图和逐项积分。
- 浏览器可能因自动播放策略阻止有声音乐；官网会尝试默认播放，并保留页面音乐开关供观众手动启用。

## 精英探索者与网页图标

在后台“队伍与选手”中，为每队选择一名指定干员（对应规则中的精英探索者）；该指定适用于整届赛事，不按初赛、决赛更换。头像可通过“上传”使用本地图片，也可不上传、只显示名称。勾选“向观众公布该队伍的指定干员”后保存，官网排名、积分数据与日程详情显示干员名称及可选头像。未勾选时，公开接口不返回该指定。

不登记或展示选手逐局是否使用该干员，不在展示中标注星级。指定干员不参与计分，也不自动核验干员累计使用次数。

浏览器标签页图标由 `favicon.svg` 提供，官网和后台共用；不替换页眉主题标识。

## 自动化验证

运行 `npm test` 检查精英探索者的数据契约、公开投影、保存链路，以及素材采集的链接提取、原图转换、抓取规则、域名限制和离线预览转义。接口测试在独立临时目录运行，不修改实际赛事数据。

## 本地素材采集与手动筛选

在项目目录执行：

```powershell
npm run assets:collect
```

默认读取 `tools/asset-sources.json` 中已核对的公开入口：

| 来源 | 采集内容 |
| --- | --- |
| 仙术杯参考活动 | 电脑页与手机页的主题背景、面板和装饰 |
| PRTS 黑流树海 | 主题图、分队、结局、节点与游戏元素 |
| 鹰角网络官网 | 官网公开展示图和游戏封面 |
| 明日方舟官网 | 壁纸、背景、干员立绘、阵营标识、界面装饰与视频封面 |
| 明日方舟官方干员档案 | 全部公开分页中的立绘预览与干员图，不下载动作视频 |
| 明日方舟动画官网 | 动画背景、角色图和剧照 |

只提取页面、内嵌配置与直接引用样式中的公开图片链接。官方来源可以通过 `scriptAssetBase` 显式启用直接引用脚本的**纯文本**图片提取；资源根目录来自实际构建产物，不按脚本地址猜测。不会执行远程脚本、不登录、不全站递归。官方档案使用实测的 `code/data.list/data.end` 协议分页，直到 `end: true`，不是把空页或错误当作完成。PRTS 缩略图与活动图床压缩链接按已核对的地址格式还原为原图。

输出默认位于项目外的同级目录 `../web-素材候选/`：

- `index.html`：双击打开的离线候选图库，支持文件名和档案名称搜索、来源与分类筛选、透明背景检查、图片尺寸显示、勾选和导出「已选素材.json」。
- `images/`：原始图片，文件名包含内容摘要，按完整内容去重。
- `manifest.json`：图片大小、分类、内容摘要、来源页面和原始下载地址；标记与现有 `素材/` 内容完全相同的图片。

勾选仅保存在当前页面内存中，刷新前先导出清单。筛选结束后可提供「已选素材.json」用于下一轮美术调整；不会自动覆盖官网素材、修改赛事数据或把候选目录提交到 Git。原图不在采集时压缩，实际接入官网时再按显示用途优化。

需要调整范围时编辑配置文件的 `pages` 和 `hosts`，或使用另一份配置与项目外的目录：

```powershell
npm run assets:collect -- --config tools/asset-sources.json --out C:/Users/26656/Desktop/其他候选素材
```

配置中的请求间隔至少 1000 毫秒，默认单次上限 2000 个原图地址、单张上限 32 MiB、样式和脚本各上限 100 个、官方干员档案最多 30 页。请求按顺序执行，检查域名白名单和 robots.txt；禁止路径、HTTP 错误、超时和超限会立即中止并保留已完成部分，不自动重试。手动重跑会校验已有文件摘要并跳过其下载。只允许输出到项目外，避免候选原图被现有静态服务意外公开或进入部署包。

公开可下载不代表拥有使用授权。第三方赛事标识、赞助标识和专属设计仍需人工排除或确认权限。抓取规则处理依据：[RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html)。

官方来源与接口溯源：

- 鹰角网络官网：https://www.hypergryph.com/
- 明日方舟官网及壁纸：https://ak.hypergryph.com/
- 官方干员档案：https://ak.hypergryph.com/archive/dynamicCompile
- 已核对的公开分页：https://ak.hypergryph.com/api/archive/dynComp?type=&page=1
- 动画官网：https://ak.hypergryph.com/anime/
