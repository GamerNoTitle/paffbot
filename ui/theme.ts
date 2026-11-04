import { argbFromHex, hexFromArgb, themeFromSourceColor } from "@material/material-color-utilities";

/**
 * MD3 动态配色：种子色 → 完整 tonal palette（light / dark）。
 *
 * 种子色来源优先级：
 *   1. 调用方显式传入（?seed=）
 *   2. Telegram 主题的 button_color（跟随用户客户端主题）
 *   3. 默认品牌色
 */
const DEFAULT_SEED = "#4F5BD5";

const SCHEME_KEYS = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "background",
  "onBackground",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "outline",
  "outlineVariant",
  "shadow",
  "scrim",
  "inverseSurface",
  "inverseOnSurface",
  "inversePrimary",
] as const;

/**
 * Scheme 只提供经典 29 色；MD3 的 surface container 阶梯要按规范从 neutral
 * 调色板取固定 tone 值（light: 87/98/100/96/94/92/90，dark: 6/24/4/10/12/17/22）。
 */
function containerTokens(
  neutral: { tone: (tone: number) => number },
  dark: boolean,
): Record<string, string> {
  const tone = (value: number) => hexFromArgb(neutral.tone(value));
  return dark
    ? {
        surfaceDim: tone(6),
        surfaceBright: tone(24),
        surfaceContainerLowest: tone(4),
        surfaceContainerLow: tone(10),
        surfaceContainer: tone(12),
        surfaceContainerHigh: tone(17),
        surfaceContainerHighest: tone(22),
      }
    : {
        surfaceDim: tone(87),
        surfaceBright: tone(98),
        surfaceContainerLowest: tone(100),
        surfaceContainerLow: tone(96),
        surfaceContainer: tone(94),
        surfaceContainerHigh: tone(92),
        surfaceContainerHighest: tone(90),
      };
}

function kebab(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function normalizeSeed(seed: string | null | undefined): string {
  if (!seed) return DEFAULT_SEED;
  const value = seed.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^[0-9a-f]{6}$/i.test(value)) return `#${value}`;
  return DEFAULT_SEED;
}

export interface ApplyThemeOptions {
  seed?: string | null;
  dark?: boolean;
}

export interface AppliedTheme {
  seed: string;
  dark: boolean;
}

export function applyTheme(options: ApplyThemeOptions = {}): AppliedTheme {
  const seed = normalizeSeed(options.seed);
  const dark = options.dark ?? false;
  const theme = themeFromSourceColor(argbFromHex(seed));
  const scheme = (dark ? theme.schemes.dark : theme.schemes.light) as unknown as Record<string, number>;

  const root = document.documentElement;
  for (const key of SCHEME_KEYS) {
    const argb = scheme[key];
    if (typeof argb === "number") {
      root.style.setProperty(`--md-sys-color-${kebab(key)}`, hexFromArgb(argb));
    }
  }
  for (const [key, value] of Object.entries(containerTokens(theme.palettes.neutral, dark))) {
    root.style.setProperty(`--md-sys-color-${kebab(key)}`, value);
  }
  root.style.setProperty("color-scheme", dark ? "dark" : "light");
  root.dataset.theme = dark ? "dark" : "light";

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", hexFromArgb(scheme.surface ?? 0));

  return { seed, dark };
}

/** 从 Telegram 主题里取一个可用的种子色。 */
export function telegramSeed(): string | null {
  const params = (window as unknown as { Telegram?: { WebApp?: { themeParams?: Record<string, string> } } }).Telegram
    ?.WebApp?.themeParams;
  const candidate = params?.button_color ?? params?.secondary_bg_color ?? params?.bg_color ?? null;
  return candidate ? normalizeSeed(candidate) : null;
}

export { DEFAULT_SEED };
