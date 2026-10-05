import { BUILDER } from '../content';
import { say } from '../speech';
import { BUILDER_AWARDS, type AwardId } from '../texts';
import { AWARD_ICON } from './awards';
import type { EventKind } from './events';
import { defaults, type PlanetState, type State } from './main';
import {
  gravity, life, MAX_PLANETS, MAX_R, MIN_R, pairStars, sizeBand, skyOf, STARS, starColor, tempBand, temperatureC,
  unstableWithin, yearDays, type Air, type PlanetKind, type StarKind,
} from './physics';

// The screens of «Моя система». The system itself fills the screen; along the bottom, a map of it like
// the app's dock: the star (or two), each planet, ＋ for a new one. Tapping one flies the view to it and
// opens its own window — the star's, a new planet's, a planet's (with sliders for its distance and
// size), the discoveries'. Closing the window (×) leaves just the view. A tap on an option chooses it
// silently; the speaker beside it explains it aloud.

const L = BUILDER.labels;
const S = BUILDER.say;
type SayKey = keyof typeof S;

export type Win = { kind: 'star' } | { kind: 'new' } | { kind: 'planet'; id: number } | { kind: 'awards' };

interface Handlers {
  state: State;
  awards: { have: Set<AwardId> };
  /** is another planet's orbit too near this one's? */
  neighbour: (id: number) => boolean;
  /** what happened last (its bar with «undo»), or null */
  event: () => EventKind | null;
  /** something is happening right now (buttons wait) */
  busy: () => boolean;
  collide: (id: number) => void;
  pullMoon: (id: number) => void;
  undo: () => void;
  setStar: (k: StarKind) => void;
  /** the second star, or null for one star */
  setStar2: (k: StarKind | null) => void;
  /** add a planet; returns its id (or null if the system is full) */
  addPlanet: (k: PlanetKind) => number | null;
  /** change a planet and settle (save, redraw everything) */
  update: (id: number, change: Partial<PlanetState>) => void;
  /** change a planet while a slider moves (the scene follows; settled by update on release) */
  live: (id: number, change: Partial<PlanetState>) => void;
  remove: (id: number) => void;
  /** open the painting studio for this (rocky) planet */
  paint: (id: number) => void;
  clear: () => void;
  /** fly the view to the star, a planet, or the whole system (null) */
  focus: (to: 'star' | number | null) => void;
  /** the planet highlighted in the scene (its window is open), or null */
  select: (id: number | null) => void;
  /** where this planet may be (AU) and where the zones are, for its distance slider */
  orbitRange: (id: number) => { min: number; max: number; zoneIn: number; zoneOut: number; unstable: number };
}

const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const speaker = (key: SayKey) => `<button class="say" data-say="${key}" aria-label="Послухати">${SPEAKER}</button>`;
const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const SYSTEM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="6.5" ry="6.5" opacity=".7"/><ellipse cx="12" cy="12" rx="10" ry="10" opacity=".45"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>';

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
const AIRS: Air[] = ['none', 'thin', 'earth', 'thick'];

function starBall(k: StarKind, size = 0) {
  const [r, g, b] = starColor(STARS[k].temp).map((x) => Math.round(x * 255));
  const px = size || { red: 26, sun: 34, white: 40, blue: 48 }[k];
  return `<span class="ball star-ball" style="width:${px}px;height:${px}px;background:radial-gradient(circle at 40% 38%, #fff 0%, rgb(${r},${g},${b}) 45%, rgba(${r >> 1},${g >> 1},${b >> 1},1) 100%);box-shadow:0 0 16px rgba(${r},${g},${b},0.7)"></span>`;
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
  const dock = document.getElementById('dock')!;
  const sheet = document.getElementById('sheet')!;
  const bar = document.getElementById('eventbar')!;
  document.querySelector('.back')!.textContent = `← ${L.back}`;
  document.querySelector('.title')!.textContent = L.title;
  const btnOverview = document.getElementById('btn-overview')!;
  const btnAwards = document.getElementById('btn-awards')!;
  btnOverview.innerHTML = SYSTEM;
  btnOverview.title = L.overview;
  btnOverview.setAttribute('aria-label', L.overview);
  let win: Win | null = null;
  /** the discovery whose card is open in the discoveries' window */
  let shownAward: AwardId | null = null;

  const pair = () => pairStars(h.state.star, h.state.star2);
  const planet = (id: number) => h.state.planets.find((p) => p.id === id) ?? null;
  const numberOf = (id: number) => h.state.planets.findIndex((p) => p.id === id) + 1;
  const band = (p: PlanetState) => (p.kind === 'rocky' ? tempBand(temperatureC(pair(), p.au, p)) : undefined);

  function open(w: Win | null) {
    win = w;
    h.select(w?.kind === 'planet' ? w.id : null);
    render();
  }

  // ---------- what follows from a planet ----------
  function results(p: PlanetState) {
    const star = pair();
    const days = yearDays(star, p.au);
    const year = days < 1000 ? `${Math.round(days)} ${plural(Math.round(days), L.days)}` : `${num(days / 365.25)} ${plural(Math.round(days / 365.25), L.years)}`;
    const yearSay: SayKey = days < 0.7 * 365.25 ? 'year_short' : days > 1.4 * 365.25 ? 'year_long' : 'year_earth';
    const c = temperatureC(star, p.au, p);
    const temp = `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(Math.round(c / 5) * 5)} °C`;
    const tempSay = `temp_${tempBand(c)}` as SayKey;
    let weight: string, weightSay: SayKey;
    if (p.kind !== 'rocky') {
      weight = L.no_ground;
      weightSay = 'weight_gas';
    } else {
      const g = gravity(p.r);
      weight = g < 0.9 ? L.lighter.replace('{n}', num(1 / g)) : g > 1.1 ? L.heavier.replace('{n}', num(g)) : L.same_weight;
      weightSay = g < 0.9 ? 'weight_light' : g > 1.1 ? 'weight_heavy' : 'weight_earth';
    }
    const v = life(p, c, !!h.state.star2 && p.au < unstableWithin(star));
    const molten = (p.molten ?? 0) > 0.25;
    const sky = skyOf(p);
    return `
      <dl class="results">
        ${molten
          ? `<div class="life molten"><dt>${L.life}</dt><dd>${L.molten}</dd>${speaker('molten')}</div>`
          : `<div class="life ${v}"><dt>${L.life}</dt><dd>${L[`life_${v}`]}</dd>${speaker(`life_${v}` as SayKey)}</div>`}
        <div><dt>${L.year}</dt><dd>${year}</dd>${speaker(yearSay)}</div>
        <div><dt>${L.temperature}</dt><dd>${temp}</dd>${speaker(tempSay)}</div>
        <div><dt>${L.weight}</dt><dd>${weight}</dd>${speaker(weightSay)}</div>
        ${h.state.star2 ? `<div><dt>${L.suns}</dt><dd>${L.suns_two}</dd>${speaker('suns_two')}</div>` : ''}
        ${sky ? `<div><dt>${L.sky}</dt><dd><span class="sky-dot sky-${sky}"></span>${L[`sky_${sky}`]}</dd>${speaker(`sky_${sky}`)}</div>` : ''}
        ${h.neighbour(p.id) ? `<div class="warn"><dt>${L.neighbours}</dt><dd>${L.too_close}</dd>${speaker('too_close')}</div>` : ''}
      </dl>
      ${h.neighbour(p.id) ? `<button class="happen" data-collide="${p.id}"${h.busy() ? ' disabled' : ''}>${L.what_happens}</button>` : ''}`;
  }

  /** a row of options (silent on tap) with one speaker: it explains the option chosen now */
  function choice(label: string, name: string, options: string[][], on: string, sayKey: SayKey) {
    return `
      <div class="choice">
        <h2>${label}</h2>
        <div class="segments">${options.map(([v, t]) => `<button class="seg${v === on ? ' on' : ''}" data-${name}="${v}">${t}</button>`).join('')}</div>
        ${speaker(sayKey)}
      </div>`;
  }

  // ---------- sliders: distance (with the zones drawn on it) and size ----------
  const SLIDER = 1000;
  function orbitToSlider(id: number, au: number) {
    const r = h.orbitRange(id);
    return Math.round(((Math.log(au) - Math.log(r.min)) / (Math.log(r.max) - Math.log(r.min))) * SLIDER);
  }
  function sliderToOrbit(id: number, v: number) {
    const r = h.orbitRange(id);
    return Math.exp(Math.log(r.min) + (v / SLIDER) * (Math.log(r.max) - Math.log(r.min)));
  }
  function orbitSlider(p: PlanetState) {
    const r = h.orbitRange(p.id);
    const pct = (au: number) => Math.min(100, Math.max(0, (orbitToSlider(p.id, au) / SLIDER) * 100)).toFixed(1);
    const zi = pct(r.zoneIn), zo = pct(r.zoneOut), un = h.state.star2 ? pct(r.unstable) : '0';
    // the track: red where no orbit lasts, green where life could be
    const track = `linear-gradient(90deg, rgba(255,106,90,0.55) 0%, rgba(255,106,90,0.55) ${un}%, rgba(255,255,255,0.12) ${un}%, rgba(255,255,255,0.12) ${zi}%, rgba(78,224,138,0.7) ${zi}%, rgba(78,224,138,0.7) ${zo}%, rgba(255,255,255,0.12) ${zo}%)`;
    return `
      <div class="choice slider">
        <h2>${L.orbit}</h2>
        <input type="range" min="0" max="${SLIDER}" step="1" value="${orbitToSlider(p.id, p.au)}" data-range="orbit" style="background:${track}" aria-label="${L.orbit}" />
        <div class="ends"><span>☀︎ ${L.nearer}</span><span>${L.farther} ❄︎</span></div>
        ${speaker('orbit')}
      </div>`;
  }
  function sizeSlider(p: PlanetState) {
    return `
      <div class="choice slider">
        <h2>${L.size}</h2>
        <input type="range" min="${MIN_R * 100}" max="${MAX_R * 100}" step="1" value="${Math.round(p.r * 100)}" data-range="size" aria-label="${L.size}" />
        <div class="ends"><span>${L.smaller}</span><span>${L.size_medium}</span><span>${L.bigger}</span></div>
        ${speaker(`size_${sizeBand(p.r)}` as SayKey)}
      </div>`;
  }

  /** what the planet is made of: its layers as rings, surface first, with their names */
  function inside(p: PlanetState) {
    const layers: [string, string, number][] =
      p.kind === 'gas' ? [['layer_air', '#e7c48f', 1], ['layer_metal', '#9aa6c4', 0.7], ['layer_rock', '#7d6a55', 0.22]]
      : p.kind === 'ice' ? [['layer_air', '#8fd0ff', 1], ['layer_ice', '#4f8fd8', 0.78], ['layer_rock', '#7d6a55', 0.3]]
      : [...(p.water ? ([['layer_ocean', '#3a7fd0', 1]] as [string, string, number][]) : []), ['layer_crust', '#9a6a3c', p.water ? 0.94 : 1], ['layer_mantle', '#d9622b', 0.88], ['layer_iron', '#f0c060', 0.42]];
    const sayKey: SayKey = p.kind === 'gas' ? 'inside_gas' : p.kind === 'ice' ? 'inside_ice' : 'inside_rocky';
    return `
      <div class="choice inside">
        <h2>${L.inside}</h2>
        <div class="layers">
          <svg viewBox="-50 -50 100 100" aria-hidden="true">${layers.map(([, c, f]) => `<circle r="${48 * f}" fill="${c}"/>`).join('')}</svg>
          <ul>${layers.map(([k, c]) => `<li><i style="background:${c}"></i>${L[k as keyof typeof L]}</li>`).join('')}</ul>
        </div>
        ${speaker(sayKey)}
      </div>`;
  }

  // ---------- the windows ----------
  function starWindow() {
    const st = h.state;
    const tiles = (attr: string, on: StarKind | null | undefined) => `
      <div class="tiles">${STAR_KINDS.map((k) => `
        <div class="tile${on === k ? ' on' : ''}">
          <button class="pick" data-${attr}="${k}">${starBall(k)}<span>${L[`star_${k}`]}</span></button>${speaker(`star_${k}`)}
        </div>`).join('')}
      </div>`;
    return {
      title: st.star2 ? L.stars_chip : L.star,
      body: `
        ${tiles('star', st.star)}
        ${choice(L.stars_count, 'count', [['1', L.one_star], ['2', L.two_stars]], st.star2 ? '2' : '1', 'two_stars')}
        ${st.star2 ? `<h2>${L.second_star}</h2>${tiles('star2', st.star2)}` : ''}
        <p class="legend"><span class="zone-dot"></span>${L.zone}${speaker('zone')}</p>
        ${st.star2 ? `<p class="legend"><span class="zone-dot bad"></span>${L.unstable_zone}${speaker('unstable_zone')}</p>` : ''}
        ${st.planets.length ? `<button class="clear" data-clear="1">${L.clear}</button>` : ''}`,
    };
  }
  function newWindow() {
    const full = h.state.planets.length >= MAX_PLANETS;
    return {
      title: L.win_new,
      body: full
        ? `<p class="note">${L.full}</p>`
        : `<p class="hint">${L.kind}${speaker('hint')}</p>
           <div class="tiles">${KINDS.map((k) => `
             <div class="tile"><button class="pick" data-new="${k}">${planetBall(k)}<span>${L[`type_${k}`]}</span></button>${speaker(`type_${k}`)}</div>`).join('')}
           </div>`,
    };
  }
  function planetWindow(p: PlanetState) {
    return {
      title: L.planet_n.replace('{n}', String(numberOf(p.id))),
      body: `
        <div class="results-box">${results(p)}</div>
        ${orbitSlider(p)}
        ${p.kind === 'rocky' ? sizeSlider(p) : ''}
        ${p.kind === 'rocky' ? `<button class="paint" data-paint="${p.id}">🎨 ${L.paint}</button>` : ''}
        <h2>${L.kind}</h2>
        <div class="tiles">${KINDS.map((k) => `
          <div class="tile${p.kind === k ? ' on' : ''}"><button class="pick" data-kind="${k}">${planetBall(k, k === 'rocky' ? band({ ...p, kind: 'rocky' }) : undefined)}<span>${L[`type_${k}`]}</span></button>${speaker(`type_${k}`)}</div>`).join('')}
        </div>
        ${p.kind === 'rocky' ? `
        ${choice(L.air, 'air', AIRS.map((a) => [a, L[`air_${a}`]]), p.air, `air_${p.air}` as SayKey)}
        ${choice(L.water, 'water', [['yes', L.water_yes], ['no', L.water_no]], p.water ? 'yes' : 'no', p.water ? 'water_yes' : 'water_no')}` : ''}
        ${choice(L.rings, 'rings', [['yes', L.rings_yes], ['no', L.rings_no]], p.rings ? 'yes' : 'no', p.rings ? 'rings_yes' : 'rings_no')}
        ${choice(L.moons, 'moons', ['0', '1', '2', '3'].map((n) => [n, n]), String(p.moons), p.moons ? 'moons_some' : 'moons_none')}
        ${p.moons ? `<div class="pull"><button class="happen small" data-pull="${p.id}"${h.busy() ? ' disabled' : ''}>${L.moon_closer}</button>${speaker('moon_closer')}</div>` : ''}
        ${inside(p)}
        <button class="remove" data-remove="${p.id}">${L.remove}</button>`,
    };
  }
  function awardsWindow() {
    const have = h.awards.have;
    const a = shownAward && have.has(shownAward) ? shownAward : null;
    return {
      title: `${L.awards} · ${have.size}/${BUILDER_AWARDS.length}`,
      body: `
        <div class="badges">${BUILDER_AWARDS.map((id) =>
          have.has(id)
            ? `<button class="badge${id === a ? ' on' : ''}" data-award="${id}" title="${BUILDER.awards[id].title}">${AWARD_ICON[id]}</button>`
            : `<span class="badge locked">?</span>`).join('')}
        </div>
        ${a ? `<p class="award-detail"><span>${AWARD_ICON[a]}</span><b>${BUILDER.awards[a].title}</b><button class="say" data-award-say="${a}" aria-label="Послухати">${SPEAKER}</button></p>` : ''}`,
    };
  }

  // ---------- drawing it all ----------
  function renderDock() {
    const st = h.state;
    const selId = win?.kind === 'planet' ? win.id : null;
    const balls = [st.star, ...(st.star2 ? [st.star2] : [])].map((k) => starBall(k, st.star2 ? 26 : 34)).join('');
    dock.innerHTML = `
      <button class="chip star${win?.kind === 'star' ? ' selected' : ''}" data-open="star"><span class="chip-ball stars">${balls}</span><span class="chip-name">${st.star2 ? L.stars_chip : L.star}</span></button>
      <span class="dock-sep"></span>
      ${st.planets.map((p, i) => `<button class="chip${p.id === selId ? ' selected' : ''}" data-open="${p.id}"><span class="chip-ball">${planetBall(p.kind, band(p))}</span><span class="chip-name">${i + 1}</span></button>`).join('')}
      ${st.planets.length < MAX_PLANETS ? `<button class="chip add${win?.kind === 'new' ? ' selected' : ''}" data-open="new"><span class="chip-ball plus">＋</span><span class="chip-name">${L.add_planet}</span></button>` : ''}`;
    btnAwards.innerHTML = `🏆 <b>${h.awards.have.size}</b>`;
    btnAwards.classList.toggle('active', win?.kind === 'awards');
    btnAwards.title = L.awards;
  }
  function renderBar() {
    const ev = h.event();
    const empty = !h.state.planets.length && !win;
    bar.hidden = !ev && !empty;
    bar.innerHTML = ev
      ? `<b>${L[`ev_${ev}` as keyof typeof L]}</b>${speaker(`ev_${ev}` as SayKey)}<button class="undo" data-undo="1">↩︎ ${L.undo}</button>`
      : empty ? `<span>${L.start_hint}</span>${speaker('hint')}` : '';
  }
  function renderSheet() {
    const p = win?.kind === 'planet' ? planet(win.id) : null;
    if (win?.kind === 'planet' && !p) win = null; // the planet is gone (removed, merged)
    const w = !win ? null : win.kind === 'star' ? starWindow() : win.kind === 'new' ? newWindow() : win.kind === 'awards' ? awardsWindow() : planetWindow(p!);
    sheet.hidden = !w;
    document.body.classList.toggle('has-sheet', !!w);
    if (!w) return;
    const scroll = sheet.querySelector('.sheet-body')?.scrollTop ?? 0;
    sheet.innerHTML = `
      <header><h1>${w.title}</h1><button class="close" data-close="1" aria-label="${L.close}">${CLOSE}</button></header>
      <div class="sheet-body">${w.body}</div>`;
    sheet.querySelector('.sheet-body')!.scrollTop = scroll;
  }
  function render() {
    renderDock();
    renderBar();
    renderSheet();
  }

  /** while a slider moves: only the results and the dock (the slider itself must stay as it is) */
  function refreshLive() {
    if (win?.kind !== 'planet') return;
    const p = planet(win.id);
    const box = sheet.querySelector('.results-box');
    if (p && box) box.innerHTML = results(p);
    renderDock();
  }

  // ---------- taps ----------
  function onTap(e: Event) {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t) return;
    const d = t.dataset;
    if (d.say) return void say(S[d.say as SayKey]);
    if (d.awardSay) return void say(BUILDER.awards[d.awardSay as AwardId].say);
    if (d.close) return open(null);
    if (d.undo) return h.undo();
    if (d.open) {
      if (d.open === 'star') {
        h.focus('star');
        return open({ kind: 'star' });
      }
      if (d.open === 'new') return open({ kind: 'new' });
      const id = Number(d.open);
      h.focus(id);
      return open({ kind: 'planet', id });
    }
    if (d.award) {
      shownAward = shownAward === d.award ? null : (d.award as AwardId);
      return render();
    }
    const id = win?.kind === 'planet' ? win.id : null;
    if (d.star) h.setStar(d.star as StarKind);
    else if (d.star2) h.setStar2(d.star2 as StarKind);
    else if (d.count) h.setStar2(d.count === '2' ? h.state.star2 ?? 'red' : null); // a red dwarf: the most common companion
    else if (d.new) {
      const nid = h.addPlanet(d.new as PlanetKind);
      if (nid !== null) {
        h.focus(nid);
        open({ kind: 'planet', id: nid });
      }
    } else if (d.kind && id !== null) {
      // a new kind brings its usual air and water (a giant has no surface water, a rocky planet starts like Earth)
      const { air, water } = defaults(d.kind as PlanetKind);
      h.update(id, { kind: d.kind as PlanetKind, air, water });
    } else if (d.air && id !== null) h.update(id, { air: d.air as Air });
    else if (d.water && id !== null) h.update(id, { water: d.water === 'yes' });
    else if (d.rings && id !== null) h.update(id, { rings: d.rings === 'yes' });
    else if (d.moons && id !== null) h.update(id, { moons: Number(d.moons) });
    else if (d.paint) h.paint(Number(d.paint));
    else if (d.collide) h.collide(Number(d.collide));
    else if (d.pull) h.pullMoon(Number(d.pull));
    else if (d.remove) {
      h.remove(Number(d.remove));
      open(null);
      h.focus(null);
    } else if (d.clear) {
      h.clear();
      open(null);
      h.focus(null);
    }
  }
  for (const el of [dock, sheet, bar]) el.addEventListener('click', onTap);
  btnOverview.addEventListener('click', () => {
    h.focus(null);
    open(null);
  });
  btnAwards.addEventListener('click', () => open(win?.kind === 'awards' ? null : { kind: 'awards' }));

  // sliders: the scene follows while dragging, everything settles on release
  sheet.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (win?.kind !== 'planet' || !t.dataset.range) return;
    const v = Number(t.value);
    h.live(win.id, t.dataset.range === 'orbit' ? { au: sliderToOrbit(win.id, v) } : { r: v / 100 });
    refreshLive();
  });
  sheet.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (win?.kind !== 'planet' || !t.dataset.range) return;
    const v = Number(t.value);
    h.update(win.id, t.dataset.range === 'orbit' ? { au: sliderToOrbit(win.id, v) } : { r: v / 100 });
  });

  return {
    render,
    refreshLive,
    /** open a planet's window (it was tapped in the scene) */
    openPlanet(id: number) {
      h.focus(id);
      open({ kind: 'planet', id });
    },
    openStar() {
      h.focus('star');
      open({ kind: 'star' });
    },
    get window() {
      return win;
    },
  };
}
