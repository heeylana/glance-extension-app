/**
 * Liquid glass for the bubble, ported from liquid-glass-react (Max Rovensky, MIT) to plain DOM:
 * the page behind is blurred and saturated, then bent and split into colour fringes towards the
 * rim by an SVG displacement filter, under two highlight rims that turn with the pointer. The
 * filter chain below is his. Chromium renders the refraction (a filter on a backdrop layer);
 * other engines keep the frosted glass without the bend.
 */
import { DISPLACEMENT_MAP } from "./glass-map";

export interface GlassOptions {
  /** How far the rim bends the backdrop, in px. */
  displacement: number;
  /** Colour fringing at the rim. */
  aberration: number;
  blurPx: number;
  saturatePct: number;
  /** 0 = rigid; above 0 the element leans and stretches towards a hovering pointer. */
  elasticity: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
let seq = 0;

/** The filter from liquid-glass-react's GlassFilter: displaced R/G/B at the rim, the untouched backdrop in the middle. */
function filterMarkup(id: string, o: GlassOptions): string {
  const a = o.aberration;
  const s = -o.displacement;
  return `<defs><filter id="${id}" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
  <feImage x="0" y="0" width="100%" height="100%" result="MAP" href="${DISPLACEMENT_MAP}" preserveAspectRatio="xMidYMid slice"/>
  <feColorMatrix in="MAP" type="matrix" values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0" result="EDGE_INTENSITY"/>
  <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK"><feFuncA type="discrete" tableValues="0 ${a * 0.05} 1"/></feComponentTransfer>
  <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER"/>
  <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${s}" xChannelSelector="R" yChannelSelector="B" result="R_D"/>
  <feColorMatrix in="R_D" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="R"/>
  <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${s - a * 0.05 * o.displacement}" xChannelSelector="R" yChannelSelector="B" result="G_D"/>
  <feColorMatrix in="G_D" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="G"/>
  <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${s - a * 0.1 * o.displacement}" xChannelSelector="R" yChannelSelector="B" result="B_D"/>
  <feColorMatrix in="B_D" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="B"/>
  <feBlend in="G" in2="B" mode="screen" result="GB"/>
  <feBlend in="R" in2="GB" mode="screen" result="RGB"/>
  <feGaussianBlur in="RGB" stdDeviation="${Math.max(0.1, 0.5 - a * 0.1)}" result="RGB_SOFT"/>
  <feComposite in="RGB_SOFT" in2="EDGE_MASK" operator="in" result="RIM"/>
  <feComponentTransfer in="EDGE_MASK" result="INNER"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>
  <feComposite in="CENTER" in2="INNER" operator="in" result="MIDDLE"/>
  <feComposite in="RIM" in2="MIDDLE" operator="over"/>
</filter></defs>`;
}

/**
 * Turn `host` into liquid glass. The layers go in first, so content appended after them sits on top
 * (give it `position: relative; z-index: 1`); content replaced with innerHTML must live in a child.
 */
export function liquidGlass(host: HTMLElement, o: GlassOptions) {
  const id = `glance-glass-${++seq}`;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "glass-filter");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = filterMarkup(id, o);
  const warp = document.createElement("span");
  warp.className = "glass-warp";
  warp.style.filter = `url(#${id})`;
  // The tint sits above the bent backdrop, unbent: on the warp itself the filter would shift it too.
  const tint = document.createElement("span");
  tint.className = "glass-tint";
  const rims = ["glass-rim glass-rim-screen", "glass-rim glass-rim-overlay", "glass-shine"].map((c) => {
    const el = document.createElement("span");
    el.className = c;
    return el;
  });
  host.classList.add("glass");
  host.style.setProperty("--glass-blur", `${o.blurPx}px`);
  host.style.setProperty("--glass-saturate", `${o.saturatePct}%`);
  host.prepend(svg, warp, tint, ...rims);

  // The map is stretched over the element, so the filter's user space has to match its size.
  const fit = () => {
    svg.setAttribute("width", String(host.offsetWidth));
    svg.setAttribute("height", String(host.offsetHeight));
  };
  new ResizeObserver(fit).observe(host);
  fit();

  // The rims turn towards the pointer; an elastic element also leans into it (liquid-glass-react's mouse offset and stretch).
  host.addEventListener("pointermove", (ev) => {
    const r = host.getBoundingClientRect();
    const mx = ((ev.clientX - (r.left + r.width / 2)) / r.width) * 100;
    const my = ((ev.clientY - (r.top + r.height / 2)) / r.height) * 100;
    host.style.setProperty("--glass-mx", mx.toFixed(1));
    host.style.setProperty("--glass-my", my.toFixed(1));
    host.style.setProperty("--glass-ax", Math.abs(mx).toFixed(1));
    if (o.elasticity > 0 && !host.matches(":active")) {
      const k = o.elasticity;
      const nx = Math.abs(mx) / 50;
      const ny = Math.abs(my) / 50;
      host.style.translate = `${(mx / 100) * r.width * k * 0.1}px ${(my / 100) * r.height * k * 0.1}px`;
      host.style.scale = `${Math.max(0.8, 1 + nx * k * 0.3 - ny * k * 0.15)} ${Math.max(0.8, 1 + ny * k * 0.3 - nx * k * 0.15)}`;
    }
  });
  const settle = () => {
    for (const v of ["--glass-mx", "--glass-my", "--glass-ax"]) host.style.removeProperty(v);
    host.style.translate = "";
    host.style.scale = "";
  };
  host.addEventListener("pointerleave", settle);
  host.addEventListener("pointerdown", () => {
    host.style.translate = "";
    host.style.scale = "";
  });
}
