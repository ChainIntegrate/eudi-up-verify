// Fake CIE-like PKI for tests, built with the openssl CLI in a temporary directory:
// root CA -> sub CA -> holder certificate (CN "<tax code>/<12 digits>", policy 1.3.76.47.4, AIA OCSP),
// plus a delegated OCSP responder. OCSP responses are produced offline by `openssl ocsp -reqin`.
// No real CIE or personal data involved.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const FAKE_TAX_CODE = "RSSMRA80A01H501U";
export const FAKE_NAME = "MARIO";
export const FAKE_SURNAME = "ROSSI";

const run = (dir, args, input) => execFileSync("openssl", args, { cwd: dir, input, stdio: ["pipe", "pipe", "pipe"] });

export function createFakePki({ holderDays = 30, policy = "1.3.76.47.4", cn } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "fake-cie-pki-"));
  const cnf = `
[v3_root]
basicConstraints = critical,CA:true
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[v3_sub]
basicConstraints = critical,CA:true,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[v3_holder]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = clientAuth
certificatePolicies = ${policy}
authorityKeyIdentifier = keyid
authorityInfoAccess = OCSP;URI:http://ocsp.fake-cie.invalid/
[v3_ocsp]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = OCSPSigning
`;
  writeFileSync(path.join(dir, "ext.cnf"), cnf);
  const key = (name) => run(dir, ["genrsa", "-out", `${name}.key`, "2048"]);
  key("root");
  key("sub");
  key("holder");
  key("ocsp");
  run(dir, ["req", "-x509", "-new", "-key", "root.key", "-out", "root.pem", "-days", "3650",
    "-subj", "/C=IT/O=Fake Ministry/OU=Fake CNSD/CN=Fake national root CA for CIE tests",
    "-extensions", "v3_root", "-config", "ext.cnf"]);
  run(dir, ["req", "-new", "-key", "sub.key", "-out", "sub.csr", "-subj", "/C=IT/O=Fake Ministry/OU=Fake CNSD/CN=Fake issuing sub CA - SUBCA999"]);
  run(dir, ["x509", "-req", "-in", "sub.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial", "-out", "sub.pem",
    "-days", "1825", "-extfile", "ext.cnf", "-extensions", "v3_sub"]);
  const holderCn = cn ?? `${FAKE_TAX_CODE}/123456789012`;
  run(dir, ["req", "-new", "-key", "holder.key", "-out", "holder.csr",
    "-subj", `/CN=${holderCn}/serialNumber=IDCIT-CA00000AA/GN=${FAKE_NAME}/SN=${FAKE_SURNAME}/C=IT`]);
  run(dir, ["x509", "-req", "-in", "holder.csr", "-CA", "sub.pem", "-CAkey", "sub.key", "-CAcreateserial", "-out", "holder.pem",
    "-days", String(holderDays), "-extfile", "ext.cnf", "-extensions", "v3_holder"]);
  run(dir, ["req", "-new", "-key", "ocsp.key", "-out", "ocsp.csr", "-subj", "/C=IT/CN=Fake OCSP responder"]);
  run(dir, ["x509", "-req", "-in", "ocsp.csr", "-CA", "sub.pem", "-CAkey", "sub.key", "-CAcreateserial", "-out", "ocsp.pem",
    "-days", "365", "-extfile", "ext.cnf", "-extensions", "v3_ocsp"]);
  writeFileSync(path.join(dir, "chain.pem"), readFileSync(path.join(dir, "sub.pem")) + readFileSync(path.join(dir, "root.pem")));

  const holderSerial = run(dir, ["x509", "-in", "holder.pem", "-noout", "-serial"]).toString().trim().split("=")[1];
  const expiry = run(dir, ["x509", "-in", "holder.pem", "-noout", "-enddate"]).toString().trim().split("=")[1];
  const ymd = (d) => d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z";
  const setStatus = (status) => {
    const line = status === "revoked"
      ? `R\t${ymd(new Date(expiry))}\t${ymd(new Date())}\t${holderSerial}\tunknown\t/CN=x\n`
      : `V\t${ymd(new Date(expiry))}\t\t${holderSerial}\tunknown\t/CN=x\n`;
    writeFileSync(path.join(dir, "index.txt"), line);
  };
  setStatus("good");

  const file = (name) => readFileSync(path.join(dir, name));
  return {
    dir,
    rootPem: file("root.pem"),
    subPem: file("sub.pem"),
    holderPem: file("holder.pem"),
    holderKeyPem: file("holder.key"),
    rootSha256: run(dir, ["x509", "-in", "root.pem", "-noout", "-fingerprint", "-sha256"]).toString().split("=")[1].trim(),
    setStatus,
    /** CAdES attached (default) or detached signature of `content`, with sub CA and root embedded. */
    signCades(content, { detached = false, embedChain = true } = {}) {
      writeFileSync(path.join(dir, "content.bin"), content);
      const args = ["cms", "-sign", "-binary", "-cades", "-md", "sha256", "-signer", "holder.pem", "-inkey", "holder.key",
        "-in", "content.bin", "-outform", "DER"];
      if (!detached) args.push("-nodetach");
      if (embedChain) args.push("-certfile", "chain.pem");
      return run(dir, args);
    },
    /** OCSP transport: answers with `openssl ocsp` using the current index (good/revoked). */
    ocspTransport: async (_url, requestDer) => {
      writeFileSync(path.join(dir, "req.der"), requestDer);
      run(dir, ["ocsp", "-index", "index.txt", "-rsigner", "ocsp.pem", "-rkey", "ocsp.key", "-CA", "sub.pem",
        "-reqin", "req.der", "-respout", "resp.der", "-ndays", "1"]);
      return file("resp.der");
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
