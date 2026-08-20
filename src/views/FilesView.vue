<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { Archive, Ban, Copy, Download, File, FileText, FolderUp, Image, Link2, MoreHorizontal, Music, Package, Search, Send, ShieldCheck, Trash2, UploadCloud, Video, X } from 'lucide-vue-next'
import { api, downloadUrl, downloadZipUrl } from '../api'
import TransferList from '../components/TransferList.vue'
import UserAvatar from '../components/UserAvatar.vue'
import { identity, loadFiles, removeFile, shareFile, state } from '../state'
import { enqueueFiles } from '../upload'
import { copyText, fileKind, formatBytes, formatTime } from '../utils'
import type { FileInfo, FileShare } from '../types'

const search = ref('')
const tab = ref<'all' | 'sent' | 'received'>('all')
const input = ref<HTMLInputElement>()
const folderInput = ref<HTMLInputElement>()
const dragging = ref(false)
const share = ref<{ file: FileInfo; id: string; url: string; qr: string } | null>(null)
const shareHours = ref(24)
const shareMaxDownloads = ref(0)
const shares = ref<FileShare[]>([])
const category = ref<'all' | 'image' | 'video' | 'audio' | 'document' | 'archive'>('all')
const menu = ref('')
const selected = ref<string[]>([])
const previewImage = ref<FileInfo | null>(null)
let searchTimer: number | undefined

watch(search, () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(() => loadFiles(search.value), 250) })
onMounted(() => loadFiles())

const visible = computed(() => state.files.filter((file) => file.status === 'complete' &&
  (tab.value === 'all' || (tab.value === 'sent') === (file.senderId === identity.id)) &&
  (category.value === 'all' || fileKind(file.originalName, file.mime) === category.value)))
const totalSize = computed(() => state.files.filter((f) => f.status === 'complete').reduce((sum, file) => sum + file.size, 0))
function icon(file: FileInfo) {
  return { image: Image, video: Video, audio: Music, archive: Package, document: FileText, file: File }[fileKind(file.originalName, file.mime)]
}
function picked(event: Event) { const target = event.target as HTMLInputElement; if (target.files?.length) enqueueFiles(target.files); target.value = '' }
function folderPicked(event: Event) { const target = event.target as HTMLInputElement; if (target.files?.length) enqueueFiles(target.files); target.value = '' }
function dropped(event: DragEvent) { dragging.value = false; if (event.dataTransfer?.files.length) enqueueFiles(event.dataTransfer.files) }
async function openShare(file: FileInfo) {
  const result = await shareFile(file.id, Math.max(1, shareHours.value) * 60 * 60 * 1000, Math.max(0, shareMaxDownloads.value))
  const url = new URL(result.path, location.origin).toString()
  share.value = { file, id: result.id, url, qr: await QRCode.toDataURL(url, { width: 230, margin: 1 }) }
  shares.value = await api(`/api/files/${encodeURIComponent(file.id)}/shares?deviceId=${encodeURIComponent(identity.id)}`)
  menu.value = ''
}
async function copyShare() { if (share.value) await copyText(share.value.url) }
async function revokeShare(item: FileShare) {
  if (!share.value) return
  await api(`/api/files/${encodeURIComponent(share.value.file.id)}/shares/${encodeURIComponent(item.id)}?deviceId=${encodeURIComponent(identity.id)}`, { method: 'DELETE' })
  shares.value = await api(`/api/files/${encodeURIComponent(share.value.file.id)}/shares?deviceId=${encodeURIComponent(identity.id)}`)
  if (item.id === share.value.id) share.value = null
}
async function copyChecksum(file: FileInfo) { if (file.sha256) await copyText(file.sha256) }
async function destroy(file: FileInfo) { if (confirm(`确定删除「${file.originalName}」吗？此操作会删除本机文件。`)) await removeFile(file.id); menu.value = '' }
function downloadSelected() {
  if (!selected.value.length) return
  location.href = downloadZipUrl(selected.value, identity.id)
}
</script>

<template>
  <div class="page-scroll files-page" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="dropped">
    <header class="page-heading"><div><span class="eyebrow">文件中心</span><h1>传输与文件</h1><p>按会话隔离访问，并使用 SHA-256 校验完整性。</p></div><div class="heading-actions"><button class="secondary-btn" @click="folderInput?.click()"><FolderUp :size="17" />上传文件夹</button><button class="primary-btn" @click="input?.click()"><UploadCloud :size="18" /> 上传文件</button></div></header>
    <input ref="input" hidden type="file" multiple @change="picked" />
    <input ref="folderInput" hidden type="file" multiple webkitdirectory directory @change="folderPicked" />

    <section class="file-stats">
      <article><span class="stat-glyph purple"><File :size="22" /></span><div><small>本地文件</small><strong>{{ state.files.filter(f => f.status === 'complete').length }}</strong></div></article>
      <article><span class="stat-glyph green"><Send :size="22" /></span><div><small>我发送的</small><strong>{{ state.files.filter(f => f.status === 'complete' && f.senderId === identity.id).length }}</strong></div></article>
      <article><span class="stat-glyph orange"><Archive :size="22" /></span><div><small>占用空间</small><strong>{{ formatBytes(totalSize) }}</strong></div></article>
    </section>

    <section class="drop-zone" :class="{ active: dragging }" @click="input?.click()">
      <span class="upload-orbit"><UploadCloud :size="29" /></span><div><strong>将文件拖放到这里</strong><p>支持多文件并行、GB 级大文件和断点续传</p></div><button class="secondary-btn">选择文件</button>
    </section>

    <section v-if="Object.keys(state.transfers).length" class="active-transfers"><div class="section-head"><h2>传输任务</h2><small>关闭页面前请等待当前分片完成</small></div><TransferList /></section>

    <section class="library">
      <div class="library-tools">
        <div class="tabs"><button :class="{ active: tab === 'all' }" @click="tab = 'all'">全部</button><button :class="{ active: tab === 'sent' }" @click="tab = 'sent'">已发送</button><button :class="{ active: tab === 'received' }" @click="tab = 'received'">已接收</button></div>
        <button v-if="selected.length" class="secondary-btn zip-button" @click="downloadSelected"><Archive :size="14" />打包下载 {{ selected.length }} 项</button>
        <select v-model="category" class="category-select"><option value="all">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option><option value="document">文档</option><option value="archive">压缩包</option></select>
        <label class="search-box"><Search :size="16" /><input v-model="search" placeholder="搜索文件名" /></label>
      </div>
      <div class="file-table">
        <div class="file-row table-head"><span>文件</span><span>来源</span><span>大小</span><span>时间</span><span /></div>
        <div v-for="file in visible" :key="file.id" class="file-row">
          <div class="file-name"><input v-model="selected" class="file-check" type="checkbox" :value="file.id" :aria-label="`选择 ${file.originalName}`" /><button v-if="fileKind(file.originalName, file.mime) === 'image'" class="type-icon image preview-thumb" title="查看大图" @click="previewImage = file"><Image :size="20" /></button><span v-else class="type-icon" :class="fileKind(file.originalName, file.mime)"><component :is="icon(file)" :size="20" /></span><div><button v-if="fileKind(file.originalName, file.mime) === 'image'" class="file-title preview-title" :title="`查看 ${file.originalName}`" @click="previewImage = file">{{ file.originalName }}</button><strong v-else :title="file.originalName">{{ file.originalName }}</strong><small>{{ file.mime || '未知类型' }}</small><button v-if="file.sha256" class="checksum" :title="file.sha256" @click="copyChecksum(file)"><ShieldCheck :size="11" />SHA-256 {{ file.sha256.slice(0, 10) }}… <Copy :size="10" /></button></div></div>
          <div class="source"><UserAvatar :name="file.senderId === identity.id ? identity.nickname : '局域网用户'" :size="28" /><span>{{ file.senderId === identity.id ? '我' : '其他设备' }}</span></div>
          <span class="muted">{{ formatBytes(file.size) }}</span><span class="muted">{{ formatTime(file.completedAt || file.createdAt) }}</span>
          <div class="row-actions"><a class="icon-btn tiny" title="下载" :href="downloadUrl(file.id, identity.id)"><Download :size="15" /></a><button class="icon-btn tiny" title="分享" @click="openShare(file)"><Link2 :size="15" /></button><button v-if="file.senderId === identity.id" class="icon-btn tiny" @click="menu = menu === file.id ? '' : file.id"><MoreHorizontal :size="16" /></button><div v-if="menu === file.id && file.senderId === identity.id" class="context-menu"><button @click="destroy(file)"><Trash2 :size="14" /> 删除文件</button></div></div>
        </div>
        <div v-if="!visible.length" class="empty-files"><span><File :size="28" /></span><strong>{{ search ? '没有匹配的文件' : '还没有共享文件' }}</strong><p>上传一个文件，局域网内的设备即可下载。</p></div>
      </div>
    </section>

    <div v-if="dragging" class="drop-overlay"><UploadCloud :size="40" /><strong>松开开始传输</strong></div>
    <div v-if="share" class="modal-backdrop" @click.self="share = null"><section class="modal share-modal"><button class="modal-close" @click="share = null"><X :size="18" /></button><span class="modal-icon"><Link2 :size="23" /></span><h2>文件分享链接</h2><p>链接仅在局域网内生效，可随时撤销并限制下载次数。</p><img :src="share.qr" alt="文件分享二维码" /><strong class="share-name">{{ share.file.originalName }}</strong><div class="share-url"><input readonly :value="share.url" /><button @click="copyShare">复制</button></div><div class="share-options"><label><span>有效小时</span><input v-model.number="shareHours" type="number" min="1" :max="(state.bootstrap?.shareMaxDays || 7) * 24" /></label><label><span>下载上限（0 不限）</span><input v-model.number="shareMaxDownloads" type="number" min="0" max="10000" /></label><button class="secondary-btn" @click="openShare(share.file)">重新生成</button></div><div class="share-history"><article v-for="item in shares" :key="item.id"><span><strong>{{ item.revokedAt ? '已撤销' : item.expiresAt < Date.now() ? '已过期' : '有效链接' }}</strong><small>{{ item.downloadCount }} / {{ item.maxDownloads || '∞' }} 次下载</small></span><button v-if="!item.revokedAt && item.expiresAt >= Date.now()" @click="revokeShare(item)"><Ban :size="13" />撤销</button></article></div></section></div>
    <div v-if="previewImage" class="image-preview" role="dialog" aria-modal="true" :aria-label="previewImage.originalName" @click.self="previewImage = null"><header><strong>{{ previewImage.originalName }}</strong><span>{{ formatBytes(previewImage.size) }}</span><a :href="downloadUrl(previewImage.id, identity.id)" title="下载原图"><Download :size="18" />下载</a><button title="关闭预览" @click="previewImage = null"><X :size="22" /></button></header><img :src="downloadUrl(previewImage.id, identity.id)" :alt="previewImage.originalName" @click.stop /></div>
  </div>
</template>

<style scoped>
.files-page { padding: 36px 42px 70px; }.page-heading { display: flex; justify-content: space-between; align-items: end; }.page-heading h1 { font-size: 29px; margin: 7px 0 4px; letter-spacing: -.04em; }.page-heading p { margin: 0; color: var(--muted); }.eyebrow { color: var(--primary); font-size: 11px; font-weight: 700; }
.file-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 13px; margin: 25px 0 17px; }.file-stats article { background: var(--surface); border: 1px solid var(--border); border-radius: 17px; padding: 15px 18px; display: flex; align-items: center; gap: 13px; }.file-stats article > div { display: grid; }.file-stats small { color: var(--muted); font-size: 10px; }.file-stats strong { font-size: 19px; margin-top: 2px; }.stat-glyph { width: 42px; height: 42px; border-radius: 13px; display: grid; place-items: center; }.stat-glyph.purple { color: var(--primary); background: var(--purple-soft); }.stat-glyph.green { color: var(--success); background: #e6f8f3; }.stat-glyph.orange { color: #e67e22; background: #fff0df; }
.drop-zone { border: 1.5px dashed #c9c1e9; background: linear-gradient(100deg,#f7f4ff,#fcfbff); border-radius: 19px; padding: 19px 22px; display: flex; align-items: center; gap: 14px; cursor: pointer; transition: .2s; }.drop-zone:hover,.drop-zone.active { border-color: var(--primary); background: var(--purple-soft); }.upload-orbit { width: 49px; height: 49px; border-radius: 16px; display: grid; place-items: center; color: var(--primary); background: white; box-shadow: 0 5px 13px rgba(60,45,115,.08); }.drop-zone > div { flex: 1; display: grid; }.drop-zone strong { font-size: 13px; }.drop-zone p { margin: 4px 0 0; color: var(--muted); font-size: 10px; }
.active-transfers { margin-top: 25px; }.section-head { display: flex; align-items: end; justify-content: space-between; margin-bottom: 10px; }.section-head h2 { font-size: 16px; margin: 0; }.section-head small { color: var(--muted); }.active-transfers :deep(.transfer-list) { grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); }
.library { margin-top: 28px; }.library-tools { display: flex; justify-content: space-between; align-items: center; margin-bottom: 11px; }.tabs { background: #eeecf1; padding: 3px; border-radius: 10px; display: flex; }.tabs button { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 10px; padding: 7px 14px; border-radius: 8px; cursor: pointer; }.tabs button.active { background: white; color: var(--text); font-weight: 700; box-shadow: 0 2px 6px rgba(30,20,50,.08); }.search-box { width: 215px; height: 35px; background: white; border: 1px solid var(--border); border-radius: 10px; display: flex; align-items: center; gap: 8px; padding: 0 10px; color: var(--muted); }.search-box input { min-width: 0; width: 100%; border: 0; outline: 0; font: inherit; font-size: 10px; }
.file-table { border: 1px solid var(--border); border-radius: 16px; background: var(--surface); overflow: visible; }.file-row { display: grid; grid-template-columns: minmax(230px, 2fr) minmax(120px,1fr) 100px 130px 100px; min-height: 63px; padding: 0 16px; align-items: center; border-bottom: 1px solid var(--border); gap: 10px; }.file-row:last-child { border-bottom: 0; }.file-row.table-head { min-height: 36px; background: #faf9fb; color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .06em; border-radius: 16px 16px 0 0; }.file-name { display: flex; align-items: center; gap: 10px; min-width: 0; }.file-name > div { min-width: 0; display: grid; }.file-name strong { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.file-name small { color: var(--muted); font-size: 8px; margin-top: 2px; }.type-icon { width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; color: var(--primary); background: var(--purple-soft); }.type-icon.image { color: #e84393; background: #ffe9f3; }.type-icon.video { color: #d35400; background: #fff0e6; }.type-icon.audio { color: #008d73; background: #e5f8f3; }.type-icon.archive { color: #a36b00; background: #fff5d9; }.source { display: flex; align-items: center; gap: 7px; font-size: 10px; }.muted { color: var(--muted); font-size: 10px; }.row-actions { display: flex; justify-content: flex-end; gap: 3px; position: relative; }.row-actions a { text-decoration: none; }.context-menu { position: absolute; z-index: 5; right: 0; top: 35px; background: white; border: 1px solid var(--border); box-shadow: var(--shadow); border-radius: 10px; padding: 5px; width: 120px; }.context-menu button { border: 0; background: transparent; color: var(--danger); width: 100%; padding: 7px; font: inherit; font-size: 10px; display: flex; gap: 7px; border-radius: 7px; cursor: pointer; }.context-menu button:hover { background: #fff0f1; }
.empty-files { padding: 48px; display: grid; justify-items: center; color: var(--muted); }.empty-files > span { width: 55px; height: 55px; border-radius: 18px; background: var(--soft); display: grid; place-items: center; }.empty-files strong { color: var(--text); margin-top: 12px; }.empty-files p { font-size: 10px; margin: 4px 0; }
.drop-overlay { position: fixed; inset: 20px; z-index: 50; border: 2px dashed var(--primary); border-radius: 25px; background: rgba(247,245,255,.94); display: grid; place-content: center; justify-items: center; color: var(--primary); pointer-events: none; backdrop-filter: blur(8px); }.drop-overlay strong { color: var(--text); margin-top: 12px; font-size: 20px; }
.share-modal { text-align: center; width: min(390px, calc(100vw - 28px)); }.share-modal > img { width: 175px; margin: 14px auto 8px; display: block; }.share-name { display: block; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.share-url { display: flex; gap: 5px; margin-top: 15px; }.share-url input { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: 9px; padding: 9px; font: inherit; font-size: 9px; background: var(--soft); }.share-url button { border: 0; background: var(--primary); color: white; border-radius: 9px; padding: 0 14px; cursor: pointer; }
.heading-actions{display:flex;gap:8px}.category-select{border:1px solid var(--border);border-radius:10px;padding:8px;background:var(--surface);color:var(--text);font:inherit;font-size:10px}.zip-button{white-space:nowrap}.file-check{accent-color:var(--primary);flex:0 0 auto}.checksum{display:flex;align-items:center;gap:3px;border:0;background:transparent;color:var(--success);font-size:7px;padding:2px 0;cursor:pointer}.share-options{display:grid;grid-template-columns:1fr 1fr auto;gap:7px;align-items:end;margin-top:12px;text-align:left}.share-options label{display:grid;gap:4px}.share-options span{font-size:8px;color:var(--muted)}.share-options input{width:100%;border:1px solid var(--border);border-radius:8px;padding:7px;color:var(--text);background:var(--surface)}.share-history{display:grid;gap:5px;max-height:130px;overflow:auto;margin-top:12px}.share-history article{display:flex;align-items:center;gap:8px;padding:7px;border-radius:9px;background:var(--soft);text-align:left}.share-history article>span{display:grid;flex:1}.share-history strong{font-size:9px}.share-history small{font-size:8px;color:var(--muted)}.share-history button{border:0;background:transparent;color:var(--danger);display:flex;gap:4px;cursor:pointer;font-size:8px}.tabs,.file-row.table-head{background:var(--soft)}.tabs button.active,.search-box,.context-menu{background:var(--surface)}
.preview-thumb{flex:0 0 auto;padding:0;border:0;cursor:zoom-in}.file-title{max-width:100%;padding:0;border:0;color:var(--text);background:transparent;text-align:left;font:inherit;font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-title{cursor:zoom-in}.image-preview{position:fixed;inset:0;z-index:100;padding:76px 24px 24px;display:grid;place-items:center;background:rgba(13,11,19,.94);backdrop-filter:blur(10px)}.image-preview>header{position:absolute;top:0;left:0;right:0;min-height:62px;padding:10px 20px;display:flex;align-items:center;gap:12px;color:#fff;background:rgba(22,19,31,.88)}.image-preview>header strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.image-preview>header span{color:#aaa4b7;font-size:10px}.image-preview>header a,.image-preview>header button{border:0;border-radius:10px;padding:8px 10px;display:flex;align-items:center;gap:5px;color:#fff;background:rgba(255,255,255,.1);text-decoration:none;cursor:pointer}.image-preview>header a{margin-left:auto}.image-preview>img{display:block;max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 18px 70px rgba(0,0,0,.5)}
@media(max-width: 850px) { .files-page { padding: 24px 16px 92px; }.file-stats { grid-template-columns: 1fr 1fr 1fr; }.file-stats article { padding: 11px; }.stat-glyph { width: 35px; height: 35px; }.file-stats strong { font-size: 14px; }.drop-zone { padding: 15px; }.drop-zone .secondary-btn { display: none; }.file-row { grid-template-columns: minmax(160px,1fr) 72px 80px; }.file-row > :nth-child(2),.file-row > :nth-child(4) { display: none; }.library-tools { gap: 10px; }.search-box { flex: 1; min-width: 100px; }.tabs button { padding: 7px 9px; } }
@media(max-width: 520px) { .heading-actions { display: none; }.file-stats { grid-template-columns: 1fr; gap: 7px; }.file-stats article { padding: 9px 12px; }.file-stats article > div { display: flex; justify-content: space-between; flex: 1; align-items: center; }.drop-zone p { max-width: 210px; }.file-row { padding: 0 9px; grid-template-columns: minmax(140px,1fr) 62px 70px; }.row-actions .icon-btn:nth-child(2) { display: none; }.category-select{display:none}.share-options{grid-template-columns:1fr 1fr}.share-options .secondary-btn{grid-column:1/-1} }
</style>
