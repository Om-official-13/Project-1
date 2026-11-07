/**
 * Web Audio API sound effects for messages and calls.
 * No external audio files — all synthesized in-browser.
 */

let audioCtx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function setSoundMuted(m: boolean) {
  muted = m;
}

export function isSoundMuted() {
  return muted;
}

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.15, whenOffset = 0) {
  if (muted) return;
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime + whenOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

export function playMessageSent() {
  playTone(880, 0.08, 'sine', 0.08);
}

export function playMessageReceived() {
  playTone(660, 0.1, 'sine', 0.1);
  playTone(880, 0.08, 'sine', 0.06, 0.08);
}

export function playCallIncoming() {
  // Ringing pattern
  playTone(440, 0.3, 'sine', 0.12, 0);
  playTone(440, 0.3, 'sine', 0.12, 0.5);
  playTone(440, 0.3, 'sine', 0.12, 1.0);
}

export function playCallOutgoing() {
  playTone(523, 0.15, 'sine', 0.1, 0);
  playTone(659, 0.15, 'sine', 0.1, 0.2);
}

export function playCallConnected() {
  playTone(659, 0.1, 'sine', 0.1, 0);
  playTone(784, 0.1, 'sine', 0.1, 0.1);
  playTone(1047, 0.15, 'sine', 0.1, 0.2);
}

export function playCallEnded() {
  playTone(440, 0.15, 'sine', 0.1, 0);
  playTone(330, 0.2, 'sine', 0.1, 0.15);
}

export function initAudio() {
  getCtx();
}
