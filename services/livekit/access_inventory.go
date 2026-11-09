// Copyright 2026 Lecturer Assistant contributors.
// SPDX-License-Identifier: Apache-2.0
package service

import (
	"encoding/json"
	"net"
	"net/http"
)

// Compact local inventory for the co-located permission supervisor. No Redis or remote SFU call.
func (s *LivekitServer) accessInventory(w http.ResponseWriter, r *http.Request) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || !net.ParseIP(host).IsLoopback() || r.Method != http.MethodGet {
		http.Error(w, "loopback only", http.StatusForbidden)
		return
	}
	if EnsureListPermission(r.Context()) != nil {
		http.Error(w, "administrative permission required", http.StatusForbidden)
		return
	}
	type permission struct {
		CanPublish   bool `json:"canPublish"`
		CanSubscribe bool `json:"canSubscribe"`
	}
	type participant struct {
		Identity   string     `json:"identity"`
		Permission permission `json:"permission"`
	}
	type inventoryRoom struct {
		Name         string        `json:"name"`
		Participants []participant `json:"participants"`
	}
	rooms := make([]inventoryRoom, 0)
	total := 0
	s.roomManager.lock.RLock()
	for _, room := range s.roomManager.rooms {
		members := room.GetParticipants()
		total += len(members)
		if len(rooms) >= 128 || total > 20000 {
			s.roomManager.lock.RUnlock()
			http.Error(w, "inventory capacity", http.StatusServiceUnavailable)
			return
		}
		entry := inventoryRoom{Name: room.ToProto().GetName(), Participants: make([]participant, 0, len(members))}
		for _, person := range members {
			info := person.ToProto()
			entry.Participants = append(entry.Participants, participant{
				Identity: string(person.Identity()), Permission: permission{
					CanPublish:   info.GetPermission().GetCanPublish(),
					CanSubscribe: info.GetPermission().GetCanSubscribe(),
				},
			})
		}
		rooms = append(rooms, entry)
	}
	s.roomManager.lock.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(struct {
		SchemaVersion int             `json:"schemaVersion"`
		Rooms         []inventoryRoom `json:"rooms"`
	}{1, rooms})
}
