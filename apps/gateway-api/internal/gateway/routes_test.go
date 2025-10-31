package gateway

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHealthRouteReturnsReadinessData(t *testing.T) {
	mux := http.NewServeMux()
	started := time.Now().Add(-1 * time.Minute)
	RegisterHealthRoutes(mux, started)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	if contentType := rec.Header().Get("Content-Type"); !strings.Contains(contentType, "application/json") {
		t.Fatalf("expected JSON content type, got %s", contentType)
	}

	var body healthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	if body.Status != "ok" {
		t.Fatalf("unexpected status: %s", body.Status)
	}

	if body.UptimeSeconds <= 0 {
		t.Fatalf("expected positive uptime, got %f", body.UptimeSeconds)
	}
}

func TestEventsHandlerForwardsSSEStream(t *testing.T) {
	planPath := make(chan string, 1)
	orchestrator := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		planPath <- r.URL.Path
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("upstream recorder missing flusher")
		}
		events := []string{"data: first\n\n", "data: second\n\n"}
		for _, evt := range events {
			if _, err := io.WriteString(w, evt); err != nil {
				t.Fatalf("failed to write upstream event: %v", err)
			}
			flusher.Flush()
		}
	}))
	defer orchestrator.Close()

	handler := NewEventsHandler(orchestrator.Client(), orchestrator.URL, 50*time.Millisecond)

	mux := http.NewServeMux()
	mux.Handle("/events", handler)

	gatewaySrv := httptest.NewServer(mux)
	defer gatewaySrv.Close()

	req, err := http.NewRequest(http.MethodGet, gatewaySrv.URL+"/events?plan_id=abc-123", nil)
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}
	req.Header.Set("Accept", "text/event-stream")

	resp, err := gatewaySrv.Client().Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from gateway, got %d", resp.StatusCode)
	}

	if contentType := resp.Header.Get("Content-Type"); !strings.Contains(contentType, "text/event-stream") {
		t.Fatalf("expected text/event-stream, got %s", contentType)
	}

	reader := bufio.NewReader(resp.Body)
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("failed to read response body: %v", err)
	}

	bodyStr := string(data)
	if !strings.Contains(bodyStr, "data: first") || !strings.Contains(bodyStr, "data: second") {
		t.Fatalf("gateway did not forward SSE events: %q", bodyStr)
	}

	select {
	case path := <-planPath:
		if path != "/plan/abc-123/events" {
			t.Fatalf("unexpected upstream path: %s", path)
		}
	case <-time.After(time.Second):
		t.Fatal("gateway did not call orchestrator")
	}
}
