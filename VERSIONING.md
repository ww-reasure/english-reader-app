# 打包版本规则

- 小更新：执行 `npm run release:patch`，版本号增加 `0.0.1`，例如 `1.7.1` → `1.7.2`。
- 大更新：执行 `npm run release:minor`，版本号增加 `0.1.0`，例如 `1.7.1` → `1.8.0`。

两条命令都会同步更新 `package.json`、`package-lock.json`、Android 的 `versionName` 与递增的 `versionCode`，以及 `version.json` 的版本、版本代码和构建日期，随后再生成 Debug APK。

`npm run build:apk` 会在 Gradle 构建前校验这四处元数据。任一版本号或版本代码不一致时，构建会被拒绝；必须通过上述发布命令恢复同步后再打包。
