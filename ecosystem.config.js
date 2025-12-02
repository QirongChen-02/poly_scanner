module.exports = {
  apps : [
    {
      name: "sharky-sports", // 体育机器人
      script: "./bot_sports.js",
      watch: false, // 只有当你修改文件时才重启
      autorestart: true,
      max_memory_restart: "200M"
    },
    {
      name: "sharky-crypto", // Crypto 机器人
      script: "./bot_crypto.js",
      watch: false,
      autorestart: true,
      max_memory_restart: "200M"
    }
  ]
};