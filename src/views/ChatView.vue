<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Archive, Check, CheckCheck, Crown, Download, File, FilePlus2, Files, FolderUp, Image, Laugh, LockKeyhole, LockOpen, LogOut, MessageCircle, MoreHorizontal, Paperclip, Plus, Reply, Search, Send, Trash2, UserMinus, UserPlus, Users, Video, X } from 'lucide-vue-next'
import { downloadUrl } from '../api'
import TransferList from '../components/TransferList.vue'
import UserAvatar from '../components/UserAvatar.vue'
import { e2eeSupported, encryptedRooms, setE2eeRoom } from '../e2ee'
import { activeRoomName, createGroup, deleteGroup, dmRoomId, identity, leaveGroup, markRoomRead, onlinePeers, retractMessage, searchMessages, selectRoom, sendMessage, sendTyping, state, toggleReaction, updateGroup } from '../state'
import { enqueueFiles } from '../upload'
import { fileKind, formatBytes, formatTime } from '../utils'
import type { ChatMessage, Device, FileInfo } from '../types'

const query = ref('')
const text = ref('')
const showEmoji = ref(false)
const showGroup = ref(false)
const groupName = ref('')
const selectedMembers = ref<string[]>([])
const messagesEl = ref<HTMLElement>()
const fileInput = ref<HTMLInputElement>()
const folderInput = ref<HTMLInputElement>()
const drag = ref(false)
const sending = ref(false)
const pasteStatus = ref('')
const replying = ref<ChatMessage | null>(null)
const showMessageSearch = ref(false)
const messageQuery = ref('')
const messageResults = ref<ChatMessage[]>([])
const showRoomManage = ref(false)
const renameValue = ref('')
const transferAdminId = ref('')
const roomManageBusy = ref(false)
const roomManageError = ref('')
const roomManageMessage = ref('')
const previewImage = ref<FileInfo | null>(null)
let pasteStatusTimer: number | undefined

const conversations = computed(() => {
  const base = state.rooms.map((room) => ({ ...room, online: true, device: undefined as Device | undefined, subtitle: room.id === 'lobby' ? `${Math.max(0, state.devices.length - 1)} 位伙伴在线` : `${room.members.length} 位成员` }))
  const direct = onlinePeers.value.map((device) => ({ id: dmRoomId(device.id), name: device.nickname, type: 'direct' as const, members: [identity.id, device.id], createdAt: 0, online: true, subtitle: device.deviceName, device }))
  const all = [...base, ...direct]
  return all.filter((item) => !query.value || item.name.toLowerCase().includes(query.value.toLowerCase()))
})
const messages = computed(() => state.messages[state.activeRoomId] || [])
const activePeer = computed(() => {
  if (!state.activeRoomId.startsWith('dm:')) return null
  const peerId = state.activeRoomId.slice(3).split(':').find((id) => id !== identity.id)
  return state.devices.find((item) => item.id === peerId) || null
})
const activeRoom = computed(() => state.rooms.find((room) => room.id === state.activeRoomId))
const activeIsAdmin = computed(() => Boolean(activeRoom.value?.admins?.includes(identity.id)))
const transferCandidates = computed(() => activeRoom.value?.members.filter((memberId) => memberId !== identity.id) || [])
const needsAdminTransfer = computed(() => activeIsAdmin.value && (activeRoom.value?.admins?.length || 0) <= 1 && transferCandidates.value.length > 0)
const isOnlyGroupMember = computed(() => activeIsAdmin.value && transferCandidates.value.length === 0)
const e2eeEnabled = computed(() => encryptedRooms.value.includes(state.activeRoomId))
const e2eeAvailable = computed(() => Boolean(e2eeSupported && activePeer.value?.encryptionPublicKey))

function toggleE2ee() {
  if (!e2eeEnabled.value && !e2eeAvailable.value) return
  setE2eeRoom(state.activeRoomId, !e2eeEnabled.value)
}

function openRoomManage() {
  transferAdminId.value = transferCandidates.value[0] || ''
  roomManageError.value = ''
  roomManageMessage.value = ''
  showRoomManage.value = true
}

watch(() => messages.value.length, async () => {
  await nextTick(); messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: 'smooth' })
  if (!document.hidden) markRoomRead()
}, { immediate: true })

async function submit() {
  if (!text.value.trim() || sending.value) return
  const value = text.value; text.value = ''; sending.value = true
  try { await sendMessage(value, replying.value?.id); replying.value = null } catch { text.value = value } finally { sending.value = false }
}
function addEmoji(emoji: string) { text.value += emoji; showEmoji.value = false }
function picked(event: Event) { const input = event.target as HTMLInputElement; if (input.files?.length) enqueueFiles(input.files); input.value = '' }
function folderPicked(event: Event) { const input = event.target as HTMLInputElement; if (input.files?.length) enqueueFiles(input.files); input.value = '' }
function dropped(event: DragEvent) { drag.value = false; if (event.dataTransfer?.files.length) enqueueFiles(event.dataTransfer.files) }
function pasted(event: ClipboardEvent) {
  const imageItems = [...(event.clipboardData?.items || [])].filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
  if (!imageItems.length) return
  const now = new Date()
  const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'), '-', String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'), String(now.getSeconds()).padStart(2, '0')].join('')
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' }
  const files = imageItems.flatMap((item, index) => {
    const source = item.getAsFile()
    if (!source) return []
    const extension = extensions[source.type] || source.name.split('.').pop() || 'png'
    return [new window.File([source], `剪贴板图片-${stamp}${imageItems.length > 1 ? `-${index + 1}` : ''}.${extension}`, { type: source.type || 'image/png', lastModified: Date.now() + index })]
  })
  if (!files.length) return
  event.preventDefault()
  enqueueFiles(files)
  pasteStatus.value = `正在发送 ${files.length} 张剪贴板图片`
  window.clearTimeout(pasteStatusTimer)
  pasteStatusTimer = window.setTimeout(() => { pasteStatus.value = '' }, 2600)
}
async function makeGroup() {
  if (!groupName.value.trim() || !selectedMembers.value.length) return
  const room = await createGroup(groupName.value, selectedMembers.value)
  showGroup.value = false; groupName.value = ''; selectedMembers.value = []; await selectRoom(room.id)
}
async function runMessageSearch() {
  messageResults.value = messageQuery.value.trim().length >= 2 ? await searchMessages(messageQuery.value, state.activeRoomId) : []
}
async function openSearchResult(message: ChatMessage) {
  await selectRoom(message.roomId); showMessageSearch.value = false
  await nextTick(); document.querySelector(`[data-message-id="${message.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
function wasRead(message: ChatMessage) {
  if (!activePeer.value) return false
  return (state.readReceipts[message.roomId]?.[activePeer.value.id] || 0) >= message.createdAt
}
async function retract(message: ChatMessage) {
  if (confirm('撤回这条消息？')) await retractMessage(message.id)
}
async function runRoomAction(action: () => Promise<unknown>, success: string) {
  roomManageBusy.value = true
  roomManageError.value = ''
  roomManageMessage.value = ''
  try {
    await action()
    roomManageMessage.value = success
    return true
  } catch (error) {
    roomManageError.value = error instanceof Error ? error.message : '群聊操作失败'
    return false
  } finally {
    roomManageBusy.value = false
  }
}
async function renameGroup() {
  if (!renameValue.value.trim()) return
  if (await runRoomAction(() => updateGroup(state.activeRoomId, 'rename', { name: renameValue.value.trim() }), '群名称已更新')) renameValue.value = ''
}
async function addMember(deviceId: string) { await runRoomAction(() => updateGroup(state.activeRoomId, 'add', { deviceId }), '成员已加入群聊') }
async function removeMember(deviceId: string) {
  if (confirm(`将“${deviceName(deviceId)}”移出群聊？`)) await runRoomAction(() => updateGroup(state.activeRoomId, 'remove', { deviceId }), '成员已移出群聊')
}
async function promoteMember(deviceId: string) {
  await runRoomAction(() => updateGroup(state.activeRoomId, 'promote', { deviceId }), `已将“${deviceName(deviceId)}”设为管理员`)
}
async function leaveCurrentGroup() {
  const roomId = state.activeRoomId
  const successor = needsAdminTransfer.value ? transferAdminId.value : undefined
  if (needsAdminTransfer.value && !successor) { roomManageError.value = '请选择一位接任管理员'; return }
  const prompt = successor ? `将管理员移交给“${deviceName(successor)}”并退出群聊？` : '退出当前群聊？'
  if (confirm(prompt) && await runRoomAction(() => leaveGroup(roomId, successor), '已退出群聊')) showRoomManage.value = false
}
async function dissolveCurrentGroup() {
  const room = activeRoom.value
  if (!room || !confirm(`确定解散“${room.name}”吗？\n\n所有成员会被移出，群聊记录将删除。群文件不会从磁盘删除，但解散后只有上传者能在文件中心继续访问。`)) return
  if (await runRoomAction(() => deleteGroup(room.id), '群聊已解散')) showRoomManage.value = false
}
function deviceName(id: string) { return state.devices.find((device) => device.id === id)?.nickname || id.slice(0, 8) }
</script>

<template>
  <div class="chat-layout" :class="{ dragging: drag }" @dragover.prevent="drag = true" @dragleave.self="drag = false" @drop.prevent="dropped">
    <aside class="conversation-panel">
      <div class="panel-head"><div><h2>消息</h2><span>{{ state.connected ? '实时在线' : '连接中…' }}</span></div><button class="icon-btn" title="创建群聊" @click="showGroup = true"><Plus :size="18" /></button></div>
      <label class="search-box"><Search :size="16" /><input v-model="query" placeholder="搜索会话" /></label>
      <div class="conversation-list">
        <button v-for="room in conversations" :key="room.id" class="conversation" :class="{ active: state.activeRoomId === room.id }" @click="selectRoom(room.id)">
          <UserAvatar v-if="room.type === 'direct' && room.device" :name="room.name" :src="room.device.avatar" :size="44" :online="room.online" />
          <span v-else class="room-avatar" :class="{ lobby: room.id === 'lobby' }"><component :is="room.id === 'lobby' ? MessageCircle : Users" :size="19" /></span>
          <span class="conversation-copy"><strong>{{ room.name }}</strong><small>{{ room.subtitle }}</small></span>
          <b v-if="state.unread[room.id]" class="unread">{{ Math.min(99, state.unread[room.id]) }}</b>
          <i v-else-if="room.type === 'direct'" class="presence" />
        </button>
        <div v-if="conversations.length === 1" class="no-peers">其他设备加入后会显示在这里</div>
      </div>
      <button class="new-group" @click="showGroup = true"><Users :size="16" /> 新建群聊</button>
    </aside>

    <main class="message-panel">
      <header class="message-head">
        <div class="active-user">
          <UserAvatar v-if="activePeer" :name="activePeer.nickname" :src="activePeer.avatar" :size="40" :online="true" />
          <span v-else class="room-avatar"><component :is="state.activeRoomId === 'lobby' ? MessageCircle : Users" :size="18" /></span>
          <div><strong>{{ activeRoomName() }}</strong><small v-if="activePeer"><i /> 在线 · {{ activePeer.ip }}</small><small v-else>{{ activeRoom?.id === 'lobby' ? `${state.devices.length} 台设备已连接` : `${activeRoom?.members.length || 0} 位成员` }}</small></div>
        </div>
        <div class="head-actions"><button v-if="activePeer" class="icon-btn" :class="{ secure: e2eeEnabled }" :disabled="!e2eeAvailable && !e2eeEnabled" :title="e2eeEnabled ? '关闭后续消息的端到端加密' : e2eeAvailable ? '开启私聊端到端加密' : '端到端加密需要双方使用 HTTPS 访问'" @click="toggleE2ee"><LockKeyhole v-if="e2eeEnabled" :size="17" /><LockOpen v-else :size="17" /></button><button class="icon-btn" title="搜索当前聊天" @click="showMessageSearch = !showMessageSearch"><Search :size="17" /></button><button v-if="activeRoom?.id.startsWith('group:')" class="icon-btn" title="群聊管理" @click="openRoomManage"><MoreHorizontal :size="18" /></button></div>
      </header>

      <form v-if="showMessageSearch" class="message-search-bar" @submit.prevent="runMessageSearch"><Search :size="16" /><input v-model="messageQuery" autofocus placeholder="搜索当前聊天记录（至少 2 个字符）" /><button class="secondary-btn">搜索</button><button type="button" class="icon-btn tiny" @click="showMessageSearch = false"><X :size="14" /></button><div v-if="messageResults.length" class="message-search-results"><button v-for="result in messageResults" :key="result.id" type="button" @click="openSearchResult(result)"><strong>{{ result.senderName }}</strong><span>{{ result.content }}</span><small>{{ formatTime(result.createdAt) }}</small></button></div></form>

      <section ref="messagesEl" class="messages">
        <div v-if="!messages.length" class="empty-chat"><span><MessageCircle :size="30" /></span><h3>开始一段对话</h3><p>消息仅在当前局域网和本机中保存。</p></div>
        <div v-else class="message-stack">
          <template v-for="(message, index) in messages" :key="message.id">
            <div v-if="index === 0 || message.createdAt - messages[index - 1].createdAt > 300000" class="time-divider"><span>{{ formatTime(message.createdAt) }}</span></div>
            <article class="message" :class="{ mine: message.senderId === identity.id }" :data-message-id="message.id">
              <UserAvatar v-if="message.senderId !== identity.id" :name="message.senderName" :size="34" />
              <div class="message-body">
                <small v-if="message.senderId !== identity.id">{{ message.senderName }}</small>
                <div v-if="message.reply" class="reply-quote"><strong>{{ message.reply.senderName }}</strong><span>{{ message.reply.content }}</span></div>
                <div v-if="message.type === 'text'" class="bubble" :class="{ deleted: message.deletedAt }">{{ message.content }}</div>
                <button v-else-if="message.file && fileKind(message.file.originalName, message.file.mime) === 'image'" class="image-message" title="点击查看大图" @click="previewImage = message.file">
                  <img :src="downloadUrl(message.file.id, identity.id)" :alt="message.file.originalName" loading="lazy" />
                  <span><strong>{{ message.file.originalName }}</strong><small>{{ formatBytes(message.file.size) }}</small></span>
                </button>
                <a v-else-if="message.file" class="file-message" :href="downloadUrl(message.file.id, identity.id)">
                  <span><component :is="fileKind(message.file.originalName, message.file.mime) === 'image' ? Image : fileKind(message.file.originalName, message.file.mime) === 'video' ? Video : File" :size="22" /></span>
                  <div><strong>{{ message.file.originalName }}</strong><small>{{ formatBytes(message.file.size) }}</small></div><Download :size="17" />
                </a>
                <div v-if="!message.deletedAt" class="message-tools"><button title="回复" @click="replying = message"><Reply :size="12" /></button><button v-for="emoji in ['👍','❤️','😂']" :key="emoji" :class="{ active: message.reactions?.[emoji]?.includes(identity.id) }" @click="toggleReaction(message.id, emoji)">{{ emoji }}</button><button v-if="message.senderId === identity.id || activeIsAdmin" title="撤回" @click="retract(message)"><Trash2 :size="12" /></button></div>
                <div v-if="message.reactions && Object.keys(message.reactions).length" class="reaction-row"><button v-for="(devices, emoji) in message.reactions" :key="emoji" :class="{ active: devices.includes(identity.id) }" @click="toggleReaction(message.id, emoji)">{{ emoji }} {{ devices.length }}</button></div>
                <time><LockKeyhole v-if="message.encrypted" :size="10" title="端到端加密消息" />{{ formatTime(message.createdAt) }} <component :is="wasRead(message) ? CheckCheck : Check" v-if="message.senderId === identity.id" :size="12" /></time>
              </div>
            </article>
          </template>
          <div v-if="state.typing[state.activeRoomId]" class="typing"><i /><i /><i /><span>{{ state.typing[state.activeRoomId] }} 正在输入</span></div>
        </div>
      </section>

      <footer class="composer">
        <div v-if="pasteStatus" class="paste-status"><Image :size="15" />{{ pasteStatus }}</div>
        <div v-if="replying" class="replying"><Reply :size="14" /><span><strong>回复 {{ replying.senderName }}</strong><small>{{ replying.content }}</small></span><button @click="replying = null"><X :size="14" /></button></div>
        <div v-if="showEmoji" class="emoji-pop"><button v-for="emoji in ['😀','😂','🥰','😎','🤔','👍','👏','🎉','❤️','🔥','✅','👀','🙌','😅','🥳','😭']" :key="emoji" @click="addEmoji(emoji)">{{ emoji }}</button></div>
        <input ref="fileInput" hidden type="file" multiple @change="picked" />
        <input ref="folderInput" hidden type="file" multiple webkitdirectory directory @change="folderPicked" />
        <button class="compose-action" title="发送文件" @click="fileInput?.click()"><Paperclip :size="20" /></button>
        <button class="compose-action folder-action" title="发送文件夹" @click="folderInput?.click()"><FolderUp :size="19" /></button>
        <textarea v-model="text" rows="1" placeholder="输入消息，支持 Ctrl+V 粘贴图片" @input="sendTyping" @paste="pasted" @keydown.enter.exact.prevent="submit" />
        <button class="compose-action" title="表情" @click="showEmoji = !showEmoji"><Laugh :size="20" /></button>
        <button class="send-btn" :disabled="!text.trim()" @click="submit"><Send :size="18" /></button>
      </footer>
    </main>

    <aside class="transfer-panel">
      <div class="transfer-head"><div><h3>文件传输</h3><span>{{ Object.values(state.transfers).filter(t => t.status === 'uploading').length }} 个进行中</span></div><Files :size="19" /></div>
      <button class="drop-mini" @click="fileInput?.click()"><span><FilePlus2 :size="22" /></span><div><strong>发送文件</strong><small>支持多选、拖拽和大文件</small></div></button>
      <div class="transfer-title"><span>传输任务</span><b>{{ Object.keys(state.transfers).length }}</b></div>
      <TransferList />
      <div class="privacy-note"><Archive :size="17" /><div><strong>文件保存在本机</strong><small>{{ state.bootstrap?.retentionDays }} 天后自动清理，可在设置中修改</small></div></div>
    </aside>

    <div v-if="drag" class="drag-overlay"><span><FilePlus2 :size="34" /></span><strong>松开即可发送</strong><small>文件将发送到「{{ activeRoomName() }}」</small></div>

    <div v-if="showGroup" class="modal-backdrop" @click.self="showGroup = false">
      <section class="modal group-modal"><button class="modal-close" @click="showGroup = false"><X :size="18" /></button><span class="modal-icon"><Users :size="23" /></span><h2>创建群聊</h2><p>选择要一起聊天的在线设备。</p>
        <label class="field"><span>群聊名称</span><input v-model="groupName" maxlength="40" placeholder="例如：设计小组" autofocus /></label>
        <div class="member-list"><label v-for="device in onlinePeers" :key="device.id"><input v-model="selectedMembers" type="checkbox" :value="device.id" /><UserAvatar :name="device.nickname" :size="34" /><span><strong>{{ device.nickname }}</strong><small>{{ device.deviceName }}</small></span><i /></label></div>
        <button class="primary-btn full" :disabled="!groupName.trim() || !selectedMembers.length" @click="makeGroup">创建群聊（{{ selectedMembers.length + 1 }} 人）</button>
      </section>
    </div>

    <div v-if="showRoomManage && activeRoom" class="modal-backdrop" @click.self="showRoomManage = false">
      <section class="modal group-modal"><button class="modal-close" @click="showRoomManage = false"><X :size="18" /></button><span class="modal-icon"><Users :size="23" /></span><h2>群聊管理</h2><p>{{ activeRoom.name }} · {{ activeRoom.members.length }} 位成员</p>
        <form v-if="activeIsAdmin" class="rename-row" @submit.prevent="renameGroup"><input v-model="renameValue" maxlength="40" :placeholder="activeRoom.name" :disabled="roomManageBusy" /><button class="secondary-btn" :disabled="roomManageBusy">重命名</button></form>
        <div class="member-list manage-members"><article v-for="memberId in activeRoom.members" :key="memberId"><UserAvatar :name="deviceName(memberId)" :size="34" /><span><strong>{{ deviceName(memberId) }}</strong><small>{{ memberId === identity.id ? '我 · ' : '' }}{{ activeRoom.admins?.includes(memberId) ? '管理员' : '成员' }}</small></span><Crown v-if="activeRoom.admins?.includes(memberId)" :size="14" class="crown" /><template v-if="activeIsAdmin && memberId !== identity.id"><button v-if="!activeRoom.admins?.includes(memberId)" :disabled="roomManageBusy" title="设为管理员" @click="promoteMember(memberId)"><Crown :size="14" /></button><button class="member-remove" :disabled="roomManageBusy" title="移出群聊" @click="removeMember(memberId)"><UserMinus :size="14" /><span>移除</span></button></template></article></div>
        <div v-if="activeIsAdmin" class="available-members"><small>添加在线成员</small><button v-for="device in onlinePeers.filter((item) => !activeRoom?.members.includes(item.id))" :key="device.id" :disabled="roomManageBusy" @click="addMember(device.id)"><UserPlus :size="13" />{{ device.nickname }}</button></div>
        <p v-if="roomManageError" class="manage-feedback error">{{ roomManageError }}</p><p v-else-if="roomManageMessage" class="manage-feedback success">{{ roomManageMessage }}</p>
        <div v-if="needsAdminTransfer" class="transfer-admin"><label><span>移交管理员后退出</span><select v-model="transferAdminId" :disabled="roomManageBusy"><option v-for="memberId in transferCandidates" :key="memberId" :value="memberId">{{ deviceName(memberId) }}</option></select></label><button class="danger-wide" :disabled="roomManageBusy || !transferAdminId" @click="leaveCurrentGroup"><LogOut :size="15" />移交并退出</button></div>
        <p v-else-if="isOnlyGroupMember" class="manage-hint">群内只有你，无法直接退出，请解散群聊。</p>
        <button v-else class="danger-wide" :disabled="roomManageBusy" @click="leaveCurrentGroup"><LogOut :size="15" />退出群聊</button>
        <button v-if="activeIsAdmin" class="dissolve-wide" :disabled="roomManageBusy" @click="dissolveCurrentGroup"><Trash2 :size="15" />解散群聊</button>
      </section>
    </div>

    <div v-if="previewImage" class="image-preview" role="dialog" aria-modal="true" :aria-label="previewImage.originalName" @click.self="previewImage = null">
      <header><strong>{{ previewImage.originalName }}</strong><span>{{ formatBytes(previewImage.size) }}</span><a :href="downloadUrl(previewImage.id, identity.id)" title="下载原图"><Download :size="18" />下载</a><button title="关闭预览" @click="previewImage = null"><X :size="22" /></button></header>
      <img :src="downloadUrl(previewImage.id, identity.id)" :alt="previewImage.originalName" @click.stop />
    </div>
  </div>
</template>

<style scoped>
.chat-layout { display: grid; grid-template-columns: 255px minmax(360px, 1fr) 285px; width: 100%; max-width: 100%; height: 100%; overflow: hidden; background: var(--surface); position: relative; }
.conversation-panel, .transfer-panel { background: #faf9fc; min-width: 0; display: flex; flex-direction: column; }
.conversation-panel { border-right: 1px solid var(--border); }.transfer-panel { border-left: 1px solid var(--border); padding: 23px 16px; overflow-x: hidden; overflow-y: auto; }
.panel-head { padding: 25px 18px 15px; display: flex; align-items: center; justify-content: space-between; }.panel-head h2 { font-size: 21px; margin: 0; }.panel-head span { color: var(--success); font-size: 10px; }
.search-box { margin: 0 14px 13px; height: 37px; background: var(--surface); border: 1px solid var(--border); border-radius: 11px; display: flex; align-items: center; gap: 8px; padding: 0 10px; color: var(--muted); }.search-box input { border: 0; outline: 0; width: 100%; background: none; color: var(--text); font: inherit; font-size: 12px; }
.conversation-list { overflow: auto; flex: 1; padding: 0 9px; }.conversation { width: 100%; padding: 10px 9px; border: 0; border-radius: 13px; background: transparent; display: flex; align-items: center; gap: 10px; color: var(--text); text-align: left; cursor: pointer; margin-bottom: 2px; }.conversation:hover { background: #f0eef5; }.conversation.active { background: var(--purple-soft); }.conversation.active .conversation-copy strong { color: var(--primary-dark); }
.room-avatar { width: 44px; height: 44px; border-radius: 15px; display: grid; place-items: center; flex: 0 0 auto; color: white; background: linear-gradient(135deg, #8276e9, #584ac3); }.room-avatar.lobby { background: linear-gradient(135deg, #1ec7a0, #009c7c); }.message-head .room-avatar { width: 40px; height: 40px; border-radius: 13px; }
.conversation-copy { min-width: 0; flex: 1; display: grid; }.conversation-copy strong { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.conversation-copy small { color: var(--muted); font-size: 10px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.presence { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }.unread { font-size: 9px; color: white; background: var(--primary); border-radius: 8px; min-width: 17px; height: 17px; display: grid; place-items: center; }
.new-group { margin: 11px 14px 17px; border: 1px dashed var(--border-strong); background: transparent; border-radius: 11px; color: var(--muted); padding: 9px; cursor: pointer; display: flex; justify-content: center; gap: 7px; align-items: center; font-size: 11px; }.new-group:hover { color: var(--primary); border-color: var(--primary); }.no-peers { text-align: center; font-size: 10px; color: var(--muted); padding: 20px 10px; }
.message-panel { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--surface); }.message-head { height: 72px; flex: 0 0 72px; border-bottom: 1px solid var(--border); padding: 0 23px; display: flex; align-items: center; justify-content: space-between; }.active-user { display: flex; align-items: center; gap: 10px; }.active-user > div { display: grid; }.active-user strong { font-size: 13px; }.active-user small { font-size: 10px; color: var(--muted); margin-top: 2px; }.active-user small i { width: 6px; height: 6px; background: var(--success); display: inline-block; border-radius: 50%; margin-right: 4px; }.head-actions { display: flex; gap: 5px; }
.head-actions .secure { color: #087d65; border-color: #a8ddd0; background: #eef8f5; }.head-actions button:disabled { opacity: .45; cursor: not-allowed; }
.message-search-bar { position: relative; z-index: 8; flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 9px 16px; border-bottom: 1px solid var(--border); background: var(--surface); color: var(--muted); }.message-search-bar > input { min-width: 0; flex: 1; border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; color: var(--text); background: var(--soft); outline: 0; }.message-search-results { position: absolute; left: 16px; right: 16px; top: calc(100% + 4px); max-height: 300px; overflow: auto; padding: 7px; border: 1px solid var(--border); border-radius: 13px; background: var(--surface); box-shadow: var(--shadow); }.message-search-results button { width: 100%; display: grid; grid-template-columns: 90px 1fr auto; gap: 8px; border: 0; border-radius: 9px; padding: 9px; color: var(--text); background: transparent; text-align: left; cursor: pointer; }.message-search-results button:hover { background: var(--soft); }.message-search-results span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.message-search-results small { color: var(--muted); }
.messages { min-height: 0; flex: 1 1 0; overflow-x: hidden; overflow-y: auto; padding: 20px clamp(16px,4vw,46px); background: linear-gradient(#fff, #fdfcff); }.message-stack { min-height: 100%; display: flex; flex-direction: column; justify-content: flex-end; }.empty-chat { min-height: 100%; display: grid; place-content: center; justify-items: center; color: var(--muted); }.empty-chat span { width: 62px; height: 62px; border-radius: 22px; background: var(--purple-soft); color: var(--primary); display: grid; place-items: center; }.empty-chat h3 { color: var(--text); margin: 14px 0 4px; }.empty-chat p { font-size: 11px; margin: 0; }
.time-divider { text-align: center; margin: 10px 0 17px; }.time-divider span { background: var(--soft); color: var(--muted); font-size: 9px; padding: 4px 8px; border-radius: 8px; }
.message { display: flex; align-items: flex-start; gap: 9px; margin: 8px 0; }.message.mine { justify-content: flex-end; }.message-body { max-width: min(72%, 520px); display: grid; justify-items: start; }.message.mine .message-body { justify-items: end; }.message-body > small { color: var(--muted); font-size: 9px; margin: 0 0 4px 4px; }.bubble { background: #f1eff4; border-radius: 6px 17px 17px 17px; padding: 10px 13px; font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }.mine .bubble { background: var(--primary); color: white; border-radius: 17px 6px 17px 17px; box-shadow: 0 5px 12px rgba(108,92,231,.16); }.message-body time { color: #aaa5b0; font-size: 8px; display: flex; align-items: center; gap: 2px; margin-top: 4px; }
.bubble.deleted { color: var(--muted); background: var(--soft); font-style: italic; box-shadow: none; }.reply-quote { max-width: 100%; display: grid; gap: 2px; margin-bottom: 4px; padding: 6px 9px; border-left: 3px solid var(--primary); border-radius: 7px; background: var(--soft); color: var(--muted); font-size: 9px; }.reply-quote span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }.message-tools { display: flex; gap: 3px; opacity: 0; transition: .15s; margin-top: 3px; }.message:hover .message-tools { opacity: 1; }.message-tools button,.reaction-row button { border: 1px solid var(--border); border-radius: 8px; padding: 3px 5px; background: var(--surface); color: var(--muted); cursor: pointer; font-size: 10px; }.message-tools button.active,.reaction-row button.active { color: var(--primary); border-color: #bdb4ee; background: var(--purple-soft); }.reaction-row { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.file-message { width: min(290px, 65vw); background: #f5f3f7; border: 1px solid var(--border); color: var(--text); border-radius: 16px; display: flex; align-items: center; padding: 11px; gap: 10px; text-decoration: none; }.mine .file-message { background: #f0edff; border-color: #ded8ff; }.file-message > span { width: 39px; height: 39px; border-radius: 12px; display: grid; place-items: center; color: var(--primary); background: white; }.file-message > div { flex: 1; min-width: 0; display: grid; }.file-message strong { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.file-message small { color: var(--muted); font-size: 9px; }.file-message > svg { color: var(--muted); }
.image-message { display: block; width: min(330px, 58vw); overflow: hidden; padding: 0; border: 1px solid var(--border); border-radius: 16px; background: var(--soft); color: var(--text); text-align: left; cursor: zoom-in; box-shadow: 0 4px 12px rgba(35,28,55,.06); }.image-message img { display: block; width: 100%; max-height: 260px; object-fit: contain; background: #f5f3f7; }.image-message > span { display: flex; justify-content: space-between; gap: 10px; padding: 8px 10px; background: white; }.image-message strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; }.image-message small { flex: 0 0 auto; color: var(--muted); font-size: 8px; }
.image-preview { position: fixed; inset: 0; z-index: 100; padding: 76px 24px 24px; display: grid; place-items: center; background: rgba(13,11,19,.94); backdrop-filter: blur(10px); }.image-preview > header { position: absolute; top: 0; left: 0; right: 0; min-height: 62px; padding: 10px 20px; display: flex; align-items: center; gap: 12px; color: white; background: rgba(22,19,31,.88); }.image-preview > header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.image-preview > header span { color: #aaa4b7; font-size: 10px; }.image-preview > header a,.image-preview > header button { border: 0; border-radius: 10px; padding: 8px 10px; display: flex; align-items: center; gap: 5px; color: white; background: rgba(255,255,255,.1); text-decoration: none; cursor: pointer; }.image-preview > header a { margin-left: auto; }.image-preview > img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; box-shadow: 0 18px 70px rgba(0,0,0,.5); }
.typing { display: flex; align-items: center; gap: 3px; color: var(--muted); font-size: 9px; margin: 10px 0; }.typing i { width: 4px; height: 4px; background: var(--primary); border-radius: 50%; animation: blink 1s infinite alternate; }.typing i:nth-child(2) { animation-delay: .2s; }.typing i:nth-child(3) { animation-delay: .4s; }.typing span { margin-left: 4px; }
.composer { min-height: 74px; flex: 0 0 auto; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 8px; padding: 11px 18px; position: relative; z-index: 2; background: var(--surface); }.composer textarea { flex: 1; resize: none; min-height: 42px; max-height: 100px; border: 1px solid var(--border); outline: 0; border-radius: 13px; padding: 12px 13px; font: inherit; font-size: 12px; background: #faf9fc; color: var(--text); }.composer textarea:focus { border-color: #c2baef; background: white; }.compose-action { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 8px; }.compose-action:hover { color: var(--primary); }.send-btn { width: 40px; height: 40px; border: 0; border-radius: 13px; display: grid; place-items: center; background: var(--primary); color: white; cursor: pointer; }.send-btn:disabled { background: #d8d5df; cursor: default; }
.replying { position: absolute; left: 18px; right: 18px; bottom: calc(100% + 6px); display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface); box-shadow: var(--shadow); color: var(--primary); }.replying > span { min-width: 0; flex: 1; display: grid; }.replying strong { font-size: 9px; }.replying small { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.replying button { border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.paste-status { position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%); display: flex; align-items: center; gap: 6px; max-width: calc(100% - 30px); padding: 7px 10px; border: 1px solid #d9d2fa; border-radius: 10px; color: var(--primary-dark); background: rgba(248,246,255,.96); box-shadow: var(--shadow); font-size: 10px; white-space: nowrap; }
.emoji-pop { position: absolute; bottom: 65px; right: 55px; padding: 8px; width: 210px; display: grid; grid-template-columns: repeat(6, 1fr); background: white; border: 1px solid var(--border); box-shadow: var(--shadow); border-radius: 14px; z-index: 5; }.emoji-pop button { border: 0; background: transparent; font-size: 19px; padding: 5px; cursor: pointer; border-radius: 7px; }.emoji-pop button:hover { background: var(--soft); }
.transfer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 17px; }.transfer-head h3 { font-size: 15px; margin: 0; }.transfer-head span { font-size: 9px; color: var(--success); }.transfer-head > svg { color: var(--primary); }
.drop-mini { border: 1px dashed #c8c0ef; border-radius: 14px; background: #f3f0ff; display: flex; align-items: center; gap: 10px; text-align: left; padding: 13px; cursor: pointer; color: var(--text); }.drop-mini > span { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; color: var(--primary); background: white; }.drop-mini > div { display: grid; }.drop-mini strong { font-size: 11px; }.drop-mini small { color: var(--muted); font-size: 9px; margin-top: 2px; }.transfer-title { display: flex; justify-content: space-between; margin: 20px 2px 10px; font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }.transfer-title b { background: var(--soft); padding: 2px 6px; border-radius: 6px; }.privacy-note { margin-top: auto; padding: 12px; display: flex; gap: 9px; background: #eef8f5; color: #087d65; border-radius: 13px; }.privacy-note > div { display: grid; }.privacy-note strong { font-size: 10px; }.privacy-note small { color: #66978d; font-size: 8px; margin-top: 2px; }
.drag-overlay { position: absolute; inset: 12px; border-radius: 20px; background: rgba(247,245,255,.94); border: 2px dashed var(--primary); z-index: 20; display: grid; place-content: center; justify-items: center; color: var(--primary); pointer-events: none; backdrop-filter: blur(6px); }.drag-overlay span { width: 70px; height: 70px; border-radius: 22px; background: var(--purple-soft); display: grid; place-items: center; }.drag-overlay strong { font-size: 20px; color: var(--text); margin: 15px 0 4px; }.drag-overlay small { color: var(--muted); }
.group-modal { width: min(420px, calc(100vw - 30px)); }.member-list { display: grid; gap: 6px; max-height: 220px; overflow: auto; margin: 14px 0 18px; }.member-list label { display: flex; align-items: center; gap: 9px; padding: 9px; border-radius: 12px; background: var(--soft); cursor: pointer; }.member-list label > input { display: none; }.member-list label > span { flex: 1; display: grid; }.member-list strong { font-size: 11px; }.member-list small { font-size: 9px; color: var(--muted); }.member-list label > i { width: 17px; height: 17px; border: 1px solid var(--border-strong); border-radius: 6px; }.member-list label:has(input:checked) { background: var(--purple-soft); }.member-list label:has(input:checked) > i { background: var(--primary); border-color: var(--primary); box-shadow: inset 0 0 0 4px var(--primary), inset 0 0 0 5px white; }
.rename-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; }.rename-row input { min-width: 0; border: 1px solid var(--border); border-radius: 10px; padding: 9px 10px; color: var(--text); background: var(--surface); }.manage-members article { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 11px; background: var(--soft); }.manage-members article > span { min-width: 0; flex: 1; display: grid; }.manage-members article button { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 8px; color: var(--muted); background: var(--surface); cursor: pointer; }.manage-members article button.member-remove { width: auto; grid-auto-flow: column; gap: 4px; padding: 0 7px; color: var(--danger); }.manage-members article button.member-remove span { font-size: 9px; }.manage-members button:disabled,.available-members button:disabled { opacity: .5; cursor: wait; }.crown { color: #d69b16; }.available-members { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 13px; }.available-members > small { flex-basis: 100%; color: var(--muted); }.available-members button { border: 1px solid var(--border); border-radius: 8px; padding: 5px 7px; background: var(--surface); color: var(--text); display: flex; gap: 4px; cursor: pointer; }.manage-feedback,.manage-hint { margin: 0 0 10px; padding: 8px 10px; border-radius: 9px; font-size: 10px; }.manage-feedback.error { color: #a61b2b; background: #fff0f2; }.manage-feedback.success { color: #087d65; background: #eef8f5; }.manage-hint { color: var(--muted); background: var(--soft); }.transfer-admin { margin-top: 4px; display: grid; gap: 8px; }.transfer-admin label { display: grid; gap: 5px; color: var(--muted); font-size: 10px; }.transfer-admin select { width: 100%; border: 1px solid var(--border); border-radius: 9px; padding: 8px; color: var(--text); background: var(--surface); }.danger-wide,.dissolve-wide { width: 100%; border-radius: 10px; padding: 9px; display: flex; justify-content: center; align-items: center; gap: 6px; cursor: pointer; }.danger-wide { border: 1px solid #ffcdd3; color: var(--danger); background: #fff5f6; }.dissolve-wide { margin-top: 8px; border: 1px solid var(--danger); color: white; background: var(--danger); }.danger-wide:disabled,.dissolve-wide:disabled { opacity: .5; cursor: wait; }
@keyframes blink { to { opacity: .25; transform: translateY(-2px); } }
@media(max-width: 1100px) { .chat-layout { grid-template-columns: 235px 1fr; }.transfer-panel { display: none; } }
@media(max-width: 700px) { .chat-layout { grid-template-columns: 1fr; grid-template-rows: 82px minmax(0, 1fr); height: 100%; }.conversation-panel { height: 82px; border: 0; border-bottom: 1px solid var(--border); display: block; overflow: hidden; }.message-panel { min-height: 0; }.panel-head { display: none; }.search-box, .new-group, .no-peers { display: none; }.conversation-list { display: flex; padding: 8px 10px; gap: 5px; overflow-x: auto; }.conversation { width: auto; min-width: 54px; padding: 4px 7px; display: grid; justify-items: center; gap: 2px; margin: 0; position: relative; }.conversation :deep(.avatar-wrap), .conversation .room-avatar { width: 38px !important; height: 38px !important; border-radius: 13px; }.conversation-copy strong { max-width: 58px; font-size: 9px; }.conversation-copy small, .conversation .presence { display: none; }.conversation .unread { position: absolute; top: 0; right: 3px; }.message-head { height: 60px; flex: 0 0 60px; padding: 0 14px; }.messages { min-height: 0; padding: 16px 13px; }.message-body { max-width: 82%; }.composer { min-height: 66px; flex: 0 0 66px; padding: 8px 10px; }.compose-action:nth-of-type(2) { display: none; } }
</style>
