import { barcodeSvg } from "../lib/barcode";

export default function BarcodeView({ code, height = 40, module = 1.6 }) {
  if (!code) return null;
  return <div className="inline-block" dangerouslySetInnerHTML={{ __html: barcodeSvg(code, { height, module }) }} />;
}
