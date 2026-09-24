// Node 24 on this Windows host can fail os.userInfo() with uv_os_get_passwd
// ENOMEM before tsx starts. tsx only uses process.geteuid() here to name its
// temporary cache directory; provide a process-local fallback for test/dev
// launchers without changing the Windows account or its privileges.
if (typeof process.geteuid !== 'function') {
  process.geteuid = () => process.pid;
}
