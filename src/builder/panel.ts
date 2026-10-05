import { BUILDER } from '../content';
import { say } from '../speech';
import type { PlanetState, State } from './main';
import {
  gravity, life, MAX_PLANETS, STARS, starColor, tempBand, temperatureC, yearDays,
  type PlanetKind, type PlanetSize, type StarKind,
} from './physics';

// The panel of «Моя система»: the star, the planets, the chosen planet's make-up and what follows from
// it. A tap on an option chooses it, silently; the little speaker beside it explains it aloud (a
// grown-up helps with the choices, the voice is there when the child wants to hear).

const L = BUILDER.labels;
const S = BUILDER.say;
type SayKey = keyof typeof S;

interface Handlers {
  state: State;
  selected: () => number | null;
  setStar: (k: StarKind) => void;
  addPlanet: (k: PlanetKind) => void;
  select: (id: number | null) => void;
  update: (id: number, change: Partial<PlanetState>) => void;
  remove: (id: number) => void;
  clear: () => void;
}

const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const speaker = (key: SayKey) => `<button class="say" data-say="${key}" aria-label="Послухати">${SPEAKER}</button>`;

/** 1 день, 2 дні, 5 днів: the Ukrainian plural of a count (forms «one|few|many» from texts.yaml) */
function plural(n: number, forms: string) {
  const [one, few, many] = forms.split('|');
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}
const num = (x: number) => (Math.round(x * 10) / 10).toString().replace('.', ',');

const STAR_KINDS: StarKind[] = ['red', 'sun', 'white', 'blue'];
const KINDS: PlanetKind[] = ['rocky', 'ice', 'gas'];
const SIZES: PlanetSize[] = ['small', 'medium', 'large'];

function starBall(k: StarKind) {
  const [r, g, b] = starColor(STARS[k].temp).map((x) => Math.round(x * 255));
  const size = { red: 26, sun: 34, white: 40, blue: 48 }[k];
  return `<span class="ball star-ball" style="width:${size}px;height:${size}px;background:radial-gradient(circle at 40% 38%, #fff 0%, rgb(${r},${g},${b}) 45%, rgba(${r >> 1},${g >> 1},${b >> 1},1) 100%);box-shadow:0 0 16px rgba(${r},${g},${b},0.7)"></span>`;
}
/** a planet's little picture: by kind, a rocky one by its warmth */
function planetBall(kind: PlanetKind, band?: string) {
  const look =
    kind === 'gas' ? '#f3e2c4 0%, #c99b62 50%, #6b4a28 100%'
    : kind === 'ice' ? '#d6f2ff 0%, #4f8fd8 55%, #1a3060 100%'
    : ({ scorching: '#fff2c8 0%, #e2b062 50%, #8a5a20 100%', hot: '#ffd2b0 0%, #c8653a 55%, #5a2412 100%',
         mild: '#c8ecff 0%, #3a8bd0 40%, #2f7a3e 70%, #0d2a4a 100%', cold: '#e8e0d6 0%, #8f8476 55%, #3c352e 100%',
         frozen: '#ffffff 0%, #cfe2ee 55%, #6d8394 100%' } as Record<string, string>)[band ?? 'mild'];
  return `<span class="ball" style="background:radial-gradient(circle at 35% 35%, ${look})"></span>`;
}

export function createPanel(h: Handlers) {
  const el = document.getElementById('panel')!;
  document.querySelector('.back')!.textContent = `← ${L.back}`;
  let adding = false;

  function results(p: PlanetState) {
    const star = STARS[h.state.star];
    const days = yearDays(star, p.au);
    const year = days < 1000 ? `${Math.round(days)} ${plural(Math.round(days), L.days)}` : `${num(days / 365.25)} ${plural(Math.round(days / 365.25), L.years)}`;
    const yearSay: SayKey = days < 0.7 * 365.25 ? 'year_short' : days > 1.4 * 365.25 ? 'year_long' : 'year_earth';
    const c = temperatureC(star, p.au, p.kind);
    const temp = `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(Math.round(c / 5) * 5)} °C`;
    const tempSay = `temp_${tempBand(c)}` as SayKey;
    let weight: string, weightSay: SayKey;
    if (p.kind !== 'rocky') {
      weight = L.no_ground;
      weightSay = 'weight_gas';
    } else {
      const g = gravity(p.size);
      weight = g < 0.9 ? L.lighter.replace('{n}', num(1 / g)) : g > 1.1 ? L.heavier.replace('{n}', num(g)) : L.same_weight;
      weightSay = g < 0.9 ? 'weight_light' : g > 1.1 ? 'weight_heavy' : 'weight_earth';
    }
    const v = life(p.kind, c);
    return `
      <dl class="results">
        <div><dt>${L.year}</dt><dd>${year}</dd>${speaker(yearSay)}</div>
        <div><dt>${L.temperature}</dt><dd>${temp}</dd>${speaker(tempSay)}</div>
        <div><dt>${L.weight}</dt><dd>${weight}</dd>${speaker(weightSay)}</div>
        <div class="life ${v}"><dt>${L.life}</dt><dd>${L[`life_${v}`]}</dd>${speaker(`life_${v}` as SayKey)}</div>
      </dl>`;
  }

  function render() {
    const st = h.state;
    const sel = st.planets.find((p) => p.id === h.selected()) ?? null;
    const band = (p: PlanetState) => (p.kind === 'rocky' ? tempBand(temperatureC(STARS[st.star], p.au, p.kind)) : undefined);
    const full = st.planets.length >= MAX_PLANETS;
    el.innerHTML = `
      <h1>${L.title}</h1>
      <p class="hint">${L.drag_hint}${speaker('hint')}</p>
      <section>
        <h2>${L.star}</h2>
        <div class="tiles">${STAR_KINDS.map((k) => `
          <div class="tile${st.star === k ? ' on' : ''}">
            <button class="pick" data-star="${k}">${starBall(k)}<span>${L[`star_${k}`]}</span></button>${speaker(`star_${k}`)}
          </div>`).join('')}
        </div>
        <p class="legend"><span class="zone-dot"></span>${L.zone}${speaker('zone')}</p>
      </section>
      <section>
        <h2>${L.planets}</h2>
        <div class="planet-list">
          ${st.planets.map((p, i) => `<button class="planet-chip${p.id === sel?.id ? ' on' : ''}" data-select="${p.id}">${planetBall(p.kind, band(p))}<b>${i + 1}</b></button>`).join('')}
          ${full ? '' : `<button class="add${adding ? ' on' : ''}" data-add="1">＋ ${L.add_planet}</button>`}
        </div>
        ${full ? `<p class="note">${L.full}</p>` : ''}
        ${adding && !full ? `<div class="tiles">${KINDS.map((k) => `
          <div class="tile"><button class="pick" data-new="${k}">${planetBall(k)}<span>${L[`type_${k}`]}</span></button>${speaker(`type_${k}`)}</div>`).join('')}
        </div>` : ''}
      </section>
      ${sel ? `
      <section class="chosen">
        <h2>${L.kind}</h2>
        <div class="tiles">${KINDS.map((k) => `
          <div class="tile${sel.kind === k ? ' on' : ''}"><button class="pick" data-kind="${k}">${planetBall(k, k === 'rocky' ? band({ ...sel, kind: 'rocky' }) : undefined)}<span>${L[`type_${k}`]}</span></button>${speaker(`type_${k}`)}</div>`).join('')}
        </div>
        ${sel.kind === 'rocky' ? `
        <h2>${L.size}</h2>
        <div class="tiles">${SIZES.map((z) => `
          <div class="tile${sel.size === z ? ' on' : ''}"><button class="pick" data-size="${z}"><span class="ball size-${z}" style="background:radial-gradient(circle at 35% 35%, #c8ecff, #3a8bd0 45%, #2f7a3e 75%)"></span><span>${L[`size_${z}`]}</span></button>${speaker(`size_${z}`)}</div>`).join('')}
        </div>` : ''}
        ${results(sel)}
        <button class="remove" data-remove="${sel.id}">${L.remove}</button>
      </section>` : ''}
      ${st.planets.length ? `<button class="clear" data-clear="1">${L.clear}</button>` : ''}`;
  }

  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t) return;
    const d = t.dataset;
    if (d.say) return void say(S[d.say as SayKey]);
    const sel = h.selected();
    if (d.star) h.setStar(d.star as StarKind);
    else if (d.add) {
      adding = !adding;
      render();
    } else if (d.new) {
      adding = false;
      h.addPlanet(d.new as PlanetKind);
    } else if (d.select) h.select(Number(d.select) === sel ? null : Number(d.select));
    else if (d.kind && sel !== null) h.update(sel, { kind: d.kind as PlanetKind });
    else if (d.size && sel !== null) h.update(sel, { size: d.size as PlanetSize });
    else if (d.remove) h.remove(Number(d.remove));
    else if (d.clear) h.clear();
  });

  return { render };
}
