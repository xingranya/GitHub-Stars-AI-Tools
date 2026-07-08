/**
 * 全局设置上下文 Provider
 * 全局设置状态共享
 */

import { createContext, useContext, ReactNode, useEffect } from 'react';
import { useSettings } from '@/hooks/use-settings';
import type { AppSettings } from '@/types-settings';

type SettingsContextValue = ReturnType<typeof useSettings>;

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();

  useEffect(() => {
    const cleanup = applyThemeSettings(settings.settings);
    return cleanup;
  }, [
    settings.settings.theme.brandColor,
    settings.settings.theme.colorPreset,
    settings.settings.theme.fontSize,
    settings.settings.theme.mode,
  ]);

  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}

export function useAppSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useAppSettings 必须在 <SettingsProvider> 内部使用');
  }
  return context;
}

function applyThemeSettings(settings: AppSettings) {
  const root = document.documentElement;
  const brandColor = settings.theme.brandColor || '#3b82f6';
  const primaryForeground = getReadableForegroundColor(brandColor);
  const fontScale = getFontScale(settings.theme.fontSize);
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const applyColorMode = () => {
    const isDark = settings.theme.mode === 'dark' || (settings.theme.mode === 'system' && mediaQuery.matches);
    root.classList.toggle('dark', isDark);
    root.style.colorScheme = isDark ? 'dark' : 'light';
  };

  root.style.setProperty('--color-primary', brandColor);
  root.style.setProperty('--color-on-primary', primaryForeground);
  root.style.setProperty('--color-primary-foreground', primaryForeground);
  root.style.setProperty('--color-primary-container', brandColor);
  root.style.setProperty('--color-on-primary-container', primaryForeground);
  root.style.setProperty('--color-ring', brandColor);
  root.style.setProperty('--color-accent', colorWithAlpha(brandColor, 0.12));
  root.style.setProperty('--color-accent-foreground', brandColor);
  root.style.setProperty('--color-primary-fixed', colorWithAlpha(brandColor, 0.16));
  root.style.setProperty('--color-on-primary-fixed-variant', brandColor);
  root.style.fontSize = `${16 * fontScale}px`;
  root.style.setProperty('--text-body-md', `${14 * fontScale}px`);
  root.style.setProperty('--text-body-md--line-height', `${20 * fontScale}px`);
  root.style.setProperty('--text-body-lg', `${16 * fontScale}px`);
  root.style.setProperty('--text-body-lg--line-height', `${24 * fontScale}px`);
  root.style.setProperty('--text-headline-md', `${24 * fontScale}px`);
  root.style.setProperty('--text-headline-md--line-height', `${32 * fontScale}px`);
  root.style.setProperty('--text-headline-lg', `${30 * fontScale}px`);
  root.style.setProperty('--text-headline-lg--line-height', `${38 * fontScale}px`);
  root.style.setProperty('--text-label-sm', `${12 * fontScale}px`);
  root.style.setProperty('--text-label-sm--line-height', `${16 * fontScale}px`);
  applyColorMode();

  if (settings.theme.mode !== 'system') {
    return undefined;
  }

  mediaQuery.addEventListener('change', applyColorMode);
  return () => mediaQuery.removeEventListener('change', applyColorMode);
}

function getFontScale(fontSize: AppSettings['theme']['fontSize']) {
  switch (fontSize) {
    case 'small':
      return 0.92;
    case 'large':
      return 1.08;
    case 'medium':
    default:
      return 1;
  }
}

function colorWithAlpha(color: string, alpha: number) {
  const normalizedAlpha = Math.max(0, Math.min(alpha, 1));
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const red = parseInt(color.slice(1, 3), 16);
    const green = parseInt(color.slice(3, 5), 16);
    const blue = parseInt(color.slice(5, 7), 16);
    return `rgb(${red} ${green} ${blue} / ${normalizedAlpha})`;
  }

  return color;
}

function getReadableForegroundColor(backgroundColor: string) {
  const rgb = hexToRgb(backgroundColor);
  if (!rgb) {
    return '#ffffff';
  }

  const lightForeground = '#ffffff';
  const darkForeground = '#111827';
  const lightContrast = getContrastRatio(rgb, hexToRgb(lightForeground)!);
  const darkContrast = getContrastRatio(rgb, hexToRgb(darkForeground)!);
  return lightContrast >= darkContrast ? lightForeground : darkForeground;
}

function getContrastRatio(firstColor: RgbColor, secondColor: RgbColor) {
  const firstLuminance = getRelativeLuminance(firstColor);
  const secondLuminance = getRelativeLuminance(secondColor);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function getRelativeLuminance(color: RgbColor) {
  const [red, green, blue] = color.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function hexToRgb(color: string): RgbColor | null {
  const normalizedColor = color.trim();
  const shortMatch = normalizedColor.match(/^#([0-9a-f]{3})$/i);
  if (shortMatch) {
    return shortMatch[1].split('').map((channel) => parseInt(`${channel}${channel}`, 16)) as RgbColor;
  }

  const longMatch = normalizedColor.match(/^#([0-9a-f]{6})$/i);
  if (!longMatch) {
    return null;
  }

  return [
    parseInt(longMatch[1].slice(0, 2), 16),
    parseInt(longMatch[1].slice(2, 4), 16),
    parseInt(longMatch[1].slice(4, 6), 16),
  ];
}

type RgbColor = [number, number, number];
