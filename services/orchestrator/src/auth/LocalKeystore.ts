import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import nacl from "tweetnacl";

type PersistedPayload = {
  version: number;
  kdf: {
    algorithm: "scrypt";
    N: number;
    r: number;
    p: number;
  };
  salt: string;
  nonce: string;
  cipher: string;
};

const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, keyLength: 32 } as const;
const SALT_LENGTH = 16;
const scrypt = promisify(nodeScrypt);

function encode(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function decode(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, "base64"));
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
      const payload = JSON.parse(raw) as PersistedPayload;
      if (payload.kdf?.algorithm !== "scrypt") {
        throw new Error("Unsupported keystore KDF");
      }
      this.salt = decode(payload.salt);
      const key = await this.deriveKey(this.salt);
      const nonce = decode(payload.nonce);
      const cipher = decode(payload.cipher);
      const plaintext = nacl.secretbox.open(cipher, nonce, key);
      if (!plaintext) {
        throw new Error("Failed to decrypt keystore");
      }
      const json = Buffer.from(plaintext).toString("utf-8");
      const parsed = JSON.parse(json) as Record<string, string>;
      return parsed;
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
    const key = await this.deriveKey(salt);
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

  private async deriveKey(salt: Uint8Array): Promise<Uint8Array> {
    const keyBuffer = (await scrypt(this.passphrase, Buffer.from(salt), SCRYPT_PARAMS.keyLength, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: 64 * 1024 * 1024
    })) as Buffer;
    return new Uint8Array(keyBuffer);
  }
}
