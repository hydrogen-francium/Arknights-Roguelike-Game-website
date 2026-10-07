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

运行 `npm test` 检查精英探索者的数据契约、公开投影和保存链路。接口测试在独立临时目录运行，不修改实际赛事数据。
