import { existsSync } from 'node:fs'
import { readdir, rename } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { getReceiptDate } from './receipt-date.js'

const availableName = (
  folderPath: string,
  sourceName: string,
  stamp: string,
): string => {
  let candidate = `${stamp}_benzin.pdf`
  let suffix = 2

  while (
    candidate !== sourceName &&
    existsSync(join(folderPath, candidate))
  ) {
    candidate = `${stamp}_benzin_${suffix}.pdf`
    suffix += 1
  }

  return candidate
}

export const renameReceipts = async (folderPath: string): Promise<string[]> => {
  const entries = await readdir(folderPath, { withFileTypes: true })
  const names: string[] = []

  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.pdf') continue

    const date = await getReceiptDate(join(folderPath, entry.name))
    if (!date) continue

    const stamp = date.replace(/-/g, '')
    const nextName = availableName(folderPath, entry.name, stamp)

    await rename(
      join(folderPath, entry.name),
      join(folderPath, nextName),
    )
    names.push(nextName)
  }

  return names
}
