#!/usr/bin/env bash
# Self-test for verify-cie.mjs with a FAKE CA and a FAKE holder certificate built with openssl.
# No real CIE involved. Everything is created in a temporary directory and deleted at the end.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
cd "$T"

FAKE_CF="RSSMRA80A01H501U"   # fake tax code, must never appear in the verifier output
pass=0; fail=0
check() { # name, expected exit code, command...
  local name="$1" expected="$2"; shift 2
  local out code
  out="$("$@" 2>&1)" && code=0 || code=$?
  if grep -q "$FAKE_CF\|MARIO\|ROSSI" <<<"$out"; then
    echo "FAIL  $name: personal data leaked in output"; fail=$((fail+1)); return
  fi
  if [[ "$code" == "$expected" ]]; then echo "PASS  $name (exit $code)"; pass=$((pass+1))
  else echo "FAIL  $name: exit $code, expected $expected"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); fi
}

# --- fake PKI ---
cat > ca.cnf <<EOF
[ca]
default_ca = myca
[myca]
dir = $T
database = $T/index.txt
new_certs_dir = $T
serial = $T/serial
crlnumber = $T/crlnumber
default_md = sha256
default_crl_days = 7
policy = pol
[pol]
[v3_ca]
basicConstraints = critical,CA:true
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[v3_holder]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature,nonRepudiation
extendedKeyUsage = clientAuth
authorityKeyIdentifier = keyid
crlDistributionPoints = URI:http://127.0.0.1:18882/current.crl
authorityInfoAccess = OCSP;URI:http://127.0.0.1:18881,caIssuers;URI:http://127.0.0.1:18882/ca.cer
[v3_ocsp]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = OCSPSigning
EOF
touch index.txt; echo 1000 > serial; echo 1000 > crlnumber
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 30 -subj "/C=IT/O=Fake Test CA/CN=FAKE CA CIE TEST" -extensions v3_ca -config <(cat /etc/ssl/openssl.cnf ca.cnf) 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout holder.key -out holder.csr -subj "/C=IT/SN=ROSSI/GN=MARIO/serialNumber=TINIT-$FAKE_CF/CN=$FAKE_CF/dnQualifier=12345678" 2>/dev/null
openssl x509 -req -in holder.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out holder.pem -days 10 -extfile ca.cnf -extensions v3_holder 2>/dev/null

# --- statement and signatures ---
node "$HERE/make-statement.mjs" --up 0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C --out enunciato.txt 2>/dev/null
openssl cms -sign -binary -nodetach -cades -md sha256 -signer holder.pem -inkey holder.key -in enunciato.txt -outform DER -out attached.p7m
openssl cms -sign -binary -cades -md sha256 -signer holder.pem -inkey holder.key -in enunciato.txt -outform DER -out detached.p7m
base64 -w 64 attached.p7m > attached-b64.p7m
printf 'tampered' >> tampered.txt; cat enunciato.txt >> tampered.txt

# --- CRLs: empty, then with the holder revoked ---
openssl ca -config ca.cnf -keyfile ca.key -cert ca.pem -gencrl -out empty.crl 2>/dev/null
HOLDER_SERIAL="$(openssl x509 -in holder.pem -noout -serial | cut -d= -f2)"
printf 'V\t%s\t\t%s\tunknown\t/CN=x\n' "$(date -u -d '+10 days' +%y%m%d%H%M%SZ)" "$HOLDER_SERIAL" > index-valid.txt
cat > index.txt <<EOF
R	$(date -u -d '+10 days' +%y%m%d%H%M%SZ)	$(date -u +%y%m%d%H%M%SZ)	$(openssl x509 -in holder.pem -noout -serial | cut -d= -f2)	unknown	/CN=x
EOF
openssl ca -config ca.cnf -keyfile ca.key -cert ca.pem -gencrl -out revoked.crl 2>/dev/null

# OCSP responder certificate
openssl req -newkey rsa:2048 -nodes -keyout ocsp.key -out ocsp.csr -subj "/C=IT/CN=FAKE OCSP" 2>/dev/null
openssl x509 -req -in ocsp.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out ocsp.pem -days 10 -extfile ca.cnf -extensions v3_ocsp 2>/dev/null
openssl x509 -in ca.pem -outform DER -out ca.cer

# local servers for the --online path: OCSP on 18881, CRL + AIA issuer on 18882
start_servers() { # $1 = CRL file to publish as current.crl
  cp "$1" current.crl
  openssl ocsp -index index.txt -port 18881 -rsigner ocsp.pem -rkey ocsp.key -CA ca.pem -nmin 5 >/dev/null 2>&1 &
  OCSP_PID=$!
  python3 -m http.server 18882 --bind 127.0.0.1 >/dev/null 2>&1 &
  HTTP_PID=$!
  sleep 1
}
stop_servers() { kill "$OCSP_PID" "$HTTP_PID" 2>/dev/null || true; wait "$OCSP_PID" "$HTTP_PID" 2>/dev/null || true; }

V="node $HERE/verify-cie.mjs"
check "attached + CA + empty CRL"        0 $V --p7m attached.p7m --statement enunciato.txt --ca ca.pem --crl-file empty.crl
check "base64 .p7m"                      0 $V --p7m attached-b64.p7m --statement enunciato.txt --ca ca.pem --crl-file empty.crl
check "detached + CA + empty CRL"        0 $V --p7m detached.p7m --statement enunciato.txt --ca ca.pem --crl-file empty.crl
check "revoked certificate"              1 $V --p7m attached.p7m --statement enunciato.txt --ca ca.pem --crl-file revoked.crl
check "statement mismatch"               1 $V --p7m attached.p7m --statement tampered.txt --ca ca.pem --crl-file empty.crl
check "detached with wrong statement"    1 $V --p7m detached.p7m --statement tampered.txt --ca ca.pem --crl-file empty.crl
check "no CA given (chain unverified)"   1 $V --p7m attached.p7m --statement enunciato.txt --crl-file empty.crl
check "no revocation source (fail closed)" 1 $V --p7m attached.p7m --statement enunciato.txt --ca ca.pem

# --online: OCSP + CRL download + AIA issuer download, holder valid
cp index.txt index-revoked.txt; cp index-valid.txt index.txt
start_servers empty.crl
check "online: OCSP good + CRL download"  0 $V --p7m attached.p7m --statement enunciato.txt --ca ca.pem --online
stop_servers
# --online with the holder revoked in both OCSP and CRL
cp index-revoked.txt index.txt
start_servers revoked.crl
check "online: OCSP + CRL revoked"        1 $V --p7m attached.p7m --statement enunciato.txt --ca ca.pem --online
stop_servers

echo; echo "--- sample output (attached, all checks) ---"
cp index-valid.txt index.txt; start_servers empty.crl
$V --p7m attached.p7m --statement enunciato.txt --ca ca.pem --online || true
stop_servers
echo; echo "Self-test: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
