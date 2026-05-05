"use client";

/**
 * useVoiceChannel — mesh-P2P WebRTC voice with HMAC-authenticated signaling
 * over Supabase Realtime.
 *
 *   AUDIO PATH:    peer ⇄ peer (DTLS-SRTP). Server is never on-path.
 *   SIGNAL PATH:   Supabase broadcast + presence. The Supabase server sees
 *                  SDP/ICE but cannot forge them — every offer/answer carries
 *                  an HMAC-SHA-256 of the SDP signed with the server epoch
 *                  key, which the Supabase server doesn't hold. A receiver
 *                  discards any SDP whose HMAC fails to verify.
 *
 *   Roster:        Supabase Presence on `voice:<channelId>`. Each participant
 *                  generates a per-session UUID (was socket.id under
 *                  Socket.IO) and tracks themselves under that key. The
 *                  presence sync gives us the initial peer list; join/leave
 *                  events handle deltas.
 *
 *   Targeting:     Broadcast goes to all subscribers of the channel, so each
 *                  payload includes a `to` field with the recipient's session
 *                  id. Other peers ignore broadcasts not addressed to them.
 *
 *   Initiator:     When peer A and B see each other, the side with the
 *                  lexicographically smaller session id offers. Avoids glare.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useTideCloak } from "@tidecloak/nextjs";
import { getSupabase } from "@/lib/supabase";
import { signSdp, verifySdp } from "@/lib/crypto";
import { trackVoiceJoin, untrackVoiceLeave } from "@/lib/voiceRoster";

// STUN-only works for ~80% of NAT pairs. The remaining 20% (symmetric NAT,
// some corporate networks) need a TURN relay. We include a free public
// `openrelay` TURN here for development; for production, run your own coturn
// or sign up for Twilio/Metered. The relay is a fallback — STUN tries first.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export interface VoicePeer {
  socketId: string;
  userId: string;
  speaking: boolean;
  hasVideo: boolean;
  /** Round-trip time in milliseconds, or null if not yet measured. */
  rttMs: number | null;
  /** Live MediaStream — attach via <video srcObject={stream}>. */
  stream: MediaStream | null;
}

interface State {
  joined: boolean;
  connecting: boolean;
  muted: boolean;
  deafened: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  peers: VoicePeer[];
  /** Local mic/cam stream — for self-view PiP. */
  localStream: MediaStream | null;
  /** Whether the local user is currently speaking (analyser-driven). */
  selfSpeaking: boolean;
  error: string | null;
}

export function useVoiceChannel(
  channelId: string | null,
  epochKey: CryptoKey | null,
) {
  const { getValueFromToken } = useTideCloak();

  const [state, setState] = useState<State>({
    joined: false,
    connecting: false,
    muted: false,
    deafened: false,
    videoEnabled: false,
    screenSharing: false,
    peers: [],
    localStream: null,
    selfSpeaking: false,
    error: null,
  });

  // Refs hold mutable WebRTC state without re-rendering on every change.
  const localStreamRef = useRef<MediaStream | null>(null);
  /** Original camera track held aside while screen share is active so we can
   *  swap back when the user stops sharing. */
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const peerConnsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const speakingTimersRef = useRef<Map<string, number>>(new Map());
  const epochKeyRef = useRef<CryptoKey | null>(null);
  /** Per-tab unique id, used in place of socket.id for tie-breaking and as
   *  the presence key. Stable for this hook instance. */
  const sessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  );
  useEffect(() => {
    epochKeyRef.current = epochKey;
  }, [epochKey]);

  const myUserId = (getValueFromToken("sub") as string) || null;

  // Voice needs a presence key equal to our session id so the same identifier
  // tie-breaks initiators and routes targeted broadcasts. We manage this
  // channel directly because Supabase requires `.on(...)` handlers to be
  // registered BEFORE `subscribe()` — RealtimeProvider's helper does the
  // subscribe up-front, which is fine for plain broadcast but not for
  // presence/voice signaling that we attach handlers for.
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Stable refs for things the handlers read so we can register them once,
  // before subscribe, without needing to re-subscribe every time React state
  // changes.
  const myUserIdRef = useRef<string | null>(null);
  myUserIdRef.current = myUserId;

  // ── Per-peer connection setup ──────────────────────────────────────────────

  // Note: this callback intentionally has no deps. It reads `channelRef` and
  // `localStreamRef` so it stays stable across renders, which lets the
  // signaling effect register handlers exactly once before subscribe().
  const ensurePeerConnection = useCallback(
    (peerSocketId: string, peerUserId: string): RTCPeerConnection => {
      const existing = peerConnsRef.current.get(peerSocketId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peerConnsRef.current.set(peerSocketId, pc);

      // Add local tracks so the mic flows out to this peer.
      const tracks = localStreamRef.current?.getTracks() ?? [];
      console.log(
        "[voice] new RTCPeerConnection for",
        peerSocketId,
        "addTrack count:",
        tracks.length,
        tracks.map((t) => t.kind).join(","),
      );
      if (localStreamRef.current) {
        for (const track of tracks) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      pc.onicecandidate = (e) => {
        const ch = channelRef.current;
        if (e.candidate && ch && channelId) {
          ch.send({
            type: "broadcast",
            event: "voice:ice-candidate",
            payload: {
              to: peerSocketId,
              from: sessionIdRef.current,
              channelId,
              candidate: e.candidate.toJSON(),
            },
          });
        }
      };

      // Track which tracks we've already wired listeners to so renegotiation
      // (which fires a fresh `ontrack` for each existing track) doesn't stack
      // up a new handler each time. The browser GCs old closures eventually
      // but the leak adds up over a long call.
      const wiredTracks = new WeakSet<MediaStreamTrack>();

      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        remoteStreamsRef.current.set(peerSocketId, stream);

        console.log(
          "[voice] ontrack from",
          peerSocketId,
          "kind:",
          e.track.kind,
          "id:",
          e.track.id,
          "readyState:",
          e.track.readyState,
          "muted:",
          e.track.muted,
          "enabled:",
          e.track.enabled,
          "streamTracks:",
          stream.getTracks().map((t) => `${t.kind}(${t.readyState}/muted=${t.muted})`),
        );

        const refreshHasVideo = () => {
          const hasVideo = stream
            .getVideoTracks()
            .some((t) => t.readyState === "live" && !t.muted && t.enabled);
          console.log(
            "[voice] refreshHasVideo",
            peerSocketId,
            "hasVideo:",
            hasVideo,
          );
          setState((s) => ({
            ...s,
            peers: s.peers.map((p) =>
              p.socketId === peerSocketId ? { ...p, stream, hasVideo } : p,
            ),
          }));
        };
        refreshHasVideo();

        if (!wiredTracks.has(e.track)) {
          wiredTracks.add(e.track);
          e.track.addEventListener("mute", refreshHasVideo);
          e.track.addEventListener("unmute", refreshHasVideo);
          e.track.addEventListener("ended", refreshHasVideo);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log("[voice] connection state", peerSocketId, pc.connectionState);
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          dropPeer(peerSocketId);
        }
      };
      pc.oniceconnectionstatechange = () => {
        console.log("[voice] ICE state", peerSocketId, pc.iceConnectionState);
      };

      setState((s) =>
        s.peers.some((p) => p.socketId === peerSocketId)
          ? s
          : {
              ...s,
              peers: [
                ...s.peers,
                {
                  socketId: peerSocketId,
                  userId: peerUserId,
                  speaking: false,
                  hasVideo: false,
                  rttMs: null,
                  stream: null,
                },
              ],
            },
      );

      return pc;
    },
    [channelId],
  );

  const dropPeer = useCallback((peerSocketId: string) => {
    const pc = peerConnsRef.current.get(peerSocketId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      peerConnsRef.current.delete(peerSocketId);
    }
    remoteStreamsRef.current.delete(peerSocketId);
    setState((s) => ({
      ...s,
      peers: s.peers.filter((p) => p.socketId !== peerSocketId),
    }));
    const t = speakingTimersRef.current.get(peerSocketId);
    if (t) clearInterval(t);
    speakingTimersRef.current.delete(peerSocketId);
  }, []);

  // ── Signaling (presence + broadcast) ──────────────────────────────────────
  //
  // Single effect that creates the channel, registers all handlers, and
  // calls subscribe() — in that order, because Supabase rejects
  // `.on(...)` calls made after `subscribe()`.

  useEffect(() => {
    if (!channelId || !state.joined) {
      setChannel(null);
      channelRef.current = null;
      return;
    }
    const mySessionId = sessionIdRef.current;
    const supabase = getSupabase();
    const ch = supabase.channel(`voice:${channelId}`, {
      config: {
        broadcast: { self: false, ack: true },
        presence: { key: mySessionId },
      },
    });
    channelRef.current = ch;

    const initiateOffer = async (peerSocketId: string, peerUserId: string) => {
      const pc = ensurePeerConnection(peerSocketId, peerUserId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!epochKeyRef.current) throw new Error("epoch key missing");
      const sigSdp = await signSdp(epochKeyRef.current, offer.sdp ?? "");
      ch.send({
        type: "broadcast",
        event: "voice:offer",
        payload: {
          to: peerSocketId,
          from: mySessionId,
          fromUserId: myUserIdRef.current,
          channelId,
          sdp: offer.sdp,
          sigSdp,
        },
      });
    };

    // Register handlers BEFORE subscribe(). After subscribe Supabase rejects
    // further .on() calls.
    ch
      .on("presence", { event: "sync" }, () => {
        const stateMap = ch.presenceState() as Record<
          string,
          Array<{ userId: string }>
        >;
        const peerKeys = Object.keys(stateMap).filter((k) => k !== mySessionId);
        console.log("[voice] presence:sync", {
          mySessionId,
          roster: Object.keys(stateMap),
          peerKeys,
        });
        for (const peerId of peerKeys) {
          const peerUserId = stateMap[peerId][0]?.userId ?? "";
          if (mySessionId < peerId) {
            console.log("[voice] sync → offer to", peerId);
            initiateOffer(peerId, peerUserId).catch((e) =>
              console.warn("[voice] offer failed", e),
            );
          } else {
            // Pre-create the peer connection so the tile shows up while we
            // wait for the other side (with the smaller id) to send its offer.
            ensurePeerConnection(peerId, peerUserId);
          }
        }
      })
      .on("presence", { event: "join" }, ({ key, newPresences }) => {
        if (key === mySessionId) return;
        const peerUserId =
          (newPresences[0] as { userId?: string })?.userId ?? "";
        console.log("[voice] presence:join", { key, peerUserId, mySessionId });
        if (mySessionId < key) {
          initiateOffer(key, peerUserId).catch((e) =>
            console.warn("[voice] offer to newcomer failed", e),
          );
        } else {
          ensurePeerConnection(key, peerUserId);
        }
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        if (key === mySessionId) return;
        console.log("[voice] presence:leave", key);
        dropPeer(key);
      })
      .on("broadcast", { event: "voice:offer" }, async ({ payload }) => {
        const p = payload as {
          to: string;
          from: string;
          fromUserId: string;
          channelId: string;
          sdp: string;
          sigSdp: string;
        };
        if (p.to !== mySessionId) return;
        if (p.channelId !== channelId) return;
        if (!epochKeyRef.current) return;
        const ok = await verifySdp(epochKeyRef.current, p.sdp, p.sigSdp);
        if (!ok) {
          console.warn("[voice] rejected offer with bad MAC from", p.from);
          return;
        }
        const pc = ensurePeerConnection(p.from, p.fromUserId);
        await pc.setRemoteDescription({ type: "offer", sdp: p.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        const sigSdp = await signSdp(epochKeyRef.current, answer.sdp ?? "");
        ch.send({
          type: "broadcast",
          event: "voice:answer",
          payload: {
            to: p.from,
            from: mySessionId,
            channelId,
            sdp: answer.sdp,
            sigSdp,
          },
        });
      })
      .on("broadcast", { event: "voice:answer" }, async ({ payload }) => {
        const p = payload as {
          to: string;
          from: string;
          channelId: string;
          sdp: string;
          sigSdp: string;
        };
        if (p.to !== mySessionId) return;
        if (p.channelId !== channelId) return;
        if (!epochKeyRef.current) return;
        const ok = await verifySdp(epochKeyRef.current, p.sdp, p.sigSdp);
        if (!ok) {
          console.warn("[voice] rejected answer with bad MAC from", p.from);
          return;
        }
        const pc = peerConnsRef.current.get(p.from);
        if (!pc) return;
        await pc.setRemoteDescription({ type: "answer", sdp: p.sdp });
      })
      .on("broadcast", { event: "voice:ice-candidate" }, async ({ payload }) => {
        const p = payload as {
          to: string;
          from: string;
          channelId: string;
          candidate: RTCIceCandidateInit;
        };
        if (p.to !== mySessionId) return;
        if (p.channelId !== channelId) return;
        const pc = peerConnsRef.current.get(p.from);
        if (!pc) return;
        try {
          await pc.addIceCandidate(p.candidate);
        } catch (e) {
          console.warn("[voice] addIceCandidate failed", e);
        }
      });

    // Subscribe AFTER all handlers are attached. Once subscribed, expose the
    // channel via state and start tracking ourselves in presence.
    ch.subscribe(async (status) => {
      console.log("[voice] subscribe status", status, mySessionId);
      if (status === "SUBSCRIBED") {
        setChannel(ch);
        try {
          await ch.track({ userId: myUserIdRef.current, sessionId: mySessionId });
          console.log("[voice] presence tracked", mySessionId);
        } catch (e) {
          console.warn("[voice] presence track failed", e);
        }
      }
    });

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
      setChannel(null);
      channelRef.current = null;
    };
  }, [channelId, state.joined, ensurePeerConnection, dropPeer]);

  // ── Speaking-level polling ────────────────────────────────────────────────

  useEffect(() => {
    if (!state.joined) return;
    const interval = window.setInterval(async () => {
      const speakingUpdates: Record<string, boolean> = {};
      const rttUpdates: Record<string, number | null> = {};
      for (const [peerId, pc] of peerConnsRef.current) {
        try {
          const stats = await pc.getStats();
          let speaking = false;
          let rttMs: number | null = null;
          stats.forEach((s) => {
            if (
              s.type === "inbound-rtp" &&
              s.kind === "audio" &&
              typeof (s as any).audioLevel === "number" &&
              (s as any).audioLevel > 0.02
            ) {
              speaking = true;
            }
            // Selected ICE pair gives us the live RTT of the underlying
            // DTLS-SRTP transport — same number Chrome shows in chrome://webrtc-internals.
            if (
              s.type === "candidate-pair" &&
              (s as any).state === "succeeded" &&
              (s as any).nominated &&
              typeof (s as any).currentRoundTripTime === "number"
            ) {
              rttMs = Math.round(
                ((s as any).currentRoundTripTime as number) * 1000,
              );
            }
          });
          speakingUpdates[peerId] = speaking;
          if (rttMs !== null) rttUpdates[peerId] = rttMs;
        } catch {}
      }
      setState((s) => ({
        ...s,
        peers: s.peers.map((p) => {
          let next = p;
          if (p.socketId in speakingUpdates) {
            next = { ...next, speaking: speakingUpdates[p.socketId] };
          }
          if (p.socketId in rttUpdates) {
            next = { ...next, rttMs: rttUpdates[p.socketId] };
          }
          return next;
        }),
      }));
    }, 1500);
    return () => clearInterval(interval);
  }, [state.joined]);

  // ── Local mic-level analyser → selfSpeaking ───────────────────────────────
  // We tap the local stream's audio track with an AnalyserNode and poll the
  // RMS amplitude on a short interval. Threshold tuned to cut background hum.
  useEffect(() => {
    if (!state.joined || !state.localStream || state.muted) {
      if (state.selfSpeaking) {
        setState((s) => ({ ...s, selfSpeaking: false }));
      }
      return;
    }
    const audio = state.localStream.getAudioTracks()[0];
    if (!audio) return;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ac = new Ctor();
    const source = ac.createMediaStreamSource(
      new MediaStream([audio]),
    );
    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const interval = window.setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      const speaking = peak > 18;
      setState((s) =>
        s.selfSpeaking === speaking ? s : { ...s, selfSpeaking: speaking },
      );
    }, 200);
    return () => {
      clearInterval(interval);
      try {
        source.disconnect();
        analyser.disconnect();
        void ac.close();
      } catch {}
    };
  }, [state.joined, state.localStream, state.muted, state.selfSpeaking]);

  // ── Public actions ─────────────────────────────────────────────────────────

  const join = useCallback(
    async (opts: { withVideo?: boolean } = {}) => {
      if (!channelId || state.joined || state.connecting) return;
      if (!epochKey) {
        setState((s) => ({
          ...s,
          error:
            "Server key not available — can't authenticate voice signaling",
        }));
        return;
      }
      setState((s) => ({ ...s, connecting: true, error: null }));
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            // Modest defaults: 480p @ 24fps is plenty for a Discord-style
            // tile and roughly 4× cheaper to encode/decode than 720p30. WSL2
            // / weak GPUs run out of decode budget at higher settings and
            // crash the renderer process. Users can upgrade later if needed.
            video: opts.withVideo
              ? {
                  width: { ideal: 640 },
                  height: { ideal: 480 },
                  frameRate: { ideal: 24 },
                }
              : false,
          });
        } catch (err) {
          if (opts.withVideo) {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
              video: false,
            });
          } else {
            throw err;
          }
        }

        localStreamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) cameraTrackRef.current = videoTrack;

        // Setting joined=true triggers the channel acquisition + presence track
        // in the effect above.
        setState((s) => ({
          ...s,
          joined: true,
          connecting: false,
          videoEnabled: !!videoTrack,
          localStream: stream,
        }));
        // Announce on the global voice roster so the sidebar can show who's
        // in voice across all channels without subscribing to per-channel
        // signaling topics.
        if (myUserId) void trackVoiceJoin(channelId, myUserId);
      } catch (err: any) {
        const name = err?.name || "";
        let msg = err?.message || "Failed to access microphone";
        if (name === "NotFoundError") {
          msg =
            "No microphone detected. If you're on WSL2, the browser can't see " +
            "Windows' audio devices — open the app from a Windows-side browser " +
            "instead, or run with `chrome --use-fake-device-for-media-stream` " +
            "for testing.";
        } else if (name === "NotAllowedError") {
          msg =
            "Microphone permission denied. Click the camera/mic icon in your " +
            "address bar and allow access, then retry.";
        } else if (name === "NotReadableError") {
          msg =
            "Microphone is in use by another application. Close it and retry.";
        } else if (name === "OverconstrainedError") {
          msg = `Camera/mic doesn't support the requested constraints: ${err.constraint || "unknown"}`;
        }
        setState((s) => ({ ...s, connecting: false, error: msg }));
      }
    },
    [channelId, state.joined, state.connecting, epochKey],
  );

  const leave = useCallback(() => {
    const ch = channelRef.current;
    if (ch) {
      try {
        ch.untrack();
      } catch {}
    }
    void untrackVoiceLeave();
    for (const id of Array.from(peerConnsRef.current.keys())) dropPeer(id);
    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop();
      localStreamRef.current = null;
    }
    cameraTrackRef.current = null;
    setState({
      joined: false,
      connecting: false,
      muted: false,
      deafened: false,
      videoEnabled: false,
      screenSharing: false,
      peers: [],
      localStream: null,
      selfSpeaking: false,
      error: null,
    });
  }, [dropPeer]);

  const toggleMute = useCallback(() => {
    setState((s) => {
      const next = !s.muted;
      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getAudioTracks()) {
          t.enabled = !next;
        }
      }
      return { ...s, muted: next };
    });
  }, []);

  /** Push-to-talk override: when held, force-enable the mic regardless of
   *  the muted flag; on release, revert to whatever `muted` says. We don't
   *  toggle the React state — that would cause re-renders on each keypress
   *  AND drop the muted intent. We just flip the underlying track. */
  const setPushToTalk = useCallback((pressed: boolean) => {
    if (!localStreamRef.current) return;
    for (const t of localStreamRef.current.getAudioTracks()) {
      // When pressed: always on. When released: respect current mute state.
      t.enabled = pressed ? true : !stateRef.current.muted;
    }
  }, []);
  // Keep a live ref to current state so setPushToTalk's release path can read
  // the latest `muted` value without us needing to re-create the callback.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const toggleDeafen = useCallback(() => {
    setState((s) => {
      const next = !s.deafened;
      for (const stream of remoteStreamsRef.current.values()) {
        for (const t of stream.getAudioTracks()) t.enabled = !next;
      }
      if (next && localStreamRef.current) {
        for (const t of localStreamRef.current.getAudioTracks()) t.enabled = false;
      }
      return { ...s, deafened: next, muted: next || s.muted };
    });
  }, []);

  const toggleVideo = useCallback(() => {
    if (state.screenSharing) return;
    setState((s) => {
      const next = !s.videoEnabled;
      const track = cameraTrackRef.current;
      if (track) track.enabled = next;
      return { ...s, videoEnabled: next };
    });
  }, [state.screenSharing]);

  /** Swap the camera track back onto every peer's video sender and clean up
   *  any stale screen tracks from the local stream. Called from the toggle
   *  button AND from the screen track's `onended` handler when the user uses
   *  the browser's native "Stop sharing" UI — both paths must do the same
   *  thing or the camera doesn't come back. */
  const swapBackToCamera = useCallback(async () => {
    const camTrack = cameraTrackRef.current;
    for (const pc of peerConnsRef.current.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        try {
          await sender.replaceTrack(camTrack ?? null);
        } catch (e) {
          console.warn("[voice] swapBackToCamera replaceTrack failed", e);
        }
      }
    }
    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getVideoTracks()) {
        if (t !== camTrack) {
          try {
            t.stop();
          } catch {}
          localStreamRef.current.removeTrack(t);
        }
      }
      if (camTrack && !localStreamRef.current.getTracks().includes(camTrack)) {
        localStreamRef.current.addTrack(camTrack);
      }
    }
    // Restore camera-on/off state to whatever the camera track is currently
    // set to. If the user had toggled video off before sharing, we leave it
    // off; if they had it on, we leave it on.
    setState((s) => ({
      ...s,
      screenSharing: false,
      videoEnabled: !!camTrack && camTrack.enabled,
    }));
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (state.screenSharing) {
      await swapBackToCamera();
      return;
    }

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
      });
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) throw new Error("no video track in screen share");

      // When the user clicks the browser's native "Stop sharing" UI the
      // screen track ends. We don't get a fresh button click to drive the
      // toggle, so we have to do the swap ourselves here.
      screenTrack.onended = () => {
        // Detach so we don't double-swap if the toggle button is also clicked.
        screenTrack.onended = null;
        swapBackToCamera().catch((e) =>
          console.warn("[voice] camera swap-back failed", e),
        );
      };

      const renegotiate: Array<[string, RTCPeerConnection]> = [];
      for (const [peerId, pc] of peerConnsRef.current) {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) {
          await sender.replaceTrack(screenTrack);
        } else {
          pc.addTrack(screenTrack, localStreamRef.current ?? new MediaStream());
          renegotiate.push([peerId, pc]);
        }
      }

      const mySessionId = sessionIdRef.current;
      for (const [peerId, pc] of renegotiate) {
        const ch = channelRef.current;
        if (!ch || !epochKeyRef.current) break;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sigSdp = await signSdp(epochKeyRef.current, offer.sdp ?? "");
        ch.send({
          type: "broadcast",
          event: "voice:offer",
          payload: {
            to: peerId,
            from: mySessionId,
            fromUserId: myUserIdRef.current,
            channelId,
            sdp: offer.sdp,
            sigSdp,
          },
        });
      }

      if (localStreamRef.current) {
        localStreamRef.current.addTrack(screenTrack);
      }
      setState((s) => ({ ...s, screenSharing: true }));
    } catch (err: any) {
      setState((s) => ({
        ...s,
        error: err?.message || "Failed to start screen share",
      }));
    }
  }, [state.screenSharing, channelId, swapBackToCamera]);

  // Cleanup on unmount or channel change
  useEffect(() => {
    return () => {
      if (state.joined) leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  return {
    ...state,
    myUserId,
    join,
    leave,
    toggleMute,
    toggleDeafen,
    toggleVideo,
    toggleScreenShare,
    setPushToTalk,
  };
}
