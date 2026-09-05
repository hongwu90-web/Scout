package httpc

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// ResponsePayload holds the status, headers, and body of a fetched URL.
type ResponsePayload struct {
	StatusCode int
	Header     http.Header
	Body       []byte
}

// DoWithFallback executes an HTTP request using the given client.
// If the request is rejected with 403 Forbidden, 401 Unauthorized, 503 Service Unavailable,
// or encounters a TLS handshake failure (frequently caused by anti-bot edge proxies like Akamai/Cloudflare
// blocking Go's TLS fingerprint), and the current platform is macOS (darwin),
// it automatically falls back to Apple's native network stack via osascript JXA.
func DoWithFallback(ctx context.Context, client *http.Client, req *http.Request) (*ResponsePayload, error) {
	if client == nil {
		client = http.DefaultClient
	}

	resp, doErr := client.Do(req)
	if doErr == nil {
		defer resp.Body.Close()

		// If success or normal redirect/not-modified, read and return
		if resp.StatusCode != http.StatusForbidden && resp.StatusCode != http.StatusServiceUnavailable && resp.StatusCode != http.StatusUnauthorized {
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				return nil, fmt.Errorf("read response body: %w", err)
			}
			return &ResponsePayload{
				StatusCode: resp.StatusCode,
				Header:     resp.Header.Clone(),
				Body:       body,
			}, nil
		}

		slog.Info("standard HTTP fetch returned anti-bot status", "status", resp.StatusCode, "url", req.URL.String())
	} else {
		slog.Info("standard HTTP fetch failed", "error", doErr, "url", req.URL.String())
	}

	// Try native macOS fallback if running on darwin
	if runtime.GOOS == "darwin" && req.URL != nil {
		slog.Info("attempting native macOS fetch fallback", "url", req.URL.String())
		targetURL := req.URL.String()
		nativeBody, nativeErr := FetchNativeDarwin(ctx, targetURL)
		if nativeErr == nil && len(nativeBody) > 0 {
			slog.Info("native macOS fetch succeeded", "url", targetURL, "bytes", len(nativeBody))
			h := make(http.Header)
			// Sniff content type if available
			ct := http.DetectContentType(nativeBody)
			h.Set("Content-Type", ct)
			return &ResponsePayload{
				StatusCode: http.StatusOK,
				Header:     h,
				Body:       nativeBody,
			}, nil
		}
		if nativeErr != nil {
			slog.Warn("native macOS fetch fallback failed", "url", targetURL, "error", nativeErr)
		}
	}

	if doErr != nil {
		return nil, doErr
	}

	// Return original blocked response if fallback did not succeed
	return &ResponsePayload{
		StatusCode: resp.StatusCode,
		Header:     resp.Header.Clone(),
		Body:       nil,
	}, nil
}

// FetchNativeDarwin fetches a URL using macOS's built-in Foundation framework.
// Because it routes through Apple's native CFNetwork/Security stack, it uses Apple's
// standard Safari/WebKit TLS handshake, passing Akamai and Cloudflare edge verification.
func FetchNativeDarwin(ctx context.Context, targetURL string) ([]byte, error) {
	script := fmt.Sprintf(`
ObjC.import("Foundation");
var url = $.NSURL.URLWithString(%q);
if (!url.isNil()) {
    var data = $.NSData.dataWithContentsOfURL(url);
    if (!data.isNil()) {
        $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
    }
}
`, targetURL)

	timeout := 25 * time.Second
	if dl, ok := ctx.Deadline(); ok {
		remaining := time.Until(dl)
		if remaining > 0 && remaining < timeout {
			timeout = remaining
		}
	}

	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(execCtx, "osascript", "-l", "JavaScript", "-e", script)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("native fetch execution failed: %w (stderr: %s)", err, strings.TrimSpace(stderr.String()))
	}

	out := stdout.Bytes()
	if len(out) == 0 {
		return nil, fmt.Errorf("native fetch returned empty response")
	}

	return out, nil
}
