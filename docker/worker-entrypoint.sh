#!/bin/sh
set -e

# Hand the container's config to cron jobs (cron runs them with no env).
python - <<'EOF'
import os, shlex
keys = [k for k in os.environ if k.startswith(("UFA_", "ENABLE_")) or k in ("PYTHONPATH", "TZ")]
with open("/etc/ufa.env", "w") as f:
    f.writelines(f"export {k}={shlex.quote(os.environ[k])}\n" for k in sorted(keys))
os.chmod("/etc/ufa.env", 0o600)
EOF

mkdir -p "${UFA_LOG_DIR:-/app/data/logs}"
echo "worker: cron schedule installed; logs in ${UFA_LOG_DIR:-/app/data/logs}"

# Run cron in the foreground as PID 1 so the container lives as long as cron.
exec cron -f
