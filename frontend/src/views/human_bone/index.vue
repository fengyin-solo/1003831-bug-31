<template>
  <section class="page" data-module="human_bone">
    <header class="page-head">
      <div>
        <h2>人骨鉴定管理</h2>
        <p class="page-desc">维护人骨标本，围绕标本编号、出土单位、鉴定部位、性别判定做登记、筛选与状态流转。</p>
        <p class="actor-line">
          当前操作人：{{ actorLabel }}。只有采集单位能维护基础信息，鉴定人只能提交鉴定，复核人才能确认。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记人骨标本</button>
        <button class="btn" type="button" @click="exportRows">导出人骨鉴定清单</button>
      </div>
    </header>

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
              v-for="action in permitted(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button v-if="canMaintain(row)" class="link" type="button" @click="openBasic(row)">
              维护基础信息
            </button>
            <span v-if="!permitted(row).length && !canMaintain(row)" class="muted">无权限</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无人骨鉴定数据，可先登记人骨标本</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条人骨鉴定记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="dialog" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>{{ dialogTitle }}</h3>
        <template v-if="dialog === 'create'">
          <p class="modal-tip">
            归属单位固定为当前操作人所在单位「{{ actor.unit }}」，登记后不随权限变更转移。
          </p>
          <label class="form-row">
            <span>鉴定部位</span>
            <input v-model="form.鉴定部位" placeholder="如：颅骨 / 骨盆 / 肢骨" />
          </label>
          <label class="form-row">
            <span>鉴定人</span>
            <input v-model="form.鉴定人" placeholder="指派的鉴定人姓名" />
          </label>
          <label class="form-row">
            <span>复核人</span>
            <input v-model="form.复核人" placeholder="指派的复核人姓名" />
          </label>
        </template>
        <template v-else-if="dialog === 'basic'">
          <p class="modal-tip">
            只有采集单位能维护基础信息；性别判定等结论只能由鉴定人通过「提交鉴定」写入。
          </p>
          <label class="form-row">
            <span>鉴定部位</span>
            <input v-model="form.鉴定部位" />
          </label>
          <label class="form-row">
            <span>鉴定人</span>
            <input v-model="form.鉴定人" placeholder="指派的鉴定人姓名" />
          </label>
          <label class="form-row">
            <span>复核人</span>
            <input v-model="form.复核人" placeholder="指派的复核人姓名" />
          </label>
        </template>
        <template v-else-if="dialog === 'conclusion'">
          <p class="modal-tip">鉴定人提交鉴定结论：性别判定、年龄范围、病理特征。</p>
          <label class="form-row">
            <span>性别判定</span>
            <input v-model="form.性别判定" placeholder="如：男性 / 女性 / 待定" />
          </label>
          <label class="form-row">
            <span>年龄范围</span>
            <input v-model="form.年龄范围" placeholder="如：35-40岁" />
          </label>
          <label class="form-row">
            <span>病理特征</span>
            <input v-model="form.病理特征" placeholder="如：骨质增生" />
          </label>
        </template>
        <footer class="modal-actions">
          <button class="btn primary" type="button" @click="submitDialog">确认</button>
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  canMaintainBasicInfo,
  createEntry,
  downloadEntries,
  listEntries,
  moduleMeta,
  permittedActions,
  runAction as applyAction,
  updateBasicInfo,
} from '@/api/local-service'
import type { ActionResult, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('human_bone')
const columns = ["标本编号", "出土单位", "鉴定部位", "性别判定", "年龄范围", "病理特征", "鉴定人", "复核人", "鉴定状态", "版本"]
const statuses = ["已采集", "鉴定中", "已鉴定", "已复核", "已归档"]
const stats = [{"label": "标本总数", "value": 0}, {"label": "已鉴定数", "value": 0}, {"label": "鉴定中数", "value": 0}]

const session = useSessionStore()
const actor = computed(() => session.currentUser)
const actorLabel = computed(
  () => `${actor.value.name}（${actor.value.unit} · ${actor.value.roles.join('/')}）`,
)

const rows = ref<EntryRow[]>([])
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

type DialogKind = 'create' | 'basic' | 'conclusion' | ''
const dialog = ref<DialogKind>('')
const dialogRow = ref<EntryRow | null>(null)
const form = ref<Record<string, string>>({})
const dialogTitle = computed(() => {
  if (dialog.value === 'create') return '登记人骨标本'
  if (dialog.value === 'basic') return `维护基础信息（${String(dialogRow.value?.标本编号 ?? '')}）`
  if (dialog.value === 'conclusion') return `提交鉴定结论（${String(dialogRow.value?.标本编号 ?? '')}）`
  return ''
})

function permitted(row: EntryRow): string[] {
  return permittedActions(meta.key, row, actor.value)
}

function canMaintain(row: EntryRow): boolean {
  return canMaintainBasicInfo(meta.key, row, actor.value)
}

function rowVersion(row: EntryRow): number {
  const version = Number(row.版本)
  return Number.isFinite(version) && version > 0 ? version : 1
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  form.value = { 鉴定部位: '', 鉴定人: '', 复核人: '' }
  dialogRow.value = null
  dialog.value = 'create'
}

function openBasic(row: EntryRow) {
  form.value = {
    鉴定部位: String(row.鉴定部位 ?? ''),
    鉴定人: String(row.鉴定人 ?? ''),
    复核人: String(row.复核人 ?? ''),
  }
  dialogRow.value = row
  dialog.value = 'basic'
}

function openConclusion(row: EntryRow) {
  form.value = {
    性别判定: String(row.性别判定 ?? ''),
    年龄范围: String(row.年龄范围 ?? ''),
    病理特征: String(row.病理特征 ?? ''),
  }
  dialogRow.value = row
  dialog.value = 'conclusion'
}

function closeDialog() {
  dialog.value = ''
  dialogRow.value = null
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '提交鉴定') {
    openConclusion(row)
    return
  }
  const result = applyAction(meta.key, Number(row.id), action, actor.value, rowVersion(row))
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function submitDialog() {
  errorMessage.value = ''
  let result: ActionResult | null = null
  if (dialog.value === 'create') {
    result = createEntry(meta.key, form.value, actor.value)
  } else if (dialog.value === 'basic' && dialogRow.value) {
    result = updateBasicInfo(meta.key, Number(dialogRow.value.id), form.value, actor.value, rowVersion(dialogRow.value))
  } else if (dialog.value === 'conclusion' && dialogRow.value) {
    result = applyAction(
      meta.key,
      Number(dialogRow.value.id),
      '提交鉴定',
      actor.value,
      rowVersion(dialogRow.value),
      form.value,
    )
  }
  if (result && !result.ok) {
    errorMessage.value = result.message
  }
  closeDialog()
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '人骨鉴定列表读取失败'
  }
}

onMounted(reload)
</script>
