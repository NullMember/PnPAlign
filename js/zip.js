// Minimal ZIP writer (STORE method — no compression, images are already compressed).
// No dependencies; produces a standard ZIP that any unzip tool/OS can open.

const Zip = (() => {
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const time =
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((date.getSeconds() >> 1) & 0x1f);
    const dosDate =
      (((date.getFullYear() - 1980) & 0x7f) << 9) |
      (((date.getMonth() + 1) & 0xf) << 5) |
      (date.getDate() & 0x1f);
    return { time, dosDate };
  }

  function writeUint16LE(arr, offset, v) {
    arr[offset] = v & 0xff;
    arr[offset + 1] = (v >>> 8) & 0xff;
  }
  function writeUint32LE(arr, offset, v) {
    arr[offset] = v & 0xff;
    arr[offset + 1] = (v >>> 8) & 0xff;
    arr[offset + 2] = (v >>> 16) & 0xff;
    arr[offset + 3] = (v >>> 24) & 0xff;
  }

  // files: [{ name: string, data: Uint8Array }]
  function createZip(files) {
    const { time, dosDate } = dosDateTime(new Date());
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const crc = crc32(data);
      const size = data.length;

      const localHeader = new Uint8Array(30 + nameBytes.length);
      writeUint32LE(localHeader, 0, 0x04034b50);
      writeUint16LE(localHeader, 4, 20); // version needed
      writeUint16LE(localHeader, 6, 0); // flags
      writeUint16LE(localHeader, 8, 0); // method = store
      writeUint16LE(localHeader, 10, time);
      writeUint16LE(localHeader, 12, dosDate);
      writeUint32LE(localHeader, 14, crc);
      writeUint32LE(localHeader, 18, size);
      writeUint32LE(localHeader, 22, size);
      writeUint16LE(localHeader, 26, nameBytes.length);
      writeUint16LE(localHeader, 28, 0); // extra length
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      writeUint32LE(centralHeader, 0, 0x02014b50);
      writeUint16LE(centralHeader, 4, 20); // version made by
      writeUint16LE(centralHeader, 6, 20); // version needed
      writeUint16LE(centralHeader, 8, 0); // flags
      writeUint16LE(centralHeader, 10, 0); // method = store
      writeUint16LE(centralHeader, 12, time);
      writeUint16LE(centralHeader, 14, dosDate);
      writeUint32LE(centralHeader, 16, crc);
      writeUint32LE(centralHeader, 20, size);
      writeUint32LE(centralHeader, 24, size);
      writeUint16LE(centralHeader, 28, nameBytes.length);
      writeUint16LE(centralHeader, 30, 0); // extra length
      writeUint16LE(centralHeader, 32, 0); // comment length
      writeUint16LE(centralHeader, 34, 0); // disk number start
      writeUint16LE(centralHeader, 36, 0); // internal attrs
      writeUint32LE(centralHeader, 38, 0); // external attrs
      writeUint32LE(centralHeader, 42, offset);
      centralHeader.set(nameBytes, 46);

      centralParts.push(centralHeader);

      offset += localHeader.length + data.length;
    }

    const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
    const centralOffset = offset;

    const end = new Uint8Array(22);
    writeUint32LE(end, 0, 0x06054b50);
    writeUint16LE(end, 4, 0); // disk number
    writeUint16LE(end, 6, 0); // disk with central dir
    writeUint16LE(end, 8, files.length);
    writeUint16LE(end, 10, files.length);
    writeUint32LE(end, 12, centralSize);
    writeUint32LE(end, 16, centralOffset);
    writeUint16LE(end, 20, 0); // comment length

    const blobParts = [...localParts, ...centralParts, end];
    return new Blob(blobParts, { type: 'application/zip' });
  }

  return { createZip };
})();
