<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Activity, Bell, Check, ChevronRight, Database, Download, HardDrive, KeyRound, Laptop, Lock, Network, RefreshCw, Save, Server, ShieldCheck, ShieldPlus, SunMoon, Upload, UserCheck, UserRound, UserX } from 'lucide-vue-next'
import { api, setAdminToken } from '../api'
import UserAvatar from '../components/UserAvatar.vue'
import { applyTheme, locale, setLocale, theme, type LocalePreference, type ThemePreference } from '../preferences'
import { identity, loadStatus, requestNotifications, saveProfile, state } from '../state'
import type { AuditEntry, BackupInfo, ManagedDevice } from '../types'
import { formatBytes, formatDuration } from '../utils'

const GiB = 1024 * 1024 * 1024
const form = reactive({
  serverName: '', port: 3210, storagePath: '', retentionDays: 30, allowedCidrs: '',
  newPassword: '', clearPassword: false, newAdminPassword: '', requireDeviceApproval: false,
  maxFileSizeGb: 50, maxStorageSizeGb: 200, minFreeSpaceGb: 1, maxDailyUploadGb: 100,
  maxConcurrentUploads: 4, shareMaxDays: 7, backupEnabled: true, backupRetention: 7,
  logRetentionDays: 14, mdnsEnabled: true
})
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const restart = ref(false)
const avatarInput = ref<HTMLInputElement>()
const restoreInput = ref<HTMLInputElement>()
const adminReady = ref(false)
const adminError = ref('')
const adminPassword = ref('')
const adminBusy = ref(false)
const managedDevices = ref<ManagedDevice[]>([])
const backups = ref<BackupInfo[]>([])
const auditLogs = ref<AuditEntry[]>([])
const backupBusy = ref(false)
const currentOrigin = window.location.origin
const pendingDevices = computed(() => managedDevices.value.filter((device) => !device.approved && !device.blocked))

function assignConfig(config: any) {
  Object.assign(form, {
    serverName: config.serverName, port: config.port, storagePath: config.storagePath,
    retentionDays: config.retentionDays, allowedCidrs: config.allowedCidrs.join('\n'),
    requireDeviceApproval: config.requireDeviceApproval, maxFileSizeGb: config.maxFileSize / GiB,
    maxStorageSizeGb: config.maxStorageSize / GiB, minFreeSpaceGb: config.minFreeSpace / GiB,
    maxDailyUploadGb: config.maxDailyUploadBytes / GiB, maxConcurrentUploads: config.maxConcurrentUploads,
    shareMaxDays: config.shareMaxDays, backupEnabled: config.backupEnabled,
    backupRetention: config.backupRetention, logRetentionDays: config.logRetentionDays,
    mdnsEnabled: config.mdnsEnabled
  })
}

async function loadAdmin() {
  try {
    const config = await api<any>('/api/admin/settings')
    assignConfig(config); adminReady.value = true; adminError.value = ''
    const [devices, backupList, status, audit] = await Promise.all([
      api<ManagedDevice[]>('/api/admin/devices'), api<BackupInfo[]>('/api/admin/backups'), api<any>('/api/admin/status'), api<AuditEntry[]>('/api/admin/audit')
    ])
    managedDevices.value = devices; backups.value = backupList; state.status = status; auditLogs.value = audit.slice(0, 50)
  } catch (value) {
    adminReady.value = false
    adminError.value = value instanceof Error ? value.message : '需要管理员验证'
  }
}

onMounted(() => {
  if (state.bootstrap) assignConfig(state.bootstrap)
  void loadStatus(); void loadAdmin()
})

async function unlockAdmin() {
  if (adminPassword.value.length < (state.bootstrap?.adminPasswordEnabled ? 1 : 10)) return
  adminBusy.value = true; adminError.value = ''
  try {
    const path = state.bootstrap?.adminPasswordEnabled ? '/api/admin/auth' : '/api/admin/setup'
    const result = await api<{ token: string }>(path, { method: 'POST', body: JSON.stringify({ password: adminPassword.value }) })
    setAdminToken(result.token); adminPassword.value = ''
    if (state.bootstrap) { state.bootstrap.adminPasswordEnabled = true; state.bootstrap.adminLocalSetup = false }
    await loadAdmin()
  } catch (value) { adminError.value = value instanceof Error ? value.message : '管理员验证失败' }
  finally { adminBusy.value = false }
}

async function saveAll() {
  saving.value = true; error.value = ''; saved.value = false
  try {
    identity.nickname = identity.nickname.trim() || '局域网用户'; saveProfile()
    if (adminReady.value) {
      const result = await api<any>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({
        serverName: form.serverName, port: Number(form.port), storagePath: form.storagePath,
        retentionDays: Number(form.retentionDays), allowedCidrs: form.allowedCidrs.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
        newPassword: form.newPassword || undefined, clearPassword: form.clearPassword,
        newAdminPassword: form.newAdminPassword || undefined, requireDeviceApproval: form.requireDeviceApproval,
        maxFileSize: Math.round(form.maxFileSizeGb * GiB), maxStorageSize: Math.round(form.maxStorageSizeGb * GiB),
        minFreeSpace: Math.round(form.minFreeSpaceGb * GiB), maxDailyUploadBytes: Math.round(form.maxDailyUploadGb * GiB),
        maxConcurrentUploads: Number(form.maxConcurrentUploads), shareMaxDays: Number(form.shareMaxDays),
        backupEnabled: form.backupEnabled, backupRetention: Number(form.backupRetention),
        logRetentionDays: Number(form.logRetentionDays), mdnsEnabled: form.mdnsEnabled
      }) })
      restart.value = result.restartRequired
      if (state.bootstrap) Object.assign(state.bootstrap, result)
    }
    saved.value = true; form.newPassword = ''; form.newAdminPassword = ''; form.clearPassword = false
    window.setTimeout(() => { saved.value = false }, 2200)
  } catch (value) { error.value = value instanceof Error ? value.message : '保存失败' }
  finally { saving.value = false }
}

async function deviceAction(device: ManagedDevice, action: 'approve' | 'block') {
  await api(`/api/admin/devices/${encodeURIComponent(device.id)}`, { method: 'PATCH', body: JSON.stringify({ action }) })
  await loadAdmin()
}

async function makeBackup() {
  backupBusy.value = true; error.value = ''
  try { await api('/api/admin/backups', { method: 'POST' }); backups.value = await api('/api/admin/backups') }
  catch (value) { error.value = value instanceof Error ? value.message : '备份失败' }
  finally { backupBusy.value = false }
}

async function downloadBackup(name: string) {
  try {
    const result = await api<{ path: string }>(`/api/admin/backups/${encodeURIComponent(name)}/download-link`, { method: 'POST' })
    const link = document.createElement('a'); link.href = result.path; link.download = name; link.click()
  } catch (value) { error.value = value instanceof Error ? value.message : '下载备份失败' }
}

async function restoreBackup(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !confirm('恢复将在下次重启时替换当前数据库，系统会自动保留恢复前备份。是否继续？')) return
  backupBusy.value = true; error.value = ''
  try {
    await api('/api/admin/backups/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
    restart.value = true
  } catch (value) { error.value = value instanceof Error ? value.message : '恢复失败' }
  finally { backupBusy.value = false; (event.target as HTMLInputElement).value = '' }
}

function avatarPicked(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return
  const image = new Image(); image.onload = () => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128
    const context = canvas.getContext('2d')!; const side = Math.min(image.width, image.height)
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 128, 128)
    identity.avatar = canvas.toDataURL('image/jpeg', .76); saveProfile(); URL.revokeObjectURL(image.src)
  }
  image.src = URL.createObjectURL(file)
}
</script>

<template>
  <div class="page-scroll settings-page">
    <header class="page-heading"><div><span class="eyebrow">控制中心 · Control center</span><h1>设置</h1><p>管理身份、存储、安全策略和本地备份。</p></div><button class="primary-btn" :disabled="saving" @click="saveAll"><component :is="saved ? Check : Save" :size="17" />{{ saved ? '已保存' : saving ? '保存中' : '保存更改' }}</button></header>
    <div v-if="error || restart" class="notice" :class="{ error }"><RefreshCw :size="17" /><span>{{ error || '配置或数据库恢复已更新，请重启 LoadChat 后完全生效。' }}</span></div>

    <div class="settings-grid">
      <main class="settings-main">
        <section class="settings-card">
          <div class="card-title"><span class="setting-icon purple"><UserRound :size="19" /></span><div><h2>个人资料</h2><p>其他局域网设备看到的身份信息</p></div></div>
          <div class="profile-editor"><button class="avatar-edit" @click="avatarInput?.click()"><UserAvatar :name="identity.nickname" :src="identity.avatar" :size="68" /><i>更换</i></button><input ref="avatarInput" hidden type="file" accept="image/*" @change="avatarPicked" /><div class="profile-fields"><label class="field"><span>昵称</span><input v-model="identity.nickname" maxlength="30" /></label><label class="field"><span>设备说明</span><input v-model="identity.deviceName" maxlength="60" /></label></div></div>
        </section>

        <section class="settings-card compact-card">
          <div class="card-title"><span class="setting-icon orange"><SunMoon :size="19" /></span><div><h2>外观与语言</h2><p>界面会记住当前浏览器的偏好</p></div></div>
          <div class="form-grid"><label class="field"><span>主题</span><select :value="theme" @change="applyTheme(($event.target as HTMLSelectElement).value as ThemePreference)"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label class="field"><span>语言</span><select :value="locale" @change="setLocale(($event.target as HTMLSelectElement).value as LocalePreference)"><option value="zh-CN">简体中文</option><option value="en">English（逐步完善）</option></select></label></div>
        </section>

        <section v-if="!adminReady" class="settings-card admin-lock">
          <div class="card-title"><span class="setting-icon green"><ShieldPlus :size="19" /></span><div><h2>{{ state.bootstrap?.adminPasswordEnabled ? '管理员验证' : '设置管理员密码' }}</h2><p>服务器配置、设备审批和备份仅管理员可用</p></div></div>
          <form class="unlock-row" @submit.prevent="unlockAdmin"><label class="field"><span>{{ state.bootstrap?.adminPasswordEnabled ? '管理员密码' : '新管理员密码（至少 10 位）' }}</span><input v-model="adminPassword" type="password" autocomplete="current-password" /></label><button class="primary-btn" :disabled="adminBusy">{{ adminBusy ? '验证中' : '解锁管理' }}</button></form><small class="error-text">{{ adminError }}</small>
        </section>

        <template v-else>
          <section class="settings-card">
            <div class="card-title"><span class="setting-icon blue"><Server :size="19" /></span><div><h2>服务器与容量</h2><p>服务地址、文件位置和磁盘保护</p></div></div>
            <div class="form-grid"><label class="field"><span>服务名称</span><input v-model="form.serverName" /></label><label class="field"><span>端口</span><input v-model.number="form.port" type="number" min="1024" max="65535" /></label><label class="field wide"><span>文件存储路径</span><div class="input-icon"><HardDrive :size="16" /><input v-model="form.storagePath" /></div></label><label class="field"><span>历史保留天数</span><input v-model.number="form.retentionDays" type="number" min="0" max="3650" /></label><label class="field"><span>单文件上限（GiB）</span><input v-model.number="form.maxFileSizeGb" type="number" min="0.001" /></label><label class="field"><span>总存储配额（GiB）</span><input v-model.number="form.maxStorageSizeGb" type="number" min="0.001" /></label><label class="field"><span>最低剩余空间（GiB）</span><input v-model.number="form.minFreeSpaceGb" type="number" min="0" /></label><label class="field"><span>单设备 24h 上传额度（GiB）</span><input v-model.number="form.maxDailyUploadGb" type="number" min="0.001" /></label><label class="field"><span>单设备并发文件数</span><input v-model.number="form.maxConcurrentUploads" type="number" min="1" max="32" /></label><label class="field"><span>分享最长有效期（天）</span><input v-model.number="form.shareMaxDays" type="number" min="1" max="365" /></label></div>
          </section>

          <section class="settings-card">
            <div class="card-title"><span class="setting-icon green"><ShieldCheck :size="19" /></span><div><h2>安全与访问</h2><p>访问密码、管理员和可信设备策略</p></div></div>
            <div class="form-grid"><label class="field"><span>{{ state.bootstrap?.passwordEnabled ? '设置新访问密码' : '启用访问密码' }}</span><div class="input-icon"><KeyRound :size="16" /><input v-model="form.newPassword" type="password" minlength="8" placeholder="至少 8 位" /></div></label><label class="field"><span>修改管理员密码</span><input v-model="form.newAdminPassword" type="password" minlength="10" placeholder="至少 10 位" /></label><label class="toggle-field"><span><strong>关闭访问密码</strong><small>管理员密码不会被关闭</small></span><input v-model="form.clearPassword" type="checkbox" /><i /></label><label class="toggle-field"><span><strong>新设备加入审批</strong><small>陌生设备需管理员批准</small></span><input v-model="form.requireDeviceApproval" type="checkbox" /><i /></label><label class="field wide"><span>允许访问的 IP 段（CIDR）</span><textarea v-model="form.allowedCidrs" rows="4" placeholder="留空默认允许常见私有网段；每行一个 CIDR" /></label><label class="toggle-field"><span><strong>mDNS 局域网发现</strong><small>发布 loadchat.local 服务</small></span><input v-model="form.mdnsEnabled" type="checkbox" /><i /></label></div>
          </section>

          <section class="settings-card">
            <div class="card-title"><span class="setting-icon purple"><Laptop :size="19" /></span><div><h2>设备管理 <b v-if="pendingDevices.length" class="count-badge">{{ pendingDevices.length }}</b></h2><p>批准可信设备或立即阻止访问</p></div></div>
            <div class="managed-list"><article v-for="device in managedDevices" :key="device.id"><UserAvatar :name="device.nickname" :src="device.avatar" :size="42" :online="device.online" /><span><strong>{{ device.nickname }}</strong><small>{{ device.deviceName }} · {{ device.ip }}</small></span><i :class="{ pending: !device.approved && !device.blocked, blocked: device.blocked }">{{ device.blocked ? '已阻止' : device.approved ? '已批准' : '待批准' }}</i><button v-if="!device.approved && !device.blocked" class="mini-action good" @click="deviceAction(device, 'approve')"><UserCheck :size="14" />批准</button><button v-if="!device.blocked && device.id !== identity.id" class="mini-action bad" @click="deviceAction(device, 'block')"><UserX :size="14" />阻止</button></article></div>
          </section>

          <section class="settings-card">
            <div class="card-title"><span class="setting-icon blue"><Database :size="19" /></span><div><h2>备份与恢复</h2><p>SQLite 一致性快照；恢复会在下次重启应用</p></div></div>
            <div class="backup-actions"><button class="secondary-btn" :disabled="backupBusy" @click="makeBackup"><Database :size="15" />立即备份</button><button class="secondary-btn" :disabled="backupBusy" @click="restoreInput?.click()"><Upload :size="15" />从备份恢复</button><input ref="restoreInput" hidden type="file" accept=".sqlite,.db" @change="restoreBackup" /><label class="toggle-field inline"><span><strong>每日自动备份</strong></span><input v-model="form.backupEnabled" type="checkbox" /><i /></label><label class="field tiny-field"><span>保留份数</span><input v-model.number="form.backupRetention" type="number" min="1" max="100" /></label></div>
            <div class="backup-list"><article v-for="backup in backups" :key="backup.name"><span><strong>{{ backup.name }}</strong><small>{{ formatBytes(backup.size) }} · {{ new Date(backup.createdAt).toLocaleString() }}</small></span><button class="icon-btn tiny" title="下载备份" @click="downloadBackup(backup.name)"><Download :size="14" /></button></article><p v-if="!backups.length">暂无备份</p></div>
          </section>

          <section class="settings-card">
            <div class="card-title"><span class="setting-icon orange"><Activity :size="19" /></span><div><h2>安全审计</h2><p>最近 50 条管理员、设备和分享操作</p></div></div>
            <div class="audit-list"><article v-for="entry in auditLogs" :key="entry.id"><span><strong>{{ entry.action }}</strong><small>{{ entry.actorId }}<template v-if="entry.target"> · {{ entry.target }}</template></small></span><span><small>{{ entry.ip }}</small><time>{{ new Date(entry.createdAt).toLocaleString() }}</time></span></article><p v-if="!auditLogs.length">暂无审计记录</p></div>
          </section>
        </template>
      </main>

      <aside class="settings-side">
        <section class="status-card dark"><div class="status-top"><span><Server :size="19" /></span><i>{{ state.connected ? '运行中' : '重连中' }}</i></div><h3>{{ form.serverName || state.bootstrap?.serverName }}</h3><p>{{ state.bootstrap?.addresses[0] || currentOrigin }}</p><div class="status-line"><span>在线设备</span><b>{{ state.status?.onlineUsers || 0 }}</b></div><div class="status-line"><span>运行时间</span><b>{{ formatDuration(state.status?.uptime || 0) }}</b></div><div class="status-line"><span>版本</span><b>v{{ state.bootstrap?.version }}</b></div></section>
        <section class="side-card"><h3><Database :size="17" /> 存储状态</h3><div class="disk-bar"><i :style="{ width: `${state.status?.disk.total ? (1 - state.status.disk.available / state.status.disk.total) * 100 : 0}%` }" /></div><div class="disk-label"><span>已用 {{ formatBytes((state.status?.disk.total || 0) - (state.status?.disk.available || 0)) }}</span><span>可用 {{ formatBytes(state.status?.disk.available || 0) }}</span></div><div class="side-stats"><span><small>文件</small><strong>{{ state.status?.totalFiles || 0 }}</strong></span><span><small>消息</small><strong>{{ state.status?.totalMessages || 0 }}</strong></span></div></section>
        <section class="side-card links"><button @click="requestNotifications"><span class="setting-icon orange"><Bell :size="17" /></span><div><strong>浏览器通知</strong><small>接收新消息提醒</small></div><ChevronRight :size="16" /></button><button><span class="setting-icon blue"><Network :size="17" /></span><div><strong>PWA 桌面应用</strong><small>浏览器菜单中选择“安装应用”</small></div><ChevronRight :size="16" /></button><button><span class="setting-icon green"><Lock :size="17" /></span><div><strong>本地数据</strong><small>SQLite + SHA-256 文件校验</small></div><ChevronRight :size="16" /></button></section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.settings-page{padding:36px 42px 70px}.page-heading{display:flex;justify-content:space-between;align-items:end;margin-bottom:24px}.page-heading h1{font-size:29px;margin:7px 0 4px;letter-spacing:-.04em}.page-heading p{margin:0;color:var(--muted)}.eyebrow{color:var(--primary);font-size:11px;font-weight:700}.notice{padding:11px 14px;display:flex;align-items:center;gap:9px;border-radius:11px;background:#fff7df;color:#8b6500;font-size:11px;margin-bottom:14px}.notice.error{background:#fff0f1;color:var(--danger)}.settings-grid{display:grid;grid-template-columns:minmax(520px,1fr) 285px;gap:18px;align-items:start}.settings-main,.settings-side{display:grid;gap:14px}.settings-card,.side-card{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:20px}.card-title{display:flex;align-items:center;gap:11px;padding-bottom:17px;border-bottom:1px solid var(--border);margin-bottom:18px}.card-title h2{font-size:14px;margin:0 0 3px}.card-title p{color:var(--muted);font-size:9px;margin:0}.setting-icon{width:37px;height:37px;display:grid;place-items:center;border-radius:12px;flex:0 0 auto}.purple{color:var(--primary);background:var(--purple-soft)}.blue{color:#2d78d2;background:#e8f2ff}.green{color:#009b78;background:#e5f8f2}.orange{color:#d87917;background:#fff1df}.profile-editor{display:flex;gap:22px;align-items:center}.avatar-edit{border:0;background:transparent;position:relative;cursor:pointer;padding:0}.avatar-edit i{position:absolute;bottom:-2px;left:50%;transform:translateX(-50%);background:#24202f;color:white;border-radius:7px;font-size:8px;padding:3px 7px;font-style:normal}.profile-fields{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:11px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px 14px}.field{display:grid;gap:6px}.field.wide{grid-column:1/-1}.field>span{font-size:10px;font-weight:700}.field input,.field textarea,.field select{width:100%;border:1px solid var(--border);border-radius:10px;padding:10px 11px;outline:0;font:inherit;color:var(--text);background:var(--surface);font-size:11px;resize:vertical}.field input:focus,.field textarea:focus,.field select:focus{border-color:#bdb4ee;box-shadow:0 0 0 3px rgba(108,92,231,.07)}.input-icon{position:relative}.input-icon svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted)}.input-icon input{padding-left:34px}.toggle-field{display:flex;align-items:center;justify-content:space-between;gap:10px;align-self:end;padding:8px 0;cursor:pointer}.toggle-field>span{display:grid}.toggle-field strong{font-size:10px}.toggle-field small,.managed-list small,.backup-list small{color:var(--muted);font-size:8px;margin-top:3px}.toggle-field input{display:none}.toggle-field i{width:37px;height:21px;border-radius:20px;background:#d9d6df;position:relative;transition:.2s;flex:0 0 auto}.toggle-field i:after{content:'';width:17px;height:17px;background:white;border-radius:50%;position:absolute;left:2px;top:2px;transition:.2s;box-shadow:0 1px 3px #999}.toggle-field input:checked+i{background:var(--primary)}.toggle-field input:checked+i:after{transform:translateX(16px)}.unlock-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end}.error-text{color:var(--danger);font-size:9px}.count-badge{background:var(--danger);color:#fff;border-radius:8px;padding:2px 6px;font-size:8px}.managed-list,.backup-list{display:grid;gap:8px}.managed-list article,.backup-list article{display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:12px;padding:10px}.managed-list article>span,.backup-list article>span{display:grid;min-width:0;flex:1}.managed-list strong,.backup-list strong{font-size:10px;overflow:hidden;text-overflow:ellipsis}.managed-list article>i{font-size:8px;font-style:normal;color:var(--success)}.managed-list article>i.pending{color:#c17a00}.managed-list article>i.blocked{color:var(--danger)}.mini-action{border:0;border-radius:8px;padding:6px 8px;font-size:8px;display:flex;align-items:center;gap:4px;cursor:pointer}.mini-action.good{background:#e5f8f2;color:#008c6d}.mini-action.bad{background:#fff0f1;color:var(--danger)}.backup-actions{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.toggle-field.inline{min-width:145px}.tiny-field{width:90px}.backup-list{margin-top:14px}.backup-list>p{text-align:center;color:var(--muted);font-size:10px}.status-card{border-radius:19px;padding:20px}.status-card.dark{color:white;background:linear-gradient(145deg,#1c1925,#30294e)}.status-top{display:flex;justify-content:space-between;align-items:center}.status-top>span{width:37px;height:37px;border-radius:12px;background:rgba(255,255,255,.1);display:grid;place-items:center}.status-top i{font-size:9px;font-style:normal;color:#77dfc3}.status-card h3{margin:16px 0 3px;font-size:16px}.status-card>p{color:#aaa4bd;font-size:9px;margin:0 0 18px;word-break:break-all}.status-line{display:flex;justify-content:space-between;font-size:9px;padding:7px 0;border-top:1px solid rgba(255,255,255,.08);color:#aaa5b7}.status-line b{color:white}.side-card h3{margin:0 0 15px;font-size:12px;display:flex;align-items:center;gap:7px}.disk-bar{height:6px;background:var(--soft);border-radius:6px;overflow:hidden}.disk-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--primary),#a596ff)}.disk-label{display:flex;justify-content:space-between;color:var(--muted);font-size:8px;margin-top:6px}.side-stats{border-top:1px solid var(--border);margin-top:15px;padding-top:13px;display:grid;grid-template-columns:1fr 1fr}.side-stats>span{display:grid}.side-stats small{color:var(--muted);font-size:8px}.links{padding:7px}.links button{display:flex;width:100%;align-items:center;gap:9px;border:0;background:transparent;border-radius:11px;padding:8px;text-align:left;cursor:pointer;color:var(--text)}.links button:hover{background:var(--soft)}.links button>div{display:grid;flex:1}.links strong{font-size:10px}.links small{color:var(--muted);font-size:8px}.links .setting-icon{width:33px;height:33px}.compact-card{padding-bottom:18px}.audit-list{display:grid;gap:7px;max-height:360px;overflow:auto}.audit-list article{display:flex;justify-content:space-between;gap:12px;padding:9px 10px;border:1px solid var(--border);border-radius:11px}.audit-list article>span{display:grid;min-width:0}.audit-list article>span:last-child{text-align:right}.audit-list strong{font-size:10px}.audit-list small,.audit-list time{font-size:8px;color:var(--muted)}.audit-list>p{text-align:center;color:var(--muted);font-size:10px}
@media(max-width:950px){.settings-grid{grid-template-columns:1fr}.settings-side{grid-template-columns:1fr 1fr}.settings-side .links{grid-column:1/-1}}@media(max-width:700px){.settings-page{padding:24px 16px 92px}.page-heading .primary-btn{position:fixed;z-index:30;right:16px;bottom:82px;border-radius:50%;width:48px;height:48px;padding:0;font-size:0}.profile-editor{align-items:flex-start}.profile-fields,.form-grid{grid-template-columns:1fr}.field.wide{grid-column:auto}.settings-side{grid-template-columns:1fr}.settings-side .links{grid-column:auto}.unlock-row{grid-template-columns:1fr}.managed-list article{flex-wrap:wrap}}
</style>
