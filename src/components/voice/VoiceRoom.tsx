"use client";

/**
 * VoiceRoom — Discord-style voice + video room.
 *
 *  - Tile grid auto-sizes by participant count: solo = 1 big tile,
 *    2 = side-by-side, 3-4 = 2×2, 5-9 = 3×3, etc.
 *  - Each tile is aspect-video; live <video> when the peer has video,
 *    avatar circle otherwise.
 *  - Self-view PiP in the bottom-right (auto-muted to avoid feedback).
 *  - Pre-join: "Voice Only" + "Join with Video" buttons.
 *  - Floating control bar at the bottom: mic, camera, screen share, deafen,
 *    disconnect. Active states are red/inset; idle are subtle.
 *
 *  Audio + video both ride the same RTCPeerConnection mesh — DTLS-SRTP
 *  encrypts both end-to-end. Signaling SDP is HMAC-signed with the server
 *  epoch key so the relay can't MITM.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Volume2,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  PhoneOff,
  Video,
  VideoOff,
  MonitorUp,
  MonitorOff,
  Loader2,
  Lock,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceChannel } from "@/hooks/useVoiceChannel";
import { useEpochKey } from "@/hooks/useEpochKey";
import { playVoiceJoin, playVoiceLeave } from "@/lib/notify-sound";

interface VoiceRoomProps {
  serverId: string | null;
  channelId: string;
  channelName: string;
  /** Map of userId → display name for nicer peer labels. */
  memberLabels?: Map<string, { displayName: string; initials: string }>;
}

export function VoiceRoom({
  serverId,
  channelId,
  channelName,
  memberLabels,
}: VoiceRoomProps) {
  const { epochKey, loading: epochLoading } = useEpochKey(serverId);
  const voice = useVoiceChannel(channelId, epochKey);
  const ready = !!epochKey;

  // Total tile count drives the grid layout — include self if joined.
  const tileCount = (voice.joined ? 1 : 0) + voice.peers.length;
  const gridClass = useMemo(() => gridClassForCount(tileCount), [tileCount]);

  // Play a small ding when the peer set changes, so you hear when someone
  // joins or leaves the voice channel you're in. We compare to the prior
  // tick by remembering the set of peer userIds.
  const prevPeerKey = useRef<string>("");
  useEffect(() => {
    if (!voice.joined) {
      prevPeerKey.current = "";
      return;
    }
    const next = voice.peers
      .map((p) => p.userId)
      .sort()
      .join(",");
    const prev = prevPeerKey.current;
    if (prev && next !== prev) {
      const beforeIds = new Set(prev.split(",").filter(Boolean));
      const afterIds = new Set(next.split(",").filter(Boolean));
      const joined = [...afterIds].some((id) => !beforeIds.has(id));
      const left = [...beforeIds].some((id) => !afterIds.has(id));
      if (joined) playVoiceJoin();
      else if (left) playVoiceLeave();
    }
    prevPeerKey.current = next;
  }, [voice.peers, voice.joined]);

  // Push-to-talk: hold Shift+Space to broadcast while muted. We swallow the
  // keypress only when we'd actually want to PTT (joined + muted), so users
  // typing in the chat composer aren't disrupted. Auto-repeat is suppressed.
  const [pttActive, setPttActive] = useState(false);
  useEffect(() => {
    if (!voice.joined) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!(e.shiftKey && e.code === "Space")) return;
      // Don't hijack typing in inputs / textareas / contenteditable.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      voice.setPushToTalk(true);
      setPttActive(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== "Shift") return;
      voice.setPushToTalk(false);
      setPttActive(false);
    };
    const onBlur = () => {
      voice.setPushToTalk(false);
      setPttActive(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [voice.joined, voice.setPushToTalk]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-100/20 px-4 shadow-sm">
        <Volume2 className="h-5 w-5 text-muted" />
        <span className="font-semibold text-white">{channelName}</span>
        {voice.joined && (
          <span className="ml-2 rounded bg-surface-100/40 px-1.5 py-0.5 text-xs text-muted">
            {tileCount} {tileCount === 1 ? "person" : "people"}
          </span>
        )}
        {voice.joined ? (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
            <ShieldCheck className="h-3 w-3" />
            P2P · DTLS-SRTP
          </span>
        ) : !ready ? (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
            <AlertTriangle className="h-3 w-3" />
            Awaiting key
          </span>
        ) : (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-surface-100/40 px-2 py-0.5 text-xs text-muted">
            <Lock className="h-3 w-3" />
            Ready
          </span>
        )}
      </header>

      {voice.error && (
        <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-1.5 text-xs text-red-400">
          {voice.error}
        </div>
      )}

      {/* Body */}
      <div className="relative flex flex-1 overflow-hidden bg-surface-300">
        {!voice.joined ? (
          <PreJoin
            channelName={channelName}
            ready={ready}
            epochLoading={epochLoading}
            connecting={voice.connecting}
            onJoinAudio={() => voice.join({ withVideo: false })}
            onJoinVideo={() => voice.join({ withVideo: true })}
          />
        ) : (
          <div
            className={cn(
              "grid h-full w-full gap-2 p-2 sm:gap-3 sm:p-4",
              gridClass,
            )}
          >
            {/* Self tile (always shown when joined) */}
            <PeerTile
              isMe
              stream={voice.localStream}
              hasVideo={voice.videoEnabled || voice.screenSharing}
              speaking={voice.selfSpeaking && !voice.muted}
              muted={voice.muted}
              isScreenSharing={voice.screenSharing}
              userId={voice.myUserId ?? "me"}
              label={memberLabels?.get(voice.myUserId ?? "")}
              deafened={voice.deafened}
            />
            {voice.peers.map((peer) => (
              <PeerTile
                key={peer.socketId}
                isMe={false}
                stream={peer.stream}
                hasVideo={peer.hasVideo}
                speaking={peer.speaking}
                muted={false /* TODO: surface peer mute via presence meta */}
                isScreenSharing={false /* TODO: surface peer screen-sharing flag */}
                userId={peer.userId}
                label={memberLabels?.get(peer.userId)}
                deafened={voice.deafened}
                duck={voice.selfSpeaking && !voice.muted}
                rttMs={peer.rttMs}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating control bar */}
      {voice.joined && (
        <div className="flex shrink-0 items-center justify-center gap-1.5 border-t border-surface-100/20 bg-surface-200/95 px-4 py-3 backdrop-blur">
          {pttActive && (
            <span className="absolute left-4 flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-300">
              <Mic className="h-3 w-3" />
              Push-to-talk
            </span>
          )}
          <ControlButton
            label={voice.muted ? "Unmute (or hold Shift+Space)" : "Mute"}
            on={!voice.muted || pttActive}
            onClick={voice.toggleMute}
            iconOn={<Mic className="h-5 w-5" />}
            iconOff={<MicOff className="h-5 w-5" />}
          />
          <ControlButton
            label={voice.videoEnabled ? "Stop camera" : "Start camera"}
            on={voice.videoEnabled}
            disabled={voice.screenSharing}
            onClick={voice.toggleVideo}
            iconOn={<Video className="h-5 w-5" />}
            iconOff={<VideoOff className="h-5 w-5" />}
          />
          <ControlButton
            label={voice.screenSharing ? "Stop sharing" : "Share screen"}
            on={voice.screenSharing}
            onClick={voice.toggleScreenShare}
            iconOn={<MonitorOff className="h-5 w-5" />}
            iconOff={<MonitorUp className="h-5 w-5" />}
          />
          <ControlButton
            label={voice.deafened ? "Undeafen" : "Deafen"}
            on={!voice.deafened}
            onClick={voice.toggleDeafen}
            iconOn={<Headphones className="h-5 w-5" />}
            iconOff={<HeadphoneOff className="h-5 w-5" />}
          />
          <div className="mx-2 h-6 w-px bg-surface-100/40" />
          <button
            onClick={voice.leave}
            title="Disconnect"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
          >
            <PhoneOff className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Tile-grid sizing ─────────────────────────────────────────────────────────

/** Choose a grid template that fills the available area without leaving giant
 *  empty cells. Tuned roughly to Discord:
 *    1   → single big tile
 *    2   → side-by-side
 *    3-4 → 2×2
 *    5-6 → 3×2
 *    7-9 → 3×3
 *    10+ → 4-wide flow
 */
function gridClassForCount(n: number): string {
  if (n <= 1) return "grid-cols-1 grid-rows-1";
  if (n === 2) return "grid-cols-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1";
  if (n <= 4) return "grid-cols-2 grid-rows-2";
  if (n <= 6) return "grid-cols-2 grid-rows-3 sm:grid-cols-3 sm:grid-rows-2";
  if (n <= 9) return "grid-cols-3 grid-rows-3";
  return "grid-cols-3 sm:grid-cols-4";
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function PreJoin({
  channelName,
  ready,
  epochLoading,
  connecting,
  onJoinAudio,
  onJoinVideo,
}: {
  channelName: string;
  ready: boolean;
  epochLoading: boolean;
  connecting: boolean;
  onJoinAudio: () => void;
  onJoinVideo: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-400">
        <Volume2 className="h-10 w-10 text-muted" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-white">{channelName}</h2>
        <p className="mt-1 text-sm text-muted">
          {ready
            ? "End-to-end encrypted voice & video — packets travel peer-to-peer over DTLS-SRTP."
            : epochLoading
              ? "Loading server keys…"
              : "Server key unavailable — can't authenticate signaling."}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          onClick={onJoinAudio}
          disabled={!ready || connecting}
          className="flex items-center justify-center gap-2 rounded-lg bg-surface-100 px-5 py-2.5 text-sm font-semibold text-white hover:bg-surface-100/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
          Voice Only
        </button>
        <button
          onClick={onJoinVideo}
          disabled={!ready || connecting}
          className="flex items-center justify-center gap-2 rounded-lg bg-green-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-green-500/40"
        >
          {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
          Join with Video
        </button>
      </div>
      <p className="text-xs text-muted/70">
        You'll be asked for microphone {`(and camera if joining with video)`} access.
      </p>
    </div>
  );
}

function PeerTile({
  stream,
  hasVideo,
  speaking,
  muted,
  isMe,
  isScreenSharing,
  label,
  userId,
  deafened,
  duck,
  rttMs,
}: {
  stream: MediaStream | null;
  hasVideo: boolean;
  speaking: boolean;
  muted: boolean;
  isMe: boolean;
  isScreenSharing: boolean;
  label?: { displayName: string; initials: string };
  userId: string;
  deafened: boolean;
  /** When true, lower this tile's audio volume (used while the local user
   *  is speaking — Discord-style ducking so peers don't drown you out). */
  duck?: boolean;
  /** Round-trip time in ms (peers only). Drives the quality pip color. */
  rttMs?: number | null;
}) {
  const display = label?.displayName ?? userId.slice(0, 8);
  const initials = label?.initials ?? userId.slice(0, 2).toUpperCase();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Always attach the stream when present so audio plays even when video is
  // off. The element is CSS-hidden when there's no video — never unmounted.
  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Self never plays its own audio (avoids feedback). Deafened mutes everyone.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMe || deafened;
  }, [isMe, deafened]);

  // Voice ducking — lower remote tile audio while the local user is talking
  // so peers don't drown them out. Skip self (already muted).
  useEffect(() => {
    if (!videoRef.current || isMe) return;
    videoRef.current.volume = duck ? 0.35 : 1.0;
  }, [duck, isMe]);

  // Quality pip: green <100ms, yellow <300ms, red ≥300ms; null = unknown.
  const qualityColor =
    rttMs == null
      ? null
      : rttMs < 100
        ? "bg-green-400"
        : rttMs < 300
          ? "bg-yellow-400"
          : "bg-red-400";
  const qualityLabel = rttMs == null ? "" : `${rttMs} ms`;

  return (
    <div
      className={cn(
        "group relative flex items-center justify-center overflow-hidden rounded-lg bg-surface-200 ring-2 transition-all",
        speaking ? "ring-green-400" : "ring-transparent",
      )}
    >
      {qualityColor && !isMe && (
        <span
          className={cn(
            "absolute right-1.5 top-1.5 z-10 h-2 w-2 rounded-full ring-2 ring-surface-200",
            qualityColor,
          )}
          title={`Connection: ${qualityLabel}`}
        />
      )}
      {/* The <video> element is the source of truth for both video frames AND
          audio playback. Keep it mounted whenever we have a stream; just hide
          visually when no video is being sent. */}
      {stream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          // Mirror local-self camera so it feels natural (Discord-style).
          // Don't mirror screen share — that should look correct.
          className={cn(
            "h-full w-full object-cover",
            isMe && !isScreenSharing && "scale-x-[-1]",
            !hasVideo && "invisible absolute h-0 w-0",
          )}
        />
      )}

      {!hasVideo && (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand text-3xl font-bold text-white shadow-lg">
            {initials}
          </div>
        </div>
      )}

      {/* Top-left: screen share badge */}
      {isScreenSharing && (
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-xs text-white backdrop-blur">
          <MonitorUp className="h-3 w-3" />
          Sharing
        </div>
      )}

      {/* Bottom strip: name + mute icon overlay (always-visible Discord-style) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        <span className="flex items-center gap-1.5 truncate text-sm text-white">
          {muted && <MicOff className="h-3.5 w-3.5 shrink-0 text-red-400" />}
          <span className="truncate font-medium">
            {display}
            {isMe && <span className="font-normal text-white/60"> (you)</span>}
          </span>
        </span>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  on,
  onClick,
  iconOn,
  iconOff,
  disabled,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  iconOn: React.ReactNode;
  iconOff: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        on
          ? "bg-surface-100 text-white hover:bg-surface-100/70"
          : "bg-red-500/20 text-red-400 hover:bg-red-500/30",
      )}
    >
      {on ? iconOn : iconOff}
    </button>
  );
}
