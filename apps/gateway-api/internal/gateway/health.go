package gateway

import (
	"encoding/json"
	"net/http"
	"time"
)

type healthResponse struct {
	Status        string            `json:"status"`
	UptimeSeconds float64           `json:"uptime_seconds"`
	Timestamp     time.Time         `json:"timestamp"`
	Details       map[string]string `json:"details"`
}

// RegisterHealthRoutes registers readiness and liveness endpoints for the gateway.
func RegisterHealthRoutes(mux *http.ServeMux, startedAt time.Time) {
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		resp := healthResponse{
			Status:        "ok",
			UptimeSeconds: time.Since(startedAt).Seconds(),
			Timestamp:     time.Now().UTC(),
			Details: map[string]string{
				"service": "gateway-api",
			},
		}

		w.Header().Set("Content-Type", "application/json")
		encoder := json.NewEncoder(w)
		encoder.Encode(resp)
	})
}
