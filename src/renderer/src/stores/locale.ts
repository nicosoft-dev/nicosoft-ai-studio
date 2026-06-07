// Locale: 'auto' (follow the OS via navigator.language) + five concrete locales.
// - The preference persists to localStorage (read synchronously so the first paint is correct) AND to
//   settings (SQLite) so the choice survives restarts.
// - 'resolved' is the effective locale used to look up strings.
// - In 'auto' we listen for OS 'languagechange' and update live.
// Mirrors stores/theme.ts.
import { create } from 'zustand'
import en from '@/locales/en.json'
import zhHans from '@/locales/zh-Hans.json'
import zhHant from '@/locales/zh-Hant.json'
import ko from '@/locales/ko.json'
import ja from '@/locales/ja.json'

export type Locale = 'en' | 'zh-Hans' | 'zh-Hant' | 'ko' | 'ja'
export type LocalePref = 'auto' | Locale

type Dict = Record<string, string>

const MESSAGES: Record<Locale, Dict> = {
  en: en as Dict,
  'zh-Hans': zhHans as Dict,
  'zh-Hant': zhHant as Dict,
  ko: ko as Dict,
  ja: ja as Dict
}

export const LOCALE_OPTIONS: { value: LocalePref; labelKey: string }[] = [
  { value: 'auto', labelKey: 'settings.language.auto' },
  { value: 'en', labelKey: 'settings.language.en' },
  { value: 'zh-Hans', labelKey: 'settings.language.zh-Hans' },
  { value: 'zh-Hant', labelKey: 'settings.language.zh-Hant' },
  { value: 'ko', labelKey: 'settings.language.ko' },
  { value: 'ja', labelKey: 'settings.language.ja' }
]

const LS_KEY = 'nicosoft-studio-locale'

const systemResolved = (): Locale => {
  const lang = (navigator.language || 'en').toLowerCase()
  if (lang.startsWith('zh')) {
    return /\b(tw|hk|mo|hant)\b/.test(lang) ? 'zh-Hant' : 'zh-Hans'
  }
  if (lang.startsWith('ko')) return 'ko'
  if (lang.startsWith('ja')) return 'ja'
  return 'en'
}

const resolve = (pref: LocalePref): Locale => (pref === 'auto' ? systemResolved() : pref)

const readPref = (): LocalePref => {
  const v = localStorage.getItem(LS_KEY)
  return v === 'en' || v === 'zh-Hans' || v === 'zh-Hant' || v === 'ko' || v === 'ja' || v === 'auto'
    ? v
    : 'auto'
}

const lookup = (locale: Locale, key: string): string =>
  MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key

const interpolate = (s: string, vars?: Record<string, string | number>): string =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s

interface LocaleState {
  pref: LocalePref
  resolved: Locale
  setPref: (pref: LocalePref) => void
}

export const useLocale = create<LocaleState>((set) => {
  const pref = readPref()
  return {
    pref,
    resolved: resolve(pref),
    setPref: (p) => {
      localStorage.setItem(LS_KEY, p)
      void window.api.settings.set('locale', p)
      set({ pref: p, resolved: resolve(p) })
    }
  }
})

export type TFunction = (key: string, vars?: Record<string, string | number>) => string

// Reactive hook: re-renders the calling component when the locale switches.
export function useT(): TFunction {
  const resolved = useLocale((s) => s.resolved)
  return (key, vars) => interpolate(lookup(resolved, key), vars)
}

// Non-reactive lookup for use outside React.
export function translate(key: string, vars?: Record<string, string | number>): string {
  return interpolate(lookup(useLocale.getState().resolved, key), vars)
}

// Call once at startup: start tracking OS language changes while in 'auto'.
let inited = false
export function initLocale(): void {
  if (inited) return
  inited = true
  window.addEventListener('languagechange', () => {
    if (useLocale.getState().pref !== 'auto') return
    useLocale.setState({ resolved: systemResolved() })
  })
}
