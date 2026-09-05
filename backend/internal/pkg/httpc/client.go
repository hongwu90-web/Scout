package httpc

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

type clientPool struct {
	mu      sync.RWMutex
	clients map[string]*http.Client
}

var defaultClientPool = &clientPool{clients: make(map[string]*http.Client)}

// NewClient creates HTTP client with specified timeout and optional proxy.
// Clients are reused by (timeout, proxy, allowPrivate) to keep connections warm.
func NewClient(timeout time.Duration, proxyURL string, allowPrivate bool) (*http.Client, error) {
	key := proxyURL + "|" + strconv.FormatInt(timeout.Milliseconds(), 10) + "|" + strconv.FormatBool(allowPrivate)

	defaultClientPool.mu.RLock()
	if client, ok := defaultClientPool.clients[key]; ok {
		defaultClientPool.mu.RUnlock()
		return client, nil
	}
	defaultClientPool.mu.RUnlock()

	transport := &http.Transport{
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          128,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: timeout,
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS10,
			CipherSuites: []uint16{
				// Modern AEAD & ECDHE ciphers (priority)
				tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
				tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
				tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,
				tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
				// CBC / ECDHE
				tls.TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA,
				tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA,
				tls.TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA,
				tls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA,
				// Legacy RSA key exchange ciphers (essential for institutional/government portals like mofcom.gov.cn)
				tls.TLS_RSA_WITH_AES_128_GCM_SHA256,
				tls.TLS_RSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_RSA_WITH_AES_128_CBC_SHA,
				tls.TLS_RSA_WITH_AES_256_CBC_SHA,
				tls.TLS_RSA_WITH_3DES_EDE_CBC_SHA,
			},
			Renegotiation: tls.RenegotiateOnceAsClient,
		},
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		if err := validateDialTarget(ctx, addr, allowPrivate); err != nil {
			return nil, err
		}
		return dialer.DialContext(ctx, network, addr)
	}

	if proxyURL != "" {
		proxy, err := url.Parse(proxyURL)
		if err != nil {
			return nil, err
		}
		transport.Proxy = http.ProxyURL(proxy)
	}

	client := &http.Client{
		Timeout:       timeout,
		Transport:     transport,
		CheckRedirect: redirectValidator(allowPrivate),
	}

	defaultClientPool.mu.Lock()
	if existing, ok := defaultClientPool.clients[key]; ok {
		defaultClientPool.mu.Unlock()
		transport.CloseIdleConnections()
		return existing, nil
	}
	defaultClientPool.clients[key] = client
	defaultClientPool.mu.Unlock()

	return client, nil
}

func redirectValidator(allowPrivate bool) func(req *http.Request, via []*http.Request) error {
	return func(req *http.Request, via []*http.Request) error {
		if req == nil || req.URL == nil {
			return nil
		}

		return ValidateRequestURL(req.Context(), req.URL.String(), allowPrivate)
	}
}

func validateDialTarget(ctx context.Context, addr string, allowPrivate bool) error {
	if allowPrivate {
		return nil
	}

	host := addr
	if parsedHost, _, err := net.SplitHostPort(addr); err == nil {
		host = parsedHost
	}

	return validatePublicHost(ctx, host)
}

// SetDefaultHeaders adds default headers required for feed fetching.
func SetDefaultHeaders(req *http.Request) {
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Sec-Ch-Ua", `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`)
	req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
	req.Header.Set("Sec-Ch-Ua-Platform", `"macOS"`)
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "none")
	req.Header.Set("Sec-Fetch-User", "?1")
}
