/**
 * AudioManager —— 全部音效由 Web Audio API 现场合成。
 *
 * 不引入任何第三方音频文件，因此没有版权风险，也不会因为网络加载失败而静默。
 * 音色取向：骰子敲击瓷碗、木鱼、小铜铃、古琴泛音、琵琶点音、小锣、大锣、鼓点、风铃。
 * 刻意避开电子枪声、老虎机音效、现代 EDM。
 *
 * 浏览器限制：AudioContext 必须在用户手势之后才能出声，
 * 因此所有播放都会先经过 unlock()（由「进入大厅」等按钮触发）。
 */

import type { SoundId as AwardSoundId } from '@bobing/shared';

/** 奖项音效直接复用 shared 的定义，保证奖项表里写的音效名一定存在。 */
export type SoundId =
  | AwardSoundId
  | 'dice_shake'
  | 'dice_roll'
  | 'dice_hit_bowl'
  | 'champion_replaced'
  | 'game_finish'
  | 'ui_click';

type Ctx = AudioContext;

class AudioManager {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.72;

  /* ---------------- 生命周期 ---------------- */

  /** 必须在一次真实的用户手势里调用（点击「进入大厅」「博饼」等）。 */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor: typeof AudioContext =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? this.volume : 0;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = this.makeNoiseBuffer(this.ctx, 2);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* 静默失败：没有音效也要能玩 */
    }
  }

  get isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.applyGain();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyGain();
  }

  private applyGain(): void {
    if (!this.master || !this.ctx) return;
    const target = this.enabled ? this.volume : 0;
    try {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    } catch {
      this.master.gain.value = target;
    }
  }

  private makeNoiseBuffer(ctx: Ctx, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      // 轻微低通，让噪声更像「实物摩擦」而不是「电视雪花」
      last = (last + white * 0.4) * 0.86;
      data[i] = white * 0.7 + last * 0.3;
    }
    return buffer;
  }

  /* ---------------- 基础音源 ---------------- */

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private noiseSource(duration: number): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 1;
    void duration;
    return src;
  }

  /** 一段有包络的噪声，用来做敲击/摩擦。 */
  private noiseBurst(opts: {
    at: number;
    duration: number;
    filter: BiquadFilterType;
    freq: number;
    q?: number;
    gain?: number;
    sweepTo?: number;
    attack?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const src = this.noiseSource(opts.duration);
    if (!src) return;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter;
    filter.frequency.setValueAtTime(opts.freq, opts.at);
    if (opts.sweepTo) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweepTo), opts.at + opts.duration);
    }
    filter.Q.value = opts.q ?? 1;

    const gain = ctx.createGain();
    const peak = opts.gain ?? 0.3;
    const attack = opts.attack ?? 0.004;
    gain.gain.setValueAtTime(0.0001, opts.at);
    gain.gain.exponentialRampToValueAtTime(peak, opts.at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.duration);

    src.connect(filter).connect(gain).connect(this.master);
    src.start(opts.at);
    src.stop(opts.at + opts.duration + 0.05);
  }

  /** 一个带包络的振荡器。 */
  private tone(opts: {
    at: number;
    freq: number;
    type?: OscillatorType;
    duration: number;
    gain?: number;
    attack?: number;
    glideTo?: number;
    detune?: number;
    delay?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, opts.at);
    if (opts.glideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.glideTo), opts.at + opts.duration);
    }
    if (opts.detune) osc.detune.value = opts.detune;

    const gain = ctx.createGain();
    const peak = opts.gain ?? 0.22;
    const attack = opts.attack ?? 0.005;
    const start = opts.at + (opts.delay ?? 0);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);

    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + opts.duration + 0.05);
  }

  /* ---------------- 具体音色 ---------------- */

  /** 陶瓷骰子敲碗：极短噪声 + 高频三角衰减。 */
  private hitBowl(at: number, strength = 1): void {
    const base = 1500 + Math.random() * 900;
    this.noiseBurst({
      at,
      duration: 0.035,
      filter: 'highpass',
      freq: 2600,
      gain: 0.16 * strength,
    });
    this.tone({
      at,
      freq: base,
      type: 'triangle',
      duration: 0.17,
      gain: 0.2 * strength,
      glideTo: base * 0.42,
      attack: 0.002,
    });
    this.tone({
      at,
      freq: base * 1.98,
      type: 'sine',
      duration: 0.09,
      gain: 0.07 * strength,
      attack: 0.002,
    });
  }

  /** 木鱼 / 木击：短促、干脆。 */
  private woodblock(at: number, pitch = 900, strength = 1): void {
    this.noiseBurst({
      at,
      duration: 0.05,
      filter: 'bandpass',
      freq: pitch,
      q: 8,
      gain: 0.24 * strength,
    });
    this.tone({ at, freq: pitch * 1.4, type: 'sine', duration: 0.07, gain: 0.1 * strength });
  }

  /** 小铜铃：两个非谐波分音，清脆。 */
  private bell(at: number, freq = 1180, strength = 1, duration = 0.9): void {
    this.tone({ at, freq, type: 'sine', duration, gain: 0.15 * strength });
    this.tone({ at, freq: freq * 2.76, type: 'sine', duration: duration * 0.55, gain: 0.06 * strength });
    this.tone({ at, freq: freq * 5.4, type: 'sine', duration: duration * 0.28, gain: 0.028 * strength });
    this.noiseBurst({ at, duration: 0.02, filter: 'highpass', freq: 5200, gain: 0.07 * strength });
  }

  /** 古琴 / 琵琶点音：噪声激励 + 低通下扫，近似拨弦。 */
  private pluck(at: number, freq: number, strength = 1, duration = 1.1): void {
    this.noiseBurst({
      at,
      duration: 0.035,
      filter: 'lowpass',
      freq: freq * 8,
      sweepTo: freq * 1.4,
      gain: 0.2 * strength,
    });
    this.tone({ at, freq, type: 'triangle', duration, gain: 0.16 * strength, attack: 0.004 });
    this.tone({ at, freq: freq * 2, type: 'sine', duration: duration * 0.4, gain: 0.05 * strength });
    this.tone({ at, freq: freq * 3.01, type: 'sine', duration: duration * 0.22, gain: 0.026 * strength });
  }

  /** 鼓：低频下扫 + 敲击噪声。 */
  private drum(at: number, strength = 1, freq = 150): void {
    this.tone({
      at,
      freq,
      type: 'sine',
      duration: 0.34,
      gain: 0.4 * strength,
      glideTo: freq * 0.36,
      attack: 0.003,
    });
    this.noiseBurst({ at, duration: 0.05, filter: 'lowpass', freq: 420, gain: 0.16 * strength });
  }

  /** 大锣：金属泛音堆叠 + 长衰减，仪式感。 */
  private gong(at: number, strength = 1): void {
    this.noiseBurst({
      at,
      duration: 2.2,
      filter: 'bandpass',
      freq: 210,
      q: 1.1,
      gain: 0.3 * strength,
    });
    this.tone({ at, freq: 96, type: 'sine', duration: 2.4, gain: 0.32 * strength, glideTo: 74 });
    this.tone({ at, freq: 233, type: 'sine', duration: 1.7, gain: 0.13 * strength });
    this.tone({ at, freq: 349, type: 'sine', duration: 1.2, gain: 0.08 * strength });
    this.tone({ at, freq: 528, type: 'sine', duration: 0.8, gain: 0.05 * strength });
    this.noiseBurst({ at, duration: 0.05, filter: 'highpass', freq: 3000, gain: 0.12 * strength });
  }

  /** 小锣：短促的一记。 */
  private smallGong(at: number, strength = 1): void {
    this.noiseBurst({ at, duration: 0.7, filter: 'bandpass', freq: 640, q: 1.6, gain: 0.2 * strength });
    this.tone({ at, freq: 420, type: 'sine', duration: 0.6, gain: 0.14 * strength, glideTo: 380 });
    this.tone({ at, freq: 815, type: 'sine', duration: 0.4, gain: 0.06 * strength });
  }

  /** 风铃：几个音高错落的小铃。 */
  private windChime(at: number, notes: number[]): void {
    notes.forEach((n, i) => this.bell(at + i * 0.16, n, 0.7, 1.1));
  }

  /* ---------------- 对外播放 ---------------- */

  play(id: SoundId): void {
    if (!this.ctx || !this.master) return;
    if (!this.enabled || this.volume <= 0) return;
    try {
      const t = this.now() + 0.01;
      switch (id) {
        case 'dice_shake': {
          for (let i = 0; i < 5; i += 1) {
            this.noiseBurst({
              at: t + i * 0.06 + Math.random() * 0.02,
              duration: 0.09,
              filter: 'bandpass',
              freq: 900 + Math.random() * 1400,
              q: 1.5,
              gain: 0.1,
            });
          }
          break;
        }
        case 'dice_roll': {
          this.noiseBurst({
            at: t,
            duration: 0.85,
            filter: 'bandpass',
            freq: 1500,
            sweepTo: 700,
            q: 1.1,
            gain: 0.13,
            attack: 0.05,
          });
          break;
        }
        case 'dice_hit_bowl': {
          this.hitBowl(t, 1);
          this.hitBowl(t + 0.07, 0.6);
          break;
        }
        case 'result_normal': {
          this.hitBowl(t, 0.5);
          break;
        }
        case 'result_small_win': {
          this.bell(t, 1046, 0.85, 0.85);
          this.bell(t + 0.11, 1318, 0.6, 0.7);
          break;
        }
        case 'result_medium_win': {
          this.woodblock(t, 880, 0.9);
          this.pluck(t + 0.05, 392, 0.75, 1.0);
          this.bell(t + 0.16, 1568, 0.5, 0.7);
          break;
        }
        case 'result_big_win': {
          this.drum(t, 0.85);
          this.smallGong(t + 0.03, 0.85);
          this.pluck(t + 0.14, 523, 0.85, 1.1);
          this.pluck(t + 0.3, 659, 0.7, 1.1);
          this.bell(t + 0.44, 1318, 0.55, 0.9);
          break;
        }
        case 'champion': {
          this.drum(t, 1);
          this.gong(t + 0.02, 0.95);
          this.drum(t + 0.26, 0.7);
          this.pluck(t + 0.34, 523, 0.9, 1.2);
          this.pluck(t + 0.5, 659, 0.8, 1.2);
          this.pluck(t + 0.66, 784, 0.85, 1.4);
          break;
        }
        case 'champion_top': {
          this.drum(t, 1.1);
          this.gong(t + 0.02, 1.15);
          this.drum(t + 0.22, 0.9);
          this.drum(t + 0.4, 0.75);
          this.gong(t + 0.5, 0.6);
          this.pluck(t + 0.62, 523, 1, 1.5);
          this.pluck(t + 0.78, 659, 0.9, 1.5);
          this.pluck(t + 0.94, 784, 0.95, 1.5);
          this.pluck(t + 1.1, 1046, 0.9, 1.8);
          this.bell(t + 1.3, 1568, 0.7, 1.4);
          break;
        }
        case 'champion_replaced': {
          this.smallGong(t, 1);
          this.drum(t + 0.06, 0.8);
          this.drum(t + 0.2, 0.6);
          break;
        }
        case 'game_finish': {
          this.windChime(t, [784, 988, 1175, 1568, 1976]);
          this.gong(t + 0.1, 0.45);
          break;
        }
        case 'ui_click': {
          this.woodblock(t, 1250, 0.5);
          break;
        }
        default:
          break;
      }
    } catch {
      /* 音效失败绝不影响游戏 */
    }
  }

  /** 骰子阶段的一串随机敲击（动画期间调用）。 */
  playDiceSequence(durationMs: number): void {
    if (!this.ctx) return;
    this.play('dice_shake');
    this.play('dice_roll');
    const hits = Math.max(3, Math.round(durationMs / 260));
    for (let i = 0; i < hits; i += 1) {
      const at = 140 + i * ((durationMs - 420) / hits) + Math.random() * 70;
      window.setTimeout(() => this.play('dice_hit_bowl'), Math.max(0, at));
    }
  }
}

export const audio = new AudioManager();
