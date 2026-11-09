// VS Code の色の計算（src/vs/base/common/color.ts）のうち、色の既定値を求めるのに使う部分を移したもの。
// 既定値の多くは「別の色を何割か明るく」のように決まっているので、同じ値になるよう丸め方まで揃える。
// VS Code は MIT（同じフォルダの LICENSE.txt）

function roundFloat(value: number, decimalPoints: number): number {
  const decimal = 10 ** decimalPoints;
  return Math.round(value * decimal) / decimal;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type RGBA = { r: number; g: number; b: number; a: number };
type HSLA = { h: number; s: number; l: number; a: number };

function rgba(r: number, g: number, b: number, a = 1): RGBA {
  return { r: clamp(r, 0, 255) | 0, g: clamp(g, 0, 255) | 0, b: clamp(b, 0, 255) | 0, a: roundFloat(clamp(a, 0, 1), 3) };
}

function hsla(h: number, s: number, l: number, a: number): HSLA {
  return { h: clamp(h, 0, 360) | 0, s: roundFloat(clamp(s, 0, 1), 3), l: roundFloat(clamp(l, 0, 1), 3), a: roundFloat(clamp(a, 0, 1), 3) };
}

function toHsla({ r: r255, g: g255, b: b255, a }: RGBA): HSLA {
  const [r, g, b] = [r255 / 255, g255 / 255, b255 / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (min + max) / 2;
  const chroma = max - min;
  if (chroma > 0) {
    s = Math.min(l <= 0.5 ? chroma / (2 * l) : chroma / (2 - 2 * l), 1);
    if (max === r) h = (g - b) / chroma + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / chroma + 2;
    else h = (r - g) / chroma + 4;
    h = Math.round(h * 60);
  }
  return hsla(h, s, l, a);
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function toRgba({ h: degrees, s, l, a }: HSLA): RGBA {
  const h = degrees / 360;
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return rgba(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), a);
}

function luminanceOf(component: number): number {
  const c = component / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

export class Color {
  readonly rgba: RGBA;
  private readonly cachedHsla?: HSLA;

  private constructor(value: RGBA, fromHsla?: HSLA) {
    this.rgba = value;
    this.cachedHsla = fromHsla;
  }

  static ofRgba(r: number, g: number, b: number, a = 1): Color {
    return new Color(rgba(r, g, b, a));
  }

  private static ofHsla(value: HSLA): Color {
    return new Color(toRgba(value), value);
  }

  /** #RGB / #RGBA / #RRGGBB / #RRGGBBAA。読めなければ null（VS Code は赤にするが、ここでは無視させる） */
  static parse(hex: string): Color | null {
    const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
    if (!match) return null;
    let digits = match[1];
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
    const [r, g, b, a = 255] = digits.match(/../g)!.map((pair) => parseInt(pair, 16));
    return Color.ofRgba(r, g, b, a / 255);
  }

  get hsla(): HSLA {
    return this.cachedHsla ?? toHsla(this.rgba);
  }

  relativeLuminance(): number {
    const { r, g, b } = this.rgba;
    return roundFloat(0.2126 * luminanceOf(r) + 0.7152 * luminanceOf(g) + 0.0722 * luminanceOf(b), 4);
  }

  isLighterThan(other: Color): boolean {
    return this.relativeLuminance() > other.relativeLuminance();
  }

  isDarkerThan(other: Color): boolean {
    return this.relativeLuminance() < other.relativeLuminance();
  }

  lighten(factor: number): Color {
    const { h, s, l, a } = this.hsla;
    return Color.ofHsla(hsla(h, s, l + l * factor, a));
  }

  darken(factor: number): Color {
    const { h, s, l, a } = this.hsla;
    return Color.ofHsla(hsla(h, s, l - l * factor, a));
  }

  transparent(factor: number): Color {
    const { r, g, b, a } = this.rgba;
    return Color.ofRgba(r, g, b, a * factor);
  }

  withOpacity(opacity: number): Color {
    const { r, g, b } = this.rgba;
    return Color.ofRgba(r, g, b, opacity);
  }

  mix(other: Color, factor = 0.5): Color {
    const t = clamp(factor, 0, 1);
    const [x, y] = [this.rgba, other.rgba];
    return Color.ofRgba(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t, x.a + (y.a - x.a) * t);
  }

  makeOpaque(background: Color): Color {
    if (this.rgba.a === 1 || background.rgba.a !== 1) return this;
    const { r, g, b, a } = this.rgba;
    const bg = background.rgba;
    return Color.ofRgba(bg.r - a * (bg.r - r), bg.g - a * (bg.g - g), bg.b - a * (bg.b - b), 1);
  }

  static lighterThan(of: Color, relative: Color, factor = 0.5): Color {
    if (of.isLighterThan(relative)) return of;
    const [l1, l2] = [of.relativeLuminance(), relative.relativeLuminance()];
    return of.lighten((factor * (l2 - l1)) / l2);
  }

  static darkerThan(of: Color, relative: Color, factor = 0.5): Color {
    if (of.isDarkerThan(relative)) return of;
    const [l1, l2] = [of.relativeLuminance(), relative.relativeLuminance()];
    return of.darken((factor * (l1 - l2)) / l1);
  }

  /** #rrggbb、透明度があれば #rrggbbaa */
  toString(): string {
    const { r, g, b, a } = this.rgba;
    return `#${hex2(r)}${hex2(g)}${hex2(b)}${a === 1 ? "" : hex2(Math.round(a * 255))}`;
  }
}
