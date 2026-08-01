/**
 * 発音の読み上げ（実装仕様書 F4）。
 *
 * Web Speech API（window.speechSynthesis）を使う。追加のインフラも課金も要らず、
 * OS 内蔵の音声で動くのでオフラインでも鳴る。
 *
 * この API には実装上の癖が3つあり、それぞれ対処している:
 *
 * 1. getVoices() は初回に空配列を返すことがある。音声リストは非同期に読み込まれ、
 *    完了時に voiceschanged が飛ぶ。
 * 2. iOS Safari はユーザー操作起因の呼び出しでないと発話しない。自動再生は
 *    「一度ユーザーが再生ボタンを押した後」に限る（unlock() で解除する）。
 * 3. 発話中に次を呼ぶとキューに積まれる。連続再生では cancel() してから話す。
 */

export type TtsLang = "en-US" | "en-GB";

export interface TtsSettings {
  lang: TtsLang;
  rate: number;
  /** カードをめくったときに自動で読み上げるか */
  autoPlayOnFlip: boolean;
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  lang: "en-US",
  rate: 1.0,
  autoPlayOnFlip: false,
};

const SETTINGS_KEY = "cortex_dict_tts_settings";

export function loadTtsSettings(): TtsSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_TTS_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      lang: parsed?.lang === "en-GB" ? "en-GB" : "en-US",
      rate: typeof parsed?.rate === "number" ? parsed.rate : 1.0,
      autoPlayOnFlip: Boolean(parsed?.autoPlayOnFlip),
    };
  } catch {
    return DEFAULT_TTS_SETTINGS;
  }
}

export function saveTtsSettings(settings: TtsSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくても再生自体はできるので黙って続行する
  }
}

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return "speechSynthesis" in window ? window.speechSynthesis : null;
}

/** この環境で英語の読み上げができるか。 */
export function isTtsAvailable(): boolean {
  const s = synth();
  if (!s) return false;
  return s.getVoices().some((v) => v.lang?.toLowerCase().startsWith("en"));
}

/**
 * 音声リストが埋まったら通知する。
 * 既に読み込み済みなら即座に1回呼ぶ。返り値は解除関数。
 */
export function onVoicesReady(callback: () => void): () => void {
  const s = synth();
  if (!s) return () => {};

  if (s.getVoices().length > 0) callback();

  const handler = () => callback();
  s.addEventListener("voiceschanged", handler);
  return () => s.removeEventListener("voiceschanged", handler);
}

/**
 * 希望の言語に最も近い音声を選ぶ。
 * 完全一致 → 同じ言語の別地域 → 英語なら何でも、の順に落とす。
 */
function pickVoice(lang: TtsLang): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  const voices = s.getVoices();
  const lower = lang.toLowerCase();

  return (
    voices.find((v) => v.lang?.toLowerCase() === lower) ??
    voices.find((v) => v.lang?.toLowerCase().replace("_", "-") === lower) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ??
    null
  );
}

/**
 * iOS 対策のロック状態。
 * ユーザー操作起因で一度でも speak() が走れば、以後は自動再生してよい。
 */
let unlocked = false;

export function isTtsUnlocked(): boolean {
  return unlocked;
}

export interface SpeakOptions extends Partial<TtsSettings> {
  /**
   * ユーザー操作を伴わない自動再生か。
   * true かつ未ロックのときは何もしない（iOS で無反応になるのを避ける）。
   */
  auto?: boolean;
}

export function speak(text: string, opts: SpeakOptions = {}): void {
  const s = synth();
  if (!s || !text.trim()) return;
  if (opts.auto && !unlocked) return;

  const settings = { ...loadTtsSettings(), ...opts };

  // 前の発話が残っているとキューに積まれて遅れて鳴るため、必ず止める
  s.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = settings.lang;
  utterance.rate = settings.rate;
  const voice = pickVoice(settings.lang);
  if (voice) utterance.voice = voice;

  s.speak(utterance);
  if (!opts.auto) unlocked = true;
}

export function stopSpeaking(): void {
  synth()?.cancel();
}

/** 表示用に IPA をスラッシュで囲む。既に囲まれていれば二重にしない。 */
export function formatPhonetic(phonetic: string | undefined): string | null {
  const trimmed = (phonetic ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : null;
}
