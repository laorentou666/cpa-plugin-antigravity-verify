"""Exercise the real shared-library ABI without external network access."""

import base64
import ctypes as c
import json
from pathlib import Path
import sys


class Buffer(c.Structure):
    _fields_ = [("ptr", c.c_void_p), ("len", c.c_size_t)]


Call = c.CFUNCTYPE(c.c_int, c.c_char_p, c.c_void_p, c.c_size_t, c.POINTER(Buffer))
Free = c.CFUNCTYPE(None, c.c_void_p, c.c_size_t)
Shutdown = c.CFUNCTYPE(None)


class HostAPI(c.Structure):
    _fields_ = [("abi_version", c.c_uint32), ("host_ctx", c.c_void_p),
                ("call", c.c_void_p), ("free_buffer", c.c_void_p)]


class PluginAPI(c.Structure):
    _fields_ = [("abi_version", c.c_uint32), ("call", Call),
                ("free_buffer", Free), ("shutdown", Shutdown)]


class NativePlugin:
    def __init__(self, filename):
        self.library = c.CDLL(str(Path(filename).resolve()))
        init = self.library.cliproxy_plugin_init
        init.argtypes = [c.POINTER(HostAPI), c.POINTER(PluginAPI)]
        init.restype = c.c_int
        self.host = HostAPI(1, None, None, None)
        self.api = PluginAPI()
        assert init(c.byref(self.host), c.byref(self.api)) == 0
        assert self.api.abi_version == 1

    def call(self, method, payload=None):
        raw = json.dumps(payload if payload is not None else {}).encode()
        request = c.create_string_buffer(raw)
        response = Buffer()
        code = self.api.call(method.encode(), request, len(raw), c.byref(response))
        try:
            assert code == 0, f"ABI call failed: {method}"
            envelope = json.loads(c.string_at(response.ptr, response.len))
        finally:
            if response.ptr:
                self.api.free_buffer(response.ptr, response.len)
        assert envelope["ok"], f"Plugin rejected: {method}"
        return envelope.get("result")

    def resource(self, name):
        response = self.call("management.handle", {
            "Method": "GET", "Path": f"/v0/resource/plugins/antigravity-verify/{name}"
        })
        response["decoded_body"] = base64.b64decode(response["Body"])
        return response


def smoke(filename):
    plugin = NativePlugin(filename)
    registration = plugin.call("plugin.register")
    assert registration["capabilities"] == {"management_api": True}
    assert registration["schema_version"] == 6
    assert all(registration["metadata"][key] for key in ["Name", "Version", "Author", "GitHubRepository"])
    routes = plugin.call("management.register")["resources"]
    assert len(routes) == 4
    assert [(route["Path"], route.get("Menu")) for route in routes if route.get("Menu")] == [
        ("/index.html", "Antigravity 账号验证")
    ]
    for route in routes:
        result = plugin.resource(route["Path"].lstrip("/"))
        assert result["StatusCode"] == 200
        assert result["Headers"]["Cache-Control"] == ["no-store"]
        assert result["decoded_body"]
    assert plugin.resource("../main.go")["StatusCode"] == 404
    assert plugin.call("management.handle", {
        "Method": "GET", "Path": "/unrelated/index.html"
    })["StatusCode"] == 404
    plugin.call("plugin.reconfigure")
    plugin.call("plugin.quiesce")
    plugin.call("plugin.shutdown")
    plugin.api.shutdown()
    print("Native ABI, sidebar registration, embedded resources and route isolation: PASS")


if __name__ == "__main__":
    smoke(sys.argv[1])
