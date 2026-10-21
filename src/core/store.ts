// SPDX-License-Identifier: MIT

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { z } from 'zod'

const isErrno = (e: unknown): e is NodeJS.ErrnoException =>
  typeof e === 'object' && e !== null && 'code' in e

/**
 * Rename is atomic within a directory. On Windows it can transiently fail with EPERM while an
 * antivirus scanner holds the file — and a hosts-file writer is exactly what antivirus watches.
 */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await rename(from, to)
      return
    } catch (e) {
      const retriable =
        isErrno(e) && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES')
      if (!retriable || i === attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 20 * 2 ** i))
    }
  }
}

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await renameWithRetry(tmp, path)
}

export interface ReadResult<T> {
  data: T
  /** True when the on-disk file was unusable and has been quarantined as `.corrupt`. */
  recovered: boolean
}

export async function readJsonValidated<S extends z.ZodType>(
  path: string,
  schema: S,
  fallback: () => z.infer<S>,
): Promise<ReadResult<z.infer<S>>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (e) {
    if (isErrno(e) && e.code === 'ENOENT') return { data: fallback(), recovered: false }
    throw e
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return quarantine(path, fallback)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) return quarantine(path, fallback)
  return { data: result.data, recovered: false }
}

async function quarantine<T>(path: string, fallback: () => T): Promise<ReadResult<T>> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await rename(path, `${path}.${stamp}.corrupt`).catch(() => {})
  return { data: fallback(), recovered: true }
}
