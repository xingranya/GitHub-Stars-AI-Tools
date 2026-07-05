import { useState, useEffect } from 'react';
import type { AppSettings } from '@/types-settings';
import { DEFAULT_SETTINGS } from '@/types-settings';

const SETTINGS_KEY = 'stars-knowledge-settings';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function updateSettings(partial: Partial<AppSettings>) {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  async function updateTheme(theme: Partial<AppSettings['theme']>) {
    await updateSettings({ theme: { ...settings.theme, ...theme } });
  }

  async function updateSync(sync: Partial<AppSettings['sync']>) {
    await updateSettings({ sync: { ...settings.sync, ...sync } });
  }

  async function updateAI(ai: Partial<AppSettings['ai']>) {
    await updateSettings({ ai: { ...settings.ai, ...ai } });
  }

  async function updateGeneral(general: Partial<AppSettings['general']>) {
    await updateSettings({ general: { ...settings.general, ...general } });
  }

  async function resetSettings() {
    setSettings(DEFAULT_SETTINGS);
    localStorage.removeItem(SETTINGS_KEY);
  }

  return {
    settings,
    isLoading,
    updateSettings,
    updateTheme,
    updateSync,
    updateAI,
    updateGeneral,
    resetSettings,
  };
}
