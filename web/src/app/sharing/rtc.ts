/** Non-trickle SDP keeps signalling bounded and never stores frames on the application server. */
export async function gatheredDescription(peer: RTCPeerConnection): Promise<string> {
  if (peer.iceGatheringState !== "complete")
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", changed);
        peer.removeEventListener("connectionstatechange", closed);
        resolve();
      };
      const changed = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      const closed = () => {
        if (peer.connectionState === "closed") {
          clearTimeout(timer);
          peer.removeEventListener("icegatheringstatechange", changed);
          peer.removeEventListener("connectionstatechange", closed);
          reject(new Error("Подключение закрыто"));
        }
      };
      const timer = setTimeout(finish, 7000);
      peer.addEventListener("icegatheringstatechange", changed);
      peer.addEventListener("connectionstatechange", closed);
    });
  const sdp = peer.localDescription?.sdp;
  if (!sdp || peer.signalingState === "closed") throw new Error("Видеоподключение закрыто");
  return sdp;
}
export function localShareChannel(code: string, channelId: string) {
  return new BroadcastChannel(`la-share-v1:${code}:${channelId}`);
}
