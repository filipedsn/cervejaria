export type TestStatus = 'passed' | 'failed' | 'skipped' | 'warning';

export interface TestResult {
  id: string;
  category: string;
  name: string;
  requirement?: string;
  status: TestStatus;
  durationMs: number;
  expected?: string;
  actual?: string;
  message?: string;
  details?: string;
}

export interface PerfMetric {
  label: string;
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  errors: number;
  target?: number;
}

export interface TenantFixture {
  index: number;
  slug: string;
  cervejariaId: string;
  donoEmail: string;
  donoToken: string;
  atendenteEmails: string[];
  atendenteTokens: string[];
  eventoId: string;
  trailerId: string;
  tapId: string;
  produtoId: string;
  volumeMl: number;
  preco: number;
  comandaIds: string[];
}

export interface Arena {
  cervejariaId: string;
  eventoId: string;
  trailerId: string;
  tapId: string;
  comandaId: string;
  produtoId: string;
  volumeMl: number;
  preco: number;
  atendenteTokens: string[];
  donoToken: string;
}

export interface MultiTrailerFixture {
  slug: string;
  cervejariaId: string;
  donoEmail: string;
  donoToken: string;
  atendenteTokens: string[];
  produtoId: string;
  volumeMl: number;
  preco: number;
  trailers: Array<{
    id: string;
    nome: string;
    eventoId: string;
    comandaId: string;
    tapId: string;
  }>;
}

export interface QaContext {
  createdAt: string;
  apiBase: string;
  jwtSecret: string;
  loadProfile: {
    breweries: number;
    employeesPerBrewery: number;
    comandasPerBrewery: number;
  };
  tenants: TenantFixture[];
  arena: Arena;
  multiTrailer: MultiTrailerFixture;
}

export interface WorkerItemOps {
  attempted: number;
  success: number;
  failed: number;
  latencies: number[];
}

export interface WorkerResult {
  workerId: string;
  pid: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  itemOps: WorkerItemOps;
  duplicateEvent: { status: number; eventoId: string | null };
}

export interface SuiteArtifact {
  generatedAt: string;
  apiBase: string;
  durationMs: number;
  results: TestResult[];
  perf: PerfMetric[];
}
