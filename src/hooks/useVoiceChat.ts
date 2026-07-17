import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser-native voice chat: push-to-talk SpeechRecognition + SpeechSynthesis.
 * No external APIs. Falls back gracefully when unsupported.
 */
type SR = any;

const getRecognitionCtor = (): any => {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
};

export function useVoiceChat(opts: {
  onTranscript: (text: string, isFinal: boolean) => void;
  onFinalSubmit?: () => void;
}) {
  const { onTranscript, onFinalSubmit } = opts;
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState<boolean>(false);
  const recRef = useRef<SR | null>(null);
  const baseTextRef = useRef<string>("");
  const submitRef = useRef(onFinalSubmit);
  const transcriptRef = useRef(onTranscript);
  submitRef.current = onFinalSubmit;
  transcriptRef.current = onTranscript;

  useEffect(() => {
    setSupported(!!getRecognitionCtor() && typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const start = useCallback((currentText: string) => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    // stop any TTS while recording so it doesn't feed back
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    const rec: SR = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    baseTextRef.current = currentText ? currentText.replace(/\s+$/, "") + " " : "";
    let finalBuf = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalBuf += r[0].transcript;
        else interim += r[0].transcript;
      }
      const combined = (baseTextRef.current + finalBuf + interim).trimStart();
      transcriptRef.current(combined, false);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const finalText = (baseTextRef.current + finalBuf).trim();
      if (finalText) {
        transcriptRef.current(finalText, true);
        submitRef.current?.();
      }
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      try { rec.stop(); } catch { /* noop */ }
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!text?.trim()) return;
    // Strip markdown/code fences for cleaner TTS
    const clean = text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[#>*_~]+/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean.slice(0, 1200));
      u.rate = 1;
      u.pitch = 1;
      u.lang = navigator.language || "en-US";
      window.speechSynthesis.speak(u);
    } catch { /* noop */ }
  }, []);

  const cancelSpeak = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
  }, []);

  useEffect(() => () => { stop(); cancelSpeak(); }, [stop, cancelSpeak]);

  return { listening, supported, start, stop, speak, cancelSpeak };
}
