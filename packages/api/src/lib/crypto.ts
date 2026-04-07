/**
 * Server-side encryption at rest — AES-256-GCM.
 *
 * Protects uploaded documents and sensitive database fields so that
 * a stolen or lost device yields no readable data without the key.
 *
 * Key management:
 *   - Master key auto-generated on first server start.
 *   - Stored at DATA_DIR/.edgebric.key (256-bit, hex-encoded).
 *   - File permissions set to 0600 (owner-only read/write).
 *   - Admins should back up this key separately from DATA_DIR.
 *     Without it, all encrypted data is permanently unrecoverable.
 *
 * Format:
 *   [12-byte IV] + [ciphertext + 16-byte GCM auth tag]
 *   Returned as a single Buffer. IV is random per encryption.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { logger } from "./logger.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const KEY_LENGTH = 32; // 256-bit key
const AUTH_TAG_LENGTH = 16;
/** Version byte prepended to new encryptions for future key rotation. */
const KEY_VERSION = 0x01;

let _masterKey: Buffer | null = null;

function keyFilePath(): string {
  return path.join(config.dataDir, ".edgebric.key");
}

/**
 * Load or generate the master encryption key.
 * Called once during server startup.
 */
export function initEncryptionKey(): void {
  const keyPath = keyFilePath();

  if (fs.existsSync(keyPath)) {
    const hex = fs.readFileSync(keyPath, "utf8").trim();
    _masterKey = Buffer.from(hex, "hex");
    if (_masterKey.length !== KEY_LENGTH) {
      throw new Error(
        `Invalid encryption key length (${_masterKey.length} bytes, expected ${KEY_LENGTH}). ` +
        `Check ${keyPath} or delete it to generate a new key (WARNING: existing encrypted data will be lost).`
      );
    }
    logger.info("Encryption key loaded");
  } else {
    _masterKey = crypto.randomBytes(KEY_LENGTH);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, _masterKey.toString("hex") + "\n", {
      encoding: "utf8",
      mode: 0o600, // owner-only read/write
    });
    logger.info({ keyPath }, "Encryption key generated — back up this file separately");
  }
}

function getMasterKey(): Buffer {
  if (!_masterKey) {
    throw new Error("Encryption not initialized — call initEncryptionKey() first");
  }
  return _masterKey;
}

/**
 * Encrypt a Buffer. Returns [keyVersion (1) + IV (12) + ciphertext + authTag (16)].
 * The key version byte enables future key rotation — the decryptor can select
 * the correct key based on this version.
 */
export function encryptBuffer(plaintext: Buffer): Buffer {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([Buffer.from([KEY_VERSION]), iv, encrypted, authTag]);
}

/**
 * Decrypt a Buffer produced by encryptBuffer.
 * Handles both versioned (v1+) and legacy (unversioned) encrypted data.
 */
export function decryptBuffer(data: Buffer): Buffer {
  const key = getMasterKey();

  let offset = 0;
  // Check for key version byte — versioned data starts with KEY_VERSION
  if (data.length > 0 && data[0] === KEY_VERSION) {
    // Versioned format: [version(1) + IV(12) + ciphertext + authTag(16)]
    offset = 1;
    // Future: select key based on version byte for key rotation
  }

  const payload = data.subarray(offset);
  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted data too short");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(payload.length - AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH, payload.length - AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypt a UTF-8 string. Returns a base64-encoded string
 * suitable for storage in SQLite text columns.
 */
export function encryptText(plaintext: string): string {
  const encrypted = encryptBuffer(Buffer.from(plaintext, "utf8"));
  return encrypted.toString("base64");
}

/**
 * Decrypt a base64-encoded string produced by encryptText.
 */
export function decryptText(encoded: string): string {
  const data = Buffer.from(encoded, "base64");
  return decryptBuffer(data).toString("utf8");
}

/**
 * Encrypt a file in-place: reads the file, encrypts, writes back.
 * The encrypted file has a 4-byte magic header "EBRC" to identify it.
 */
const MAGIC = Buffer.from("EBRC");

export function encryptFile(filePath: string): void {
  const plaintext = fs.readFileSync(filePath);
  const encrypted = encryptBuffer(plaintext);
  fs.writeFileSync(filePath, Buffer.concat([MAGIC, encrypted]));
}

/**
 * Decrypt a file to a Buffer. Does NOT modify the file on disk.
 * Returns the decrypted content for processing.
 */
export function decryptFile(filePath: string): Buffer {
  const raw = fs.readFileSync(filePath);

  // Check if file is encrypted (has EBRC magic header)
  if (raw.length >= MAGIC.length && raw.subarray(0, MAGIC.length).equals(MAGIC)) {
    return decryptBuffer(raw.subarray(MAGIC.length));
  }

  // Not encrypted — return as-is (backward compatibility with pre-encryption uploads)
  return raw;
}

/**
 * Check if a file is encrypted (has the EBRC magic header).
 */
export function isFileEncrypted(filePath: string): boolean {
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(MAGIC.length);
    fs.readSync(fd, header, 0, MAGIC.length, 0);
    return header.equals(MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

// ─── Embedding noise protection ─────────────────────────────────────────────

/**
 * Generate a deterministic noise vector for embedding protection.
 *
 * Uses HMAC-SHA256(master_key, label + counter) in counter mode to produce
 * enough pseudorandom bytes to fill the embedding dimension. Each 4-byte block
 * is converted to a float in [-1, 1]. The result is deterministic: the same
 * key + label always produces the same noise vector.
 *
 * Noise is shared per dataset (not per chunk) so that sqlite-vec ANN search
 * still works: shift the query by the same noise and L2 distances are
 * preserved. An attacker without the key sees random vectors and cannot
 * infer topics or compare embeddings across datasets.
 */
export function generateEmbeddingNoise(label: string, dimensions: number): Float32Array {
  const key = getMasterKey();
  const noise = new Float32Array(dimensions);
  let idx = 0;
  let counter = 0;

  while (idx < dimensions) {
    const hmac = crypto.createHmac("sha256", key);
    hmac.update(`emb-noise:${label}:${counter}`);
    const hash = hmac.digest();
    // Each SHA-256 digest = 32 bytes = 8 float32 values
    for (let i = 0; i + 3 < hash.length && idx < dimensions; i += 4, idx++) {
      const uint32 = hash.readUInt32LE(i);
      noise[idx] = (uint32 / 0xffffffff) * 2 - 1; // Map to [-1, 1]
    }
    counter++;
  }

  return noise;
}

/**
 * Add dataset-level noise to an embedding vector for storage.
 * stored = real + noise(datasetName)
 */
export function addEmbeddingNoise(embedding: number[], datasetName: string): number[] {
  const noise = generateEmbeddingNoise(datasetName, embedding.length);
  return embedding.map((v, i) => v + noise[i]!);
}

/**
 * Shift a query embedding by the dataset's noise so that sqlite-vec ANN
 * returns correct results against noise-shifted stored embeddings.
 *
 * L2(stored, shifted_query) = L2(real + noise, query + noise) = L2(real, query)
 */
export function shiftQueryEmbedding(queryEmbedding: number[], datasetName: string): number[] {
  const noise = generateEmbeddingNoise(datasetName, queryEmbedding.length);
  return queryEmbedding.map((v, i) => v + noise[i]!);
}

/**
 * Decrypt a file to a temporary path for tools that need a real file
 * (e.g., Docling PDF extraction, Mammoth DOCX extraction).
 * Caller is responsible for cleaning up the temp file.
 */
export function decryptFileToTemp(filePath: string): { tempPath: string; needsCleanup: boolean } {
  const raw = fs.readFileSync(filePath);

  // Not encrypted — return original path, no cleanup needed
  if (raw.length < MAGIC.length || !raw.subarray(0, MAGIC.length).equals(MAGIC)) {
    return { tempPath: filePath, needsCleanup: false };
  }

  const decrypted = decryptBuffer(raw.subarray(MAGIC.length));
  const ext = path.extname(filePath);
  const tempPath = path.join(
    path.dirname(filePath),
    `.decrypted-${crypto.randomUUID()}${ext}`
  );
  fs.writeFileSync(tempPath, decrypted, { mode: 0o600 });
  return { tempPath, needsCleanup: true };
}
