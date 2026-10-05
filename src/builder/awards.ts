import { BUILDER } from '../content';
import { say } from '../speech';
import { BUILDER_AWARDS, type AwardId } from '../texts';
import { life, pairStars, temperatureC, unstableWithin, yearDays } from './physics';
import type { State } from './main';

// «Мої відкриття»: discoveries the child makes in their own system — each a real fact about planets.
// Earned once, kept in this browser apart from the system (starting over keeps them). A new one slides
// in at the top with a little confetti; its speaker tells the fact (voice on a tap only, as everywhere
// here).

export const AWARD_ICON: Record<AwardId, string> = {
  first_planet: '🌑', life: '🌍', red_life: '🔴', two_suns: '🌞', rings: '🪐', three_moons: '🌙', gas_giant: '🟠',
  venus: '🌋', frozen: '❄️', short_year: '⚡', long_year: '⏳', painted: '🎨', unstable: '🌀', full: '✨',
};
const STORE = 'planets.builder.awards.v1';
const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/** What this system shows right now. */
function earnedNow(st: State): Set<AwardId> {
  const out = new Set<AwardId>();
  const pair = pairStars(st.star, st.star2);
  if (st.planets.length) out.add('first_planet');
  if (st.planets.length >= 6) out.add('full');
  if (st.star2 && st.planets.length) out.add('two_suns');
  for (const p of st.planets) {
    const c = temperatureC(pair, p.au, p);
    const days = yearDays(pair, p.au);
    const shaky = !!st.star2 && p.au < unstableWithin(pair);
    if (life(p, c, shaky) === 'yes') {
      out.add('life');
      if (st.star === 'red' && !st.star2) out.add('red_life');
    }
    if (p.rings) out.add('rings');
    if (p.moons >= 3) out.add('three_moons');
    if (p.kind === 'gas') out.add('gas_giant');
    if (p.kind === 'rocky' && p.air === 'thick' && c > 200) out.add('venus');
    if (c < -150) out.add('frozen');
    if (days < 7) out.add('short_year');
    if (days > 100 * 365.25) out.add('long_year');
    if (p.kind === 'rocky' && p.paint) out.add('painted');
    if (shaky) out.add('unstable');
  }
  return out;
}

export function createAwards() {
  let have = new Set<AwardId>();
  try {
    have = new Set((JSON.parse(localStorage.getItem(STORE) ?? '[]') as AwardId[]).filter((a) => BUILDER_AWARDS.includes(a)));
  } catch {
    /* none yet, or storage unavailable */
  }

  const toast = document.createElement('div');
  toast.id = 'award-toast';
  document.body.appendChild(toast);
  const queue: AwardId[] = [];
  let showing = false;
  let hideTimer = 0;

  function showNext() {
    const id = queue.shift();
    if (!id) {
      showing = false;
      return;
    }
    showing = true;
    const a = BUILDER.awards[id];
    toast.innerHTML = `
      <div class="confetti">${Array.from({ length: 14 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
      <span class="award-icon">${AWARD_ICON[id]}</span>
      <div><small>${BUILDER.labels.award_new}</small><b>${a.title}</b></div>
      <button class="say" data-award-say="${id}" aria-label="Послухати">${SPEAKER}</button>`;
    toast.classList.remove('show');
    void toast.offsetWidth; // restart the slide-in
    toast.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      toast.classList.remove('show');
      window.setTimeout(showNext, 450);
    }, 5000);
  }
  toast.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-award-say]') as HTMLElement | null;
    if (b) say(BUILDER.awards[b.dataset.awardSay as AwardId].say);
  });

  return {
    /** the discoveries made so far */
    get have() {
      return have;
    },
    /** Look at the system as it is now; announce what is new. Returns true if anything was. */
    check(st: State) {
      const fresh = [...earnedNow(st)].filter((a) => !have.has(a));
      if (!fresh.length) return false;
      for (const a of fresh) have.add(a);
      try {
        localStorage.setItem(STORE, JSON.stringify([...have]));
      } catch {
        /* kept for this visit only */
      }
      queue.push(...fresh);
      if (!showing) showNext();
      return true;
    },
  };
}
