#!/usr/bin/env bash
# One-time migration from the verified public Netlify prototype.
# Run through GitHub Actions. After import, the repository is self-contained.
set -euo pipefail

ORIGIN='https://majestic-marshmallow-4844eb.netlify.app'
mkdir -p site/icons
files=(
  index.html share.html check.html styles.css share-receiver.css
  app.js share-receiver.js manifest.webmanifest sw.js _headers
  favicon.ico icons/icon-192.png icons/icon-512.png
)
for file in "\${files[@]}"; do
  echo "Fetching /$file"
  curl --fail --location --silent --show-error \
    --retry 2 --connect-timeout 15 --max-time 35 \
    "$ORIGIN/$file" --output "site/$file"
  test -s "site/$file"
done

# Refuse to import some other version or a login/placeholder page.
echo "fbfe6b4b16849922a7a2f2f5739f664f56f4fc6c65390f76677b410224cd6738  site/app.js" | sha256sum --check
echo "450cf7ba8f4b89b4892997e36bc60082e0dd7f8dfca8e6de8a57147dab292f76  site/index.html" | sha256sum --check
echo "2ac6bef91762f44b51539846d4b41e7490c0e9c27c7c7732add2cf3ed33302bf  site/manifest.webmanifest" | sha256sum --check

python3 - <<'PY'
from pathlib import Path
for name in ('app.js','share-receiver.js'):
    file = Path('site') / name
    content = file.read_text()
    old = "'/.netlify/functions/metadata'"
    assert content.count(old) == 1, f"Unexpected metadata endpoint in {file}"
    file.write_text(content.replace(old,"'/api/metadata'"))
worker = Path('site/sw.js')
body = worker.read_text()
assert "repository-shell-v1-5" in body, 'Unexpected service worker version'
worker.write_text(body.replace("repository-shell-v1-5", "repository-shell-v1-6-cloudflare"))
PY

echo "Imported and converted verified v1.5 files."
