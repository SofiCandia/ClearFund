import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface StorageProvider {
  save(hash: string, data: Buffer): Promise<string>;
  read(hash: string): Promise<Buffer>;
  exists(hash: string): Promise<boolean>;
}

export class DiskStorageProvider implements StorageProvider {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  async save(hash: string, data: Buffer): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const destination = this.filename(hash);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await pipeline(
        Readable.from(data),
        createWriteStream(temporary, { flags: "wx" }),
      );
      await rename(temporary, destination);
    } catch (error) {
      if (await this.exists(hash)) {
        await unlink(temporary).catch((cleanupError: unknown) => {
          if (
            typeof cleanupError !== "object" ||
            cleanupError === null ||
            !("code" in cleanupError) ||
            cleanupError.code !== "ENOENT"
          ) {
            throw cleanupError;
          }
        });
      } else {
        await unlink(temporary).catch((cleanupError: unknown) => {
          if (
            typeof cleanupError !== "object" ||
            cleanupError === null ||
            !("code" in cleanupError) ||
            cleanupError.code !== "ENOENT"
          ) {
            throw cleanupError;
          }
        });
        throw error;
      }
    }
    return `/evidence/${hash}`;
  }

  async read(hash: string): Promise<Buffer> {
    return readFile(this.filename(hash));
  }

  async exists(hash: string): Promise<boolean> {
    try {
      await stat(this.filename(hash));
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }

  private filename(hash: string): string {
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error("Evidence hash must be a lowercase SHA-256 digest.");
    }
    return join(this.directory, hash);
  }
}
