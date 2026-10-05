import path from 'node:path';

const suffix = (...parts) => `${path.sep}${parts.join(path.sep)}`;
export const SYNTHETIC_EXPECTED_MODULES = [
  suffix('backend', 'src', 'app.ts'),
  suffix('backend', 'src', 'lib', 'comanda-service.ts'),
  suffix('backend', 'src', 'routes', 'operacao', 'comandas.ts'),
  suffix('backend', 'src', 'routes', 'public.ts'),
  suffix('backend', 'scripts', 'pdv-unico-commerce-migrator.isolated.test.mjs'),
];

const representativeEntry = suffix('backend', 'scripts', 'pdv-unico-representative-qa.isolated.test.mjs');

function missingSuffixes(observed, required) {
  return required.filter((suffix) => !observed.some((modulePath) => modulePath.endsWith(suffix)));
}

export function auditSnapshotModules({ observedModules, syntheticResult, representativeResult, representativeAttempted }) {
  const syntheticRequired = syntheticResult === 'PASS' ? SYNTHETIC_EXPECTED_MODULES : [];
  const syntheticMissing = missingSuffixes(observedModules, syntheticRequired);
  if (syntheticMissing.length) throw new Error(`Import audit did not observe certified synthetic modules: ${syntheticMissing.join(', ')}`);

  const representativeWasObserved = representativeAttempted && observedModules.some((modulePath) => modulePath.endsWith(representativeEntry));
  if (representativeResult === 'PASS' && !representativeWasObserved) {
    throw new Error(`Import audit did not observe certified representative module ${representativeEntry}.`);
  }
  return {
    syntheticModules: { result: syntheticResult === 'PASS' ? 'PASS' : 'NOT_ASSERTED', expectedCount: syntheticRequired.length, observedCount: observedModules.filter((modulePath) => syntheticRequired.some((suffix) => modulePath.endsWith(suffix))).length },
    representativeModules: {
      result: !representativeAttempted ? 'NOT_RUN' : representativeWasObserved ? 'ENTRYPOINT_OBSERVED' : 'NOT_REACHED',
      expectedCount: representativeWasObserved ? 1 : 0,
      observedCount: representativeWasObserved ? 1 : 0,
    },
  };
}
