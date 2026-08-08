# 打包版本规则

- 小更新：执行 `npm run release:patch`，版本号增加 `0.0.1`，例如 `1.7.1` → `1.7.2`。
- 大更新：执行 `npm run release:minor`，版本号增加 `0.1.0`，例如 `1.7.1` → `1.8.0`。

两条命令都会同步更新 `package.json`、`package-lock.json`、Android 的 `versionName` 与递增的 `versionCode`，以及 `version.json` 的版本、版本代码和构建日期，随后再生成 Debug APK。

`npm run build:apk` 会在 Gradle 构建前校验这四处元数据。任一版本号或版本代码不一致时，构建会被拒绝；必须通过上述发布命令恢复同步后再打包。

## Phase 5C 私有 QA 构建

- `npm run build` 使用 `public` 模式，只用于验证公开构建不包含 `exam-packs/private/`，不生成可发布 APK。
- `npm run build:private-qa` 使用 `private-qa` 模式，生成带授权私有题包的 Web/Capacitor 产物。
- `npm run build:apk` 只允许显式的 `private-qa` flavor，并在 Gradle 前后检查 release manifest、私有 pack 和 APK ZIP 内容。
- 私有 QA APK 会复制为 `E:\play\claude\EnglishReader-private-qa-v<version>-<versionCode>-debug.apk`，同时生成 SHA-256 校验文件。
- `private-qa` APK 只用于授权内部测试，不得上传公共仓库或作为公开发行包。
- 发布前必须通过 `npm run security:audit`；完整依赖树和非 dev 依赖树都不得有 High 级漏洞。
