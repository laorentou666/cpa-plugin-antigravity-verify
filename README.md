# Antigravity 账号验证插件

为 CLIProxyAPI 提供独立的账号验证页面。查询 Antigravity 账号状态，遇到 `Verify your account` 提示时，直接显示对应账号和验证链接，方便复制或打开。

支持单个、批量查询，以及账号搜索、结果筛选和批量复制。兼容 v0、v8 管理接口，可自动选择或手动指定。

## 安装

需要支持原生插件的 CLIProxyAPI。源码构建需要 Go 1.23+ 和 C 编译器。

```bash
git clone https://github.com/laorentou666/cpa-plugin-antigravity-verify.git
cd cpa-plugin-antigravity-verify
bash build.sh
```

将 `dist/<系统>/<架构>/` 中生成的动态库放入 CLIProxyAPI 的 `plugins/<系统>/<架构>/` 目录，并在配置中启用：

```yaml
plugins:
  enabled: true
  dir: "plugins"
  configs:
    antigravity-verify:
      enabled: true
      priority: 1
```

重启 CLIProxyAPI，在侧边栏的「插件」中打开「Antigravity 账号验证」。

## 使用

- 点击「查询全部账号」，或先「读取账号列表」再逐个查询。
- 需要验证的账号会显示链接，可逐条复制、批量复制或打开验证页。
- 使用搜索框和「仅看需要验证的账号」筛选结果。

管理密钥可复用管理中心保存的会话，也可在页面中填写。接口默认自动选择，页面会显示当前使用的版本。

## 开发

```bash
node --test tests/core.test.mjs
python3 tests/native_smoke.py dist/linux/amd64/antigravity-verify.so
```

浏览器测试使用 Python Playwright：

```bash
python3 tests/browser_smoke.py dist/linux/amd64/antigravity-verify.so
```

## 许可证

[MIT](LICENSE)。原生插件接口参考 [CLIProxyAPI 官方示例](https://github.com/router-for-me/CLIProxyAPI/tree/v8.0.78/examples/plugin/management-api)。

---

友情支持：[linux.do](https://linux.do)
