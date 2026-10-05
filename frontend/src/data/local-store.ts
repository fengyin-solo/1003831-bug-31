import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 没有 localStorage 的环境（测试脚本等）退化成内存存储，保证读写语义一致。
let memoryFallback: Record<string, EntryRow[]> | null = null

function normalize(rows: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  // 旧版本浏览器里可能还存着没有人骨权限字段的数据，读出来时就地补齐，不用清库。
  const humanBone = rows.human_bone
  if (Array.isArray(humanBone)) {
    for (const row of humanBone) {
      if (typeof row.版本 !== 'number' || !(row.版本 > 0)) row.版本 = 1
      if (typeof row.鉴定人 !== 'string') row.鉴定人 = ''
      if (typeof row.复核人 !== 'string') row.复核人 = ''
    }
  }
  return rows
}

function readStorage(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    if (memoryFallback === null) {
      memoryFallback = clone(SEED_ROWS)
    }
    return memoryFallback
  }
  const fallback = clone(SEED_ROWS)
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return normalize({ ...fallback, ...parsed })
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

function persist(rows: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  } else {
    memoryFallback = rows
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

// 每次读写前先从持久层同步一次：别的标签页刚改过的数据这里立刻能看到，
// 版本号检查对跨标签页的并发才真正生效。
export function refreshRows(): void {
  cache = readStorage()
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
