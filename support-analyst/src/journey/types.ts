export type JourneyMode = 'usuario' | 'sessao' | 'correlacao';

export type JourneyCriteria = {
  mode: JourneyMode;
  value: string;
  from: Date;
  to: Date;
  environment: 'dev' | 'prd';
  summary: boolean;
  limit: number;
};

/** One line of the timeline. Every field is optional because older events lack the WI-E fields. */
export type JourneyEvent = {
  source: 'audit' | 'trace';
  timestamp: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  roles?: string;
  tenant?: string;
  sessionId?: string;
  action?: string;
  description?: string;
  route?: string;
  page?: string;
  label?: string;
  searchTerm?: string;
  httpMethod?: string;
  httpRoute?: string;
  status?: number;
  durationMs?: number;
  error?: string;
  vital?: string;
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  userAgent?: string;
  os?: string;
  correlationId?: string;
  traceId?: string;
};
