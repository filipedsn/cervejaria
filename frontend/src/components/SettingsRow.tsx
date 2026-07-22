import type { ReactNode } from 'react';

interface SettingsRowProps {
  title: string;
  description?: string;
  control: ReactNode;
  stacked?: boolean;
}

export function SettingsRow({ title, description, control, stacked = false }: SettingsRowProps) {
  if (stacked) {
    return (
      <div className="settings-row flex-col items-stretch gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">{title}</p>
          {description && <p className="text-xs text-ink-muted mt-0.5">{description}</p>}
        </div>
        {control}
      </div>
    );
  }

  return (
    <div className="settings-row">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {description && <p className="text-xs text-ink-muted mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

interface ThemeSegmentedControlProps {
  value: 'light' | 'dark';
  onChange: (theme: 'light' | 'dark') => void;
}

export function ThemeSegmentedControl({ value, onChange }: ThemeSegmentedControlProps) {
  return (
    <div className="segmented-control w-full" role="group" aria-label="Aparência">
      <button
        type="button"
        className={`segmented-control-btn ${
          value === 'light' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
        }`}
        aria-pressed={value === 'light'}
        onClick={() => onChange('light')}
      >
        Claro
      </button>
      <button
        type="button"
        className={`segmented-control-btn ${
          value === 'dark' ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
        }`}
        aria-pressed={value === 'dark'}
        onClick={() => onChange('dark')}
      >
        Escuro
      </button>
    </div>
  );
}
