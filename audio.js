(function () {
  'use strict';

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    window.GameAudio = {
      init() {},
      unlock() {},
      setVolume() {},
      setScene() {},
      setPaused() {},
      setBombMusic() {},
      sfx() {},
      explosion() {},
      weaponHit() {},
      weaponActive() {},
      getState() {
        return { supported: false, unlocked: false, scene: 'silent', paused: false, volume: 0 };
      }
    };
    return;
  }

  const MUSIC_LEVEL = 0.3;
  const SFX_LEVEL = 0.72;
  const TRACKS = {
    menu: {
      bpm: 74,
      steps: 32,
      chords: [
        [50, 53, 57],
        [46, 50, 53],
        [53, 57, 60],
        [48, 52, 55]
      ],
      roots: [38, 34, 41, 36]
    },
    battle: {
      bpm: 124,
      steps: 32,
      chords: [
        [50, 53, 57],
        [46, 50, 53],
        [53, 57, 60],
        [48, 52, 55]
      ],
      roots: [38, 34, 41, 36]
    }
  };
  const BOMB_TRACKS = {
    A: {
      bpm: 96,
      steps: 32,
      chords: [
        [50, 54, 57],
        [45, 49, 52],
        [47, 50, 54],
        [43, 47, 50]
      ],
      roots: [38, 33, 35, 31]
    },
    B: {
      bpm: 96,
      steps: 32,
      chords: [
        [50, 54, 57],
        [45, 49, 52],
        [47, 50, 54],
        [43, 47, 50]
      ],
      roots: [38, 33, 35, 31]
    }
  };

  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let bombBus = null;
  let bombTrackA = null;
  let bombTrackB = null;
  let noiseBuffer = null;
  let initialized = false;
  let unlocked = false;
  let volume = 0.7;
  let desiredScene = 'silent';
  let activeScene = null;
  let paused = false;
  let step = 0;
  let nextNoteTime = 0;
  let bombStep = 0;
  let bombNextTime = 0;
  let bombPlaying = false;
  let bombTargetA = 0;
  let bombTargetB = 0;
  let bombDuck = 0;
  let scheduler = null;
  let fadeTimer = 0;
  let unlockHandler = null;
  const lastPlayed = Object.create(null);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function throttle(key, ms) {
    const now = performance.now();
    if (now - (lastPlayed[key] || 0) < ms) return false;
    lastPlayed[key] = now;
    return true;
  }

  function ensureContext() {
    if (ctx) return true;
    try {
      ctx = new AudioContextClass();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(master);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = SFX_LEVEL;
      sfxBus.connect(master);
      bombBus = ctx.createGain();
      bombBus.gain.value = 0;
      bombBus.connect(master);
      bombTrackA = ctx.createGain();
      bombTrackA.gain.value = 0;
      bombTrackA.connect(bombBus);
      bombTrackB = ctx.createGain();
      bombTrackB.gain.value = 0;
      bombTrackB.connect(bombBus);
      noiseBuffer = createNoiseBuffer();
      scheduler = window.setInterval(() => {
        scheduleMusic();
        scheduleBombMusic();
      }, 60);
      return true;
    } catch (error) {
      ctx = null;
      master = null;
      musicBus = null;
      sfxBus = null;
      bombBus = null;
      bombTrackA = null;
      bombTrackB = null;
      noiseBuffer = null;
      return false;
    }
  }

  function createNoiseBuffer() {
    const length = Math.max(1, Math.floor(ctx.sampleRate));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  function unlock() {
    if (unlocked) return;
    if (!ensureContext()) return;
    unlocked = true;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (unlockHandler) {
      document.removeEventListener('pointerdown', unlockHandler);
      document.removeEventListener('keydown', unlockHandler);
      document.removeEventListener('touchstart', unlockHandler);
      unlockHandler = null;
    }
    setVolume(volume);
    if (desiredScene === 'menu' || desiredScene === 'battle') {
      startScene(desiredScene);
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    unlockHandler = () => unlock();
    document.addEventListener('pointerdown', unlockHandler, { passive: true });
    document.addEventListener('keydown', unlockHandler);
    document.addEventListener('touchstart', unlockHandler, { passive: true });
  }

  function setVolume(value) {
    volume = clamp(Number(value) || 0, 0, 1);
    if (!ctx || !master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
  }

  function musicTarget() {
    if (paused || (activeScene !== 'menu' && activeScene !== 'battle')) return 0;
    return MUSIC_LEVEL * (1 - 0.45 * bombDuck);
  }

  function applyMusicTarget() {
    if (!ctx || !musicBus || fadeTimer) return;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(musicTarget(), ctx.currentTime, 0.12);
  }

  function bombBusTarget() {
    return !paused && activeScene === 'battle' ? 1 : 0;
  }

  function applyBombBusTarget() {
    if (!ctx || !bombBus) return;
    bombBus.gain.cancelScheduledValues(ctx.currentTime);
    bombBus.gain.setTargetAtTime(bombBusTarget(), ctx.currentTime, 0.1);
  }

  function setPaused(value) {
    paused = Boolean(value);
    if (!ctx || !musicBus) return;
    const now = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setTargetAtTime(musicTarget(), now, 0.06);
    applyBombBusTarget();
    if (!paused) nextNoteTime = now + 0.05;
  }

  function startScene(name) {
    if (!ctx || !unlocked) return;
    activeScene = name;
    step = 0;
    nextNoteTime = ctx.currentTime + 0.08;
    if (name !== 'battle') {
      bombPlaying = false;
      bombDuck = 0;
      bombTargetA = 0;
      bombTargetB = 0;
      if (bombTrackA) bombTrackA.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      if (bombTrackB) bombTrackB.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    }
    const now = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setTargetAtTime(0, now, 0.06);
    applyBombBusTarget();
    if (fadeTimer) {
      window.clearTimeout(fadeTimer);
      fadeTimer = 0;
    }
    if (name !== 'menu' && name !== 'battle') return;
    fadeTimer = window.setTimeout(() => {
      fadeTimer = 0;
      if (!ctx || activeScene !== name || paused) return;
      applyMusicTarget();
    }, 180);
  }

  function setScene(name) {
    desiredScene = name || 'silent';
    if (!ctx || !unlocked) return;
    if (activeScene === desiredScene) {
      if (desiredScene === 'menu' || desiredScene === 'battle') {
        setPaused(paused);
      }
      return;
    }
    startScene(desiredScene);
  }

  function scheduleMusic() {
    if (!ctx || !unlocked || paused || !activeScene) return;
    const track = TRACKS[activeScene];
    if (!track) return;
    const stepDuration = 60 / track.bpm / 2;
    const horizon = ctx.currentTime + 0.18;
    if (nextNoteTime < ctx.currentTime - 0.2) nextNoteTime = ctx.currentTime + 0.05;
    while (nextNoteTime < horizon) {
      playStep(track, step, nextNoteTime);
      step = (step + 1) % track.steps;
      nextNoteTime += stepDuration;
    }
  }

  function playStep(track, index, time) {
    const bar = Math.floor(index / 8) % track.chords.length;
    const chord = track.chords[bar];
    const root = track.roots[bar];
    const isBattle = activeScene === 'battle';
    const stepDuration = 60 / track.bpm / 2;

    if (index % 8 === 0) {
      playPad(chord, time, isBattle ? 1.6 : stepDuration * 7.2, isBattle ? 0.026 : 0.042);
    }

    if (isBattle) {
      if (index % 2 === 0) {
        playBass(midiToFreq(root), time, 0.18, 0.12);
      }
      playPluck(midiToFreq(chord[index % chord.length] + 12), time, 0.13, 0.032, 'square');
      if (index % 8 === 0 || index % 8 === 4) playKick(time);
      if (index % 8 === 4) playSnare(time);
      if (index % 2 === 0) playHat(time, 0.022);
    } else {
      if (index % 8 === 0) {
        playBass(midiToFreq(root), time, 0.9, 0.075);
      }
      if (index % 2 === 0) {
        playPluck(midiToFreq(chord[(index / 2) % chord.length] + 12), time, 0.5, 0.038, 'triangle');
      }
      if (index % 16 === 8) {
        playPluck(midiToFreq(chord[0] + 24), time + stepDuration * 0.5, 0.6, 0.018, 'sine');
      }
    }
  }

  function setBombMusic(bombs, player) {
    if (!ctx || !unlocked) return;
    let sumA = 0;
    let sumB = 0;
    if (player && Array.isArray(bombs)) {
      for (const bomb of bombs) {
        if (!bomb || bomb.dead) continue;
        const distance = Math.hypot(bomb.x - player.x, bomb.y - player.y);
        if (distance >= 9) continue;
        const weight = Math.pow(clamp((9 - distance) / 7, 0, 1), 2);
        if (bomb.musicTrack === 'B') sumB += weight;
        else sumA += weight;
      }
    }
    bombTargetA = Math.min(0.5, 0.45 * sumA);
    bombTargetB = Math.min(0.5, 0.45 * sumB);
    const now = ctx.currentTime;
    if (bombTrackA) bombTrackA.gain.setTargetAtTime(bombTargetA, now, 0.12);
    if (bombTrackB) bombTrackB.gain.setTargetAtTime(bombTargetB, now, 0.12);
    bombDuck = clamp((sumA + sumB) / 1.1, 0, 1);
    applyMusicTarget();
    applyBombBusTarget();
    const audible = sumA + sumB > 0.001;
    if (audible && !bombPlaying && activeScene === 'battle') {
      bombPlaying = true;
      bombStep = 0;
      bombNextTime = now + 0.08;
    } else if (!audible) {
      bombPlaying = false;
    }
  }

  function scheduleBombMusic() {
    if (!ctx || !unlocked || paused || activeScene !== 'battle' || !bombPlaying) return;
    const track = BOMB_TRACKS.A;
    const stepDuration = 60 / track.bpm / 2;
    const horizon = ctx.currentTime + 0.18;
    if (bombNextTime < ctx.currentTime - 0.2) bombNextTime = ctx.currentTime + 0.05;
    while (bombNextTime < horizon) {
      playBombStep(bombStep, bombNextTime);
      bombStep = (bombStep + 1) % track.steps;
      bombNextTime += stepDuration;
    }
  }

  function playBombStep(index, time) {
    const trackA = BOMB_TRACKS.A;
    const trackB = BOMB_TRACKS.B;
    const bar = Math.floor(index / 8) % trackA.chords.length;
    const chordA = trackA.chords[bar];
    const rootA = trackA.roots[bar];
    const chordB = trackB.chords[bar];
    const rootB = trackB.roots[bar];

    if (bombTargetA > 0.002) {
      if (index % 8 === 0) {
        playBombPad(bombTrackA, chordA, time, 2.1, 0.018);
        playBombTone(bombTrackA, midiToFreq(rootA), time, 0.9, 0.045, 'triangle');
      }
      if (index % 2 === 0) {
        playBombTone(
          bombTrackA,
          midiToFreq(chordA[(index / 2) % chordA.length] + 24),
          time,
          0.55,
          0.032,
          'sine'
        );
      }
      if (index % 16 === 12) {
        playBombTone(bombTrackA, midiToFreq(chordA[1] + 12), time, 0.7, 0.018, 'triangle');
      }
    }

    if (bombTargetB > 0.002) {
      if (index % 8 === 0) playBombPad(bombTrackB, chordB, time, 1.2, 0.012);
      if (index % 2 === 0) {
        playBombTone(bombTrackB, midiToFreq(rootB), time, 0.22, 0.07, 'sawtooth');
      }
      playBombTone(
        bombTrackB,
        midiToFreq(chordB[index % chordB.length] + 12),
        time,
        0.12,
        0.022,
        'square'
      );
      if (index % 8 === 0 || index % 8 === 4) {
        playBombTone(bombTrackB, 120, time, 0.16, 0.12, 'sine', 38);
        playNoise(0.05, 0.025, 'lowpass', 180, time, bombTrackB);
      }
      if (index % 8 === 4) {
        playNoise(0.09, 0.045, 'bandpass', 1400, time, bombTrackB);
      }
      if (index % 2 === 0) {
        playNoise(0.025, 0.012, 'highpass', 6000, time, bombTrackB);
      }
    }
  }

  function playBombTone(destination, frequency, start, duration, gain, type, endFrequency) {
    if (!ctx || !destination) return;
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, frequency), start);
    if (endFrequency && endFrequency !== frequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + Math.min(0.02, duration * 0.3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(envelope);
    envelope.connect(destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function playBombPad(destination, chord, start, duration, gain) {
    for (let i = 0; i < chord.length; i += 1) {
      const frequency = midiToFreq(chord[i]);
      playBombTone(destination, frequency, start, duration, gain, 'triangle');
      playBombTone(destination, frequency * 1.006, start, duration, gain * 0.5, 'sine');
    }
  }

  function playTone(frequency, start, duration, gain, type, endFrequency) {
    if (!ctx || !sfxBus) return;
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, frequency), start);
    if (endFrequency && endFrequency !== frequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + Math.min(0.015, duration * 0.25));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(envelope);
    envelope.connect(sfxBus);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function playMusicTone(frequency, start, duration, gain, type, endFrequency) {
    if (!ctx || !musicBus) return;
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, frequency), start);
    if (endFrequency && endFrequency !== frequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + Math.min(0.03, duration * 0.3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(envelope);
    envelope.connect(musicBus);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function playPad(chord, start, duration, gain) {
    for (let i = 0; i < chord.length; i += 1) {
      const frequency = midiToFreq(chord[i]);
      playMusicTone(frequency, start, duration, gain, 'triangle');
      playMusicTone(frequency * 1.005, start, duration, gain * 0.55, 'sine');
    }
  }

  function playBass(frequency, start, duration, gain) {
    playMusicTone(frequency, start, duration, gain, 'triangle', frequency * 0.96);
  }

  function playPluck(frequency, start, duration, gain, type) {
    playMusicTone(frequency, start, duration, gain, type || 'triangle');
  }

  function playNoise(duration, gain, filterType, frequency, start, destination) {
    if (!ctx || !noiseBuffer) return;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const envelope = ctx.createGain();
    source.buffer = noiseBuffer;
    filter.type = filterType || 'lowpass';
    filter.frequency.setValueAtTime(frequency || 1200, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination || sfxBus);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  function playKick(start) {
    playMusicTone(120, start, 0.18, 0.2, 'sine', 38);
    playNoise(0.06, 0.05, 'lowpass', 180, start, musicBus);
  }

  function playSnare(start) {
    playNoise(0.11, 0.09, 'bandpass', 1400, start, musicBus);
    playMusicTone(180, start, 0.07, 0.045, 'triangle', 90);
  }

  function playHat(start, gain) {
    playNoise(0.035, gain, 'highpass', 6000, start, musicBus);
  }

  function sfxIceBody(start) {
    playTone(1040, start, 0.16, 0.085, 'sine', 1450);
    playTone(1560, start + 0.015, 0.12, 0.045, 'triangle', 1100);
  }

  function spikeTick(start) {
    playNoise(0.035, 0.07, 'highpass', 4200, start);
    playTone(2200, start, 0.035, 0.045, 'square', 1200);
  }

  function playPreset(name) {
    if (!ctx || !unlocked) return;
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'physical':
        playTone(150, t, 0.09, 0.18, 'triangle', 70);
        playNoise(0.055, 0.08, 'lowpass', 420, t);
        break;
      case 'physicalSpike':
        playTone(150, t, 0.09, 0.16, 'triangle', 70);
        playNoise(0.055, 0.07, 'lowpass', 420, t);
        spikeTick(t + 0.012);
        break;
      case 'energy':
        playTone(520, t, 0.13, 0.08, 'sawtooth', 130);
        playNoise(0.04, 0.035, 'bandpass', 1800, t);
        break;
      case 'energySpike':
        playTone(520, t, 0.12, 0.075, 'sawtooth', 130);
        spikeTick(t + 0.01);
        break;
      case 'ice':
        sfxIceBody(t);
        break;
      case 'iceSpike':
        sfxIceBody(t);
        spikeTick(t + 0.014);
        break;
      case 'poison':
        playTone(190, t, 0.16, 0.1, 'sine', 85);
        playNoise(0.08, 0.035, 'lowpass', 500, t);
        break;
      case 'poisonSpike':
        playTone(190, t, 0.15, 0.09, 'sine', 85);
        spikeTick(t + 0.012);
        break;
      case 'explosion':
        playNoise(0.38, 0.18, 'lowpass', 700, t);
        playTone(95, t, 0.32, 0.15, 'sine', 30);
        break;
      case 'slash':
        playNoise(0.12, 0.1, 'bandpass', 1800, t);
        playTone(320, t, 0.1, 0.03, 'triangle', 120);
        break;
      case 'punch':
        playTone(110, t, 0.1, 0.16, 'sine', 50);
        playNoise(0.045, 0.06, 'lowpass', 320, t);
        break;
      case 'bite':
        playNoise(0.07, 0.08, 'bandpass', 900, t);
        playTone(170, t, 0.06, 0.06, 'triangle', 80);
        break;
      case 'cast':
        playTone(300, t, 0.2, 0.055, 'triangle', 700);
        break;
      case 'iceCast':
        playTone(620, t, 0.24, 0.05, 'sine', 1200);
        break;
      case 'frostBeam':
        playTone(1100, t, 0.32, 0.085, 'sine', 220);
        playTone(660, t + 0.02, 0.24, 0.045, 'triangle', 160);
        playNoise(0.2, 0.045, 'highpass', 2400, t);
        break;
      case 'shotgunBlast':
        playNoise(0.2, 0.18, 'lowpass', 900, t);
        playTone(130, t, 0.16, 0.15, 'triangle', 45);
        break;
      case 'summon':
        playTone(260, t, 0.18, 0.055, 'triangle', 390);
        playTone(390, t + 0.09, 0.22, 0.045, 'sine', 520);
        break;
      case 'build':
        playNoise(0.06, 0.07, 'bandpass', 700, t);
        playTone(160, t, 0.12, 0.06, 'triangle', 90);
        break;
      case 'signal':
        playTone(660, t, 0.1, 0.06, 'sine', 660);
        playTone(880, t + 0.1, 0.16, 0.045, 'sine', 880);
        break;
      case 'vine':
        playNoise(0.18, 0.08, 'bandpass', 620, t);
        playTone(120, t, 0.2, 0.055, 'triangle', 70);
        break;
      case 'hurt':
        playTone(130, t, 0.18, 0.12, 'sawtooth', 60);
        playNoise(0.09, 0.08, 'lowpass', 420, t);
        break;
      case 'death':
        playTone(240, t, 0.18, 0.08, 'triangle', 55);
        break;
      case 'bossDeath':
        playTone(80, t, 0.8, 0.16, 'sine', 25);
        playNoise(0.6, 0.13, 'lowpass', 500, t);
        break;
      case 'victory':
        playTone(440, t, 0.15, 0.06, 'triangle');
        playTone(554, t + 0.12, 0.15, 0.06, 'triangle');
        playTone(659, t + 0.24, 0.4, 0.07, 'triangle');
        break;
      case 'defeat':
        playTone(220, t, 0.25, 0.07, 'triangle', 180);
        playTone(165, t + 0.2, 0.45, 0.06, 'sine', 90);
        break;
      case 'music':
        playTone(660, t, 0.15, 0.05, 'sine');
        playTone(880, t + 0.08, 0.25, 0.04, 'triangle');
        break;
      default:
        playTone(260, t, 0.12, 0.04, 'triangle');
        break;
    }
  }

  function sfx(name) {
    if (!ctx || !unlocked) return;
    if (!throttle('sfx:' + name, 60)) return;
    playPreset(name);
  }

  function weaponHit(sourceId, damageType, options) {
    if (!ctx || !unlocked) return;
    const flags = options || {};
    if (flags.dot || flags.explosion) return;
    let signature = damageType || 'physical';
    if (flags.spike) signature = signature + 'Spike';
    if (!throttle('hit:' + (sourceId || signature) + ':' + signature, 80)) return;
    playPreset(signature);
  }

  function explosion(sourceId) {
    if (!ctx || !unlocked) return;
    if (!throttle('explosion:' + (sourceId || 'generic'), 80)) return;
    playPreset('explosion');
  }

  const ACTIVE_PRESETS = {
    musicBomb: 'music',
    piranha: 'bite',
    focusGauntlet: 'punch',
    forestBoots: 'vine',
    spiderTowerBox: 'signal',
    frostCannon: 'iceCast',
    outlawShotgun: 'signal',
    scavengerCrown: 'summon',
    poisonSacBook: 'summon',
    necroBook: 'summon',
    launcherBox: 'build',
    energyTowerBox: 'build',
    lightningRod: 'build',
    springTrap: 'build',
    spikeMine: 'build',
    iceWhisper: 'iceCast',
    iceStandoff: 'iceCast'
  };

  function weaponActive(weaponId) {
    if (!ctx || !unlocked) return;
    if (!throttle('active:' + weaponId, 260)) return;
    playPreset(ACTIVE_PRESETS[weaponId] || 'cast');
  }

  function getState() {
    return {
      supported: true,
      unlocked,
      scene: activeScene,
      paused,
      volume,
      contextState: ctx ? ctx.state : 'none',
      bombTargetA,
      bombTargetB,
      bombDuck,
      bombPlaying
    };
  }

  window.GameAudio = {
    init,
    unlock,
    setVolume,
    setScene,
    setPaused,
    setBombMusic,
    sfx,
    explosion,
    weaponHit,
    weaponActive,
    getState
  };
})();
