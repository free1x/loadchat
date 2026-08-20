import { ref } from 'vue'

export type ThemePreference = 'system' | 'light' | 'dark'
export type LocalePreference = 'zh-CN' | 'en'

const savedTheme = (localStorage.getItem('loadchat:theme') || 'system') as ThemePreference
const savedLocale = (localStorage.getItem('loadchat:locale') || (navigator.language.startsWith('zh') ? 'zh-CN' : 'en')) as LocalePreference

export const theme = ref<ThemePreference>(['system', 'light', 'dark'].includes(savedTheme) ? savedTheme : 'system')
export const locale = ref<LocalePreference>(savedLocale === 'en' ? 'en' : 'zh-CN')

export function applyTheme(value: ThemePreference = theme.value) {
  theme.value = value
  localStorage.setItem('loadchat:theme', value)
  const resolved = value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value
  document.documentElement.dataset.theme = resolved
}

export function setLocale(value: LocalePreference) {
  locale.value = value
  localStorage.setItem('loadchat:locale', value)
  document.documentElement.lang = value
}

applyTheme()
setLocale(locale.value)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme.value === 'system') applyTheme('system') })
