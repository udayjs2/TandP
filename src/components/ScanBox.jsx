import { useEffect, useRef, useState } from "react";
import { ScanLine, Camera, X } from "lucide-react";
import { inputCls, Btn } from "./ui";

// Works with a USB / Bluetooth barcode scanner (it types the code and presses Enter) and, where the browser
// supports it, the phone camera (BarcodeDetector).
export default function ScanBox({ onScan, placeholder = "Scan or type a barcode, then Enter", autoFocus = true }) {
  const [v, setV] = useState("");
  const [cam, setCam] = useState(false);
  const [camErr, setCamErr] = useState("");
  const ref = useRef(null);
  const video = useRef(null);
  const canCam = typeof window !== "undefined" && "BarcodeDetector" in window && navigator.mediaDevices?.getUserMedia;

  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);

  useEffect(() => {
    if (!cam) return;
    let stop = false, stream, timer;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        const det = new window.BarcodeDetector({ formats: ["code_128", "ean_13", "qr_code"] });
        let last = "", lastAt = 0;
        const tick = async () => {
          if (stop) return;
          try {
            const r = await det.detect(video.current);
            const c = r[0]?.rawValue;
            if (c && (c !== last || Date.now() - lastAt > 1500)) { last = c; lastAt = Date.now(); onScan(c); }
          } catch { /* keep trying */ }
          timer = setTimeout(tick, 350);
        };
        tick();
      } catch (e) { setCamErr("Camera not available: " + (e.message || e)); setCam(false); }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam]);

  const submit = (e) => {
    e?.preventDefault?.();
    const c = v.trim();
    if (!c) return;
    setV("");
    onScan(c);
    ref.current?.focus();
  };
  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanLine size={15} className="absolute left-2.5 top-2.5 text-stone-400" />
          <input ref={ref} aria-label="Barcode" className={inputCls + " pl-8 font-mono"} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(e); }} />
        </div>
        <Btn onClick={submit}>Scan</Btn>
        {canCam && <Btn variant="ghost" onClick={() => setCam(!cam)}>{cam ? <X size={14} /> : <Camera size={14} />} {cam ? "Stop" : "Camera"}</Btn>}
      </div>
      {camErr && <p className="text-xs text-rose-600 mt-1">{camErr}</p>}
      {cam && <video ref={video} muted playsInline className="mt-2 w-full max-w-sm rounded-lg border border-stone-300" />}
    </div>
  );
}
