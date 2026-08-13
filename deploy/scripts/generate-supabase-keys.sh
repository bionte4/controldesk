#!/usr/bin/env sh
# Generate ANON_KEY + SERVICE_ROLE_KEY (JWT tokens) dari JWT_SECRET.
#
# Usage:
#   JWT_SECRET=<your-jwt-secret> ./deploy/scripts/generate-supabase-keys.sh
#
# Atau kalau JWT_SECRET sudah di .env.production:
#   set -a; . .env.production; set +a; ./deploy/scripts/generate-supabase-keys.sh
#
# Output: printed ke stdout, salin ke `.env.production`.

set -eu

if [ -z "${JWT_SECRET:-}" ]; then
  echo "ERROR: JWT_SECRET tidak diset di env." >&2
  echo "Jalankan dulu:" >&2
  echo "  export JWT_SECRET=\$(grep '^JWT_SECRET=' .env.production | cut -d= -f2-)" >&2
  echo "  ./deploy/scripts/generate-supabase-keys.sh" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node tidak ditemukan. Install Node 20+." >&2
  exit 1
fi

# Issue 10 tahun ke depan (standar Supabase self-host).
IAT=$(date +%s)
EXP=$((IAT + 10 * 365 * 24 * 60 * 60))

# Generate lewat inline Node.js CommonJS — HS256, tanpa dependency tambahan.
JWT_SECRET="$JWT_SECRET" IAT="$IAT" EXP="$EXP" node -e "
const crypto = require('node:crypto');

const secret = process.env.JWT_SECRET;
const iat = Number(process.env.IAT);
const exp = Number(process.env.EXP);

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sign(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const data = encodedHeader + '.' + encodedPayload;
  const signature = crypto.createHmac('sha256', secret).update(data).digest();
  return data + '.' + base64url(signature);
}

const anonToken = sign({ role: 'anon', iss: 'supabase', iat, exp });
const serviceToken = sign({ role: 'service_role', iss: 'supabase', iat, exp });

process.stdout.write('\n# ---------------------------------------------------------------------------\n');
process.stdout.write('# Salin baris di bawah ke .env.production.\n');
process.stdout.write('# Token valid 10 tahun; rotate JWT_SECRET jika token bocor.\n');
process.stdout.write('# ---------------------------------------------------------------------------\n\n');
process.stdout.write('ANON_KEY=' + anonToken + '\n');
process.stdout.write('SERVICE_ROLE_KEY=' + serviceToken + '\n');
"
