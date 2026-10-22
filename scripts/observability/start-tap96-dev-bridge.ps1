# Explicitly temporary DEV pipeline. Never restarts/reconfigures shared services.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$config = Join-Path $root 'deploy\observability\tap96-dev-bridge.yml'
$name = 'tap96-dev-bridge'
$volume = 'tap96-dev-bridge-queue'
$containers = @(& docker container ls -a --format '{{.Names}}')
if ($LASTEXITCODE -ne 0) { throw 'Could not inventory Docker containers.' }
if ($containers -contains $name) { throw 'Temporary DEV bridge already exists; inspect it rather than replacing it.' }
$volumes = @(& docker volume ls --format '{{.Name}}')
if ($LASTEXITCODE -ne 0) { throw 'Could not inventory Docker volumes.' }
if ($volumes -contains $volume) {
  $labels = (& docker volume inspect --format '{{json .Labels}}' $volume) | ConvertFrom-Json
  $owner = $labels.'codex.purpose'
  if ($owner -ne 'tap96-dev-temporary') { throw 'Refusing a queue volume without matching temporary ownership.' }
} else {
  & docker volume create --label codex.purpose=tap96-dev-temporary $volume | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create private DEV queue volume.' }
}
# Initialize only this named volume so Collector retains its image's non-root UID.
& docker run --rm --network none --user 0 --entrypoint chown --mount "type=volume,source=$volume,target=/var/lib/otelcol" postgres:16-alpine -R 10001:10001 /var/lib/otelcol
if ($LASTEXITCODE -ne 0) { throw 'Private DEV queue ownership initialization failed.' }
& docker run --rm --network none --mount "type=bind,source=$config,target=/etc/otelcol/config.yml,readonly" --mount "type=volume,source=$volume,target=/var/lib/otelcol" otel/opentelemetry-collector-contrib:0.130.1 validate --config=/etc/otelcol/config.yml
if ($LASTEXITCODE -ne 0) { throw 'DEV bridge configuration rejected.' }
& docker run -d --name $name --label codex.purpose=tap96-dev-temporary --memory 256m --cpus 1 --restart no -p 127.0.0.1:14418:4318 -p 127.0.0.1:18889:8888 --mount "type=bind,source=$config,target=/etc/otelcol/config.yml,readonly" --mount "type=volume,source=$volume,target=/var/lib/otelcol" otel/opentelemetry-collector-contrib:0.130.1 --config=/etc/otelcol/config.yml
if ($LASTEXITCODE -ne 0) { throw 'Temporary DEV bridge did not start.' }
Write-Output 'TAP96_DEV_OTEL_ENDPOINT=http://127.0.0.1:14418'
Write-Output 'TAP96_DEV_OTEL_METRICS=http://127.0.0.1:18889/metrics'
