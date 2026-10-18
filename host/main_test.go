package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPing(t *testing.T) {
	reply := handle([]byte(`{"action":"ping"}`))
	data, err := json.Marshal(reply)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(data), `"pong"`) {
		t.Fatalf("expected pong, got %s", data)
	}
}

func TestUnknownActionRejected(t *testing.T) {
	reply := handle([]byte(`{"action":"rm -rf /"}`))
	data, _ := json.Marshal(reply)
	if !strings.Contains(string(data), "Unknown action requested") {
		t.Fatalf("expected rejection, got %s", data)
	}
}

func TestParseSmiOutput(t *testing.T) {
	output := "0, NVIDIA GeForce RTX 3060, 12, 9103, 12288, 34, 10.22\n" +
		"1, NVIDIA GeForce RTX 4060 Ti, 6, 13030, 16380, 42, 17.31\n"
	reply := parseSmiOutput(output).(map[string]any)

	if reply["count"] != 2 {
		t.Fatalf("count = %v", reply["count"])
	}
	gpus := reply["all_gpus"].([]gpu)
	if gpus[0].VramUsedMB != 9103 || gpus[1].TempC != 42 || gpus[1].PowerW != 17.31 {
		t.Fatalf("unexpected parse: %+v", gpus)
	}
}

func TestParseSmiPlaceholders(t *testing.T) {
	reply := parseSmiOutput("0, GPU, [N/A], 100, 200, [N/A], [N/A]\n").(map[string]any)
	gpus := reply["all_gpus"].([]gpu)
	if gpus[0].UtilPct != 0 || gpus[0].PowerW != 0 {
		t.Fatalf("placeholders should become 0: %+v", gpus[0])
	}
}

func TestParseSmiGarbage(t *testing.T) {
	reply := parseSmiOutput("not a csv line\n").(map[string]any)
	if reply["status"] != "parse_error" {
		t.Fatalf("expected parse_error, got %v", reply["status"])
	}
}

func TestPortFromLogName(t *testing.T) {
	match := portPattern.FindStringSubmatch("llama-1792350738-port-27505-try0.log")
	if match == nil || match[1] != "27505" {
		t.Fatalf("port not parsed: %v", match)
	}
}

func TestTailLinesKeepsLastAndStaysValidJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.log")
	var builder strings.Builder
	for i := 0; i < maxLogLines+50; i++ {
		builder.WriteString("\tsampler params line\n")
	}
	builder.WriteString("last line\n")
	if err := os.WriteFile(path, []byte(builder.String()), 0o600); err != nil {
		t.Fatal(err)
	}

	lines, err := tailLines(path, maxLogLines)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != maxLogLines {
		t.Fatalf("len = %d", len(lines))
	}
	if lines[len(lines)-1] != "last line" {
		t.Fatalf("newest line lost: %q", lines[len(lines)-1])
	}

	// Raw tabs inside a string used to make Chrome drop the whole frame.
	data, err := json.Marshal(map[string]any{"lines": lines})
	if err != nil || !json.Valid(data) {
		t.Fatalf("frame is not valid JSON: %v", err)
	}
}

func TestGetLogMissingPath(t *testing.T) {
	reply := getLog(`C:\definitely\not\here\server.log`).(map[string]any)
	if reply["status"] != "error" {
		t.Fatalf("expected error, got %v", reply["status"])
	}
}
