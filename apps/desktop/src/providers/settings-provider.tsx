/**
 * Settings Context Provider
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
  }, [settings.settings.theme]);

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
  const fontScale = getFontScale(settings.theme.fontSize);
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const applyColorMode = () => {
    const isDark = settings.theme.mode === 'dark' || (settings.theme.mode === 'system' && mediaQuery.matches);
    root.classList.toggle('dark', isDark);
    root.style.colorScheme = isDark ? 'dark' : 'light';
  };

  root.style.setProperty('--color-primary', brandColor);
  root.style.setProperty('--color-primary-container', brandColor);
  root.style.setProperty('--color-ring', brandColor);
  root.style.setProperty('--color-accent', colorWithAlpha(brandColor, 0.12));
  root.style.setProperty('--color-accent-foreground', brandColor);
  root.style.setProperty('--color-primary-fixed', colorWithAlpha(brandColor, 0.16));
  root.style.setProperty('--color-on-primary-fixed-variant', brandColor);
  root.style.setProperty('--text-body-md', `${14 * fontScale}px`);
  root.style.setProperty('--text-body-lg', `${16 * fontScale}px`);
  root.style.setProperty('--text-headline-md', `${24 * fontScale}px`);
  root.style.setProperty('--text-headline-lg', `${30 * fontScale}px`);
  root.style.setProperty('--text-label-sm', `${12 * fontScale}px`);
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
