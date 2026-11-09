// Copyright 2026 Lecturer Assistant contributors.
// SPDX-License-Identifier: Apache-2.0
package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/livekit/protocol/auth"
)

func TestAccessInventoryRejectsNonLoopbackAndWrites(t *testing.T) {
	s := &LivekitServer{}
	for _, check := range []struct{ method, remote string }{
		{http.MethodGet, "192.0.2.10:1234"},
		{http.MethodGet, "not-an-address"},
		{http.MethodPost, "127.0.0.1:1234"},
	} {
		r := httptest.NewRequest(check.method, "/internal/access-inventory", nil)
		r.RemoteAddr = check.remote
		w := httptest.NewRecorder()
		s.accessInventory(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("unexpected status %d", w.Code)
		}
	}
}

func TestAccessInventoryRequiresAdministrativePermission(t *testing.T) {
	s := &LivekitServer{}
	for _, grants := range []*auth.ClaimGrants{nil, {Video: &auth.VideoGrant{RoomJoin: true}}} {
		r := httptest.NewRequest(http.MethodGet, "/internal/access-inventory", nil)
		r.RemoteAddr = "127.0.0.1:1234"
		if grants != nil {
			r = r.WithContext(WithGrants(r.Context(), grants, "test"))
		}
		w := httptest.NewRecorder()
		s.accessInventory(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("unexpected status %d", w.Code)
		}
	}
}

func TestAccessInventoryReturnsVersionedLocalEmptyState(t *testing.T) {
	s := &LivekitServer{roomManager: &RoomManager{}}
	r := httptest.NewRequest(http.MethodGet, "/internal/access-inventory", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	r = r.WithContext(WithGrants(r.Context(), &auth.ClaimGrants{Video: &auth.VideoGrant{RoomList: true}}, "test"))
	w := httptest.NewRecorder()
	s.accessInventory(w, r)
	var body struct {
		SchemaVersion int   `json:"schemaVersion"`
		Rooms         []any `json:"rooms"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK || body.SchemaVersion != 1 || body.Rooms == nil || len(body.Rooms) != 0 {
		t.Fatal("invalid inventory contract")
	}
}
