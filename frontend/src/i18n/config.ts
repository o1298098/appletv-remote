import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import en from "@/locales/en.json"
import zh from "@/locales/zh.json"

export const LOCALE_STORAGE_KEY = "atv-remote-locale"

/** 应用支持的语言；其余系统语言首次进入时回落到英语 */
export const SUPPORTED_LOCALES = ["zh", "en"] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

function systemPreferredLocale(): AppLocale {
  if (typeof navigator === "undefined") return "en"
  const nav = navigator.language.toLowerCase()
  if (nav.startsWith("zh")) return "zh"
  return "en"
}

function detectLng(): AppLocale {
  try {
    const s = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (s === "en" || s === "zh") return s
  } catch {
    /* ignore */
  }
  return systemPreferredLocale()
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: detectLng(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
})

function applyDocumentLang(lng: string) {
  document.documentElement.lang = lng === "zh" ? "zh-CN" : "en"
}

applyDocumentLang(i18n.language)

i18n.on("languageChanged", (lng) => {
  applyDocumentLang(lng)
})

export default i18n
