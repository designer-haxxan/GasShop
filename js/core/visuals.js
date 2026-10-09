// Animated SVG graphics for gas cylinders and the bulk gas tank. Pure functions returning markup.
// Fill colours come from the gradients defined once in index.html (#grad-flame, #grad-water, #grad-steel).
import { esc, fmtQty } from './utils.js';

// Cylinder with a liquid level. full / total = share of cylinders that are full (0..1).
// tone: 'flame' (orange, domestic) | 'water' (blue, commercial) | 'steel' (grey, empty / idle).
export function cylinderSvg(pct, { tone = 'flame', label = '' } = {}) {
  const p = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
  const h = Math.round(92 * p);
  return `<svg class="cyl tone-${tone}" viewBox="0 0 64 128" role="img" aria-label="${esc(label)}">
    <rect class="cyl-body" x="6" y="14" width="52" height="110" rx="20"/>
    <rect class="cyl-fill" x="10" y="${118 - h}" width="44" height="${h}" rx="14" style="--h:${h}"/>
    <rect class="cyl-shine" x="13" y="22" width="5" height="88" rx="2.5"/>
    <rect class="cyl-band" x="6" y="46" width="52" height="5"/>
    <rect class="cyl-band" x="6" y="92" width="52" height="5"/>
    <rect class="cyl-valve" x="22" y="4" width="20" height="13" rx="4"/>
    <rect class="cyl-valve-tip" x="28" y="0" width="8" height="6" rx="2"/>
  </svg>`;
}

// Bulk gas tank with a wave that rises to the current level. kg / capacity = fill share.
export function tankSvg(kg, capacity) {
  const pct = capacity > 0 ? Math.max(0, Math.min(1, kg / capacity)) : 0;
  const y = Math.round(106 - 96 * pct); // top of the liquid, inside the shell
  return `<svg class="tank" viewBox="0 0 220 124" role="img" aria-label="Gas tank ${fmtQty(kg)} kg">
    <defs><clipPath id="tank-clip"><rect x="12" y="10" width="196" height="104" rx="30"/></clipPath></defs>
    <rect class="tank-shell" x="12" y="10" width="196" height="104" rx="30"/>
    <g clip-path="url(#tank-clip)">
      <g class="tank-liquid" style="transform:translateY(${y}px)">
        <g class="wave-track">
          <path class="wave wave-back" d="M0 10 Q 27.5 0 55 10 T 110 10 T 165 10 T 220 10 T 275 10 T 330 10 T 385 10 T 440 10 V 124 H 0 Z"/>
          <path class="wave" d="M0 14 Q 27.5 4 55 14 T 110 14 T 165 14 T 220 14 T 275 14 T 330 14 T 385 14 T 440 14 V 124 H 0 Z"/>
        </g>
      </g>
    </g>
    <rect class="tank-gloss" x="26" y="20" width="10" height="84" rx="5"/>
    <text class="tank-pct" x="110" y="72" text-anchor="middle">${Math.round(pct * 100)}%</text>
  </svg>`;
}

// Circular progress ring. Starts empty and is animated by ringAnimate() after it is in the DOM.
export function ringSvg(pct, { size = 84, stroke = 9, tone = 'flame' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
  return `<svg class="ring tone-${tone}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${Math.round(p * 100)}%">
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle class="ring-bar" data-target="${(c * (1 - p)).toFixed(2)}" data-c="${c.toFixed(2)}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

// Starts ring and tank animations inside root once it is in the DOM.
export function animateVisuals(root) {
  if (!root) return;
  // Two frames: the browser must paint the start state before the CSS transition runs.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('.ring-bar').forEach((el) => { el.style.strokeDashoffset = el.dataset.target; });
    root.querySelectorAll('.cyl-fill').forEach((el) => el.classList.add('is-in'));
    root.querySelectorAll('.tank-liquid').forEach((el) => el.classList.add('is-in'));
  }));
}
