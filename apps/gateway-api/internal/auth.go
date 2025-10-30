package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

const stateTTL = 10 * time.Minute

type oauthProvider struct {
	Name         string
	AuthorizeURL string
	RedirectURI  string
	ClientID     string
	Scopes       []string
}

type stateData struct {
	Provider     string
	RedirectURI  string
	CodeVerifier string
	ExpiresAt    time.Time
	State        string
}

type stateCache struct {
	mu    sync.Mutex
	items map[string]stateData
}

func newStateCache() *stateCache {
	return &stateCache{items: make(map[string]stateData)}
}

func (c *stateCache) set(state string, data stateData) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[state] = data
}

func (c *stateCache) pop(state string) (stateData, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, ok := c.items[state]
	if !ok {
		return stateData{}, false
	}
	if time.Now().After(data.ExpiresAt) {
		delete(c.items, state)
		return stateData{}, false
	}
	delete(c.items, state)
	return data, true
}

var oauthStates = newStateCache()

func cleanupExpiredStates() {
	ticker := time.NewTicker(time.Minute)
	go func() {
		for range ticker.C {
			now := time.Now()
			oauthStates.mu.Lock()
			for k, v := range oauthStates.items {
				if now.After(v.ExpiresAt) {
					delete(oauthStates.items, k)
				}
			}
			oauthStates.mu.Unlock()
		}
	}()
}

func init() {
	cleanupExpiredStates()
}

func getProviderConfig(provider string) (oauthProvider, error) {
	redirectBase := strings.TrimRight(getEnv("OAUTH_REDIRECT_BASE", "http://127.0.0.1:8080"), "/")
	configs := map[string]oauthProvider{
		"openrouter": {
			Name:         "openrouter",
			AuthorizeURL: "https://openrouter.ai/oauth/authorize",
			RedirectURI:  fmt.Sprintf("%s/auth/openrouter/callback", redirectBase),
			ClientID:     os.Getenv("OPENROUTER_CLIENT_ID"),
			Scopes:       []string{"offline", "openid", "profile"},
		},
	}
	cfg, ok := configs[provider]
	if !ok {
		return oauthProvider{}, fmt.Errorf("unknown provider: %s", provider)
	}
	if cfg.ClientID == "" {
		return oauthProvider{}, fmt.Errorf("provider %s is not configured", provider)
	}
	return cfg, nil
}

func authorizeHandler(w http.ResponseWriter, r *http.Request) {
	provider := strings.TrimPrefix(r.URL.Path, "/auth/")
	provider = strings.TrimSuffix(provider, "/authorize")
	cfg, err := getProviderConfig(provider)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	redirectURI := r.URL.Query().Get("redirect_uri")
	if redirectURI == "" {
		http.Error(w, "redirect_uri is required", http.StatusBadRequest)
		return
	}
	if err := validateClientRedirect(redirectURI); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	state, codeVerifier, codeChallenge, err := generateStateAndPKCE()
	if err != nil {
		http.Error(w, "failed to generate state", http.StatusInternalServerError)
		return
	}

	oauthStates.set(state, stateData{
		Provider:     provider,
		RedirectURI:  redirectURI,
		CodeVerifier: codeVerifier,
		ExpiresAt:    time.Now().Add(stateTTL),
		State:        state,
	})

	authURL, err := buildAuthorizeURL(cfg, state, codeChallenge)
	if err != nil {
		http.Error(w, "failed to build authorize url", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, authURL, http.StatusFound)
}

func callbackHandler(w http.ResponseWriter, r *http.Request) {
	provider := strings.TrimPrefix(r.URL.Path, "/auth/")
	provider = strings.TrimSuffix(provider, "/callback")

	cfg, err := getProviderConfig(provider)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	if errParam := r.URL.Query().Get("error"); errParam != "" {
		redirectError(w, r, provider, errParam)
		return
	}

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" || state == "" {
		http.Error(w, "code and state are required", http.StatusBadRequest)
		return
	}

	data, ok := oauthStates.pop(state)
	if !ok || data.Provider != provider {
		http.Error(w, "invalid or expired state", http.StatusBadRequest)
		return
	}

	payload := map[string]string{
		"code":          code,
		"code_verifier": data.CodeVerifier,
		"redirect_uri":  cfg.RedirectURI,
	}

	buf, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, "failed to encode payload", http.StatusInternalServerError)
		return
	}
	orchestratorURL := strings.TrimRight(getEnv("ORCHESTRATOR_URL", "http://127.0.0.1:4000"), "/")
	endpoint := fmt.Sprintf("%s/auth/%s/callback", orchestratorURL, url.PathEscape(provider))
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(buf))
	if err != nil {
		http.Error(w, "failed to create upstream request", http.StatusInternalServerError)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		http.Error(w, "failed to contact orchestrator", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		redirectWithStatus(w, r, data.RedirectURI, data.State, "error", extractErrorMessage(body))
		return
	}

	redirectWithStatus(w, r, data.RedirectURI, data.State, "success", "")
}

func redirectError(w http.ResponseWriter, r *http.Request, _ string, errParam string) {
	state := r.URL.Query().Get("state")
	if state == "" {
		http.Error(w, errParam, http.StatusBadRequest)
		return
	}
	data, ok := oauthStates.pop(state)
	if !ok {
		http.Error(w, errParam, http.StatusBadRequest)
		return
	}
	redirectWithStatus(w, r, data.RedirectURI, data.State, "error", errParam)
}

func redirectWithStatus(w http.ResponseWriter, r *http.Request, redirectURI, state, status, message string) {
	target, err := url.Parse(redirectURI)
	if err != nil {
		http.Error(w, "invalid redirect_uri", http.StatusInternalServerError)
		return
	}
	q := target.Query()
	if state != "" {
		q.Set("state", state)
	}
	q.Set("status", status)
	if status == "error" && message != "" {
		q.Set("error", message)
	}
	target.RawQuery = q.Encode()
	http.Redirect(w, r, target.String(), http.StatusFound)
}

func extractErrorMessage(body []byte) string {
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err == nil {
		if msg, ok := parsed["error"].(string); ok {
			return msg
		}
	}
	return string(body)
}

func generateStateAndPKCE() (string, string, string, error) {
	state, err := randomString(32)
	if err != nil {
		return "", "", "", err
	}
	verifier, err := randomString(64)
	if err != nil {
		return "", "", "", err
	}
	challenge := pkceChallenge(verifier)
	return state, verifier, challenge, nil
}

func randomString(length int) (string, error) {
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func buildAuthorizeURL(cfg oauthProvider, state, codeChallenge string) (string, error) {
	u, err := url.Parse(cfg.AuthorizeURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", cfg.RedirectURI)
	q.Set("state", state)
	q.Set("code_challenge", codeChallenge)
	q.Set("code_challenge_method", "S256")
	if len(cfg.Scopes) > 0 {
		q.Set("scope", strings.Join(cfg.Scopes, " "))
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func validateClientRedirect(redirectURI string) error {
	u, err := url.Parse(redirectURI)
	if err != nil {
		return errors.New("invalid redirect_uri")
	}
	if u.Scheme == "https" {
		return nil
	}
	if u.Scheme == "http" {
		host := strings.Split(u.Host, ":")[0]
		if host == "127.0.0.1" || host == "localhost" {
			return nil
		}
	}
	return errors.New("redirect_uri must be https or loopback")
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
