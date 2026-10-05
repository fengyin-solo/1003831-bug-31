import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return migrate(fallback)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return migrate(fallback)
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return migrate({ ...fallback, ...parsed })
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return migrate(fallback)
  }
}

// 旧数据迁移：权限口径上线前持久化的记录没有版本号和归属单位，读取时补齐，
// 归属单位一律保留记录原有的历史单位，不随操作人单位变化。
function migrate(rows: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const specimens = rows['human_bone']
  if (Array.isArray(specimens)) {
    for (const row of specimens) {
      if (typeof row.version !== 'number') {
        row.version = 1
      }
      if (!row['归属单位']) {
        row['归属单位'] = String(row['出土单位'] ?? '甲单位')
      }
    }
  }
  if (!Array.isArray(rows['storage_intake'])) {
    rows['storage_intake'] = []
  }
  return rows
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
