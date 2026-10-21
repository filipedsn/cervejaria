// Apply the Quiver minimum host-metadata policy before EDOT initializes.
// Service, deployment and instance identity are retained; host/process detectors are omitted.
process.env.OTEL_NODE_RESOURCE_DETECTORS = 'env,serviceinstance';
