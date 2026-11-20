"""Test the embedded plugin UI with local management API fixtures."""

import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import sys
import threading
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright
from native_smoke import NativePlugin


ROOT = Path(__file__).resolve().parents[1]
VERIFY_URL = "https://accounts.google.com/v3/signin/continue?plt=test%2Bvalue&continue=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%26y%3D2&sarp=1&scc=1&flowName=GlifWebSignIn"


def verification_body(with_link=True):
    detail = {"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "VALIDATION_REQUIRED", "metadata": {}}
    if with_link:
        detail["metadata"]["validation_url"] = VERIFY_URL
    return {"error": {"code": 403, "message": "Verify your account to continue.", "details": [detail]}}


def main(filename):
    plugin = NativePlugin(filename)
    counters = {"list": 0, "quota": [], "unauthorized": 0, "paths": []}
    files = [
        {"provider": "antigravity", "auth_index": "disabled", "email": "disabled@example.com", "name": "disabled.json", "disabled": True},
        {"provider": "antigravity", "auth_index": "missing", "email": "missing@example.com", "name": "missing.json"},
        {"provider": "antigravity", "auth_index": "healthy", "email": "healthy@example.com", "name": "healthy.json"},
        {"provider": "antigravity", "auth_index": "ordinary", "email": "ordinary@example.com", "name": "ordinary.json"},
        {"provider": "antigravity", "auth_index": "duplicate", "email": "disabled@example.com", "name": "duplicate.json"},
        {"provider": "codex", "auth_index": "codex", "email": "other@example.com", "name": "other.json"},
    ]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def send_json(self, status, value):
            body = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            if self.headers.get("Authorization") == "Bearer test-management-key":
                return True
            counters["unauthorized"] += 1
            self.send_json(401, {"error": "unauthorized"})
            return False

        def do_GET(self):
            if self.path.startswith("/v0/resource/plugins/antigravity-verify/"):
                result = plugin.resource(self.path.rsplit("/", 1)[1])
                self.send_response(result["StatusCode"])
                for key, values in result["Headers"].items():
                    for value in values:
                        self.send_header(key, value)
                self.end_headers()
                self.wfile.write(result["decoded_body"])
            elif self.path in ["/v0/management/auth-files", "/v8/management/credentials"]:
                if self.authorized():
                    counters["paths"].append(self.path)
                    counters["list"] += 1
                    self.send_json(200, {"files": files})
            else:
                self.send_json(404, {})

        def do_POST(self):
            if self.path not in ["/v0/management/api-call", "/v8/management/requests/api-call"]:
                self.send_json(404, {})
                return
            if not self.authorized():
                return
            counters["paths"].append(self.path)
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            assert data["header"]["Authorization"] == "Bearer $TOKEN$"
            assert data["url"] == "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"
            assert json.loads(data["data"]) == {"project": "aicode-consumers"}
            index = data["auth_index"]
            counters["quota"].append(index)
            status = 200 if index == "healthy" else 403
            body = {} if status == 200 else verification_body(index != "missing")
            if index == "ordinary":
                body = {"error": {"code": 403, "message": "Permission denied"}}
            self.send_json(200, {"status_code": status, "body": json.dumps(body)})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True,
                                        executable_path=os.environ.get("CHROMIUM_EXECUTABLE") or shutil.which("chromium"),
                                        args=["--no-sandbox"])
            context = browser.new_context(permissions=["clipboard-read", "clipboard-write"])
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.add_init_script("""(() => {
                const plain = JSON.stringify({state:{managementKey:'test-management-key'}});
                const key = new TextEncoder().encode(`cli-proxy-api-webui::secure-storage|${location.host}|${navigator.userAgent}`);
                const bytes = new TextEncoder().encode(plain);
                const encoded = btoa(String.fromCharCode(...bytes.map((b,i)=>b^key[i%key.length])));
                localStorage.setItem('cli-proxy-auth','enc::v1::'+encoded);
            })();""")
            page.clock.install()
            page.goto(f"http://127.0.0.1:{server.server_port}/v0/resource/plugins/antigravity-verify/index.html")
            page.get_by_role("button", name="查询全部账号", exact=True).wait_for()
            page.clock.fast_forward(600000)
            assert counters["list"] == 0 and counters["quota"] == [], "Opening/idle page made requests"
            page.get_by_role("button", name="读取账号列表", exact=True).click()
            expect(page.locator("#total")).to_have_text("5")
            assert counters["list"] == 1 and counters["quota"] == []
            assert counters["paths"] == ["/v8/management/credentials"]
            expect(page.locator("#api-current")).to_have_text("当前接口：v8")
            disabled = page.locator("article").filter(has=page.get_by_role("heading", name="disabled@example.com", exact=True)).filter(has_text="disabled.json")
            disabled.get_by_role("button", name="查询", exact=True).click()
            expect(page.locator("#pending")).to_have_text("1")
            assert counters["quota"] == ["disabled"]
            assert disabled.locator("textarea").input_value() == VERIFY_URL
            disabled.get_by_role("button", name="复制验证链接", exact=True).click()
            assert page.evaluate("navigator.clipboard.readText()") == VERIFY_URL
            page.get_by_role("button", name="查询全部账号", exact=True).click()
            expect(page.locator("#checked")).to_have_text("5")
            expect(page.locator("#query-all")).to_be_enabled()
            assert page.locator("#pending").inner_text() == "3"
            assert page.locator("#errors").inner_text() == "1"
            assert sorted(counters["quota"][1:]) == ["disabled", "duplicate", "healthy", "missing", "ordinary"]
            assert all(path.startswith("/v8/management/") for path in counters["paths"])
            assert page.locator("article").filter(has_text="missing@example.com").get_by_text("403 · 需要验证账号，上游未提供可用验证链接").count() == 1
            page.locator("#only-pending").check()
            assert page.locator("article").count() == 3
            page.get_by_role("button", name="复制全部验证链接", exact=True).click()
            copied = page.evaluate("navigator.clipboard.readText()")
            assert copied.count(VERIFY_URL) == 2
            for width in [375, 768, 1440]:
                page.set_viewport_size({"width": width, "height": 1000})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Overflow at {width}px"
                page.screenshot(path=f"/tmp/antigravity-verify-{width}.png", full_page=True)
            before = (counters["list"], len(counters["quota"]))
            page.clock.fast_forward(600000)
            assert before == (counters["list"], len(counters["quota"])), "Idle page repeated a query"
            assert not errors, errors
            compatibility_checks(context, server.server_port)
            browser.close()
        print("Browser: manual-only queries, disabled/duplicate account identity, HTTP 200/inner 403, missing links, clipboard, filters, 375/768/1440 layouts: PASS")
    finally:
        server.shutdown()


def compatibility_checks(context, port):
    base = f"http://127.0.0.1:{port}/v0/resource/plugins/antigravity-verify/index.html"

    def open_case(block=None, mode="auto"):
        page = context.new_page()
        requests = []

        def intercept(route):
            path = urlsplit(route.request.url).path
            requests.append(path)
            reply = block(path) if block else None
            if reply == "network":
                route.abort("failed")
            elif reply:
                status, body, content_type = reply
                route.fulfill(status=status, body=body, content_type=content_type)
            else:
                route.continue_()

        page.route("**/v*/management/**", intercept)
        page.clock.install()
        page.goto(base)
        page.locator("#api-mode").select_option(mode)
        page.clock.fast_forward(600000)
        assert requests == [], "Mode selection or idle page made API requests"
        return page, requests

    for status, body, content_type in [
        (404, "{}", "application/json"),
        (405, "{}", "application/json"),
        (200, "<html>Proxy fallback</html>", "text/html"),
        (200, '{"unexpected":"schema"}', "application/json"),
    ]:
        page, requests = open_case(lambda path: (status, body, content_type) if path.startswith("/v8/") else None)
        page.locator("#load-accounts").click()
        expect(page.locator("#total")).to_have_text("5")
        expect(page.locator("#load-accounts")).to_be_enabled()
        expect(page.locator("#api-current")).to_have_text("当前接口：v0")
        assert requests == ["/v8/management/credentials", "/v0/management/auth-files"]
        card = page.locator("article").filter(has_text="missing@example.com")
        card.get_by_role("button", name="查询", exact=True).click()
        expect(page.locator("#pending")).to_have_text("1")
        expect(page.locator("#load-accounts")).to_be_enabled()
        assert requests[-1] == "/v0/management/api-call"
        with page.expect_response(lambda response: response.url.endswith("/auth-files")):
            page.locator("#load-accounts").click()
        expect(page.locator("#load-accounts")).to_be_enabled()
        assert requests[-1] == "/v0/management/auth-files"
        assert requests.count("/v8/management/credentials") == 1, "Successful mode was not reused"
        page.close()

    page, requests = open_case(mode="v0")
    page.locator("#query-all").click()
    expect(page.locator("#checked")).to_have_text("5")
    expect(page.locator("#query-all")).to_be_enabled()
    assert len(requests) == 6 and all(path.startswith("/v0/") for path in requests)
    page.close()

    page, requests = open_case(lambda _path: (404, "{}", "application/json"), mode="v8")
    page.locator("#load-accounts").click()
    expect(page.locator("#notice")).to_contain_text("404")
    expect(page.locator("#load-accounts")).to_be_enabled()
    assert requests == ["/v8/management/credentials"], "Explicit mode fell back"
    page.close()

    for status in [401, 403, 500]:
        page, requests = open_case(lambda _path: (status, "{}", "application/json"))
        page.locator("#load-accounts").click()
        expect(page.locator("#notice")).to_be_visible()
        expect(page.locator("#load-accounts")).to_be_enabled()
        assert requests == ["/v8/management/credentials"], f"HTTP {status} caused a fallback"
        page.close()

    page, requests = open_case(lambda _path: "network")
    page.locator("#load-accounts").click()
    expect(page.locator("#notice")).to_be_visible()
    expect(page.locator("#load-accounts")).to_be_enabled()
    assert requests == ["/v8/management/credentials"], "Network failure caused a fallback"
    page.close()

    page, requests = open_case(lambda path: (404, "{}", "application/json") if path.endswith("/requests/api-call") else None)
    page.locator("#load-accounts").click()
    expect(page.locator("#total")).to_have_text("5")
    expect(page.locator("#load-accounts")).to_be_enabled()
    page.locator("article").filter(has_text="missing@example.com").get_by_role("button", name="查询", exact=True).click()
    expect(page.locator("#pending")).to_have_text("1")
    expect(page.locator("#api-current")).to_have_text("当前接口：v0")
    expect(page.locator("#load-accounts")).to_be_enabled()
    assert requests == ["/v8/management/credentials", "/v8/management/requests/api-call", "/v0/management/api-call"]
    page.close()
    print("Compatibility: v8 default, v0 fallback/cache, manual modes, HTML/schema mismatch, management vs upstream errors: PASS")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / "dist/linux/amd64/antigravity-verify.so")
