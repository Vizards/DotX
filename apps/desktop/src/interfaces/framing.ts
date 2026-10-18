// Both private desktop pipes prefix JSON with a uint32 little-endian byte length.
// Allocate each body once; only yield after every byte has been initialized.
export class FrameDecoder {
  private readonly header = Buffer.alloc(4);
  private headerBytes = 0;
  private body?: Buffer;
  private bodyBytes = 0;

  *push(chunk: Buffer): Generator<Buffer> {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.body) {
        const count = Math.min(4 - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + count);
        this.headerBytes += count;
        offset += count;
        if (this.headerBytes < 4) continue;
        this.body = Buffer.allocUnsafe(this.header.readUInt32LE());
        this.headerBytes = 0;
      }
      const count = Math.min(this.body.length - this.bodyBytes, chunk.length - offset);
      chunk.copy(this.body, this.bodyBytes, offset, offset + count);
      this.bodyBytes += count;
      offset += count;
      if (this.bodyBytes === this.body.length) {
        const frame = this.body;
        this.body = undefined;
        this.bodyBytes = 0;
        yield frame;
      }
    }
  }

  reset() {
    this.headerBytes = 0;
    this.body = undefined;
    this.bodyBytes = 0;
  }
}
