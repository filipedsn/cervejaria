type IconProps = { className?: string; strokeWidth?: number };

export function IconCalendar({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

export function IconClipboard({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  );
}

export function IconBarChart({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20V10M18 20V4M6 20v-4" />
    </svg>
  );
}

export function IconSettings({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

export function IconBell({ className = 'w-5 h-5', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function IconEye({ className = 'w-5 h-5', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconEyeOff({ className = 'w-5 h-5', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

export function IconShield({ className = 'w-4 h-4', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
    </svg>
  );
}

export function IconUsers({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconTrophy({ className = 'w-5 h-5', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

export function IconQr({ className = 'w-5 h-5', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h2v2h-2zM20 14v2h-2v-2zM14 20h2v2h-2zM20 20h2v2h-2zM17 17h2v2h-2z" />
    </svg>
  );
}

export function IconPlus({ className = 'w-6 h-6', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconTrash({ className = 'w-5 h-5', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function IconPencil({ className = 'w-5 h-5', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function IconStore({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9.5 4.5 4h15L21 9.5" />
      <path d="M3 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 3 0" />
      <path d="M5 12v8h14v-8" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

export function IconCashRegister({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h12M6 14h4" />
      <path d="M8 6V4M16 6V4" />
    </svg>
  );
}

export function IconPackage({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 8.5 12 3 3 8.5 12 14l9-5.5Z" />
      <path d="M3 8.5V16.5L12 22l9-5.5V8.5" />
      <path d="M12 14v8" />
    </svg>
  );
}

export function IconChefHat({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 13c0-2.8 2.2-5 5-5s5 2.2 5 5" />
      <path d="M4 13h16v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-3Z" />
      <path d="M8 19v2M16 19v2" />
    </svg>
  );
}

export function IconListMenu({ className = 'w-6 h-6', strokeWidth = 1.75 }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

/** Navegacao do modulo cervejaria. */
export const NAV_ITEMS = [
  { path: '/eventos', label: 'Eventos', shortLabel: 'Eventos', Icon: IconCalendar, exact: true as const },
  { path: '/comandas', label: 'Comandas', shortLabel: 'Comandas', Icon: IconClipboard },
  { path: '/clientes', label: 'Clientes', shortLabel: 'Clientes', Icon: IconUsers },
  { path: '/dashboard', label: 'Dashboard', shortLabel: 'Dashboard', Icon: IconBarChart, donoOnly: true as const },
  { path: '/configuracoes', label: 'Configurações', shortLabel: 'Config.', Icon: IconSettings, donoOnly: true as const },
];

/** Navegacao do modulo quiosque, adicionada apenas quando o modulo esta ativo. */
export const NAV_ITEMS_QUIOSQUE = [
  { path: '/quiosque/comandas', label: 'Quiosque', shortLabel: 'Quiosque', Icon: IconStore },
];

type QuiosqueNavContext = {
  temCozinha: boolean;
  controlaEstoque: boolean;
};

/** Abas do quiosque na barra inferior — mesmo padrao mobile da cervejaria. */
export const QUIOSQUE_NAV_ITEMS = [
  { path: '/quiosque/comandas', label: 'Comandas', shortLabel: 'Comandas', Icon: IconClipboard },
  {
    path: '/quiosque/cozinha',
    label: 'Cozinha',
    shortLabel: 'Cozinha',
    Icon: IconChefHat,
    somenteCozinha: true as const,
  },
  {
    path: '/quiosque/estoque',
    label: 'Estoque',
    shortLabel: 'Estoque',
    Icon: IconPackage,
    somenteEstoque: true as const,
  },
  {
    path: '/quiosque/dashboard',
    label: 'Dashboard',
    shortLabel: 'Dashboard',
    Icon: IconBarChart,
    donoOnly: true as const,
  },
  { path: '/quiosque/catalogo', label: 'Cardápio', shortLabel: 'Cardápio', Icon: IconListMenu },
  {
    path: '/quiosque/configuracoes',
    label: 'Configurações',
    shortLabel: 'Config.',
    Icon: IconSettings,
    donoOnly: true as const,
  },
];

type QuiosqueNavFilterContext = QuiosqueNavContext & { isDono: boolean };

export function getQuiosqueNavItems(contexto: QuiosqueNavFilterContext) {
  return QUIOSQUE_NAV_ITEMS.filter(
    (item) =>
      (!('donoOnly' in item && item.donoOnly) || contexto.isDono) &&
      (!('somenteCozinha' in item && item.somenteCozinha) || contexto.temCozinha) &&
      (!('somenteEstoque' in item && item.somenteEstoque) || contexto.controlaEstoque),
  );
}

export function isQuiosqueNavActive(path: string, current: string, exact?: boolean) {
  if (path === '/quiosque/comandas') return current.startsWith('/quiosque/comandas');
  if (path === '/quiosque/dashboard') return current === path || current.startsWith('/quiosque/turnos/');
  if (path === '/quiosque/configuracoes') {
    return current.startsWith('/quiosque/configuracoes') || current === '/quiosque/equipe';
  }
  if (exact) return current === path;
  return current.startsWith(path);
}
