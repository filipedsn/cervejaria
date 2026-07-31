import { APP_LOGO, APP_NAME } from '../../lib/app-branding';

export function QuiverTapBrand() {
  return (
    <div className="brewery-brand quiver-tap-brand" aria-label={APP_NAME}>
      <img src={APP_LOGO} alt={APP_NAME} className="brewery-logo" />
    </div>
  );
}
