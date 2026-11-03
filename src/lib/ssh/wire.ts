/** SSH 二进制协议（RFC 4251）里够用的那部分：字符串、uint32、mpint。 */

export class SshFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SshFormatError";
  }
}

export class SshReader {
  private readonly view: DataView;

  constructor(
    private readonly buf: Uint8Array,
    public offset = 0,
  ) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  readU8(): number {
    if (this.remaining < 1) throw new SshFormatError("数据不完整：缺 1 字节");
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readU32(): number {
    if (this.remaining < 4) throw new SshFormatError("数据不完整：缺 4 字节长度");
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  readBytes(length: number): Uint8Array {
    if (length < 0 || this.remaining < length) throw new SshFormatError(`数据不完整：需要 ${length} 字节`);
    const out = this.buf.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  readString(): Uint8Array {
    return this.readBytes(this.readU32());
  }

  readText(): string {
    return new TextDecoder().decode(this.readString());
  }

  expectEnd(what: string): void {
    if (this.remaining !== 0) throw new SshFormatError(`${what} 末尾有 ${this.remaining} 字节多余数据`);
  }
}

export function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

export function sshString(input: Uint8Array | string): Uint8Array {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return concat([u32(bytes.length), bytes]);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** mpint 的正整数值：去掉符号位补的 0x00。 */
export function mpintMagnitude(raw: Uint8Array): Uint8Array {
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start += 1;
  return raw.subarray(start);
}
