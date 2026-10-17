export const APPROVED_PRODUCTION_APPLICATION_SHA = '734f98e2f20d2bf1433c13a7260cb3667b569895';
export const APPROVED_PRODUCTION_MANIFEST_SHA256 = 'b75719b842ee70f5a9e3484de61c879ce9d23b6be08568360c63ef3150167acc';

export function assertApprovedProductionPackage({ applicationSha, manifestSha256 }) {
  if (applicationSha !== APPROVED_PRODUCTION_APPLICATION_SHA) {
    throw new Error('Retained application SHA differs from the explicitly approved package.');
  }
  if (manifestSha256 !== APPROVED_PRODUCTION_MANIFEST_SHA256) {
    throw new Error('External retained package manifest digest is missing or differs from the approved digest.');
  }
  return true;
}
