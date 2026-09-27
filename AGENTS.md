# 项目开发索引

## 当前仓库索引

- 遇到赛事官网的数据流、后台编辑入口、静态页与本地服务关系时，必须优先读取 `.context/architecture/赛事官网架构.md`。
- 遇到积分明细布局、结局加分或分队倍率计算时，必须优先读取 `site.js` 中的 `getScoreComponents` 与 `scoreLedgerMarkup` 实现。
- 遇到积分明细展开后标签和值错位、空白列或移动端换列时，必须优先读取 `.context/pitfalls/积分明细栅格布局.md`。
- 遇到规则文本、每日参赛选手、后台结构化编辑或图片上传时，必须优先读取 `.context/architecture/赛事官网架构.md` 和 `admin.js`。
- 遇到后台分页、日程图标对应、音乐自动播放或 Docker 上传素材持久化时，必须优先读取 `.context/architecture/赛事官网架构.md`、`site.js` 和 `README.md`。
- 遇到页面筹备中状态、公开接口数据投影、后台登录会话或素材上传鉴权时，必须优先读取 `.context/conventions/页面发布与后台鉴权.md`。
- 遇到服务端权威计分、公开排名数据或前后端计分规则不一致时，必须优先读取 `scoring.js` 与 `.context/architecture/赛事官网架构.md`。
- 遇到后台登录按钮无响应、登录脚本解析错误或部署后仍加载旧后台脚本时，必须优先读取 `.context/pitfalls/后台登录脚本缓存与提交处理.md`。
- 遇到手机端导航菜单无法展开、图片加载缓慢或静态资源缓存策略时，必须优先读取 `.context/pitfalls/移动端菜单与静态素材缓存.md`。
