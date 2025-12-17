 运行程序
根据您的需求，有两种运行方式：

方式 A：直接运行 (推荐调试使用)
您提供的 index.js 文件似乎是主逻辑文件（V5.2 版本），它会同时根据配置扫描 Crypto 和 Sports 板块。直接运行它最简单：

Bash
node index.js

方式 B：使用 PM2 后台运行 (推荐生产环境使用)
您上传的文件中包含 ecosystem.config.js，这是一个 PM2 配置文件。它配置了两个独立的应用实例：sharky-sports 和 sharky-crypto，分别运行 bot_sports.js 和 bot_crypto.js（前提是这两个文件在您的目录中存在且代码逻辑正确）。

安装 PM2 (如果您还没有安装):
Bash
npm install pm2 -g

启动服务:
Bash
pm2 start ecosystem.config.js

查看日志:
Bash
pm2 logs

管理进程:
停止：pm2 stop all

重启：pm2 restart all

查看状态：pm2 status

常见问题排查
缺少文件：如果您运行 node index.js 报错提示找不到 ./utils/logger 或 ./services/oracle，请确保您上传文件列表中的 utils 和 services 文件夹及其内部的 .js 文件都在项目目录中正确的位置。

网络问题：由于程序需要连接 polymarket.com 的 API 和 WebSocket，如果您在中国大陆或其他网络受限地区，可能需要配置代理或确保网络环境能够访问这些服务。
