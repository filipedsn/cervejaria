import QRCode from 'react-qr-code';

type Props = {
  value: string;
  size?: number;
  className?: string;
  title?: string;
};

/** QR instantâneo no browser — sem API externa. */
export function QrCodeImage({ value, size = 90, className = '', title }: Props) {
  return (
    <div
      className={`rounded-lg border border-line bg-white p-1 shrink-0 ${className}`}
      style={{ width: size, height: size }}
      title={title}
    >
      <QRCode
        value={value}
        size={size - 8}
        style={{ height: 'auto', maxWidth: '100%', width: '100%' }}
        viewBox={`0 0 ${size - 8} ${size - 8}`}
      />
    </div>
  );
}
