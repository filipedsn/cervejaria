import type { ReactNode } from 'react';
import { BackLink } from './BackLink';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  backTo?: string;
  backLabel?: string;
  action?: ReactNode;
  titleExtra?: ReactNode;
}

export function PageHeader({ title, subtitle, eyebrow, backTo, backLabel, action, titleExtra }: PageHeaderProps) {
  return (
    <div className="space-y-3">
      {backTo && <BackLink to={backTo} label={backLabel} />}
      <div className="space-y-3 sm:space-y-0 sm:flex sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="page-eyebrow mb-1">{eyebrow}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title">{title}</h1>
            {titleExtra}
          </div>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {action && (
          <div className="shrink-0 w-full sm:w-auto [&_.touch-btn]:w-full sm:[&_.touch-btn]:w-auto">{action}</div>
        )}
      </div>
    </div>
  );
}
