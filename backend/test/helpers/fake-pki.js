// Fake CIE-like PKI for tests, built with the openssl CLI in a temporary directory:
// root CA -> sub CA -> holder certificate (CN "<tax code>/<12 digits>", policy 1.3.76.47.4, AIA OCSP),
// plus a delegated OCSP responder. OCSP responses are produced offline by `openssl ocsp -reqin`.
// No real CIE or personal data involved.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const FAKE_TAX_CODE = "RSSMRA80A01H501X";
export const FAKE_NAME = "MARIO";
export const FAKE_SURNAME = "ROSSI";

const run = (dir, args, input) => execFileSync("openssl", args, { cwd: dir, input, stdio: ["pipe", "pipe", "pipe"] });

export function createFakePki({ holderDays = 400, policy = "1.3.76.47.4", cn, ocspUrl = "http://ocsp.fake-cie.invalid/" } = {}) {
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
authorityInfoAccess = OCSP;URI:${ocspUrl}
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

  const ymd = (d) => d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z";
  const serialOf = (pem) => run(dir, ["x509", "-in", pem, "-noout", "-serial"]).toString().trim().split("=")[1];
  const expiryOf = (pem) => run(dir, ["x509", "-in", pem, "-noout", "-enddate"]).toString().trim().split("=")[1];
  // OCSP index: one line per holder certificate
  const index = new Map();
  const writeIndex = () =>
    writeFileSync(
      path.join(dir, "index.txt"),
      [...index.entries()]
        .map(([n, h]) => (h.status === "revoked"
          ? `R\t${ymd(new Date(h.expiry))}\t${ymd(new Date())}\t${h.serial}\tunknown\t/CN=${n}\n`
          : `V\t${ymd(new Date(h.expiry))}\t\t${h.serial}\tunknown\t/CN=${n}\n`))
        .join(""),
    );
  const register = (name) => {
    const serial = serialOf(`${name}.pem`);
    index.set(name, { serial, expiry: expiryOf(`${name}.pem`), status: "good" });
    writeIndex();
  };
  register("holder");
  const setStatus = (status, name = "holder") => {
    index.get(name).status = status;
    writeIndex();
  };
  let holders = 0;
  /** Issues another holder certificate (another "person") under the same sub CA. */
  const issueHolder = (taxCode, { days = holderDays } = {}) => {
    const name = `holder${++holders}`;
    run(dir, ["genrsa", "-out", `${name}.key`, "2048"]);
    run(dir, ["req", "-new", "-key", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=${taxCode}/123456789012/C=IT`]);
    run(dir, ["x509", "-req", "-in", `${name}.csr`, "-CA", "sub.pem", "-CAkey", "sub.key", "-CAcreateserial", "-out", `${name}.pem`,
      "-days", String(days), "-extfile", "ext.cnf", "-extensions", "v3_holder"]);
    register(name);
    return name;
  };

  const file = (name) => readFileSync(path.join(dir, name));
  return {
    dir,
    rootPem: file("root.pem"),
    subPem: file("sub.pem"),
    holderPem: file("holder.pem"),
    holderKeyPem: file("holder.key"),
    rootSha256: run(dir, ["x509", "-in", "root.pem", "-noout", "-fingerprint", "-sha256"]).toString().split("=")[1].trim(),
    setStatus,
    issueHolder,
    holderFiles: (name = "holder") => ({ pem: file(`${name}.pem`), keyPem: file(`${name}.key`) }),
    /** CAdES attached (default) or detached signature of `content`, with sub CA and root embedded. */
    signCades(content, { detached = false, embedChain = true, holder = "holder", md = "sha256" } = {}) {
      writeFileSync(path.join(dir, "content.bin"), content);
      const args = ["cms", "-sign", "-binary", "-cades", "-md", md, "-signer", `${holder}.pem`, "-inkey", `${holder}.key`,
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
    /** Real HTTP OCSP responder (openssl ocsp -port) for end-to-end tests. Returns a stop function. */
    serveOcsp(port) {
      const child = spawn("openssl", ["ocsp", "-index", "index.txt", "-port", String(port), "-rsigner", "ocsp.pem",
        "-rkey", "ocsp.key", "-CA", "sub.pem", "-nmin", "5"], { cwd: dir, stdio: "ignore" });
      return () => child.kill("SIGTERM");
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
