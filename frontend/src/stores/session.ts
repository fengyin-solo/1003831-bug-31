import { defineStore } from 'pinia'

// 演示用账号。权限判断全部以数据记录上的单位/指派人为准，
// 这里切换账号只改变「当前操作人」，不会改写任何历史记录的归属。
export type SessionUser = {
  name: string
  unit: string
  roles: string[]
}

const DEMO_USERS: SessionUser[] = [
  { name: '赵采集', unit: '甲单位', roles: ['采集员'] },
  { name: '钱鉴定', unit: '乙单位', roles: ['鉴定人'] },
  { name: '孙复核', unit: '丙单位', roles: ['复核人'] },
  { name: '周记录', unit: '乙单位', roles: ['采集员'] },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    users: DEMO_USERS,
    currentUserName: DEMO_USERS[0].name,
    shiftLabel: '白班 08:00-20:00',
    scope: '田野考古发掘数字化管理系统',
  }),
  getters: {
    currentUser: (state): SessionUser =>
      state.users.find((user) => user.name === state.currentUserName) ?? state.users[0],
    canOperate: (state) => state.currentUserName.length > 0,
  },
  actions: {
    switchUser(name: string) {
      if (this.users.some((user) => user.name === name)) {
        this.currentUserName = name
      }
    },
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})
