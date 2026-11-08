import { useEffect, useRef, useState } from "react";
import { ScanLine, Camera, X, Image as ImageIcon } from "lucide-react";
import { inputCls, Btn } from "./ui";

const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";

// Loads the ZXing barcode decoder once (used where the browser has no built-in BarcodeDetector: Safari, Firefox,
// desktop Chrome on Windows/Linux, in-app webviews).
let zxingPromise;
function loadZXing() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ZXING_URL;
      s.async = true;
      s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error("Scanner library did not load")));
      s.onerror = () => { zxingPromise = null; reject(new Error("Could not load the scanner library — check the internet connection")); };
      document.head.appendChild(s);
    });
  }
  return zxingPromise;
}

const beep = () => {
  try { navigator.vibrate?.(60); } catch { /* not supported */ }
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    const ctx = new C(), o = ctx.createOscillator();
    o.frequency.value = 1100; o.connect(ctx.destination); o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 90);
  } catch { /* no audio */ }
};

// Three ways to scan: the camera (live), a photo of the barcode, or a USB / Bluetooth scanner / typing (code + Enter).
export default function ScanBox({ onScan, placeholder = "Scan with a scanner or type the code, then Enter", autoFocus = false, keepOpen = true }) {
  const [v, setV] = useState("");
  const [cam, setCam] = useState(false);
  const [status, setStatus] = useState("");
  const input = useRef(null);
  const video = useRef(null);
  const file = useRef(null);
  const scanRef = useRef(onScan);
  scanRef.current = onScan;

  useEffect(() => { if (autoFocus && input.current) input.current.focus(); }, [autoFocus]);

  // live camera
  useEffect(() => {
    if (!cam) return;
    let stop = false, stream, timer, reader;
    let last = "", lastAt = 0;
    const found = (code) => {
      if (!code) return;
      const now = Date.now();
      if (code === last && now - lastAt < 1800) return; // same label still in view
      last = code; lastAt = now;
      beep();
      scanRef.current(code);
      if (!keepOpen) setCam(false);
    };
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't open the camera here (it needs https). Use the Photo button instead.");
        setStatus("Starting camera…");
        if ("BarcodeDetector" in window) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
          video.current.srcObject = stream;
          await video.current.play();
          const det = new window.BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "qr_code"] });
          setStatus("Point the camera at the barcode");
          const tick = async () => {
            if (stop) return;
            try { const r = await det.detect(video.current); if (r[0]?.rawValue) found(r[0].rawValue); } catch { /* keep trying */ }
            timer = setTimeout(tick, 250);
          };
          tick();
        } else {
          const Z = await loadZXing();
          const hints = new Map();
          hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.QR_CODE]);
          reader = new Z.BrowserMultiFormatReader(hints, 300);
          setStatus("Point the camera at the barcode");
          await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video.current, (res) => { if (res && !stop) found(res.getText()); });
        }
      } catch (e) {
        setStatus("");
        setCam(false);
        alert(e?.name === "NotAllowedError" ? "Camera permission was blocked. Allow the camera for this site, or use the Photo button." : `Camera scan didn't start: ${e.message || e}`);
      }
    })();
    return () => {
      stop = true; clearTimeout(timer);
      try { reader?.reset(); } catch { /* already stopped */ }
      stream?.getTracks().forEach((t) => t.stop());
      setStatus("");
    };
  }, [cam, keepOpen]);

  const submit = () => {
    const c = v.trim();
    if (!c) { setCam(true); return; } // empty box: the Scan button opens the camera
    setV("");
    scanRef.current(c);
    input.current?.focus();
  };

  // photo of a barcode (works in any mobile browser, even when live video is blocked)
  const onPhoto = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setStatus("Reading photo…");
    const url = URL.createObjectURL(f);
    try {
      let code = "";
      if ("BarcodeDetector" in window) {
        const bmp = await createImageBitmap(f);
        const r = await new window.BarcodeDetector().detect(bmp);
        code = r[0]?.rawValue || "";
      }
      if (!code) {
        const Z = await loadZXing();
        const hints = new Map();
        hints.set(Z.DecodeHintType.TRY_HARDER, true);
        const res = await new Z.BrowserMultiFormatReader(hints).decodeFromImageUrl(url);
        code = res.getText();
      }
      if (code) { beep(); scanRef.current(code); setStatus(""); } else setStatus("No barcode found in that photo — try again closer.");
    } catch { setStatus("No barcode found in that photo — try again closer and keep it sharp."); }
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <ScanLine size={15} className="absolute left-2.5 top-2.5 text-stone-400" />
          <input ref={input} aria-label="Barcode" className={inputCls + " pl-8 font-mono"} placeholder={placeholder} value={v}
            onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} />
        </div>
        <Btn onClick={() => (v.trim() ? submit() : setCam(!cam))}>{cam ? <X size={14} /> : <Camera size={14} />} {v.trim() ? "Add" : cam ? "Stop camera" : "Scan with camera"}</Btn>
        <Btn variant="ghost" onClick={() => file.current?.click()}><ImageIcon size={14} /> Photo</Btn>
        <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Barcode photo" onChange={onPhoto} />
      </div>
      {status && <p className="text-xs text-stone-500 mt-1" role="status">{status}</p>}
      {cam && <video ref={video} muted playsInline className="mt-2 w-full max-w-sm rounded-lg border border-stone-300 bg-black" />}
    </div>
  );
}
