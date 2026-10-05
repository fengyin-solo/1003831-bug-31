import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionOptions,
  ActionResult,
  ActorContext,
  ActorRole,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// —— 共享鉴定权限口径 ——
// 标本归属、鉴定动作、复核写入、库房待办四条路径共用这一份口径：
// 归属单位在登记时写进记录并保持不变，动作按「角色 + 归属单位」校验，版本号做并发互斥。
const OWNER_FIELD = '归属单位'
const INTAKE_KEY = 'storage_intake'

// 每个动作要求的角色；不在表里的动作不限制角色。
const ACTION_ROLES: Record<string, Record<string, ActorRole>> = {
  human_bone: { 开始鉴定: '鉴定人', 提交鉴定: '鉴定人', 复核鉴定: '复核人' },
}

// 需要操作人单位与记录归属单位一致的动作。
const UNIT_SCOPED_ACTIONS: Record<string, readonly string[]> = {
  human_bone: ['开始鉴定', '提交鉴定'],
}

// 动作允许的发起状态，保证 已采集→鉴定中→已鉴定→已复核 的顺序流转。
const ACTION_FLOW: Record<string, Record<string, string>> = {
  human_bone: { 开始鉴定: '已采集', 提交鉴定: '鉴定中', 复核鉴定: '已鉴定' },
}

// 基础信息可维护字段：归属单位、性别判定、鉴定人等归属/结论字段不在其列。
const BASIC_INFO_FIELDS: Record<string, readonly string[]> = {
  human_bone: ['出土单位', '鉴定部位', '年龄范围', '病理特征'],
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
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 版本口径：带版本号的记录必须带上次看到的版本，确认与复核并发时只允许一个版本生效。
function checkVersion(meta: ModuleMeta, row: EntryRow, version?: number): string | null {
  if (typeof row.version !== 'number') {
    return null
  }
  if (version !== row.version) {
    return `${meta.entity}已被他人更新（当前版本 ${row.version}），请刷新列表后重试`
  }
  return null
}

// 权限口径：先校验角色，再校验归属单位；两者都以记录上的历史归属为准。
function checkActor(key: string, action: string, row: EntryRow, actor?: ActorContext): string | null {
  const needRole = ACTION_ROLES[key]?.[action]
  const unitScoped = UNIT_SCOPED_ACTIONS[key]?.includes(action) ?? false
  if (!needRole && !unitScoped) {
    return null
  }
  if (!actor) {
    return '缺少操作人身份，无法校验权限'
  }
  if (needRole && actor.role !== needRole) {
    return `「${action}」只能由${needRole}执行，当前角色为${actor.role}`
  }
  if (unitScoped) {
    const owner = String(row[OWNER_FIELD] ?? '')
    if (owner && actor.unit !== owner) {
      return `「${action}」只能由归属单位 ${owner} 的人员执行，当前单位为 ${actor.unit}`
    }
  }
  return null
}

export function runAction(
  key: string,
  id: number,
  action: string,
  options: ActionOptions = {},
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const versionDenied = checkVersion(meta, row, options.version)
  if (versionDenied) {
    return { ok: false, message: versionDenied }
  }
  const actorDenied = checkActor(key, action, row, options.actor)
  if (actorDenied) {
    return { ok: false, message: actorDenied }
  }
  const current = String(row.status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const flowFrom = ACTION_FLOW[key]?.[action]
  if (flowFrom && current !== flowFrom) {
    return { ok: false, message: `「${action}」只能从「${flowFrom}」发起，当前状态为「${current}」` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (typeof row.version === 'number') {
    updated.version = row.version + 1
  }
  // 鉴定写入口径：只写鉴定人与结论，归属单位保持登记时的历史单位不变。
  if (key === 'human_bone' && action === '提交鉴定' && options.actor) {
    updated['鉴定人'] = options.actor.operator
    if (options.conclusion && options.conclusion.trim() !== '') {
      updated['性别判定'] = options.conclusion.trim()
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  // 复核写入库房待办：归属单位与原结论取标本记录快照，跨模块共用同一归属口径。
  if (key === 'human_bone' && action === '复核鉴定') {
    createStorageIntake(updated, options.actor)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 只有采集单位（归属单位）的采集员能维护基础信息；归属与结论字段不可在此改写。
export function maintainBasicInfo(
  key: string,
  id: number,
  patch: Record<string, string>,
  actor?: ActorContext,
  version?: number,
): ActionResult {
  const meta = moduleMeta(key)
  const allowed = BASIC_INFO_FIELDS[key]
  if (!allowed) {
    return { ok: false, message: `${meta.entity}不支持基础信息维护` }
  }
  if (!actor) {
    return { ok: false, message: '缺少操作人身份，无法校验权限' }
  }
  if (actor.role !== '采集员') {
    return { ok: false, message: `只有采集单位人员能维护基础信息，当前角色为${actor.role}` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const versionDenied = checkVersion(meta, row, version)
  if (versionDenied) {
    return { ok: false, message: versionDenied }
  }
  const owner = String(row[OWNER_FIELD] ?? '')
  if (owner && actor.unit !== owner) {
    return { ok: false, message: `只有归属单位 ${owner} 能维护该${meta.entity}的基础信息，当前单位为 ${actor.unit}` }
  }
  const updated: EntryRow = { ...row }
  for (const field of allowed) {
    const value = patch[field]
    if (typeof value === 'string' && value.trim() !== '') {
      updated[field] = value.trim()
    }
  }
  if (typeof row.version === 'number') {
    updated.version = row.version + 1
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}基础信息已更新，归属单位仍为 ${owner || actor.unit}` }
}

// 登记人骨标本：归属单位在登记时锁定为采集单位，之后的动作与权限变更都不改写。
export function registerSpecimen(
  fields: Record<string, string>,
  actor?: ActorContext,
): ActionResult {
  const key = 'human_bone'
  const meta = moduleMeta(key)
  if (!actor) {
    return { ok: false, message: '缺少操作人身份，无法校验权限' }
  }
  if (actor.role !== '采集员') {
    return { ok: false, message: `只有采集单位人员能登记${meta.entity}，当前角色为${actor.role}` }
  }
  const rows = listRows(key)
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const code = `HUMA-${String(nextId).padStart(4, '0')}`
  const text = (field: string) => {
    const value = fields[field]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : '未填写'
  }
  const row: EntryRow = {
    id: nextId,
    status: meta.statuses[0],
    pending: true,
    abnormal: false,
    version: 1,
    标本编号: code,
    出土单位: text('出土单位'),
    [OWNER_FIELD]: actor.unit,
    鉴定部位: text('鉴定部位'),
    性别判定: '待定',
    年龄范围: text('年龄范围'),
    病理特征: text('病理特征'),
    鉴定人: '—',
    鉴定状态: meta.statuses[0],
  }
  saveRows(key, [...rows, row])
  return { ok: true, message: `${meta.entity} ${code} 已登记，归属单位 ${actor.unit}` }
}

// 库房入藏待办：同一标本同一版本只生成一条，归属单位与原结论保留复核时的历史快照。
function createStorageIntake(specimen: EntryRow, actor?: ActorContext): void {
  const intakes = listRows(INTAKE_KEY)
  const specimenCode = String(specimen['标本编号'] ?? specimen.id)
  const sourceVersion = Number(specimen.version ?? 0)
  const exists = intakes.some(
    (row) => String(row['标本编号']) === specimenCode && Number(row['来源版本']) === sourceVersion,
  )
  if (exists) {
    return
  }
  const nextId = intakes.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const intake: EntryRow = {
    id: nextId,
    status: '待入藏',
    pending: true,
    abnormal: false,
    version: 1,
    入藏编号: `INTK-${String(nextId).padStart(4, '0')}`,
    标本编号: specimenCode,
    [OWNER_FIELD]: String(specimen[OWNER_FIELD] ?? ''),
    原结论: String(specimen['性别判定'] ?? ''),
    鉴定人: String(specimen['鉴定人'] ?? ''),
    复核人: actor?.operator ?? '—',
    来源版本: sourceVersion,
  }
  saveRows(INTAKE_KEY, [...intakes, intake])
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
