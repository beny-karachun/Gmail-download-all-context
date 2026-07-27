(() => {
  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[index] = value >>> 0;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function setUint16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function setUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function normalizePath(path) {
    const clean = String(path || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .split("/")
      .filter((part) => part && part !== "." && part !== "..")
      .join("/");
    if (!clean) throw new Error("ZIP entries need a non-empty path.");
    return clean;
  }

  class StoreZip {
    constructor() {
      this.entries = [];
      this.paths = new Set();
      this.byteLength = 0;
    }

    addText(path, text, date = new Date()) {
      return this.addBytes(path, encoder.encode(String(text)), date);
    }

    addBytes(path, bytes, date = new Date()) {
      const cleanPath = normalizePath(path);
      if (this.paths.has(cleanPath)) throw new Error(`Duplicate ZIP path: ${cleanPath}`);

      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (data.byteLength > 0xffffffff) throw new Error("A ZIP entry is too large for this exporter.");
      if (this.byteLength + data.byteLength > 0xffffffff) {
        throw new Error("The ZIP is too large for this exporter.");
      }

      this.paths.add(cleanPath);
      this.entries.push({
        path: cleanPath,
        nameBytes: encoder.encode(cleanPath),
        data,
        crc: crc32(data),
        modified: dosDateTime(date),
      });
      this.byteLength += data.byteLength;
      return cleanPath;
    }

    toBlob() {
      if (this.entries.length > 0xffff) throw new Error("The ZIP contains too many files.");

      const localParts = [];
      const centralParts = [];
      let localOffset = 0;

      for (const entry of this.entries) {
        const localHeader = new Uint8Array(30 + entry.nameBytes.length);
        const localView = new DataView(localHeader.buffer);
        setUint32(localView, 0, 0x04034b50);
        setUint16(localView, 4, 20);
        setUint16(localView, 6, 0x0800);
        setUint16(localView, 8, 0);
        setUint16(localView, 10, entry.modified.time);
        setUint16(localView, 12, entry.modified.date);
        setUint32(localView, 14, entry.crc);
        setUint32(localView, 18, entry.data.length);
        setUint32(localView, 22, entry.data.length);
        setUint16(localView, 26, entry.nameBytes.length);
        setUint16(localView, 28, 0);
        localHeader.set(entry.nameBytes, 30);
        localParts.push(localHeader, entry.data);

        const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
        const centralView = new DataView(centralHeader.buffer);
        setUint32(centralView, 0, 0x02014b50);
        setUint16(centralView, 4, 20);
        setUint16(centralView, 6, 20);
        setUint16(centralView, 8, 0x0800);
        setUint16(centralView, 10, 0);
        setUint16(centralView, 12, entry.modified.time);
        setUint16(centralView, 14, entry.modified.date);
        setUint32(centralView, 16, entry.crc);
        setUint32(centralView, 20, entry.data.length);
        setUint32(centralView, 24, entry.data.length);
        setUint16(centralView, 28, entry.nameBytes.length);
        setUint16(centralView, 30, 0);
        setUint16(centralView, 32, 0);
        setUint16(centralView, 34, 0);
        setUint16(centralView, 36, 0);
        setUint32(centralView, 38, 0);
        setUint32(centralView, 42, localOffset);
        centralHeader.set(entry.nameBytes, 46);
        centralParts.push(centralHeader);

        localOffset += localHeader.length + entry.data.length;
      }

      const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
      const end = new Uint8Array(22);
      const endView = new DataView(end.buffer);
      setUint32(endView, 0, 0x06054b50);
      setUint16(endView, 4, 0);
      setUint16(endView, 6, 0);
      setUint16(endView, 8, this.entries.length);
      setUint16(endView, 10, this.entries.length);
      setUint32(endView, 12, centralSize);
      setUint32(endView, 16, localOffset);
      setUint16(endView, 20, 0);

      return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
    }
  }

  globalThis.MailpackZip = StoreZip;
})();
