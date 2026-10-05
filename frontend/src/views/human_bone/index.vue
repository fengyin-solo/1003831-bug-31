<template>
  <section class="page" data-module="human_bone">
    <header class="page-head">
      <div>
        <h2>人骨鉴定管理</h2>
        <p class="page-desc">维护人骨标本，围绕标本编号、出土单位、鉴定部位、性别判定做登记、筛选与状态流转。</p>
        <p class="actor-hint">当前操作身份：{{ store.operator }} · {{ store.unit }} · {{ store.role }}</p>
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
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openMaintain(row)">维护基础信息</button>
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

    <div v-if="dialog.mode !== 'closed'" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3>{{ dialogTitle }}</h3>
        <template v-if="dialog.mode === 'identify'">
          <p class="page-desc">提交鉴定结论，归属单位保持登记时的历史单位不变。</p>
          <label class="form-item">
            <span>性别判定</span>
            <select v-model="dialog.conclusion">
              <option>男性</option>
              <option>女性</option>
              <option>未知</option>
            </select>
          </label>
        </template>
        <template v-else>
          <p v-if="dialog.mode === 'maintain'" class="page-desc">
            仅采集单位可维护基础信息，归属单位与鉴定结论不在此修改。
          </p>
          <label v-for="field in editableFields" :key="field" class="form-item">
            <span>{{ field }}</span>
            <input v-model="dialog.form[field]" :placeholder="`请输入${field}`" />
          </label>
        </template>
        <p v-if="dialog.error" class="error-text">{{ dialog.error }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitDialog">确认</button>
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  maintainBasicInfo,
  moduleMeta,
  registerSpecimen,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('human_bone')
const columns = ["标本编号", "出土单位", "归属单位", "鉴定部位", "性别判定", "年龄范围", "病理特征", "鉴定人", "鉴定状态"]
const actions = ["开始鉴定", "提交鉴定", "复核鉴定"]
const statuses = ["已采集", "鉴定中", "已鉴定", "已复核", "已归档"]
const stats = [{"label": "标本总数", "value": 0}, {"label": "已鉴定数", "value": 0}, {"label": "鉴定中数", "value": 0}]
const editableFields = ["出土单位", "鉴定部位", "年龄范围", "病理特征"]

const store = useSessionStore()
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

type DialogMode = 'closed' | 'register' | 'maintain' | 'identify'
const dialog = reactive({
  mode: 'closed' as DialogMode,
  row: null as EntryRow | null,
  form: {} as Record<string, string>,
  conclusion: '男性',
  error: '',
})
const dialogTitle = computed(() => {
  if (dialog.mode === 'register') return '登记人骨标本'
  if (dialog.mode === 'maintain') return `维护基础信息：${dialog.row?.['标本编号'] ?? ''}`
  if (dialog.mode === 'identify') return `提交鉴定：${dialog.row?.['标本编号'] ?? ''}`
  return ''
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  dialog.mode = 'register'
  dialog.row = null
  dialog.form = {}
  dialog.error = ''
}

function openMaintain(row: EntryRow) {
  dialog.mode = 'maintain'
  dialog.row = row
  dialog.form = Object.fromEntries(editableFields.map((field) => [field, String(row[field] ?? '')]))
  dialog.error = ''
}

function openIdentify(row: EntryRow) {
  dialog.mode = 'identify'
  dialog.row = row
  dialog.conclusion = '男性'
  dialog.error = ''
}

function closeDialog() {
  dialog.mode = 'closed'
  dialog.row = null
  dialog.error = ''
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '提交鉴定') {
    openIdentify(row)
    return
  }
  const result = applyAction(meta.key, Number(row.id), action, {
    actor: store.actor,
    version: Number(row.version),
  })
  if (!result.ok) {
    reload()
    errorMessage.value = result.message
    return
  }
  reload()
}

function submitDialog() {
  dialog.error = ''
  let result
  if (dialog.mode === 'identify' && dialog.row) {
    result = applyAction(meta.key, Number(dialog.row.id), '提交鉴定', {
      actor: store.actor,
      version: Number(dialog.row.version),
      conclusion: dialog.conclusion,
    })
  } else if (dialog.mode === 'maintain' && dialog.row) {
    result = maintainBasicInfo(meta.key, Number(dialog.row.id), dialog.form, store.actor, Number(dialog.row.version))
  } else if (dialog.mode === 'register') {
    result = registerSpecimen(dialog.form, store.actor)
  } else {
    return
  }
  if (!result.ok) {
    reload()
    dialog.error = result.message
    return
  }
  closeDialog()
  reload()
}

function reload() {
  errorMessage.value = ''
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
