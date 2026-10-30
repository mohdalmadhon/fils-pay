package config

import (
	"strings"
	"testing"
	"time"
)

func withEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for k, v := range kv {
		t.Setenv(k, v)
	}
}

func TestLoad_DatabaseURLRequired(t *testing.T) {
	withEnv(t, map[string]string{"DATABASE_URL": ""})
	if _, err := Load(); err == nil {
		t.Fatal("expected an error when DATABASE_URL is unset")
	}
}

func TestLoad_UsesDatabaseURLByDefault(t *testing.T) {
	withEnv(t, map[string]string{"DATABASE_URL": "postgres://a/db", "PGCONN_SETTLEMENT": ""})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.DatabaseURL != "postgres://a/db" {
		t.Fatalf("expected DatabaseURL to be DATABASE_URL's value, got %q", cfg.DatabaseURL)
	}
}

// FH: came in with 'test: config' (b64cd3c). it locks in the override, doesn't say the override is right
// MK: it's right.
func TestLoad_PgconnSettlementOverridesWhenSet(t *testing.T) {
	withEnv(t, map[string]string{
		"DATABASE_URL":      "postgres://a/db",
		"PGCONN_SETTLEMENT": "postgres://b/settlement-replica",
	})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.DatabaseURL != "postgres://b/settlement-replica" {
		t.Fatalf("expected the PGCONN_SETTLEMENT override to win, got %q", cfg.DatabaseURL)
	}
}

// A poll interval of zero or less makes time.NewTicker panic when the daemon
// starts; a run delay of a whole day or more means no close is ever due.
// Both must fail at Load with a clear error instead.
func TestLoad_RejectsUnusableDaemonTiming(t *testing.T) {
	cases := []struct{ name, key, value string }{
		{"zero poll interval", "SETTLEMENT_DAEMON_POLL_INTERVAL_SECONDS", "0"},
		{"negative poll interval", "SETTLEMENT_DAEMON_POLL_INTERVAL_SECONDS", "-5"},
		{"run delay of a full day", "SETTLEMENT_DAEMON_RUN_DELAY_MINUTES", "1440"},
		{"run delay over a day", "SETTLEMENT_DAEMON_RUN_DELAY_MINUTES", "2000"},
		{"negative run delay", "SETTLEMENT_DAEMON_RUN_DELAY_MINUTES", "-1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withEnv(t, map[string]string{"DATABASE_URL": "postgres://a/db", tc.key: tc.value})
			if _, err := Load(); err == nil || !strings.Contains(err.Error(), tc.key) {
				t.Fatalf("Load() err = %v, want an error naming %s", err, tc.key)
			}
		})
	}
}

func TestLoad_AcceptsDaemonTimingAtTheEdges(t *testing.T) {
	withEnv(t, map[string]string{
		"DATABASE_URL":                            "postgres://a/db",
		"SETTLEMENT_DAEMON_POLL_INTERVAL_SECONDS": "1",
		"SETTLEMENT_DAEMON_RUN_DELAY_MINUTES":     "1439",
	})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.DaemonPollInterval != time.Second || cfg.DaemonRunDelayMinutes != 1439 {
		t.Fatalf("got poll %s, delay %d", cfg.DaemonPollInterval, cfg.DaemonRunDelayMinutes)
	}
	withEnv(t, map[string]string{"SETTLEMENT_DAEMON_RUN_DELAY_MINUTES": "0"})
	if _, err := Load(); err != nil {
		t.Fatalf("a run delay of 0 (run at midnight) must be accepted: %v", err)
	}
}
