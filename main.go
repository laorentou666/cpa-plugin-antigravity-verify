package main

/*
#include <stdint.h>
#include <stdlib.h>

typedef struct { void* ptr; size_t len; } cliproxy_buffer;
typedef struct {
    uint32_t abi_version;
    void* host_ctx;
    void* call;
    void* free_buffer;
} cliproxy_host_api;
typedef int (*cliproxy_plugin_call_fn)(char*, uint8_t*, size_t, cliproxy_buffer*);
typedef void (*cliproxy_plugin_free_fn)(void*, size_t);
typedef void (*cliproxy_plugin_shutdown_fn)(void);
typedef struct {
    uint32_t abi_version;
    cliproxy_plugin_call_fn call;
    cliproxy_plugin_free_fn free_buffer;
    cliproxy_plugin_shutdown_fn shutdown;
} cliproxy_plugin_api;
extern int cliproxyPluginCall(char*, uint8_t*, size_t, cliproxy_buffer*);
extern void cliproxyPluginFree(void*, size_t);
extern void cliproxyPluginShutdown(void);
*/
import "C"

import (
	"embed"
	"encoding/json"
	"net/http"
	"strings"
	"unsafe"
)

//go:embed web/*
var assets embed.FS

const resourceBase = "/v0/resource/plugins/antigravity-verify"

type envelope struct {
	OK     bool `json:"ok"`
	Result any  `json:"result,omitempty"`
	Error  any  `json:"error,omitempty"`
}

type resource struct {
	Path        string
	Menu        string `json:",omitempty"`
	Description string `json:",omitempty"`
}

type managementRequest struct {
	Method string
	Path   string
}

type managementResponse struct {
	StatusCode int
	Headers    http.Header
	Body       []byte
}

func main() {}

//export cliproxy_plugin_init
func cliproxy_plugin_init(host *C.cliproxy_host_api, plugin *C.cliproxy_plugin_api) C.int {
	if host == nil || plugin == nil || host.abi_version != 1 {
		return 1
	}
	plugin.abi_version = 1
	plugin.call = C.cliproxy_plugin_call_fn(C.cliproxyPluginCall)
	plugin.free_buffer = C.cliproxy_plugin_free_fn(C.cliproxyPluginFree)
	plugin.shutdown = C.cliproxy_plugin_shutdown_fn(C.cliproxyPluginShutdown)
	return 0
}

//export cliproxyPluginCall
func cliproxyPluginCall(method *C.char, request *C.uint8_t, requestLen C.size_t, response *C.cliproxy_buffer) C.int {
	if response == nil {
		return 1
	}
	response.ptr, response.len = nil, 0
	if method == nil || uint64(requestLen) > 1024*1024 || (requestLen > 0 && request == nil) {
		return 1
	}
	var raw []byte
	if requestLen > 0 {
		raw = C.GoBytes(unsafe.Pointer(request), C.int(requestLen))
	}
	result := dispatch(C.GoString(method), raw)
	out, err := json.Marshal(result)
	if err != nil {
		return 1
	}
	response.ptr = C.CBytes(out)
	response.len = C.size_t(len(out))
	return 0
}

//export cliproxyPluginFree
func cliproxyPluginFree(ptr unsafe.Pointer, _ C.size_t) {
	C.free(ptr)
}

//export cliproxyPluginShutdown
func cliproxyPluginShutdown() {}

func dispatch(method string, raw []byte) envelope {
	switch method {
	case "plugin.register", "plugin.reconfigure":
		return envelope{OK: true, Result: map[string]any{
			"schema_version": 6,
			"metadata": map[string]any{
				"Name": "Antigravity 账号验证", "Version": "1.0.2", "Author": "laorentou666",
				"GitHubRepository": "https://github.com/laorentou666/cpa-plugin-antigravity-verify",
				"Logo":             "", "ConfigFields": []any{},
			},
			"capabilities": map[string]bool{"management_api": true},
		}}
	case "plugin.quiesce", "plugin.shutdown":
		return envelope{OK: true, Result: map[string]any{}}
	case "management.register":
		return envelope{OK: true, Result: map[string]any{"resources": []resource{
			{Path: "/index.html", Menu: "Antigravity 账号验证", Description: "手动查询账号状态并复制验证链接"},
			{Path: "/app.js"}, {Path: "/core.js"}, {Path: "/style.css"},
		}}}
	case "management.handle":
		var req managementRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			return envelope{OK: false, Error: map[string]string{"code": "invalid_request", "message": "Invalid management request"}}
		}
		return envelope{OK: true, Result: serveResource(req)}
	default:
		return envelope{OK: false, Error: map[string]string{"code": "unknown_method", "message": "Unsupported method"}}
	}
}

func serveResource(req managementRequest) managementResponse {
	headers := http.Header{
		"Cache-Control": {"no-store"}, "X-Content-Type-Options": {"nosniff"},
		"Referrer-Policy":         {"no-referrer"},
		"Content-Security-Policy": {"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"},
	}
	name := strings.TrimPrefix(req.Path, resourceBase+"/")
	mime := map[string]string{
		"index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8",
		"core.js": "text/javascript; charset=utf-8", "style.css": "text/css; charset=utf-8",
	}
	contentType, allowed := mime[name]
	if req.Method != http.MethodGet || !strings.HasPrefix(req.Path, resourceBase+"/") || !allowed {
		headers.Set("Content-Type", "text/plain; charset=utf-8")
		return managementResponse{StatusCode: 404, Headers: headers, Body: []byte("Not found")}
	}
	body, err := assets.ReadFile("web/" + name)
	if err != nil {
		return managementResponse{StatusCode: 500, Headers: headers, Body: []byte("Resource unavailable")}
	}
	headers.Set("Content-Type", contentType)
	return managementResponse{StatusCode: 200, Headers: headers, Body: body}
}
