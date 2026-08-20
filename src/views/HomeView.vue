<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { Check, ChevronRight, Copy, Laptop, MessageCircle, QrCode, Radio, Send, ShieldCheck, Smartphone, Wifi } from 'lucide-vue-next'
import UserAvatar from '../components/UserAvatar.vue'
import { identity, onlinePeers, selectRoom, state } from '../state'
import { copyText } from '../utils'

const emit = defineEmits<{ navigate: [page: string] }>()
const qr = ref('')
const copied = ref(false)
const accessAddress = computed(() => {
  if (!state.bootstrap) return location.origin
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return location.origin
  return state.bootstrap.primaryAddress
})

onMounted(async () => { qr.value = await QRCode.toDataURL(accessAddress.value, { width: 220, margin: 1, color: { dark: '#171522', light: '#ffffff' } }) })
async function copyAddress() {
  await copyText(accessAddress.value); copied.value = true
  window.setTimeout(() => { copied.value = false }, 1500)
}
async function chat(id: string) {
  const roomId = `dm:${[identity.id, id].sort().join(':')}`
  await selectRoom(roomId); emit('navigate', 'chat')
}
</script>

<template>
  <div class="page-scroll home-page">
    <header class="page-heading">
      <div><span class="eyebrow"><Radio :size="14" /> 局域网在线</span><h1>下午好，{{ identity.nickname }}</h1><p>所有消息和文件都留在你的局域网内。</p></div>
      <button class="primary-btn" @click="emit('navigate', 'chat')"><MessageCircle :size="18" /> 开始聊天</button>
    </header>

    <section class="hero-card">
      <div class="hero-copy">
        <span class="hero-label"><ShieldCheck :size="15" /> 私密连接已就绪</span>
        <h2>让身边的设备<br /><em>即刻连在一起。</em></h2>
        <p>无需账号、无需安装。让其他设备连接同一 Wi-Fi，打开下方地址即可加入。</p>
        <button class="address-pill" @click="copyAddress">
          <span><Wifi :size="17" />{{ accessAddress }}</span><b>{{ copied ? '已复制' : '复制' }} <component :is="copied ? Check : Copy" :size="14" /></b>
        </button>
      </div>
      <div class="qr-panel">
        <span class="qr-corner"><QrCode :size="18" /></span>
        <img v-if="qr" :src="qr" alt="局域网访问二维码" />
        <strong>手机扫码加入</strong><small>请确保连接同一 Wi-Fi</small>
      </div>
      <span class="hero-orb orb-one" /><span class="hero-orb orb-two" />
    </section>

    <section class="stat-row">
      <article><span class="stat-icon lavender"><Laptop :size="21" /></span><div><strong>{{ state.devices.length }}</strong><small>在线设备</small></div><i>实时</i></article>
      <article><span class="stat-icon mint"><Send :size="21" /></span><div><strong>{{ state.status?.totalFiles || 0 }}</strong><small>共享文件</small></div><i>本地</i></article>
      <article><span class="stat-icon blue"><MessageCircle :size="21" /></span><div><strong>{{ state.status?.totalMessages || 0 }}</strong><small>历史消息</small></div><i>{{ state.bootstrap?.retentionDays }} 天</i></article>
    </section>

    <section class="devices-section">
      <div class="section-title"><div><h2>附近设备</h2><p>已经访问此服务的在线浏览器设备</p></div><span>{{ onlinePeers.length }} 台可连接</span></div>
      <div v-if="onlinePeers.length" class="device-grid">
        <button v-for="device in onlinePeers" :key="device.id" class="device-card" @click="chat(device.id)">
          <UserAvatar :name="device.nickname" :src="device.avatar" :size="52" :online="true" />
          <span class="device-info"><strong>{{ device.nickname }}</strong><small><component :is="device.deviceName.includes('移动') ? Smartphone : Laptop" :size="13" />{{ device.deviceName }}</small><code>{{ device.ip }}</code></span>
          <span class="go"><ChevronRight :size="18" /></span>
        </button>
      </div>
      <div v-else class="empty-devices"><span><Wifi :size="30" /></span><div><strong>等待其他设备加入</strong><p>在另一台设备打开 {{ accessAddress }}</p></div></div>
    </section>
  </div>
</template>

<style scoped>
.home-page { padding: 38px 42px 70px; }
.page-heading { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 26px; }
.page-heading h1 { font-size: 30px; letter-spacing: -.04em; margin: 8px 0 4px; }
.page-heading p { color: var(--muted); margin: 0; }
.eyebrow { color: var(--success); display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; }
.hero-card { min-height: 270px; border-radius: 28px; background: linear-gradient(125deg, #171522 0%, #292346 62%, #41377b 100%); color: white; display: flex; align-items: center; justify-content: space-between; padding: 38px 52px; position: relative; overflow: hidden; box-shadow: 0 18px 44px rgba(33,28,68,.16); }
.hero-copy { max-width: 600px; position: relative; z-index: 2; }
.hero-label { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.08); padding: 6px 10px; border-radius: 20px; font-size: 11px; }
.hero-copy h2 { font-size: clamp(31px, 4vw, 48px); line-height: 1.05; letter-spacing: -.055em; margin: 20px 0 14px; }
.hero-copy h2 em { font-style: normal; color: #aaa0ff; }
.hero-copy p { color: #c2bdd4; max-width: 500px; font-size: 14px; }
.address-pill { border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.09); color: white; border-radius: 12px; display: flex; align-items: center; gap: 24px; padding: 10px 12px; margin-top: 22px; cursor: pointer; max-width: 100%; }
.address-pill span, .address-pill b { display: flex; align-items: center; gap: 8px; }
.address-pill span { font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; }
.address-pill b { background: white; color: #28233f; padding: 6px 9px; border-radius: 7px; font-size: 11px; white-space: nowrap; }
.qr-panel { width: 180px; background: white; color: var(--text); border-radius: 20px; padding: 16px; text-align: center; z-index: 2; box-shadow: 0 16px 30px rgba(0,0,0,.22); transform: rotate(1.5deg); position: relative; }
.qr-panel img { width: 148px; display: block; }
.qr-panel strong { font-size: 12px; display: block; }.qr-panel small { color: var(--muted); font-size: 9px; }
.qr-corner { position: absolute; right: -9px; top: -10px; width: 32px; height: 32px; border-radius: 10px; background: var(--primary); color: white; display: grid; place-items: center; }
.hero-orb { position: absolute; border-radius: 50%; filter: blur(2px); opacity: .2; border: 1px solid #9f94f6; }.orb-one { width: 250px; height: 250px; right: -80px; top: -90px; }.orb-two { width: 140px; height: 140px; right: 190px; bottom: -100px; }
.stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 20px 0 34px; }
.stat-row article { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 17px 18px; display: flex; align-items: center; gap: 13px; }
.stat-row article > div { display: grid; flex: 1; }.stat-row strong { font-size: 20px; }.stat-row small { color: var(--muted); }.stat-row i { color: var(--muted); font-size: 10px; font-style: normal; background: var(--soft); padding: 4px 7px; border-radius: 8px; }
.stat-icon { width: 42px; height: 42px; border-radius: 13px; display: grid; place-items: center; }.lavender { color: var(--primary); background: var(--purple-soft); }.mint { color: #009b7a; background: #e0f8f2; }.blue { color: #267ddd; background: #e5f1ff; }
.section-title { display: flex; justify-content: space-between; align-items: end; margin-bottom: 15px; }.section-title h2 { margin: 0 0 3px; font-size: 19px; }.section-title p { margin: 0; color: var(--muted); font-size: 12px; }.section-title > span { font-size: 11px; color: var(--success); background: #e7f8f3; padding: 6px 9px; border-radius: 10px; }
.device-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.device-card { border: 1px solid var(--border); background: var(--surface); border-radius: 17px; padding: 15px; display: flex; gap: 12px; align-items: center; cursor: pointer; text-align: left; transition: .2s; color: var(--text); }.device-card:hover { border-color: #c8c1f3; transform: translateY(-2px); box-shadow: var(--shadow); }
.device-info { display: grid; min-width: 0; flex: 1; }.device-info strong { font-size: 13px; }.device-info small { display: flex; align-items: center; gap: 4px; color: var(--muted); margin-top: 3px; }.device-info code { color: #aaa4b4; font-size: 9px; margin-top: 3px; }.go { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; color: var(--muted); background: var(--soft); }
.empty-devices { background: var(--surface); border: 1px dashed var(--border-strong); border-radius: 18px; padding: 28px; display: flex; justify-content: center; align-items: center; gap: 15px; }.empty-devices > span { color: var(--primary); background: var(--purple-soft); width: 54px; height: 54px; border-radius: 17px; display: grid; place-items: center; }.empty-devices strong { font-size: 14px; }.empty-devices p { color: var(--muted); margin: 5px 0 0; font-size: 11px; }
@media(max-width: 800px) { .home-page { padding: 24px 18px 90px; }.page-heading { align-items: flex-start; }.page-heading .primary-btn { display: none; }.hero-card { padding: 28px 24px; }.hero-copy h2 { font-size: 34px; }.qr-panel { display: none; }.address-pill { gap: 10px; width: 100%; }.address-pill span { flex: 1; }.stat-row { grid-template-columns: 1fr; gap: 8px; }.stat-row article { padding: 12px 14px; }.devices-section { margin-top: 25px; } }
</style>
