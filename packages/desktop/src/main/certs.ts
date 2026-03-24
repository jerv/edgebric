/**
 * Self-signed certificate generation for HTTPS.
 *
 * Generates a CA + server certificate at setup time so the Edgebric server
 * can run over HTTPS without "Not Secure" warnings. The CA is added to the
 * macOS system keychain so browsers trust it automatically.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface CertPaths {
  caCert: string;
  caKey: string;
  serverCert: string;
  serverKey: string;
}

/** Returns the cert directory and file paths for a given data dir */
export function certPaths(dataDir: string): CertPaths {
  const certsDir = path.join(dataDir, "certs");
  return {
    caCert: path.join(certsDir, "ca.pem"),
    caKey: path.join(certsDir, "ca-key.pem"),
    serverCert: path.join(certsDir, "server.pem"),
    serverKey: path.join(certsDir, "server-key.pem"),
  };
}

/** Check if certs already exist */
export function certsExist(dataDir: string): boolean {
  const p = certPaths(dataDir);
  return fs.existsSync(p.serverCert) && fs.existsSync(p.serverKey);
}

/**
 * Generate a self-signed CA and server certificate using Node's built-in crypto.
 * The CA cert is trusted in the macOS keychain so browsers don't show warnings.
 */
export function generateCerts(dataDir: string, hostname: string, port: number): CertPaths {
  const p = certPaths(dataDir);
  const certsDir = path.dirname(p.caCert);
  fs.mkdirSync(certsDir, { recursive: true });

  // Generate CA key pair
  const caKeys = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Self-sign the CA certificate
  // Using openssl via shell because Node's X509Certificate API can't create certs
  // (only parse them). openssl is always available on macOS.
  const caSubject = "/CN=Edgebric Local CA/O=Edgebric";
  const caKeyPath = p.caKey;
  const caCertPath = p.caCert;

  // Write CA private key
  fs.writeFileSync(caKeyPath, caKeys.privateKey, { mode: 0o600 });

  // Create CA cert (valid 10 years)
  execSync(
    `openssl req -new -x509 -key "${caKeyPath}" -out "${caCertPath}" ` +
    `-days 3650 -subj "${caSubject}" -batch 2>/dev/null`,
  );

  // Generate server key pair
  const serverKeys = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  fs.writeFileSync(p.serverKey, serverKeys.privateKey, { mode: 0o600 });

  // Create a CSR for the server
  const csrPath = path.join(certsDir, "server.csr");
  const extPath = path.join(certsDir, "server.ext");

  // SAN extension file — include all hostnames the server might be accessed by
  const sans = [
    `DNS:${hostname}`,
    "DNS:localhost",
    "DNS:edgebric.local",
    "IP:127.0.0.1",
  ];
  // Deduplicate
  const uniqueSans = [...new Set(sans)];
  const extContent = [
    "authorityKeyIdentifier=keyid,issuer",
    "basicConstraints=CA:FALSE",
    "keyUsage=digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
    `subjectAltName=${uniqueSans.join(",")}`,
  ].join("\n");
  fs.writeFileSync(extPath, extContent);

  // Create CSR
  execSync(
    `openssl req -new -key "${p.serverKey}" -out "${csrPath}" ` +
    `-subj "/CN=${hostname}/O=Edgebric" -batch 2>/dev/null`,
  );

  // Sign the server cert with our CA (valid 2 years)
  execSync(
    `openssl x509 -req -in "${csrPath}" -CA "${caCertPath}" -CAkey "${caKeyPath}" ` +
    `-CAcreateserial -out "${p.serverCert}" -days 730 -extfile "${extPath}" 2>/dev/null`,
  );

  // Clean up temp files
  try {
    fs.unlinkSync(csrPath);
    fs.unlinkSync(extPath);
    fs.unlinkSync(path.join(certsDir, "ca.srl"));
  } catch { /* ignore */ }

  return p;
}

/**
 * Trust the CA certificate in the macOS system keychain.
 * Requires admin password (macOS will show a password prompt).
 */
export function trustCA(dataDir: string): boolean {
  const p = certPaths(dataDir);
  if (!fs.existsSync(p.caCert)) return false;

  try {
    // Add to system keychain and trust for SSL
    execSync(
      `security add-trusted-cert -d -r trustRoot ` +
      `-k /Library/Keychains/System.keychain "${p.caCert}" 2>/dev/null`,
    );
    return true;
  } catch {
    // User may have cancelled the password prompt or doesn't have admin rights.
    // Try user keychain instead (no admin needed, but only works for this user).
    try {
      execSync(
        `security add-trusted-cert -r trustRoot ` +
        `-k ~/Library/Keychains/login.keychain-db "${p.caCert}" 2>/dev/null`,
      );
      return true;
    } catch {
      return false;
    }
  }
}
