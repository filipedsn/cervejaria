import { BreweryBrand } from './BreweryBrand';
import { QuiverTapBrand } from './QuiverTapBrand';

export interface RankingHeaderProps {
  kicker: string;
  title: string;
  subtitle?: string;
  badge?: string;
  breweryName?: string | null;
  breweryLogoUrl?: string | null;
  breweryLogoVersion?: string | number | Date | null;
  isLive?: boolean;
}

export function RankingHeader({
  kicker,
  title,
  subtitle,
  badge,
  breweryName,
  breweryLogoUrl,
  breweryLogoVersion,
  isLive = true,
}: RankingHeaderProps) {
  return (
    <header className="tap-champions-header">
      <BreweryBrand name={breweryName} logoUrl={breweryLogoUrl} logoVersion={breweryLogoVersion} />

      <div className="tap-champions-header-center">
        <div className="flex flex-wrap items-center justify-center gap-2 mb-1">
          {isLive && (
            <span className="tap-champions-live-badge">
              <span className="tap-champions-live-dot" aria-hidden />
              AO VIVO
            </span>
          )}
          {badge && (
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[var(--ranking-orange-soft)] text-[var(--ranking-orange)] border border-[var(--ranking-orange-border)]">
              {badge}
            </span>
          )}
        </div>
        <p className="tap-champions-eyebrow">{kicker}</p>
        <h1 className="tap-champions-title truncate">{title}</h1>
        {subtitle && <p className="tap-champions-subtitle truncate">{subtitle}</p>}
      </div>

      <QuiverTapBrand />
    </header>
  );
}
