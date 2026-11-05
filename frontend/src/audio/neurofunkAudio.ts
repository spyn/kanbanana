/**
 * Kanbanana 174 BPM Dark Neurofunk / Techstep WebAudio Synthesizer
 * High-tech Neurofunk sound design:
 * - Detuned unison sawtooth + sine sub "Reese" bass with LFO-modulated formant filter & tanh distortion
 * - 174 BPM two-step breakbeat (punchy kick, 200Hz techstep snare, ghost snares, metallic rolling hats)
 * - Sci-fi tension riser + micro-silence + 2-bar Phrygian Reese DROP when a PR passes review & merges
 * - Optional continuous 174 BPM dark rolling background groove + real-time AnalyserNode spectrum
 */

const BPM = 174
const SIXTEENTH_SEC = 60 / BPM / 4 // ~0.086207s per 16th note at 174 BPM

// Dark F-Phrygian / Hungarian-minor frequencies (Hz) for dark neurofunk sci-fi tension
const NOTE = {
  E1: 41.203,
  F1: 43.654,
  Gb1: 46.249,
  Ab1: 51.913,
  B1: 61.735,
  C2: 65.406,
  Db2: 69.296,
} as const

export type NeuroDropFlavor =
  | 'neurofunk'
  | 'techstep'
  | 'liquid'
  | 'stadium'
  | 'rave'
  | 'darkstep'

export interface DropPresetMeta {
  id: NeuroDropFlavor
  name: string
  subLabel: string
  vibe: string
}

export const DROP_PRESETS: DropPresetMeta[] = [
  {
    id: 'neurofunk',
    name: 'Surgical Neurofunk',
    subLabel: 'Formant Reese Tear',
    vibe: '174 BPM Modulated Formant Saw & Heavy Reese',
  },
  {
    id: 'techstep',
    name: 'Virus Techstep',
    subLabel: 'Stepping Wobble Reese',
    vibe: '174 BPM Stepping Wobble Bass & Punchy Breakbeat',
  },
  {
    id: 'liquid',
    name: 'Atmospheric Liquid',
    subLabel: 'Liquid Sub Glide',
    vibe: 'Warm Sub Sine Glide & Rolling Off-Beat Hats',
  },
  {
    id: 'stadium',
    name: 'Heavyweight Sub',
    subLabel: 'Stadium Sub Slam',
    vibe: 'High-Impact Sub Bass & Driven Breakbeat',
  },
  {
    id: 'rave',
    name: 'Euphoric 174 Rave',
    subLabel: 'Fast Rave Breakbeat',
    vibe: 'Energetic Fast Breakbeat & Rave Chords',
  },
  {
    id: 'darkstep',
    name: 'Dark Minimal Techstep',
    subLabel: 'Hollow Notch Reese',
    vibe: 'Dark Minimal Breakbeat & Sweeping Notch Filter',
  },
]

function makeDistortionCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 1024
  const buffer = new ArrayBuffer(samples * 4)
  const curve = new Float32Array(buffer)
  const k = Math.max(1, drive)
  const norm = Math.tanh(k)
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1
    curve[i] = Math.tanh(x * k) / norm
  }
  return curve
}

export class NeurofunkAudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private analyser: AnalyserNode | null = null
  private freqBins: Uint8Array<ArrayBuffer> | null = null
  private noiseBuffer: AudioBuffer | null = null
  private reeseCurve: Float32Array<ArrayBuffer> = makeDistortionCurve(4.2)
  private softClipCurve: Float32Array<ArrayBuffer> = makeDistortionCurve(1.8)

  private activeDropBus: GainNode | null = null
  private lastDropAtMs = 0

  // Optional 174 BPM dark rolling background loop state
  private loopTimer: number | null = null
  private loopBus: GainNode | null = null
  private nextStepTime = 0
  private currentLoopStep = 0
  private isLoopRunning = false

  private volume = 0.78

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return null
      const ctx = new AudioCtx()
      const master = ctx.createGain()
      master.gain.value = this.volume

      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -11
      comp.knee.value = 8
      comp.ratio.value = 6
      comp.attack.value = 0.003
      comp.release.value = 0.14

      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.72

      master.connect(comp)
      comp.connect(analyser)
      analyser.connect(ctx.destination)

      // Pre-build 2s noise buffer for crisp snares, ghost notes, hats & risers
      const len = ctx.sampleRate * 2
      const nBuf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = nBuf.getChannelData(0)
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1
      }

      this.ctx = ctx
      this.masterGain = master
      this.compressor = comp
      this.analyser = analyser
      this.freqBins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
      this.noiseBuffer = nBuf
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }
    return this.ctx
  }

  public unlock(): boolean {
    const ctx = this.ensureContext()
    return Boolean(ctx)
  }

  public setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02)
    }
  }

  public getVolume(): number {
    return this.volume
  }

  public getSpectrumLevels(barCount = 12): number[] {
    if (!this.analyser || !this.freqBins || !this.ctx || this.ctx.state !== 'running') {
      return Array.from({ length: barCount }, () => 0)
    }
    this.analyser.getByteFrequencyData(this.freqBins)
    const out: number[] = []
    const usableBins = Math.min(this.freqBins.length, 24)
    for (let i = 0; i < barCount; i++) {
      const idx = Math.min(usableBins - 1, Math.floor((i / barCount) * usableBins))
      out.push(this.freqBins[idx] / 255)
    }
    return out
  }

  // =========================================================================
  // CORE DRUM & NEURO SYNTHESIS PRIMITIVES
  // =========================================================================

  private scheduleKick(ctx: AudioContext, dest: AudioNode, t: number, velocity = 1): void {
    // Punchy 174 BPM DnB kick body (165Hz -> 46Hz pitch envelope)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const shaper = ctx.createWaveShaper()
    shaper.curve = this.softClipCurve

    osc.type = 'sine'
    osc.frequency.setValueAtTime(168, t)
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.052)
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.16)

    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime(0.95 * velocity, t + 0.003)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.175)

    osc.connect(shaper)
    shaper.connect(gain)
    gain.connect(dest)

    osc.start(t)
    osc.stop(t + 0.185)

    // Beater click transient so the kick cuts through heavy Reese mids
    const clickOsc = ctx.createOscillator()
    const clickGain = ctx.createGain()
    clickOsc.type = 'triangle'
    clickOsc.frequency.setValueAtTime(980, t)
    clickOsc.frequency.exponentialRampToValueAtTime(140, t + 0.014)

    clickGain.gain.setValueAtTime(0.32 * velocity, t)
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.016)

    clickOsc.connect(clickGain)
    clickGain.connect(dest)
    clickOsc.start(t)
    clickOsc.stop(t + 0.02)
  }

  private scheduleSnare(
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    velocity = 1,
    isGhost = false,
  ): void {
    // 1. Techstep 200Hz tonal snare punch
    const bodyOsc = ctx.createOscillator()
    const bodyGain = ctx.createGain()
    bodyOsc.type = 'triangle'
    bodyOsc.frequency.setValueAtTime(isGhost ? 245 : 228, t)
    bodyOsc.frequency.exponentialRampToValueAtTime(isGhost ? 165 : 148, t + 0.042)

    const bodyDur = isGhost ? 0.055 : 0.105
    bodyGain.gain.setValueAtTime(0.0001, t)
    bodyGain.gain.linearRampToValueAtTime((isGhost ? 0.24 : 0.68) * velocity, t + 0.002)
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + bodyDur)

    bodyOsc.connect(bodyGain)
    bodyGain.connect(dest)
    bodyOsc.start(t)
    bodyOsc.stop(t + bodyDur + 0.01)

    // 2. Crisp high-passed snare crack / ghost shuffle
    if (!this.noiseBuffer) return
    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer

    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(isGhost ? 3200 : 2500, t)
    bp.Q.value = isGhost ? 1.5 : 0.9

    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.setValueAtTime(950, t)

    const nGain = ctx.createGain()
    const nDur = isGhost ? 0.052 : 0.145
    nGain.gain.setValueAtTime(0.0001, t)
    nGain.gain.linearRampToValueAtTime((isGhost ? 0.22 : 0.64) * velocity, t + 0.002)
    nGain.gain.exponentialRampToValueAtTime(0.001, t + nDur)

    noise.connect(bp)
    bp.connect(hp)
    hp.connect(nGain)
    nGain.connect(dest)

    const offset = (t * 137) % 1.4
    noise.start(t, offset, nDur + 0.02)
  }

  private scheduleHat(
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    open = false,
    velocity = 0.45,
  ): void {
    if (!this.noiseBuffer) return
    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer

    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.setValueAtTime(open ? 6400 : 7800, t)

    const gain = ctx.createGain()
    const dur = open ? 0.082 : 0.031
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime(velocity * 0.42, t + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur)

    noise.connect(hp)
    hp.connect(gain)
    gain.connect(dest)

    const offset = (t * 251) % 1.5
    noise.start(t, offset, dur + 0.01)
  }

  /**
   * Signature Neurofunk "Reese" Bass Voice:
   * - Clean sub-bass sine at fundamental (F1 / Gb1 / Ab1 / E1)
   * - 3 detuned unison sawtooths (-24c, 0c, +24c) one octave up for mid-range tear
   * - Resonant lowpass + moving bandpass notch modulated by an LFO + tanh waveshaper
   */
  private scheduleReeseBass(
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    dur: number,
    freqHz: number,
    opts: {
      slideToHz?: number
      filterPeakHz?: number
      lfoRateHz?: number
      gainLevel?: number
    } = {},
  ): void {
    const {
      slideToHz,
      filterPeakHz = 2500,
      lfoRateHz = 5.8,
      gainLevel = 0.56,
    } = opts

    // 1. Chest-hitting Sine Sub Layer
    const subOsc = ctx.createOscillator()
    const subGain = ctx.createGain()
    subOsc.type = 'sine'
    subOsc.frequency.setValueAtTime(freqHz, t)
    if (slideToHz) {
      subOsc.frequency.exponentialRampToValueAtTime(slideToHz, t + dur * 0.82)
    }

    subGain.gain.setValueAtTime(0.0001, t)
    subGain.gain.linearRampToValueAtTime(gainLevel * 0.85, t + 0.015)
    subGain.gain.setValueAtTime(gainLevel * 0.8, Math.max(t + 0.02, t + dur - 0.035))
    subGain.gain.exponentialRampToValueAtTime(0.0008, t + dur)

    subOsc.connect(subGain)
    subGain.connect(dest)
    subOsc.start(t)
    subOsc.stop(t + dur + 0.015)

    // 2. Detuned Unison Sawtooth Neuro Layer -> Moving Formant Filter -> Tanh Saturation
    const growlFilter = ctx.createBiquadFilter()
    growlFilter.type = 'lowpass'
    growlFilter.Q.value = 7.2
    growlFilter.frequency.setValueAtTime(190, t)
    growlFilter.frequency.exponentialRampToValueAtTime(filterPeakHz, t + dur * 0.36)
    growlFilter.frequency.exponentialRampToValueAtTime(280, t + dur)

    // LFO chewing the Reese filter cutoff
    const lfo = ctx.createOscillator()
    const lfoDepth = ctx.createGain()
    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(lfoRateHz, t)
    lfoDepth.gain.setValueAtTime(filterPeakHz * 0.34, t)
    lfo.connect(lfoDepth)
    lfoDepth.connect(growlFilter.frequency)

    // Moving mid-scoop notch for authentic neurofunk vocal/sci-fi hollowness
    const notch = ctx.createBiquadFilter()
    notch.type = 'notch'
    notch.frequency.setValueAtTime(620, t)
    notch.frequency.linearRampToValueAtTime(1180, t + dur * 0.65)
    notch.Q.value = 2.8

    const shaper = ctx.createWaveShaper()
    shaper.curve = this.reeseCurve
    shaper.oversample = '2x'

    const tameLowpass = ctx.createBiquadFilter()
    tameLowpass.type = 'lowpass'
    tameLowpass.frequency.setValueAtTime(3900, t)

    const midGain = ctx.createGain()
    midGain.gain.setValueAtTime(0.0001, t)
    midGain.gain.linearRampToValueAtTime(gainLevel * 0.58, t + 0.014)
    midGain.gain.setValueAtTime(gainLevel * 0.52, Math.max(t + 0.02, t + dur - 0.04))
    midGain.gain.exponentialRampToValueAtTime(0.0008, t + dur)

    growlFilter.connect(notch)
    notch.connect(shaper)
    shaper.connect(tameLowpass)
    tameLowpass.connect(midGain)
    midGain.connect(dest)

    const detunes = [-24, 0, 24]
    detunes.forEach((cents) => {
      const saw = ctx.createOscillator()
      saw.type = 'sawtooth'
      saw.detune.setValueAtTime(cents, t)
      saw.frequency.setValueAtTime(freqHz * 2, t)
      if (slideToHz) {
        saw.frequency.exponentialRampToValueAtTime(slideToHz * 2, t + dur * 0.82)
      }
      saw.connect(growlFilter)
      saw.start(t)
      saw.stop(t + dur + 0.015)
    })

    lfo.start(t)
    lfo.stop(t + dur + 0.015)
  }

  private scheduleChirp(
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    freqHz: number,
    dur = 0.045,
    type: OscillatorType = 'square',
    gainMax = 0.18,
  ): void {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freqHz, t)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gainMax, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.connect(g)
    g.connect(dest)
    osc.start(t)
    osc.stop(t + dur + 0.01)
  }

  // =========================================================================
  // SIGNATURE PR-MERGE 174 BPM DROPS (NOISIA, PACMAN, CIRCLES, DELTA HEAVY, ETC)
  // =========================================================================

  public playPrMergeDrop(force = false, flavor: NeuroDropFlavor = 'neurofunk'): void {
    const nowMs = performance.now()
    if (!force && nowMs - this.lastDropAtMs < 450) {
      // Prevent chaotic overlapping drops when scrubbing at 8x speed
      return
    }
    this.lastDropAtMs = nowMs

    const ctx = this.ensureContext()
    if (!ctx || !this.masterGain) return

    // Smoothly fade out any previous active drop bus
    if (this.activeDropBus) {
      const prevBus = this.activeDropBus
      try {
        prevBus.gain.cancelScheduledValues(ctx.currentTime)
        prevBus.gain.setValueAtTime(prevBus.gain.value, ctx.currentTime)
        prevBus.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.045)
        window.setTimeout(() => {
          try {
            prevBus.disconnect()
          } catch {
            // ignore
          }
        }, 90)
      } catch {
        // ignore
      }
    }

    // Duck background loop slightly during the hero PR Merge Drop
    if (this.loopBus) {
      this.loopBus.gain.setTargetAtTime(0.12, ctx.currentTime, 0.03)
      this.loopBus.gain.setTargetAtTime(0.45, ctx.currentTime + 3.1, 0.25)
    }

    const dropBus = ctx.createGain()
    dropBus.gain.setValueAtTime(0.92, ctx.currentTime)
    dropBus.connect(this.masterGain)
    this.activeDropBus = dropBus

    const s = SIXTEENTH_SEC
    const t0 = ctx.currentTime + 0.02
    const riserLen = 4 * s // 1-beat pre-drop tension riser + snare rush
    const dropStart = t0 + riserLen + 0.018 // 18ms micro-silence gap before the 1!

    // --- PHASE 1: PRE-DROP TENSION RISERS BY FLAVOR ---
    if (flavor === 'techstep') {
      // Virus 174 BPM techstep chiptune / resonant arp tease
      ;[440, 554, 659, 880, 1108].forEach((freq, idx) => {
        this.scheduleChirp(ctx, dropBus, t0 + idx * (s * 0.75), freq, 0.04, 'square', 0.16)
      })
    } else if (flavor === 'rave') {
      // High-energy 174 BPM euphoric rave chord stabs
      ;[0, 1.5, 2.5].forEach((beatOffset) => {
        const chordT = t0 + beatOffset * s
        ;[174.6, 220, 261.6].forEach((f) => {
          this.scheduleChirp(ctx, dropBus, chordT, f * 2, 0.06, 'sawtooth', 0.09)
        })
      })
    } else if (flavor === 'liquid') {
      // Atmospheric liquid roller warm sub-frequency glide
      const liquidOsc = ctx.createOscillator()
      const liquidGain = ctx.createGain()
      liquidOsc.type = 'sine'
      liquidOsc.frequency.setValueAtTime(130.8, t0)
      liquidOsc.frequency.exponentialRampToValueAtTime(261.6, t0 + riserLen)
      liquidGain.gain.setValueAtTime(0.01, t0)
      liquidGain.gain.linearRampToValueAtTime(0.14, t0 + riserLen - 0.02)
      liquidGain.gain.linearRampToValueAtTime(0.0001, t0 + riserLen + 0.005)
      liquidOsc.connect(liquidGain)
      liquidGain.connect(dropBus)
      liquidOsc.start(t0)
      liquidOsc.stop(t0 + riserLen + 0.01)
    }

    // Shared bandpass noise riser
    if (this.noiseBuffer) {
      const sweep = ctx.createBufferSource()
      sweep.buffer = this.noiseBuffer
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = flavor === 'darkstep' ? 6.2 : 4.5
      bp.frequency.setValueAtTime(flavor === 'darkstep' ? 220 : 340, t0)
      bp.frequency.exponentialRampToValueAtTime(
        flavor === 'stadium' ? 6200 : 4800,
        t0 + riserLen,
      )

      const rGain = ctx.createGain()
      rGain.gain.setValueAtTime(0.02, t0)
      rGain.gain.exponentialRampToValueAtTime(0.48, t0 + riserLen - 0.01)
      rGain.gain.linearRampToValueAtTime(0.0001, t0 + riserLen + 0.008)

      sweep.connect(bp)
      bp.connect(rGain)
      rGain.connect(dropBus)
      sweep.start(t0, 0, riserLen + 0.02)
    }

    // Siren Riser (Tritone or Siren Pitch Glide)
    if (flavor !== 'liquid') {
      const siren = ctx.createOscillator()
      const sirenGain = ctx.createGain()
      siren.type = 'sawtooth'
      siren.frequency.setValueAtTime(flavor === 'stadium' ? 220 : 174.6, t0)
      siren.frequency.exponentialRampToValueAtTime(
        flavor === 'stadium' ? 550 : 349.2,
        t0 + riserLen,
      )
      sirenGain.gain.setValueAtTime(0.01, t0)
      sirenGain.gain.linearRampToValueAtTime(
        flavor === 'stadium' ? 0.22 : 0.16,
        t0 + riserLen - 0.015,
      )
      sirenGain.gain.linearRampToValueAtTime(0.0001, t0 + riserLen + 0.005)
      siren.connect(sirenGain)
      sirenGain.connect(dropBus)
      siren.start(t0)
      siren.stop(t0 + riserLen + 0.01)
    }

    // Pre-drop accelerating snare rush
    ;[0, 1.5, 2.5, 3.25].forEach((stepOff, idx) => {
      this.scheduleSnare(ctx, dropBus, t0 + stepOff * s, 0.45 + idx * 0.14, idx < 2)
    })

    // --- PHASE 2: 2-BAR 174 BPM TWO-STEP TECHSTEP BREAKBEAT (32 SIXTEENTHS) ---
    const kickSteps =
      flavor === 'darkstep'
        ? new Set([0, 8, 14, 16, 24])
        : new Set([0, 10, 16, 24, 26])
    const mainSnareSteps = new Set([4, 12, 20, 28])
    const ghostSnareSteps =
      flavor === 'darkstep'
        ? new Set([3, 7, 9, 13, 15, 23, 27, 30, 31])
        : new Set([7, 9, 15, 23, 25, 30, 31])

    for (let step = 0; step < 32; step++) {
      const ts = dropStart + step * s
      if (kickSteps.has(step)) {
        const kickVol =
          flavor === 'stadium'
            ? step === 0 || step === 16
              ? 1.15
              : 1.02
            : step === 0 || step === 16
              ? 1.0
              : 0.92
        this.scheduleKick(ctx, dropBus, ts, kickVol)
      }
      if (mainSnareSteps.has(step)) {
        this.scheduleSnare(ctx, dropBus, ts, 1.0, false)
      } else if (ghostSnareSteps.has(step)) {
        this.scheduleSnare(ctx, dropBus, ts, 0.65, true)
      }

      // Rolling hats & rides (Liquid gets extra open-hat bounce)
      const isOffbeatRide = step % 4 === 2
      const isOpenLiquidHat = flavor === 'liquid' && step % 2 === 1
      this.scheduleHat(
        ctx,
        dropBus,
        ts,
        isOffbeatRide || isOpenLiquidHat,
        isOffbeatRide ? 0.68 : isOpenLiquidHat ? 0.52 : 0.38,
      )
    }

    // --- PHASE 3: SIGNATURE BASSLINE BY DRUM & BASS FLAVOR ---
    if (flavor === 'techstep') {
      // Stepping Wobble Techstep Formant Reese
      this.scheduleReeseBass(ctx, dropBus, dropStart + 0 * s, 4 * s, NOTE.F1, {
        filterPeakHz: 3400,
        lfoRateHz: 12.5,
        gainLevel: 0.64,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 4 * s, 4 * s, NOTE.F1, {
        slideToHz: NOTE.Ab1,
        filterPeakHz: 3100,
        lfoRateHz: 8.7,
        gainLevel: 0.6,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 8 * s, 4 * s, NOTE.Gb1, {
        slideToHz: NOTE.F1,
        filterPeakHz: 2800,
        lfoRateHz: 14.5,
        gainLevel: 0.58,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 12 * s, 4 * s, NOTE.F1, {
        filterPeakHz: 3200,
        lfoRateHz: 11.6,
        gainLevel: 0.62,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 16 * s, 5 * s, NOTE.F1, {
        filterPeakHz: 3600,
        lfoRateHz: 13.0,
        gainLevel: 0.64,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 21 * s, 5 * s, NOTE.C2, {
        slideToHz: NOTE.Gb1,
        filterPeakHz: 3800,
        lfoRateHz: 16.0,
        gainLevel: 0.58,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 26 * s, 6 * s, NOTE.E1, {
        slideToHz: NOTE.F1,
        filterPeakHz: 2400,
        lfoRateHz: 8.7,
        gainLevel: 0.62,
      })
    } else if (flavor === 'liquid') {
      // Atmospheric Liquid Sub Slide (F1 -> Ab1 -> Db2 -> C2 -> F1)
      this.scheduleReeseBass(ctx, dropBus, dropStart + 0 * s, 6 * s, NOTE.F1, {
        filterPeakHz: 1400,
        lfoRateHz: 4.2,
        gainLevel: 0.68,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 6 * s, 6 * s, NOTE.Ab1, {
        slideToHz: NOTE.Db2,
        filterPeakHz: 1850,
        lfoRateHz: 5.8,
        gainLevel: 0.66,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 12 * s, 4 * s, NOTE.Db2, {
        slideToHz: NOTE.C2,
        filterPeakHz: 1600,
        lfoRateHz: 4.2,
        gainLevel: 0.64,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 16 * s, 6 * s, NOTE.F1, {
        filterPeakHz: 1500,
        lfoRateHz: 4.2,
        gainLevel: 0.68,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 22 * s, 5 * s, NOTE.Ab1, {
        slideToHz: NOTE.C2,
        filterPeakHz: 1900,
        lfoRateHz: 5.8,
        gainLevel: 0.65,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 27 * s, 5.5 * s, NOTE.C2, {
        slideToHz: NOTE.F1,
        filterPeakHz: 1300,
        lfoRateHz: 3.8,
        gainLevel: 0.68,
      })
    } else if (flavor === 'stadium') {
      // Heavyweight Stadium Sub Slam
      this.scheduleReeseBass(ctx, dropBus, dropStart + 0 * s, 8 * s, NOTE.F1, {
        filterPeakHz: 2800,
        lfoRateHz: 7.25,
        gainLevel: 0.74,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 8 * s, 8 * s, NOTE.C2, {
        slideToHz: NOTE.F1,
        filterPeakHz: 3200,
        lfoRateHz: 11.6,
        gainLevel: 0.7,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 16 * s, 8 * s, NOTE.F1, {
        filterPeakHz: 3000,
        lfoRateHz: 9.5,
        gainLevel: 0.74,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 24 * s, 8 * s, NOTE.E1, {
        slideToHz: NOTE.F1,
        filterPeakHz: 2400,
        lfoRateHz: 6.0,
        gainLevel: 0.72,
      })
    } else if (flavor === 'rave') {
      // Euphoric 174 Rave Drop
      this.scheduleReeseBass(ctx, dropBus, dropStart + 0 * s, 6 * s, NOTE.F1, {
        filterPeakHz: 3400,
        lfoRateHz: 8.7,
        gainLevel: 0.64,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 6 * s, 6 * s, NOTE.Ab1, {
        slideToHz: NOTE.C2,
        filterPeakHz: 3700,
        lfoRateHz: 11.6,
        gainLevel: 0.62,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 12 * s, 4 * s, NOTE.C2, {
        slideToHz: NOTE.Db2,
        filterPeakHz: 3500,
        lfoRateHz: 13.0,
        gainLevel: 0.6,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 16 * s, 6 * s, NOTE.F1, {
        filterPeakHz: 3200,
        lfoRateHz: 8.7,
        gainLevel: 0.64,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 22 * s, 5 * s, NOTE.Db2, {
        slideToHz: NOTE.C2,
        filterPeakHz: 3400,
        lfoRateHz: 10.5,
        gainLevel: 0.62,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 27 * s, 5.5 * s, NOTE.C2, {
        slideToHz: NOTE.F1,
        filterPeakHz: 2200,
        lfoRateHz: 6.0,
        gainLevel: 0.65,
      })
    } else if (flavor === 'darkstep') {
      // Dark Minimal Techstep Reese (Sweeping Notch)
      this.scheduleReeseBass(ctx, dropBus, dropStart + 0 * s, 6 * s, NOTE.F1, {
        filterPeakHz: 2200,
        lfoRateHz: 6.2,
        gainLevel: 0.62,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 6 * s, 4 * s, NOTE.Gb1, {
        slideToHz: NOTE.F1,
        filterPeakHz: 2600,
        lfoRateHz: 12.0,
        gainLevel: 0.58,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 10 * s, 6 * s, NOTE.F1, {
        filterPeakHz: 1900,
        lfoRateHz: 5.0,
        gainLevel: 0.6,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 16 * s, 6 * s, NOTE.F1, {
        filterPeakHz: 2400,
        lfoRateHz: 8.7,
        gainLevel: 0.62,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 22 * s, 5 * s, NOTE.Gb1, {
        slideToHz: NOTE.E1,
        filterPeakHz: 2800,
        lfoRateHz: 13.5,
        gainLevel: 0.56,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 27 * s, 5.5 * s, NOTE.E1, {
        slideToHz: NOTE.F1,
        filterPeakHz: 1800,
        lfoRateHz: 5.8,
        gainLevel: 0.6,
      })
    } else {
      // Default: Surgical Neurofunk Phrygian Reese
      this.scheduleReeseBass(ctx, dropBus, dropStart + 0 * s, 6 * s, NOTE.F1, {
        filterPeakHz: 2650,
        lfoRateHz: 5.8,
        gainLevel: 0.62,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 6 * s, 4 * s, NOTE.Gb1, {
        slideToHz: NOTE.F1,
        filterPeakHz: 3300,
        lfoRateHz: 11.6,
        gainLevel: 0.58,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 10 * s, 6 * s, NOTE.F1, {
        slideToHz: NOTE.Ab1,
        filterPeakHz: 2100,
        lfoRateHz: 4.35,
        gainLevel: 0.58,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 16 * s, 6 * s, NOTE.F1, {
        filterPeakHz: 2800,
        lfoRateHz: 8.7,
        gainLevel: 0.62,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 22 * s, 5 * s, NOTE.C2, {
        slideToHz: NOTE.Gb1,
        filterPeakHz: 3600,
        lfoRateHz: 14.5,
        gainLevel: 0.56,
      })
      this.scheduleReeseBass(ctx, dropBus, dropStart + 27 * s, 5.5 * s, NOTE.E1, {
        slideToHz: NOTE.F1,
        filterPeakHz: 1900,
        lfoRateHz: 5.8,
        gainLevel: 0.6,
      })
    }
  }

  // =========================================================================
  // TACTICAL AGENT CUES (DISPATCH, LOCK, QUARANTINE / GUARDRAIL TRIP)
  // =========================================================================

  public playDispatchTick(): void {
    const ctx = this.ensureContext()
    if (!ctx || !this.masterGain) return
    const t = ctx.currentTime + 0.005
    this.scheduleHat(ctx, this.masterGain, t, false, 0.35)

    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(523.25, t) // C5
    osc.frequency.exponentialRampToValueAtTime(698.46, t + 0.045) // F5
    g.gain.setValueAtTime(0.11, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
    osc.connect(g)
    g.connect(this.masterGain)
    osc.start(t)
    osc.stop(t + 0.065)
  }

  public playLockClank(): void {
    const ctx = this.ensureContext()
    if (!ctx || !this.masterGain) return
    const t = ctx.currentTime + 0.005
    this.scheduleSnare(ctx, this.masterGain, t, 0.42, true)
  }

  public playQuarantineGrowl(): void {
    const ctx = this.ensureContext()
    if (!ctx || !this.masterGain) return
    const t = ctx.currentTime + 0.01
    // Dark tritone Reese warning stab (B1 -> F1) when Spec/Security Guard or Budget Breaker trips!
    this.scheduleReeseBass(ctx, this.masterGain, t, 0.38, NOTE.B1, {
      slideToHz: NOTE.E1,
      filterPeakHz: 2200,
      lfoRateHz: 13,
      gainLevel: 0.44,
    })
  }

  // =========================================================================
  // CONTINUOUS 174 BPM ROLLING TECHSTEP BACKGROUND GROOVE
  // =========================================================================

  public startRollingLoop(): void {
    const ctx = this.ensureContext()
    if (!ctx || !this.masterGain || this.isLoopRunning) return

    const bus = ctx.createGain()
    bus.gain.setValueAtTime(0.45, ctx.currentTime)
    bus.connect(this.masterGain)
    this.loopBus = bus
    this.isLoopRunning = true
    this.currentLoopStep = 0
    this.nextStepTime = ctx.currentTime + 0.04

    const lookaheadMs = 45
    const scheduleAheadSec = 0.16

    const scheduler = () => {
      if (!this.isLoopRunning || !this.ctx || !this.loopBus) return
      while (this.nextStepTime < this.ctx.currentTime + scheduleAheadSec) {
        const step = this.currentLoopStep % 16
        const t = this.nextStepTime

        // Subtle 174 BPM rolling techstep skeleton
        if (step === 0 || step === 10) {
          this.scheduleKick(this.ctx, this.loopBus, t, 0.65)
        }
        if (step === 4 || step === 12) {
          this.scheduleSnare(this.ctx, this.loopBus, t, 0.52, false)
        } else if (step === 7 || step === 9 || step === 15) {
          this.scheduleSnare(this.ctx, this.loopBus, t, 0.38, true)
        }
        this.scheduleHat(this.ctx, this.loopBus, t, step % 4 === 2, step % 2 === 0 ? 0.36 : 0.22)

        // Low pulsing F1/Gb1 dark neuro drone on bar downbeat & step 10
        if (step === 0) {
          this.scheduleReeseBass(this.ctx, this.loopBus, t, 5 * SIXTEENTH_SEC, NOTE.F1, {
            filterPeakHz: 950,
            lfoRateHz: 5.8,
            gainLevel: 0.34,
          })
        } else if (step === 10) {
          this.scheduleReeseBass(this.ctx, this.loopBus, t, 4 * SIXTEENTH_SEC, NOTE.Gb1, {
            slideToHz: NOTE.F1,
            filterPeakHz: 1250,
            lfoRateHz: 8.7,
            gainLevel: 0.3,
          })
        }

        this.nextStepTime += SIXTEENTH_SEC
        this.currentLoopStep = (this.currentLoopStep + 1) % 16
      }
    }

    scheduler()
    this.loopTimer = window.setInterval(scheduler, lookaheadMs)
  }

  public stopRollingLoop(): void {
    this.isLoopRunning = false
    if (this.loopTimer !== null) {
      window.clearInterval(this.loopTimer)
      this.loopTimer = null
    }
    if (this.loopBus && this.ctx) {
      const b = this.loopBus
      this.loopBus = null
      try {
        b.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.04)
        window.setTimeout(() => {
          try {
            b.disconnect()
          } catch {
            // ignore
          }
        }, 150)
      } catch {
        // ignore
      }
    }
  }

  public dispose(): void {
    this.stopRollingLoop()
    if (this.ctx) {
      void this.ctx.close()
      this.ctx = null
    }
  }
}
