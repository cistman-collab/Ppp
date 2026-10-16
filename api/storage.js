
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

function storagePath(key) {
  const root = process.env.WTI_DATA_DIR;

  if (!root || !path.isAbsolute(root)) {
    throw new Error('WTI_DATA_DIR must be an absolute path');
  }

  const parts = String(key).split('/');

  if (
    parts.some(part =>
      !part ||
      part === '.' ||
      part === '..' ||
      !/^[a-zA-Z0-9._-]+$/.test(part)
    )
  ) {
    throw new Error('Invalid storage path');
  }

  return path.join(root, ...parts);
}

function checksum(data) {
  return createHash('sha256')
    .update(data)
    .digest('hex');
}

export async function get(key) {
  const file = storagePath(key);
  let data;

  try {
    data = fs.readFileSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  return {
    statusCode: 200,
    blob: { etag: checksum(data) },
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(data));
        controller.close();
      }
    })
  };
}

export async function put(key, body, options = {}) {
  let target = key;

  if (options.addRandomSuffix) {
    const parsed = path.posix.parse(key);
    target = path.posix.join(
      parsed.dir,
      `${parsed.name}-${randomUUID()}${parsed.ext}`
    );
  }

  const file = storagePath(target);
  let previous = null;

  try {
    previous = fs.readFileSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (
    Object.hasOwn(options, 'ifMatch') &&
    (options.ifMatch === null ? previous !== null : !previous || checksum(previous) !== options.ifMatch)
  ) {
    throw new Error('Storage version conflict');
  }

  if (
    previous &&
    !options.allowOverwrite &&
    !options.ifMatch &&
    !options.addRandomSuffix
  ) {
    throw new Error('File already exists');
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });

  const data = Buffer.from(String(body));
  const temporary = `${file}.${randomUUID()}.tmp`;

  try {
    fs.writeFileSync(temporary, data, {
      flag: 'wx',
      mode: 0o600
    });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }

  return {
    pathname: target,
    etag: checksum(data)
  };
}
