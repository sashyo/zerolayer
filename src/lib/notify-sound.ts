"use client";

/**
 * Tiny Discord-style ping using Web Audio. We generate the tone in JS so we
 * don't have to ship an asset file. Two short notes with a quick decay so
 * it's noticeable but not annoying.
 *
 * The browser blocks autoplay until the user has interacted with the page.
 * Call `playMentionPing()` from inside a real user-event handler the first
 * time, or just accept that the very first ping after page load may be muted
 * — every later one (after any click/keypress) will play.
 */
let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

function tone(freq: number, when: number, duration = 0.18) {
  const ac = getContext();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ac.currentTime + when);
  gain.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + when + 0.02);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    ac.currentTime + when + duration,
  );
  osc.connect(gain).connect(ac.destination);
  osc.start(ac.currentTime + when);
  osc.stop(ac.currentTime + when + duration + 0.02);
}

export function playMentionPing() {
  try {
    const ac = getContext();
    if (!ac) return;
    if (ac.state === "suspended") void ac.resume();
    tone(880, 0); // A5
    tone(1175, 0.12); // D6
  } catch {}
}

/** Two short rising notes — peer joined a voice channel you're in. */
export function playVoiceJoin() {
  try {
    const ac = getContext();
    if (!ac) return;
    if (ac.state === "suspended") void ac.resume();
    tone(587, 0, 0.12); // D5
    tone(880, 0.08, 0.14); // A5
  } catch {}
}

/** Two short falling notes — peer left a voice channel you're in. */
export function playVoiceLeave() {
  try {
    const ac = getContext();
    if (!ac) return;
    if (ac.state === "suspended") void ac.resume();
    tone(880, 0, 0.1); // A5
    tone(587, 0.08, 0.14); // D5
  } catch {}
}
