import { fromBase64, toBase64Url, utf8 } from "../crypto";
import { fingerprintOf, parsePublicKeyBlob, type ParsedPublicKey } from "./keys";
import { concat, mpintMagnitude, SshFormatError, SshReader, sshString } from "./wire";

/**
 * OpenSSH SSHSIG（`ssh-keygen -Y sign`）验签。
 *
 * 格式见 OpenSSH PROTOCOL.sshsig：
 *   armor 内是 SSH 二进制串：
 *     "SSHSIG" | uint32 version=1 | string publickey | string namespace
 *     | string reserved | string hash_algorithm | string signature
 *
 * 被签名的数据不是原消息，而是：
 *     "SSHSIG" | string namespace | string reserved | string hash_algorithm | string H
 *   其中 H = hash(hash_algorithm, message)。
 *
 * 最后用公钥对这段数据做签名校验（ed25519 / RSA PKCS#1 v1.5 / ECDSA）。
 */

const MAGIC = utf8("SSHSIG");

export interface SshSignatureVerifyOptions {
  armor: string;
  message: string | Uint8Array;
  namespace: string;
}

export interface SshSignatureVerifyResult {
  ok: boolean;
  keyType?: string;
  fingerprint?: string;
  hashAlgorithm?: string;
  reason?: string;
}

interface ParsedSshSig {
  publicKeyBlob: Uint8Array;
  namespace: string;
  reserved: Uint8Array;
  hashAlgorithm: "sha256" | "sha512";
  signatureBlob: Uint8Array;
}

function decodeArmor(armor: string): Uint8Array {
  const match = /-----BEGIN SSH SIGNATURE-----([\s\S]*?)-----END SSH SIGNATURE-----/.exec(armor);
  if (!match) throw new SshFormatError("这不是 SSHSIG 签名（缺少 BEGIN/END SSH SIGNATURE 标记）");
  const base64 = (match[1] ?? "").replace(/\s+/g, "");
  if (!base64) throw new SshFormatError("SSHSIG 内容为空");
  try {
    return fromBase64(base64);
  } catch {
    throw new SshFormatError("SSHSIG base64 段无法解码");
  }
}

export function parseSshSignature(armor: string): ParsedSshSig {
  const reader = new SshReader(decodeArmor(armor));
  const magic = new TextDecoder().decode(reader.readBytes(6));
  if (magic !== "SSHSIG") throw new SshFormatError("SSHSIG 魔数不匹配");
  const version = reader.readU32();
  if (version !== 1) throw new SshFormatError(`不支持的 SSHSIG 版本 ${version}`);
  const publicKeyBlob = reader.readString();
  const namespace = reader.readText();
  const reserved = reader.readString();
  const hashAlgorithm = reader.readText();
  if (hashAlgorithm !== "sha256" && hashAlgorithm !== "sha512") {
    throw new SshFormatError(`不支持的哈希算法 ${hashAlgorithm}`);
  }
  const signatureBlob = reader.readString();
  reader.expectEnd("SSHSIG");
  return { publicKeyBlob, namespace, reserved, hashAlgorithm, signatureBlob };
}

async function verifyWithKey(
  key: ParsedPublicKey,
  signatureType: string,
  signatureData: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  switch (key.type) {
    case "ssh-ed25519": {
      if (signatureType !== "ssh-ed25519") return false;
      const keyReader = new SshReader(key.body);
      const rawKey = keyReader.readString();
      if (rawKey.length !== 32 || signatureData.length !== 64) return false;
      const cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "Ed25519" }, false, ["verify"]);
      return crypto.subtle.verify({ name: "Ed25519" }, cryptoKey, signatureData, data);
    }
    case "ssh-rsa": {
      // ssh-rsa 本身 = SHA-1，已不安全，只接受 rsa-sha2-*。
      const hash = signatureType === "rsa-sha2-256" ? "SHA-256" : signatureType === "rsa-sha2-512" ? "SHA-512" : null;
      if (!hash) return false;
      const reader = new SshReader(key.body);
      const e = mpintMagnitude(reader.readString());
      const n = mpintMagnitude(reader.readString());
      const jwk: JsonWebKey = { kty: "RSA", n: toBase64Url(n), e: toBase64Url(e), ext: true };
      const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash }, false, [
        "verify",
      ]);
      return crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, cryptoKey, signatureData, data);
    }
    case "ecdsa-sha2-nistp256":
    case "ecdsa-sha2-nistp384":
    case "ecdsa-sha2-nistp521": {
      if (signatureType !== key.type) return false;
      const curve =
        key.type === "ecdsa-sha2-nistp256" ? "P-256" : key.type === "ecdsa-sha2-nistp384" ? "P-384" : "P-521";
      const hash = key.type === "ecdsa-sha2-nistp256" ? "SHA-256" : key.type === "ecdsa-sha2-nistp384" ? "SHA-384" : "SHA-512";
      const coordinateSize = key.type === "ecdsa-sha2-nistp256" ? 32 : key.type === "ecdsa-sha2-nistp384" ? 48 : 66;

      const keyReader = new SshReader(key.body);
      keyReader.readText(); // curve name, e.g. nistp256
      const point = keyReader.readString();
      if (point.length !== 1 + coordinateSize * 2 || point[0] !== 0x04) return false;
      const jwk: JsonWebKey = {
        kty: "EC",
        crv: curve,
        x: toBase64Url(point.subarray(1, 1 + coordinateSize)),
        y: toBase64Url(point.subarray(1 + coordinateSize)),
        ext: true,
      };
      const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: curve }, false, [
        "verify",
      ]);

      const sigReader = new SshReader(signatureData);
      const r = mpintMagnitude(sigReader.readString());
      const s = mpintMagnitude(sigReader.readString());
      sigReader.expectEnd("ECDSA 签名");
      if (r.length > coordinateSize || s.length > coordinateSize) return false;
      const raw = new Uint8Array(coordinateSize * 2);
      raw.set(r, coordinateSize - r.length);
      raw.set(s, coordinateSize * 2 - s.length);

      return crypto.subtle.verify({ name: "ECDSA", hash }, cryptoKey, raw, data);
    }
    default:
      return false;
  }
}

export async function verifySshSignature(options: SshSignatureVerifyOptions): Promise<SshSignatureVerifyResult> {
  try {
    const parsed = parseSshSignature(options.armor);
    if (parsed.namespace !== options.namespace) {
      return { ok: false, reason: `签名命名空间是 ${parsed.namespace}，应该是 ${options.namespace}` };
    }

    const key = parsePublicKeyBlob(parsed.publicKeyBlob);
    const fingerprint = await fingerprintOf(key.blob);

    const message = typeof options.message === "string" ? utf8(options.message) : options.message;
    const digest = new Uint8Array(
      await crypto.subtle.digest(parsed.hashAlgorithm === "sha512" ? "SHA-512" : "SHA-256", message),
    );

    const signedData = concat([
      MAGIC,
      sshString(parsed.namespace),
      sshString(parsed.reserved),
      sshString(parsed.hashAlgorithm),
      sshString(digest),
    ]);

    const sigReader = new SshReader(parsed.signatureBlob);
    const signatureType = sigReader.readText();
    const signatureData = sigReader.readString();
    sigReader.expectEnd("签名块");

    const ok = await verifyWithKey(key, signatureType, signatureData, signedData);
    return {
      ok,
      keyType: key.type,
      fingerprint,
      hashAlgorithm: parsed.hashAlgorithm,
      reason: ok ? undefined : "签名校验失败",
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "SSHSIG 解析失败" };
  }
}
