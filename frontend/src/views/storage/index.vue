<template>
  <section class="page" data-module="storage">
    <header class="page-head">
      <div>
        <h2>库房管理管理</h2>
        <p class="page-desc">维护库房架位，围绕架位编号、库房名称、存放器物类别、架位层数做登记、筛选与状态流转。</p>
        <p class="actor-line">当前操作人：{{ actorLabel }}。入藏记录按复核通过时的快照生成，归属单位与原结论不再回写。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记库房架位</button>
        <button class="btn" type="button" @click="exportRows">导出库房管理清单</button>
      </div>
    </header>

    <h3 class="section-title">入藏待办（人骨标本）</h3>
    <p class="section-desc">
      人骨标本复核通过后在这里生成入藏待办，归属单位以标本的出土单位为准；只有归属单位能确认入藏。
    </p>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in intakeColumns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in intakeRows" :key="String(row.id)">
          <td v-for="column in intakeColumns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button v-if="canConfirm(row)" class="link" type="button" @click="confirm(row)">
              确认入藏
            </button>
            <span v-else class="muted">—</span>
          </td>
        </tr>
        <tr v-if="!intakeRows.length">
          <td :colspan="intakeColumns.length + 2" class="empty-state">暂无入藏待办，人骨标本复核通过后自动生成</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">库房架位</h3>
    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无库房管理数据，可先登记库房架位</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条库房管理记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  canConfirmIntake,
  confirmIntake,
  downloadEntries,
  listEntries,
  listStorageIntake,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('storage')
const columns = ["架位编号", "库房名称", "存放器物类别", "架位层数", "容纳件数", "当前件数", "管理人", "架位状态"]
const actions = ["存放器物", "调整整理", "临时封存"]
const statuses = ["正常使用", "已满", "待整理", "临时封存"]
const stats = [{"label": "架位总数", "value": 0}, {"label": "已满架位", "value": 0}, {"label": "可用架位", "value": 0}]
const intakeColumns = ["入藏编号", "标本编号", "归属单位", "性别判定", "年龄范围", "病理特征", "鉴定人", "复核人", "生成时间", "版本"]

const session = useSessionStore()
const actor = computed(() => session.currentUser)
const actorLabel = computed(
  () => `${actor.value.name}（${actor.value.unit} · ${actor.value.roles.join('/')}）`,
)

const rows = ref<EntryRow[]>([])
const intakeRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function canConfirm(row: EntryRow): boolean {
  return canConfirmIntake(row, actor.value)
}

function confirm(row: EntryRow) {
  errorMessage.value = ''
  const version = Number(row.版本)
  const result = confirmIntake(Number(row.id), actor.value, Number.isFinite(version) ? version : undefined)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '库房架位登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    intakeRows.value = [...listStorageIntake()]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '库房管理列表读取失败'
  }
}

onMounted(reload)
</script>
