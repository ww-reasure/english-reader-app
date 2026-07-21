# 打包版本规则

- 小更新：执行 `npm run release:patch`，版本号增加 `0.0.1`，例如 `1.7.1` → `1.7.2`。
- 大更新：执行 `npm run release:minor`，版本号增加 `0.1.0`，例如 `1.7.1` → `1.8.0`。

两条命令都会同步更新 `package.json`、`package-lock.json`、Android 的 `versionName` 与递增的 `versionCode`，随后再生成 Debug APK。
