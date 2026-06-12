import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface LocalQrCodeProps {
  value: string;
  label: string;
}

export function LocalQrCode({ value, label }: LocalQrCodeProps) {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 6,
      type: "image/png"
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div className="qr-card" aria-label={label} title={value}>
      {dataUrl ? <img src={dataUrl} alt={label} /> : <span className="qr-placeholder" />}
      <span>{label}</span>
    </div>
  );
}
