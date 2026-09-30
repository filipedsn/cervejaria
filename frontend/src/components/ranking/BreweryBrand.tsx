import { useEffect, useState } from 'react';
import { assetUrl } from '../../lib/api';

interface BreweryBrandProps {
  name?: string | null;
  logoUrl?: string | null;
  logoVersion?: string | number | Date | null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function BreweryBrand({ name, logoUrl, logoVersion }: BreweryBrandProps) {
  const [imgError, setImgError] = useState(false);
  const resolvedUrl = assetUrl(logoUrl, logoVersion);
  const displayName = name?.trim() || 'Cervejaria';
  const showImage = resolvedUrl && !imgError;

  useEffect(() => {
    setImgError(false);
  }, [resolvedUrl]);

  return (
    <div className="brewery-brand" aria-label={`Marca ${displayName}`}>
      {showImage ? (
        <img
          src={resolvedUrl}
          alt={`Logo da ${displayName}`}
          className="brewery-logo"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="brewery-logo-fallback" aria-hidden title={displayName}>
          {initials(displayName)}
        </div>
      )}
    </div>
  );
}
