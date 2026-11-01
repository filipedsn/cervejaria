import { useState, type CSSProperties } from 'react';
import './PortalBackground.css';

/** Shared by the viewport background and the device previews in Appearance. */
export function PortalBackground({ src, preview = false }: { src?: string | null; preview?: boolean }) {
  const [image, setImage] = useState<{ src: string; ratio: number } | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src && failedSrc !== src);
  const ready = Boolean(src && image?.src === src);

  return (
    <div className={`portal-background ${preview ? 'portal-background--preview' : ''}`} aria-hidden="true">
      <div className="portal-background-glow" />
      {showImage ? (
        <div
          className="portal-background-image"
          style={{ '--portal-image-ratio': ready ? image!.ratio : 1, visibility: ready ? 'visible' : 'hidden' } as CSSProperties}
        >
          <img
            key={src!}
            src={src!}
            alt=""
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              setImage({ src: src!, ratio: naturalWidth / naturalHeight });
            }}
            onError={() => setFailedSrc(src!)}
          />
          <div className="portal-background-shade" />
        </div>
      ) : null}
    </div>
  );
}
