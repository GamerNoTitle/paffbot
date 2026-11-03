import { fromBase64, toBase64, sha256 } from "../crypto";
import { SshFormatError, SshReader } from "./wire";

export type SupportedKeyType =
  | "ssh-ed25519"
  | "ssh-rsa"
  | "ecdsa-sha2-nistp256"
  | "ecdsa-sha2-nistp384"
  | "ecdsa-sha2-nistp521";

export interface ParsedPublicKey {
  type: SupportedKeyType;
  blob: Uint8Array;
  /** type 字段之后的原始字节（ed25519: 一个 string；rsa: e/n；ecdsa: curve/point） */
  body: Uint8Array;
}

const SUPPORTED: ReadonlySet<string> = new Set([
  "ssh-ed25519",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
]);

export function parsePublicKeyBlob(blob: Uint8Array): ParsedPublicKey {
  const reader = new SshReader(blob);
  const type = reader.readText();
  if (!SUPPORTED.has(type)) {
    throw new SshFormatError(
      `不支持的密钥类型 ${type}（支持 ed25519 / rsa / ecdsa p256·p384·p521；不支持 sk-* 硬件密钥）`,
    );
  }
  const body = blob.subarray(reader.offset);

  // 结构校验：按类型把该有的字段读完，确保不是截断/拼接的垃圾数据
  const bodyReader = new SshReader(body);
  if (type === "ssh-ed25519") {
    const key = bodyReader.readString();
    if (key.length !== 32) throw new SshFormatError("ed25519 公钥长度不对");
  } else if (type === "ssh-rsa") {
    bodyReader.readString(); // e
    bodyReader.readString(); // n
  } else {
    bodyReader.readText(); // curve name
    bodyReader.readString(); // point
  }
  bodyReader.expectEnd(`公钥 ${type}`);

  return { type: type as SupportedKeyType, blob, body };
}

/** 解析 `ssh-ed25519 AAAAC3... comment` 这样的一行 authorized_keys 格式。 */
export function parsePublicKeyLine(line: string): ParsedPublicKey {
  const text = line.trim();
  if (!text) throw new SshFormatError("公钥为空");
  const tokens = text.split(/\s+/);
  const typeIndex = tokens.findIndex((t) => t.startsWith("ssh-") || t.startsWith("ecdsa-"));
  if (typeIndex < 0 || typeIndex + 1 >= tokens.length) {
    throw new SshFormatError("公钥格式不对，应形如 `ssh-ed25519 AAAAC3Nza... 备注`");
  }
  const declaredType = tokens[typeIndex] as string;
  const base64 = tokens[typeIndex + 1] as string;
  let blob: Uint8Array;
  try {
    blob = fromBase64(base64);
  } catch {
    throw new SshFormatError("公钥 base64 段无法解码");
  }
  const parsed = parsePublicKeyBlob(blob);
  if (parsed.type !== declaredType) {
    throw new SshFormatError(`公钥类型声明不一致：${declaredType} vs ${parsed.type}`);
  }
  return parsed;
}

/** OpenSSH 风格的 SHA256:xxxx 指纹（无 padding 的 base64）。 */
export async function fingerprintOf(blob: Uint8Array): Promise<string> {
  const digest = await sha256(blob);
  return `SHA256:${toBase64(digest).replace(/=+$/, "")}`;
}
