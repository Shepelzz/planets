import { BODIES, EARTH_DIAMETER, type BodyId, type BodyInfo } from './data';

interface Handlers {
  onSelect: (id: BodyId) => void;
  onOverview: () => void;
  onTogglePlay: () => void;
}

const EARTH = BODIES.find((b) => b.id === 'earth')!;

const ICONS = {
  pause: '<svg class="solid" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
  play: '<svg class="solid" viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="6.5" ry="6.5" opacity=".7"/><ellipse cx="12" cy="12" rx="10" ry="10" opacity=".45"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6" stroke-linecap="round"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// Rendered 3D thumbnails (data URLs) once the textures are in; gradients until then.
let thumbs: Record<string, string> = {};
function iconBg(info: BodyInfo): string {
  const t = thumbs[info.id];
  return t ? `url(${t}) center / contain no-repeat` : info.icon;
}
const iconClass = (info: BodyInfo) => (thumbs[info.id] ? ' textured' : '');

function sizeCompare(info: BodyInfo): string {
  const ratio = info.diameterKm / EARTH_DIAMETER;
  const max = 64;
  const big = Math.max(ratio, 1);
  const earthR = Math.max((1 / big) * max, 1.5);
  const bodyR = Math.max((ratio / big) * max, 1.5);
  let caption: string;
  if (info.id === 'earth') caption = 'Это и есть Земля!';
  else if (ratio >= 1.5) caption = `Больше Земли в ${fmt(ratio)} раз${plural(ratio)}`;
  else if (ratio <= 0.67) caption = `Меньше Земли в ${fmt(1 / ratio)} раз${plural(1 / ratio)}`;
  else caption = 'Почти как Земля';
  return `
    <div class="compare">
      <div class="compare-pics">
        <div class="compare-item">
          <div class="ball${iconClass(info)}" style="width:${bodyR * 2}px;height:${bodyR * 2}px;background:${iconBg(info)}"></div>
          <span>${info.name}</span>
        </div>
        ${info.id === 'earth' ? '' : `
        <div class="compare-item">
          <div class="ball${iconClass(EARTH)}" style="width:${earthR * 2}px;height:${earthR * 2}px;background:${iconBg(EARTH)}"></div>
          <span>Земля</span>
        </div>`}
      </div>
      <div class="compare-caption">${caption} (по ширине)</div>
    </div>`;
}

function fmt(x: number) {
  if (x >= 10) return Math.round(x).toLocaleString('ru-RU');
  return (Math.round(x * 10) / 10).toLocaleString('ru-RU');
}
function plural(x: number) {
  const n = Math.round(x);
  if (!Number.isInteger(Math.round(x * 10) / 10)) return 'а';
  const m10 = n % 10, m100 = n % 100;
  return m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'а' : '';
}

export function createUI(h: Handlers) {
  const dock = document.getElementById('dock')!;
  const info = document.getElementById('info')!;
  const hint = document.getElementById('hint')!;
  const btnMotion = document.getElementById('btn-motion')!;
  const btnOverview = document.getElementById('btn-overview')!;
  const btnInfo = document.getElementById('btn-info')!;
  btnOverview.innerHTML = ICONS.system;
  btnInfo.innerHTML = ICONS.info;

  const chips = new Map<BodyId, HTMLButtonElement>();
  for (const b of BODIES) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (b.rings ? ' ringed' : '') + (b.id === 'sun' ? ' star' : '');
    chip.innerHTML = `<span class="chip-ball"></span><span class="chip-name">${b.name}</span>`;
    chip.addEventListener('click', () => h.onSelect(b.id));
    paintChip(chip, b);
    dock.appendChild(chip);
    chips.set(b.id, chip);
  }

  function paintChip(chip: HTMLElement, b: BodyInfo) {
    const ball = chip.querySelector('.chip-ball') as HTMLElement;
    ball.style.background = iconBg(b);
    ball.classList.toggle('textured', !!thumbs[b.id]);
  }

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
      <button class="close" aria-label="Скрыть">${ICONS.close}</button>
      <div class="info-head">
        <span class="info-ball${iconClass(b)}" style="background:${iconBg(b)}"></span>
        <div>
          <h1>${b.name}</h1>
          <p class="kind">${b.kind}</p>
        </div>
      </div>
      <div class="info-body">
        <dl class="stats">
          ${b.stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
        </dl>
        ${sizeCompare(b)}
        <section class="fact">
          <h2>А ты знала?</h2>
          <p class="fact-text">${b.facts[factIndex % b.facts.length]}</p>
          <div class="fact-foot">
            <span class="dots">${b.facts.map((_, i) => `<i class="${i === factIndex % b.facts.length ? 'on' : ''}"></i>`).join('')}</span>
            <button class="next-fact">Ещё факт</button>
          </div>
        </section>
      </div>
      <p class="credit">Карты планет: <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar System Scope</a> (CC BY 4.0) по данным NASA</p>`;
    info.querySelector('.close')!.addEventListener('click', () => {
      infoWanted = false;
      renderInfo();
      syncInfoBtn();
    });
    info.querySelector('.next-fact')!.addEventListener('click', () => {
      factIndex++;
      const p = info.querySelector('.fact-text') as HTMLElement;
      p.classList.remove('pop');
      void p.offsetWidth;
      p.textContent = b.facts[factIndex % b.facts.length];
      p.classList.add('pop');
      info.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i === factIndex % b.facts.length));
    });
  }

  function syncInfoBtn() {
    btnInfo.classList.toggle('active', !!current && infoWanted);
    btnInfo.toggleAttribute('disabled', !current);
  }

  btnMotion.addEventListener('click', h.onTogglePlay);
  btnOverview.addEventListener('click', h.onOverview);
  btnInfo.addEventListener('click', () => {
    infoWanted = !infoWanted;
    renderInfo();
    syncInfoBtn();
  });

  return {
    setThumbnails(t: Record<string, string>) {
      thumbs = t;
      for (const b of BODIES) paintChip(chips.get(b.id)!, b);
      const scrollTop = info.scrollTop;
      renderInfo();
      info.scrollTop = scrollTop;
    },
    setSelected(id: BodyId | null) {
      for (const [cid, chip] of chips) chip.classList.toggle('selected', cid === id);
      if (id) {
        chips.get(id)!.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        hint.classList.add('gone');
      }
      const next = id ? BODIES.find((b) => b.id === id)! : null;
      if (next !== current) factIndex = 0;
      current = next;
      document.body.classList.toggle('has-focus', !!current);
      renderInfo();
      syncInfoBtn();
    },
    setPlaying(p: boolean) {
      btnMotion.innerHTML = p ? ICONS.pause : ICONS.play;
      btnMotion.setAttribute('aria-label', p ? 'Пауза' : 'Продолжить');
      btnMotion.title = p ? 'Остановить движение (пробел)' : 'Запустить движение (пробел)';
    },
    toggleInfo() {
      if (!current) return;
      infoWanted = !infoWanted;
      renderInfo();
      syncInfoBtn();
    },
  };
}
