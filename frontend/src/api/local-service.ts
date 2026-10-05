import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, refreshRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, Actor, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 人骨标本的归属与鉴定权限口径全部集中在这一处，列表页的动作按钮和库房页的
// 入藏清单共用同一套判断，不再各算各的——之前两个页面归属错位就是口径分散导致的。
const HUMAN_BONE_KEY = 'human_bone'

// 库房入藏清单（人骨标本复核通过后生成的库房待办）：与架位是两类数据，分开存放。
export const STORAGE_INTAKE_KEY = 'storage_intake'

// 基础信息白名单：只有采集单位能改这些字段；
// 性别判定等鉴定结论只能由鉴定人通过「提交鉴定」写入，其他入口一律改不了。
const BASIC_INFO_FIELDS = ['鉴定部位', '鉴定人', '复核人']
const CONCLUSION_FIELDS = ['性别判定', '年龄范围', '病理特征']

// 鉴定动作必须按顺序流转，不能跳步。
const HUMAN_BONE_FLOW: Record<string, string> = {
  开始鉴定: '已采集',
  提交鉴定: '鉴定中',
  复核鉴定: '已鉴定',
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  refreshRows()
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function findRowIndex(rows: EntryRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

function rowVersion(row: EntryRow): number {
  const version = Number(row.版本)
  return Number.isFinite(version) && version > 0 ? version : 1
}

// 版本检查（乐观锁）：确认与复核并发时，只有拿着最新版本号的那个请求能生效，
// 其余的一律拦下，让对方刷新后重来。
function checkVersion(row: EntryRow, expectedVersion: number | undefined, entity: string): ActionResult | null {
  if (expectedVersion === undefined) {
    return null
  }
  const current = rowVersion(row)
  if (current !== expectedVersion) {
    return {
      ok: false,
      message: `${entity}已更新到版本 ${current}，本次操作基于版本 ${expectedVersion}，已被拦截，请刷新后重试`,
    }
  }
  return null
}

// 鉴定/复核的动作权限：只看记录上指派的鉴定人、复核人，与操作人当前所在单位无关。
// 返回 null 表示放行，否则返回拒绝原因。
function humanBoneActionError(action: string, row: EntryRow, actor: Actor): string | null {
  const identifier = String(row.鉴定人 ?? '')
  const reviewer = String(row.复核人 ?? '')
  if (action === '开始鉴定' || action === '提交鉴定') {
    if (!identifier) {
      return '该标本还没有指派鉴定人，请先由采集单位维护基础信息'
    }
    if (actor.name !== identifier) {
      return `只有鉴定人「${identifier}」能${action}，当前操作人「${actor.name}」无权操作`
    }
    return null
  }
  if (action === '复核鉴定') {
    if (!reviewer) {
      return '该标本还没有指派复核人，请先由采集单位维护基础信息'
    }
    if (actor.name !== reviewer) {
      return `只有复核人「${reviewer}」能确认该标本，当前操作人「${actor.name}」无权操作`
    }
    if (actor.name === identifier) {
      return '鉴定人不能复核自己提交的结论，必须由复核人确认'
    }
    return null
  }
  return `人骨标本没有登记「${action}」这个动作`
}

// 维护基础信息的权限：只有采集单位（记录上的出土单位）能改。
// 归属永远按记录上的单位解释，操作人后来换了单位、权限再变，旧记录仍归原单位。
export function canMaintainBasicInfo(key: string, row: EntryRow, actor: Actor | null | undefined): boolean {
  return key === HUMAN_BONE_KEY && !!actor && actor.unit !== '' && actor.unit === String(row.出土单位 ?? '')
}

// 行内可执行动作：页面只负责渲染，能不能做由这里统一判断。
export function permittedActions(key: string, row: EntryRow, actor: Actor | null | undefined): string[] {
  const meta = moduleMeta(key)
  if (key !== HUMAN_BONE_KEY) {
    return [...meta.actions]
  }
  if (!actor) {
    return []
  }
  return meta.actions.filter(
    (action) =>
      HUMAN_BONE_FLOW[action] === String(row.status) && humanBoneActionError(action, row, actor) === null,
  )
}

export function runAction(
  key: string,
  id: number,
  action: string,
  actor?: Actor,
  expectedVersion?: number,
  payload?: Record<string, string>,
): ActionResult {
  refreshRows()
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = findRowIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (key === HUMAN_BONE_KEY) {
    return runHumanBoneAction(meta, rows, index, action, target, actor, expectedVersion, payload)
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function runHumanBoneAction(
  meta: ModuleMeta,
  rows: EntryRow[],
  index: number,
  action: string,
  target: string,
  actor: Actor | undefined,
  expectedVersion: number | undefined,
  payload: Record<string, string> | undefined,
): ActionResult {
  const row = rows[index]
  if (!actor) {
    return { ok: false, message: '请先在页面顶部选择操作人，再执行鉴定动作' }
  }
  const denied = humanBoneActionError(action, row, actor)
  if (denied) {
    return { ok: false, message: denied }
  }
  const required = HUMAN_BONE_FLOW[action]
  if (required && String(row.status) !== required) {
    return { ok: false, message: `「${action}」只能在「${required}」状态执行，当前状态「${String(row.status)}」` }
  }
  const conflict = checkVersion(row, expectedVersion, meta.entity)
  if (conflict) {
    return conflict
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== lastStatus,
    abnormal: false,
    版本: rowVersion(row) + 1,
  }
  if (action === '提交鉴定' && payload) {
    // 鉴定结论只能由鉴定人在这个动作里写入。
    for (const field of CONCLUSION_FIELDS) {
      const value = payload[field]
      if (typeof value === 'string' && value.trim() !== '') {
        updated[field] = value.trim()
      }
    }
  }
  updated.鉴定状态 = target
  const next = [...rows]
  next[index] = updated
  saveRows(HUMAN_BONE_KEY, next)
  if (action === '复核鉴定') {
    createIntakeFromReview(updated)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 复核通过后生成库房入藏待办：归属单位和鉴定结论都按复核通过那一刻的快照写入。
// 之后标本再被修改、操作人单位再变，这条入藏记录都保持原样（保留历史单位和原结论）。
function createIntakeFromReview(row: EntryRow): void {
  const items = [...listRows(STORAGE_INTAKE_KEY)]
  // 一个标本只生成一条入藏待办，重复触发不会重复入库。
  if (items.some((item) => Number(item.sourceId) === Number(row.id))) {
    return
  }
  const id = items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  items.push({
    id,
    sourceId: Number(row.id),
    status: '待入藏',
    pending: true,
    abnormal: false,
    入藏编号: `INT-${String(id).padStart(4, '0')}`,
    标本编号: String(row.标本编号 ?? ''),
    归属单位: String(row.出土单位 ?? ''),
    性别判定: String(row.性别判定 ?? ''),
    年龄范围: String(row.年龄范围 ?? ''),
    病理特征: String(row.病理特征 ?? ''),
    鉴定人: String(row.鉴定人 ?? ''),
    复核人: String(row.复核人 ?? ''),
    生成时间: new Date().toLocaleString('zh-CN', { hour12: false }),
    版本: 1,
  })
  saveRows(STORAGE_INTAKE_KEY, items)
}

export function listStorageIntake(): EntryRow[] {
  refreshRows()
  return [...listRows(STORAGE_INTAKE_KEY)]
}

export function canConfirmIntake(row: EntryRow, actor: Actor | null | undefined): boolean {
  return (
    !!actor &&
    actor.unit !== '' &&
    actor.unit === String(row.归属单位 ?? '') &&
    String(row.status) === '待入藏'
  )
}

// 库房确认入藏：只有归属单位（历史单位）能确认；版本号保证并发确认只有一个生效。
export function confirmIntake(id: number, actor: Actor | undefined, expectedVersion?: number): ActionResult {
  refreshRows()
  const items = listRows(STORAGE_INTAKE_KEY)
  const index = findRowIndex(items, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的入藏记录` }
  }
  const row = items[index]
  if (!actor) {
    return { ok: false, message: '请先在页面顶部选择操作人，再确认入藏' }
  }
  if (actor.unit !== String(row.归属单位 ?? '')) {
    return { ok: false, message: `只有归属单位「${String(row.归属单位 ?? '')}」能确认这条入藏记录` }
  }
  if (String(row.status) !== '待入藏') {
    return { ok: false, message: `这条入藏记录已经是「${String(row.status)}」，不用重复确认` }
  }
  const conflict = checkVersion(row, expectedVersion, '入藏记录')
  if (conflict) {
    return conflict
  }
  const next = [...items]
  next[index] = { ...row, status: '已入藏', pending: false, 版本: rowVersion(row) + 1 }
  saveRows(STORAGE_INTAKE_KEY, next)
  return { ok: true, message: '入藏记录已确认，当前状态「已入藏」' }
}

// 维护基础信息：只有采集单位能改，且只能改白名单字段；
// 出土单位本身不允许改——旧记录的归属不随权限变更而转移。
export function updateBasicInfo(
  key: string,
  id: number,
  patch: Record<string, string>,
  actor: Actor | undefined,
  expectedVersion?: number,
): ActionResult {
  if (key !== HUMAN_BONE_KEY) {
    return { ok: false, message: '该模块暂未开放基础信息维护' }
  }
  refreshRows()
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = findRowIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  if (!actor) {
    return { ok: false, message: '请先在页面顶部选择操作人，再维护基础信息' }
  }
  if (!canMaintainBasicInfo(key, row, actor)) {
    return { ok: false, message: `只有采集单位「${String(row.出土单位 ?? '')}」能维护该标本的基础信息` }
  }
  const conflict = checkVersion(row, expectedVersion, meta.entity)
  if (conflict) {
    return conflict
  }
  const updated: EntryRow = { ...row, 版本: rowVersion(row) + 1 }
  for (const field of BASIC_INFO_FIELDS) {
    const value = patch[field]
    if (typeof value === 'string' && value.trim() !== '') {
      updated[field] = value.trim()
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}基础信息已更新（版本 ${String(updated.版本)}）` }
}

// 登记人骨标本：归属单位取操作人所在单位并固化到记录上，
// 之后操作人换单位、权限再变，这条记录仍归登记时的单位解释。
export function createEntry(key: string, values: Record<string, string>, actor: Actor | undefined): ActionResult {
  if (key !== HUMAN_BONE_KEY) {
    return { ok: false, message: '该模块暂未开放登记入口' }
  }
  if (!actor || actor.unit === '') {
    return { ok: false, message: '请先选择有归属单位的操作人，再登记标本' }
  }
  refreshRows()
  const rows = [...listRows(key)]
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const code = `HUMA-${String(id).padStart(4, '0')}`
  rows.push({
    id,
    status: '已采集',
    pending: true,
    abnormal: false,
    标本编号: code,
    出土单位: actor.unit,
    鉴定部位: (values.鉴定部位 ?? '').trim(),
    性别判定: '待定',
    年龄范围: '待定',
    病理特征: '待定',
    鉴定人: (values.鉴定人 ?? '').trim(),
    复核人: (values.复核人 ?? '').trim(),
    鉴定状态: '待鉴定',
    版本: 1,
  })
  saveRows(key, rows)
  return { ok: true, message: `人骨标本 ${code} 已登记，归属单位「${actor.unit}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  refreshRows()
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
