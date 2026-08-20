<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Clock3, Files, Home, LoaderCircle, LockKeyhole, MessageCircle, Settings, ShieldCheck, WifiOff, X } from 'lucide-vue-next'
import UserAvatar from './components/UserAvatar.vue'
import { bootstrap, dismissNotice, identity, login, selectRoom, setCurrentPage, state } from './state'
import type { AppNotice } from './types'
import ChatView from './views/ChatView.vue'
import FilesView from './views/FilesView.vue'
import HomeView from './views/HomeView.vue'
import SettingsView from './views/SettingsView.vue'

const pages = { home: HomeView, chat: ChatView, files: FilesView, settings: SettingsView }
type Page = keyof typeof pages
const initial = location.hash.slice(1) as Page
const page = ref<Page>(pages[initial] ? initial : 'home')
const password = ref('')
const loggingIn = ref(false)
const current = computed(() => pages[page.value])
const unreadTotal = computed(() => Object.values(state.unread).reduce((sum, value) => sum + value, 0))
const nav = [
  { id: 'home' as const, label: '首页', icon: Home },
  { id: 'chat' as const, label: '消息', icon: MessageCircle },
  { id: 'files' as const, label: '文件', icon: Files },
  { id: 'settings' as const, label: '设置', icon: Settings }
]
function navigate(value: string) { if (value in pages) { page.value = value as Page; location.hash = value } }
async function authenticate() { if (!password.value) return; loggingIn.value = true; try { await login(password.value); password.value = '' } catch { /* state contains error */ } finally { loggingIn.value = false } }
async function openNotice(notice: AppNotice) { dismissNotice(notice.id); await selectRoom(notice.roomId); navigate('chat') }
function syncVisibility() { setCurrentPage(page.value) }
watch(page, (value) => setCurrentPage(value), { immediate: true })
onMounted(() => { void bootstrap(); document.addEventListener('visibilitychange', syncVisibility) })
onBeforeUnmount(() => document.removeEventListener('visibilitychange', syncVisibility))
</script>

<template>
  <div v-if="state.loading && !state.ready" class="splash"><div class="splash-logo"><span>LC</span><i /></div><LoaderCircle class="spin" :size="21" /><p>正在连接局域网服务…</p></div>
  <div v-else-if="state.error && !state.bootstrap" class="fatal"><span><WifiOff :size="32" /></span><h1>无法连接 LoadChat</h1><p>{{ state.error }}</p><button class="primary-btn" @click="bootstrap">重新连接</button></div>
  <main v-else-if="state.bootstrap && !state.authenticated" class="auth-page">
    <section class="auth-card"><div class="auth-brand"><span class="brand-mark">LC</span><strong>LoadChat</strong></div><span class="auth-icon"><LockKeyhole :size="26" /></span><h1>欢迎回来</h1><p>「{{ state.bootstrap.serverName }}」已启用访问保护。请输入局域网管理员提供的密码。</p><form @submit.prevent="authenticate"><label><span>访问密码</span><input v-model="password" type="password" autofocus placeholder="输入访问密码" autocomplete="current-password" /></label><small v-if="state.authError">{{ state.authError }}</small><button class="primary-btn full" :disabled="loggingIn || !password"><LoaderCircle v-if="loggingIn" class="spin" :size="17" /><ShieldCheck v-else :size="17" />进入 LoadChat</button></form><div class="auth-foot"><ShieldCheck :size="14" /> 连接仅在当前局域网内建立</div></section>
  </main>
  <main v-else-if="state.pendingApproval" class="auth-page">
    <section class="auth-card"><div class="auth-brand"><span class="brand-mark">LC</span><strong>LoadChat</strong></div><span class="auth-icon"><Clock3 :size="26" /></span><h1>等待设备批准</h1><p>管理员已开启新设备审批。请让管理员在服务端本机的“设置 → 设备管理”中批准「{{ identity.nickname }}」。</p><div class="auth-foot"><ShieldCheck :size="14" /> 批准后本页面会自动进入</div></section>
  </main>
  <div v-else class="app-shell">
    <aside class="app-sidebar">
      <button class="logo" title="LoadChat" @click="navigate('home')"><span>LC</span><i /></button>
      <nav><button v-for="item in nav" :key="item.id" :class="{ active: page === item.id }" :title="item.label" @click="navigate(item.id)"><component :is="item.icon" :size="20" /><span>{{ item.label }}</span><b v-if="item.id === 'chat' && unreadTotal">{{ Math.min(99, unreadTotal) }}</b></button></nav>
      <div class="sidebar-user" :title="state.connectionState === 'online' ? '实时在线' : state.connectionState === 'connecting' ? '正在连接' : '连接已断开'"><UserAvatar :name="identity.nickname" :src="identity.avatar" :size="38" :status="state.connectionState" /><span>{{ identity.nickname }}</span></div>
    </aside>
    <section class="app-content"><component :is="current" @navigate="navigate" /></section>
    <nav class="mobile-nav"><button v-for="item in nav" :key="item.id" :class="{ active: page === item.id }" @click="navigate(item.id)"><component :is="item.icon" :size="20" /><span>{{ item.label }}</span><b v-if="item.id === 'chat' && unreadTotal" /></button></nav>
    <div class="notice-stack" aria-live="polite">
      <article v-for="notice in state.notices" :key="notice.id" class="message-notice">
        <button class="notice-content" @click="openNotice(notice)"><UserAvatar :name="notice.senderName" :size="38" :online="true" /><span><small>新消息</small><strong>{{ notice.senderName }}</strong><p>{{ notice.preview }}</p></span></button>
        <button class="notice-close" title="关闭" @click="dismissNotice(notice.id)"><X :size="14" /></button>
      </article>
    </div>
  </div>
</template>
