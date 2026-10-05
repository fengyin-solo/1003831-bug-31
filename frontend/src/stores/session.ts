import { defineStore } from 'pinia'

import type { ActorContext, ActorRole } from '@/data/types'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '田野考古发掘数字化管理系统',
    // 当前操作人的单位与角色：权限校验以记录上的归属单位为准，这里只是身份来源。
    unit: '甲单位',
    role: '采集员' as ActorRole,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    actor: (state): ActorContext => ({
      operator: state.operator,
      unit: state.unit,
      role: state.role,
    }),
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setUnit(unit: string) {
      this.unit = unit
    },
    setRole(role: ActorRole) {
      this.role = role
    },
  },
})
