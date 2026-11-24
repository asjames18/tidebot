/**
 * Watch-mode RFB client->server filter: parses client message framing so input
 * events (KeyEvent 4, PointerEvent 5, ClientCutText 6) can be dropped server-side
 * while the rest of the stream is forwarded. Pure functions, no I/O.
 */

/** Length of the client message at the head of `b`, 0 if more bytes are needed to know, -1 if unknown. */
export function rfbClientMsgLength(b: Buffer): number {
  const t = b[0];
  switch (t) {
    case 0: return 20; // SetPixelFormat
    case 2: return b.length < 4 ? 0 : 4 + 4 * b.readUInt16BE(2); // SetEncodings
    case 3: return 10; // FramebufferUpdateRequest
    case 4: return 8; // KeyEvent
    case 5: return 6; // PointerEvent
    // ClientCutText: length >= 0 is the classic 8-byte header + text; a negative
    // length marks the extended form, which carries 4 extra reserved bytes.
    case 6: {
      if (b.length < 8) return 0;
      const n = b.readInt32BE(4);
      return n < 0 ? 12 + Math.abs(n) : 8 + n;
    }
    case 150: return 10; // EnableContinuousUpdates
    case 248: return b.length < 9 ? 0 : 9 + b[8]; // ClientFence
    case 251: return b.length < 8 ? 0 : 8 + 16 * b[6]; // SetDesktopSize
    default: return -1;
  }
}

/** Filters a client->server RFB stream, dropping input events. Returns bytes to forward. */
export class WatchFilter {
  private pending = Buffer.alloc(0);
  feed(chunk: Buffer): Buffer {
    this.pending = Buffer.concat([this.pending, chunk]);
    const out: Buffer[] = [];
    for (;;) {
      const b = this.pending;
      if (!b.length) break;
      const len = rfbClientMsgLength(b);
      if (len === -1) { this.pending = Buffer.alloc(0); break; } // unknown: fail closed
      if (len === 0 || b.length < len) break; // need more bytes
      const msg = b.subarray(0, len);
      const t = b[0];
      if (t !== 4 && t !== 5 && t !== 6) out.push(Buffer.from(msg));
      this.pending = b.subarray(len);
    }
    return Buffer.concat(out);
  }
}
