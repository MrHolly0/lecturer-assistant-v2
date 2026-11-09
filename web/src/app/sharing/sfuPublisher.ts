import type { Room } from "livekit-client";
import { publisherSfuTicket } from "../api/share-api";
import { shareVideoBitrate, SHARE_FRAME_RATE } from "./shareQuality";

/** One upstream track per lecturer, independently of the number of students. */
export class SfuPublisher {
  private room: Room | null = null;
  private busy = false;
  private generation = 0;
  private retryAt = 0;
  private failures = 0;
  async sync(course: string, session: string, id: string, stream: MediaStream, paused: boolean) {
    if (paused) {
      this.stop();
      return;
    }
    if (this.busy || (this.room && this.room.state !== "disconnected") || Date.now() < this.retryAt)
      return;
    this.busy = true;
    const generation = this.generation;
    let room: Room | null = null;
    try {
      const { Room, Track } = await import("livekit-client");
      if (generation !== this.generation) return;
      room = new Room({
        adaptiveStream: false,
        dynacast: false,
        disconnectOnPageLeave: true,
        stopLocalTrackOnUnpublish: false
      });
      const ticket = await publisherSfuTicket(course, session, id);
      if (generation !== this.generation) return;
      this.room = room;
      await room.connect(ticket.url, ticket.token, { autoSubscribe: false });
      if (generation !== this.generation) {
        await room.disconnect(false);
        return;
      }
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === "ended")
        throw new Error("Источник демонстрации остановлен");
      const settings = track.getSettings();
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.ScreenShare,
        simulcast: false,
        videoCodec: "vp8",
        degradationPreference: "maintain-resolution",
        videoEncoding: {
          maxBitrate: shareVideoBitrate(settings.width ?? 1920, settings.height ?? 1080),
          maxFramerate: SHARE_FRAME_RATE
        }
      });
      this.failures = 0;
    } catch {
      await room?.disconnect(false);
      if (this.room === room) this.room = null;
      this.retryAt =
        Date.now() + 500 + Math.random() * Math.min(30000, 1500 * 2 ** this.failures++);
    } finally {
      this.busy = false;
    }
  }
  stop() {
    this.generation++;
    const room = this.room;
    this.room = null;
    if (room) void room.disconnect(false);
  }
}
