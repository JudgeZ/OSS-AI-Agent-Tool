import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import type { ScryptOptions } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import nacl from "tweetnacl";

type ScryptKdf = {
  algorithm: "scrypt";
  N: number;
  r: number;
  p: number;
};

type PersistedPayload = {
  version: number;
  kdf: ScryptKdf;
  salt: string;
  nonce: string;
  cipher: string;
};

type LegacyPayload = {
  salt: string;
  nonce: string;
  cipher: string;
};

type ScryptParameters = {
  N: number;
  r: number;
  p: number;
};

const KEY_LENGTH = 32;
const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1 } as const;
const SALT_LENGTH = 16;
const scrypt = promisify(nodeScrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

type Sodium = {
  ready: Promise<void>;
  crypto_pwhash: (
    outputLength: number,
    password: string | Uint8Array,
    salt: Uint8Array,
    opslimit: number,
    memlimit: number,
    algorithm: number
  ) => Uint8Array;
  crypto_pwhash_OPSLIMIT_MODERATE: number;
  crypto_pwhash_MEMLIMIT_MODERATE: number;
  crypto_pwhash_ALG_ARGON2ID13: number;
};

let sodiumInstance: Sodium | undefined;

async function getSodium(): Promise<Sodium> {
  if (!sodiumInstance) {
    const module = await import("libsodium-wrappers-sumo");
    const sodium = module.default as Sodium;
    await sodium.ready;
    sodiumInstance = sodium;
  }
  return sodiumInstance;
}

function encode(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function decode(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, "base64"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPersistedPayload(candidate: unknown): candidate is PersistedPayload {
  if (!isRecord(candidate)) {
    return false;
  }
  const { version, kdf, salt, nonce, cipher } = candidate;
  if (typeof version !== "number") {
    return false;
  }
  if (!isRecord(kdf)) {
    return false;
  }
  if (kdf.algorithm !== "scrypt") {
    return false;
  }
  if (typeof kdf.N !== "number" || typeof kdf.r !== "number" || typeof kdf.p !== "number") {
    return false;
  }
  if (typeof salt !== "string" || typeof nonce !== "string" || typeof cipher !== "string") {
    return false;
  }
  return true;
}

function isLegacyPayload(candidate: unknown): candidate is LegacyPayload {
  if (!isRecord(candidate)) {
    return false;
  }
  const { salt, nonce, cipher } = candidate;
  return typeof salt === "string" && typeof nonce === "string" && typeof cipher === "string";
}

export class LocalKeystore {
  private salt?: Uint8Array;

  constructor(private readonly filePath: string, private readonly passphrase: string) {
    if (!passphrase) {
      throw new Error("Local keystore requires a non-empty passphrase");
    }
  }

  async read(): Promise<Record<string, string>> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (isPersistedPayload(parsed)) {
        return await this.decryptPersistedPayload(parsed);
      }
      if (isLegacyPayload(parsed)) {
        return await this.decryptLegacyPayload(parsed);
      }
      throw new Error("Unsupported keystore payload format");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        this.salt = undefined;
        return {};
      }
      throw error;
    }
  }

  async write(values: Record<string, string>): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const salt = this.salt ?? randomBytes(SALT_LENGTH);
    this.salt = salt;
    const key = await this.deriveScryptKey(salt);
    const nonce = randomBytes(nacl.secretbox.nonceLength);
    const plaintext = Buffer.from(JSON.stringify(values), "utf-8");
    const cipher = nacl.secretbox(new Uint8Array(plaintext), nonce, key);
    const payload: PersistedPayload = {
      version: 1,
      kdf: { algorithm: "scrypt", N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p },
      salt: encode(salt),
      nonce: encode(nonce),
      cipher: encode(cipher)
    };
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }

  private async decryptPersistedPayload(payload: PersistedPayload): Promise<Record<string, string>> {
    const { salt: encodedSalt, nonce, cipher, kdf } = payload;
    const salt = decode(encodedSalt);
    this.salt = salt;
    const key = await this.deriveScryptKey(salt, { N: kdf.N, r: kdf.r, p: kdf.p });
    const decrypted = this.tryDecryptWithKey({ salt: encodedSalt, nonce, cipher }, key);
    if (!decrypted) {
      throw new Error("Failed to decrypt keystore");
    }
    return decrypted;
  }

  private async decryptLegacyPayload(payload: LegacyPayload): Promise<Record<string, string>> {
    const salt = decode(payload.salt);
    this.salt = salt;
    const scryptKey = await this.deriveScryptKey(salt);
    const scryptResult = this.tryDecryptWithKey(payload, scryptKey);
    if (scryptResult) {
      return scryptResult;
    }
    const argonKey = await this.deriveLegacyArgon2Key(salt);
    const argonResult = this.tryDecryptWithKey(payload, argonKey);
    if (!argonResult) {
      throw new Error("Failed to decrypt keystore");
    }
    return argonResult;
  }

  private tryDecryptWithKey(payload: LegacyPayload, key: Uint8Array): Record<string, string> | null {
    const nonce = decode(payload.nonce);
    const cipher = decode(payload.cipher);
    const plaintext = nacl.secretbox.open(cipher, nonce, key);
    if (!plaintext) {
      return null;
    }
    const json = Buffer.from(plaintext).toString("utf-8");
    const parsed = JSON.parse(json) as Record<string, string>;
    return parsed;
  }

  private async deriveScryptKey(salt: Uint8Array, params: ScryptParameters = SCRYPT_PARAMS): Promise<Uint8Array> {
    const keyBuffer = (await scrypt(this.passphrase, Buffer.from(salt), KEY_LENGTH, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: 64 * 1024 * 1024
    })) as Buffer;
    return new Uint8Array(keyBuffer);
  }

  private async deriveLegacyArgon2Key(salt: Uint8Array): Promise<Uint8Array> {
    const sodium = await getSodium();
    return sodium.crypto_pwhash(
      KEY_LENGTH,
      this.passphrase,
      salt,
      sodium.crypto_pwhash_OPSLIMIT_MODERATE,
      sodium.crypto_pwhash_MEMLIMIT_MODERATE,
      sodium.crypto_pwhash_ALG_ARGON2ID13
    );
  }
}
