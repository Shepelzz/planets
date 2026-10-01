import { BODIES, EARTH_DIAMETER, type BodyId, type BodyInfo } from './data';
import { NARRATION } from './narration';
import { STRUCTURE_LABEL } from './phrases';
import { say, setSpeechEnabled, speechSupported } from './speech';

interface Handlers {
  onSelect: (id: BodyId) => void;
  onOverview: () => void;
  onTogglePlay: () => void;
  /** Open (or close, if open) the cut-away of the current body; onEnd when its story ends. Returns true if it opened. */
  onStructure: (onEnd: () => void) => boolean;
  /** Another block on the card is about to talk. */
  onTalk: () => void;
}

const EARTH = BODIES.find((b) => b.id === 'earth')!;

const ICONS = {
  soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.5a8 8 0 0 1 0 11"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  pause: '<svg class="solid" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
  play: '<svg class="solid" viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="6.5" ry="6.5" opacity=".7"/><ellipse cx="12" cy="12" rx="10" ry="10" opacity=".45"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
  labels: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6" stroke-linecap="round"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// Rendered 3D thumbnails (data URLs) once the textures are in; gradients until then.
let thumbs: Record<string, string> = {};
function iconBg(info: BodyInfo): string {
  const t = thumbs[info.id];
  return t ? `url(${t}) center / contain no-repeat` : info.icon;
}
const iconClass = (info: BodyInfo) => (thumbs[info.id] ? ' textured' : '');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// small speaker mark on blocks that talk when tapped (hidden while sound is off)
// a little knife-cut planet: marks the block that opens the cut-away
const CUT_MARK = '<svg class="say-mark cut-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9h-9z" fill="currentColor"/><path d="M14 2.2A9 9 0 0 1 21.8 10H14z" fill="currentColor" opacity=".45"/></svg>';
const SAY_MARK = '<svg class="say-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const moonsOf = (id: BodyId) => BODIES.filter((b) => b.parent === id);

/** Buttons for the moons we can fly to, inside the card's «Супутники» block. */
function statMoons(b: BodyInfo): string {
  const moons = moonsOf(b.id);
  if (!moons.length) return '';
  return `<div class="stat-moons">${moons
    .map((m) => `<button class="stat-moon" data-moon="${m.id}"><span class="moon-ball${iconClass(m)}" style="background:${iconBg(m)}"></span>${m.name}</button>`)
    .join('')}</div>`;
}

function sizeCompare(info: BodyInfo): string {
  const ratio = info.diameterKm / EARTH_DIAMETER;
  const max = 64;
  const big = Math.max(ratio, 1);
  const earthR = Math.max((1 / big) * max, 1.5);
  const bodyR = Math.max((ratio / big) * max, 1.5);
  let caption: string;
  if (info.id === 'earth') caption = 'Це і є Земля!';
  else if (ratio >= 1.5) caption = `У ${fmt(ratio)} ${times(ratio)} більше за Землю`;
  else if (ratio <= 0.67) caption = `У ${fmt(1 / ratio)} ${times(1 / ratio)} менше за Землю`;
  else caption = 'Майже як Земля';
  return `
    <div class="compare talk" role="button" tabindex="0" data-say="${esc(NARRATION[info.id].compare)}">
      ${SAY_MARK}
      <div class="compare-pics">
        <div class="compare-item">
          <div class="ball${iconClass(info)}" style="width:${bodyR * 2}px;height:${bodyR * 2}px;background:${iconBg(info)}"></div>
          <span>${info.name}</span>
        </div>
        ${info.id === 'earth' ? '' : `
        <div class="compare-item">
          <div class="ball${iconClass(EARTH)}" style="width:${earthR * 2}px;height:${earthR * 2}px;background:${iconBg(EARTH)}"></div>
          <span>${EARTH.name}</span>
        </div>`}
      </div>
      <div class="compare-caption">${caption} (завширшки)</div>
    </div>`;
}

function fmt(x: number) {
  if (x >= 10) return Math.round(x).toLocaleString('uk-UA');
  return (Math.round(x * 10) / 10).toLocaleString('uk-UA');
}
/** Ukrainian form of «раз»: 1 раз, 2–4 рази, 5+ разів, fractions — раза. */
function times(x: number) {
  if (!Number.isInteger(Math.round(x * 10) / 10)) return 'раза';
  const n = Math.round(x);
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'раз';
  return m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'рази' : 'разів';
}

export function createUI(h: Handlers) {
  const dock = document.getElementById('dock')!;
  const info = document.getElementById('info')!;
  const hint = document.getElementById('hint')!;
  const btnMotion = document.getElementById('btn-motion')!;
  const btnOverview = document.getElementById('btn-overview')!;
  const btnLabels = document.getElementById('btn-labels')!;
  const btnSound = document.getElementById('btn-sound')!;
  btnOverview.innerHTML = ICONS.system;
  btnLabels.innerHTML = ICONS.labels;

  // The dock holds only the Sun, the planets and the dwarf planet (in groups with dividers); moons
  // live in a row that appears above it for the chosen planet, so the dock never grows with them.
  const chips = new Map<BodyId, HTMLButtonElement>();
  let prevGroup = '';
  for (const b of BODIES.filter((x) => !x.parent)) {
    const group = b.id === 'sun' ? 'star' : b.dwarf ? 'dwarf' : 'planet';
    if (prevGroup && group !== prevGroup) {
      const sep = document.createElement('span');
      sep.className = 'dock-sep';
      dock.appendChild(sep);
    }
    prevGroup = group;
    const chip = document.createElement('button');
    chip.className = 'chip' + (b.rings ? ' ringed' : '') + (b.id === 'sun' ? ' star' : '');
    const moonCount = moonsOf(b.id).length;
    const badge = moonCount ? `<span class="chip-badge" aria-label="супутників: ${moonCount}">${moonCount}</span>` : '';
    chip.innerHTML = `<span class="chip-ball">${badge}</span><span class="chip-name">${b.name}</span>`;
    chip.addEventListener('click', () => h.onSelect(b.id));
    paintChip(chip, b);
    dock.appendChild(chip);
    chips.set(b.id, chip);
  }

  // moons of the chosen planet (or of the chosen moon's planet), above the dock
  const moonsRow = document.createElement('div');
  moonsRow.id = 'moons';
  document.body.appendChild(moonsRow);
  function renderMoons() {
    const parentId = current ? current.parent ?? current.id : null;
    const parent = parentId ? BODIES.find((b) => b.id === parentId)! : null;
    const moons = parentId ? moonsOf(parentId) : [];
    const show = moons.length > 0;
    moonsRow.classList.toggle('show', show);
    document.body.classList.toggle('has-moons', show);
    if (!show || !parent) return;
    moonsRow.setAttribute('aria-label', `Супутники ${parent.nameGenitive ?? parent.name}`);
    moonsRow.innerHTML = moons
        .map(
          (m) =>
            `<button class="moon-chip${current && m.id === current.id ? ' selected' : ''}" data-moon="${m.id}">` +
            `<span class="moon-ball${iconClass(m)}" style="background:${iconBg(m)}"></span><span class="moon-name">${m.name}</span></button>`,
        )
        .join('');
  }
  moonsRow.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-moon]') as HTMLElement | null;
    if (btn) h.onSelect(btn.dataset.moon as BodyId);
  });

  function paintChip(chip: HTMLElement, b: BodyInfo) {
    const ball = chip.querySelector('.chip-ball') as HTMLElement;
    ball.style.background = iconBg(b);
    ball.classList.toggle('textured', !!thumbs[b.id]);
  }

  // ---- narration: tapping a block on the card reads it aloud ----
  let speakingEl: HTMLElement | null = null;
  function talk(el: HTMLElement, text: string) {
    h.onTalk();
    speakingEl?.classList.remove('speaking');
    speakingEl = el;
    const spoke = say(text, () => {
      el.classList.remove('speaking');
      if (speakingEl === el) speakingEl = null;
    });
    if (spoke) el.classList.add('speaking');
  }
  function onTalkTap(e: Event) {
    const moonBtn = (e.target as HTMLElement).closest('[data-moon]') as HTMLElement | null;
    if (moonBtn && info.contains(moonBtn)) {
      h.onSelect(moonBtn.dataset.moon as BodyId);
      return;
    }
    const el = (e.target as HTMLElement).closest('.talk') as HTMLElement | null;
    if (!el || !info.contains(el)) return;
    if (el.dataset.structure) {
      speakingEl?.classList.remove('speaking');
      speakingEl = el;
      const opened = h.onStructure(() => {
        el.classList.remove('speaking');
        if (speakingEl === el) speakingEl = null;
      });
      el.classList.toggle('speaking', opened);
      return;
    }
    talk(el, el.dataset.say ?? el.textContent ?? '');
  }
  info.addEventListener('click', onTalkTap);
  info.addEventListener('keydown', (e) => {
    // Enter only: Space is the global pause key and must not press the focused block again
    if (e.key === 'Enter') {
      e.preventDefault();
      onTalkTap(e);
    }
  });

  let current: BodyInfo | null = null;
  let factIndex = 0;
  let infoWanted = true;

  function renderInfo() {
    if (!current) {
      info.hidden = true;
      return;
    }
    const b = current;
    info.hidden = !infoWanted;
    info.innerHTML = `
      <button class="close" aria-label="Сховати">${ICONS.close}</button>
      <div class="info-head">
        <span class="info-ball${iconClass(b)}" style="background:${iconBg(b)}"></span>
        <div>
          <h1 class="talk" data-say="${esc(`${b.name}. ${b.kind}.`)}">${b.name}</h1>
          <p class="kind">${b.kind}</p>
        </div>
      </div>
      <div class="info-body">
        <dl class="stats">
          ${b.stats.map(([k, v]) => {
            const value = esc(v).replace(/\n/g, '<br>');
            return k === STRUCTURE_LABEL
              ? `<div class="talk structure" role="button" tabindex="0" data-structure="1">${CUT_MARK}<dt>${k}</dt><dd>${value}</dd><p class="cut-hint">натисни — і зазирни всередину</p></div>`
              : `<div class="talk" role="button" tabindex="0" data-say="${esc(NARRATION[b.id].stats[k] ?? `${k}: ${v}`)}">${SAY_MARK}<dt>${k}</dt><dd>${value}</dd>${k === 'Супутники' ? statMoons(b) : ''}</div>`;
          }).join('')}
        </dl>
        ${sizeCompare(b)}
        <section class="fact">
          <h2>А ти знаєш?</h2>
          <p class="fact-text talk" role="button" tabindex="0">${b.facts[factIndex % b.facts.length]}</p>
          <div class="fact-foot">
            <span class="dots">${b.facts.map((_, i) => `<i class="${i === factIndex % b.facts.length ? 'on' : ''}"></i>`).join('')}</span>
            <button class="next-fact">Ще факт</button>
          </div>
        </section>
      </div>
      <p class="credit">Мапи планет: <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar System Scope</a> (CC BY 4.0) за даними NASA; Плутон і Харон — NASA / New Horizons</p>`;
    info.querySelector('.close')!.addEventListener('click', () => {
      infoWanted = false;
      renderInfo();
    });
    info.querySelector('.next-fact')!.addEventListener('click', () => {
      factIndex++;
      const p = info.querySelector('.fact-text') as HTMLElement;
      p.classList.remove('pop');
      void p.offsetWidth;
      p.textContent = b.facts[factIndex % b.facts.length];
      p.classList.add('pop');
      info.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i === factIndex % b.facts.length));
      talk(p, p.textContent!);
    });
  }

  // planet name labels in the 3D view; the choice survives a reload
  let labelsOn = true;
  try {
    labelsOn = localStorage.getItem('planets.labels') !== 'off';
  } catch {
    /* storage unavailable (private mode): keep the default */
  }
  function applyLabels() {
    document.body.classList.toggle('no-labels', !labelsOn);
    btnLabels.classList.toggle('active', labelsOn);
    btnLabels.setAttribute('aria-pressed', String(labelsOn));
    btnLabels.title = labelsOn ? 'Сховати підписи планет (L)' : 'Показати підписи планет (L)';
  }
  function toggleLabels() {
    labelsOn = !labelsOn;
    applyLabels();

  // saying planet names aloud: on by default, remembered like the labels
  let soundOn = true;
  try {
    soundOn = localStorage.getItem('planets.sound') !== 'off';
  } catch {
    /* storage unavailable: keep the default */
  }
  function applySound() {
    setSpeechEnabled(soundOn);
    document.body.classList.toggle('no-sound', !soundOn);
    btnSound.innerHTML = soundOn ? ICONS.soundOn : ICONS.soundOff;
    btnSound.classList.toggle('active', soundOn);
    btnSound.setAttribute('aria-pressed', String(soundOn));
    btnSound.title = soundOn ? 'Не називати планети вголос (S)' : 'Називати планети вголос (S)';
  }
  function toggleSound() {
    soundOn = !soundOn;
    applySound();
    try {
      localStorage.setItem('planets.sound', soundOn ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }
  applySound();
  if (!speechSupported) btnSound.hidden = true;
    try {
      localStorage.setItem('planets.labels', labelsOn ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }
  applyLabels();

  // saying planet names aloud: on by default, remembered like the labels
  let soundOn = true;
  try {
    soundOn = localStorage.getItem('planets.sound') !== 'off';
  } catch {
    /* storage unavailable: keep the default */
  }
  function applySound() {
    setSpeechEnabled(soundOn);
    document.body.classList.toggle('no-sound', !soundOn);
    btnSound.innerHTML = soundOn ? ICONS.soundOn : ICONS.soundOff;
    btnSound.classList.toggle('active', soundOn);
    btnSound.setAttribute('aria-pressed', String(soundOn));
    btnSound.title = soundOn ? 'Не називати планети вголос (S)' : 'Називати планети вголос (S)';
  }
  function toggleSound() {
    soundOn = !soundOn;
    applySound();
    try {
      localStorage.setItem('planets.sound', soundOn ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }
  applySound();
  if (!speechSupported) btnSound.hidden = true;

  btnMotion.addEventListener('click', h.onTogglePlay);
  btnOverview.addEventListener('click', h.onOverview);
  btnLabels.addEventListener('click', toggleLabels);
  btnSound.addEventListener('click', toggleSound);

  return {
    setThumbnails(t: Record<string, string>) {
      thumbs = t;
      for (const [cid, chip] of chips) paintChip(chip, BODIES.find((b) => b.id === cid)!);
      renderMoons();
      const scrollTop = info.scrollTop;
      renderInfo();
      info.scrollTop = scrollTop;
    },
    setSelected(id: BodyId | null) {
      const next = id ? BODIES.find((b) => b.id === id)! : null;
      const dockId = next ? next.parent ?? next.id : null; // a moon lights up its planet
      for (const [cid, chip] of chips) chip.classList.toggle('selected', cid === dockId);
      if (dockId) {
        chips.get(dockId)!.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        hint.classList.add('gone');
      }
      if (next !== current) factIndex = 0;
      current = next;
      document.body.classList.toggle('has-focus', !!current);
      renderMoons();
      renderInfo();
    },
    setPlaying(p: boolean) {
      btnMotion.innerHTML = p ? ICONS.pause : ICONS.play;
      btnMotion.setAttribute('aria-label', p ? 'Пауза' : 'Продовжити');
      btnMotion.title = p ? 'Зупинити рух (пробіл)' : 'Запустити рух (пробіл)';
    },
    toggleInfo() {
      if (!current) return;
      infoWanted = !infoWanted;
      renderInfo();
    },
    /** Reopen the story card after it was closed (tapping the selected planet again). */
    showInfo() {
      if (!current || infoWanted) return;
      infoWanted = true;
      renderInfo();
    },
    /** Tap on empty space: put the card away (tapping the planet again brings it back). */
    hideInfo() {
      if (!current || !infoWanted) return;
      infoWanted = false;
      renderInfo();
    },
    toggleLabels,
    toggleSound,
  };
}
