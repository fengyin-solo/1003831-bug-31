/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

/** 操作角色：采集员维护基础信息，鉴定人提交鉴定，复核人确认复核。 */
export type ActorRole = '采集员' | '鉴定人' | '复核人'

/** 操作人上下文：单位与角色是权限口径的依据，由会话提供。 */
export type ActorContext = {
  operator: string
  unit: string
  role: ActorRole
}

export type ActionOptions = {
  actor?: ActorContext
  /** 乐观并发口径：动作发起时看到的记录版本，与当前版本不一致则拒绝写入。 */
  version?: number
  /** 提交鉴定时写入的结论（性别判定）。 */
  conclusion?: string
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
