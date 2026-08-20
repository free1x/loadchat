<script setup lang="ts">
import { computed } from 'vue'
import { Check, FileUp, Pause, Play, RotateCcw, X } from 'lucide-vue-next'
import { state } from '../state'
import { pauseTransfer, removeTransfer, resumeTransfer } from '../upload'
import { formatBytes } from '../utils'

const transfers = computed(() => Object.values(state.transfers).sort((a, b) => b.startedAt - a.startedAt))
</script>

<template>
  <div class="transfer-list">
    <div v-if="!transfers.length" class="empty-mini">
      <span class="empty-icon"><FileUp :size="24" /></span>
      <p>还没有传输任务</p>
      <small>拖入文件即可开始</small>
    </div>
    <article v-for="item in transfers" :key="item.key" class="transfer-item">
      <span class="file-badge"><FileUp :size="18" /></span>
      <div class="transfer-main">
        <div class="transfer-line"><strong :title="item.name">{{ item.name }}</strong><span>{{ Math.round(item.progress) }}%</span></div>
        <div class="progress"><i :style="{ width: `${item.progress}%` }" :class="item.status" /></div>
        <div class="transfer-meta">
          <span v-if="item.status === 'uploading'">{{ formatBytes(item.speed) }}/s</span>
          <span v-else-if="item.status === 'paused'">已暂停 · {{ formatBytes(item.uploaded) }}</span>
          <span v-else-if="item.status === 'complete'" class="success"><Check :size="12" /> 已完成</span>
          <span v-else-if="item.status === 'error'" class="danger" :title="item.error">{{ item.error }}</span>
          <span v-else>等待中</span>
          <span>{{ formatBytes(item.size) }}</span>
        </div>
      </div>
      <button v-if="item.status === 'uploading'" class="icon-btn tiny" title="暂停" @click="pauseTransfer(item.key)"><Pause :size="15" /></button>
      <button v-else-if="item.status === 'paused'" class="icon-btn tiny" title="继续" @click="resumeTransfer(item.key)"><Play :size="15" /></button>
      <button v-else-if="item.status === 'error'" class="icon-btn tiny" title="重试" @click="resumeTransfer(item.key)"><RotateCcw :size="15" /></button>
      <button v-else-if="item.status === 'complete'" class="icon-btn tiny" title="移除" @click="removeTransfer(item.key)"><X :size="15" /></button>
    </article>
  </div>
</template>

<style scoped>
.transfer-list { display: grid; gap: 10px; width: 100%; min-width: 0; overflow: hidden; }
.transfer-item { display: flex; width: 100%; min-width: 0; max-width: 100%; overflow: hidden; gap: 10px; align-items: flex-start; padding: 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.file-badge { width: 34px; height: 34px; border-radius: 10px; background: var(--purple-soft); color: var(--primary); display: grid; place-items: center; flex: 0 0 auto; }
.transfer-main { min-width: 0; max-width: 100%; overflow: hidden; flex: 1 1 0; }
.transfer-line, .transfer-meta { display: flex; min-width: 0; max-width: 100%; justify-content: space-between; gap: 8px; }
.transfer-line strong { display: block; flex: 1 1 0; min-width: 0; max-width: 100%; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.transfer-line > span { flex: 0 0 auto; font-size: 11px; color: var(--muted); }
.progress { height: 4px; background: var(--soft); margin: 8px 0 6px; border-radius: 5px; overflow: hidden; }
.progress i { display: block; height: 100%; border-radius: inherit; background: var(--primary); transition: width .2s; }
.progress i.complete { background: var(--success); }
.progress i.error { background: var(--danger); }
.transfer-meta { color: var(--muted); font-size: 10px; overflow: hidden; }.transfer-meta > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.success { color: var(--success); display: inline-flex; align-items: center; gap: 2px; }
.danger { color: var(--danger); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 130px; }
</style>
