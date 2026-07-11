import { APP_NAME, APP_LOGO } from '../lib/app-branding';

interface AppLogoProps {
  className?: string;
}

export function AppLogo({ className }: AppLogoProps) {
  return (
    <img
      src={APP_LOGO}
      alt={APP_NAME}
      className={className ?? 'w-full mx-auto object-contain'}
    />
  );
}
