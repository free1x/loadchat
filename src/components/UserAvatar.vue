<script setup lang="ts">
import { computed } from 'vue'
import { avatarColor, initials } from '../utils'

const props = withDefaults(defineProps<{ name: string; src?: string; size?: number; online?: boolean | null; status?: 'online' | 'connecting' | 'offline' }>(), { src: '', size: 42, online: null })
const style = computed(() => ({ width: `${props.size}px`, height: `${props.size}px`, background: avatarColor(props.name), fontSize: `${Math.max(11, props.size * .32)}px` }))
const presence = computed(() => props.status || (props.online ? 'online' : 'offline'))
const presenceLabel = computed(() => ({ online: '实时在线', connecting: '正在连接', offline: '离线' })[presence.value])
</script>

<template>
  <span class="avatar-wrap" :style="{ width: `${size}px`, height: `${size}px` }">
    <img v-if="src" class="avatar" :src="src" :alt="name" :style="style" />
    <span v-else class="avatar" :style="style">{{ initials(name) }}</span>
    <i v-if="online !== null || status" class="online-dot" :class="presence" :title="presenceLabel" />
  </span>
</template>

<style scoped>
.avatar-wrap { display: inline-flex; flex: 0 0 auto; position: relative; }
.avatar { border-radius: 34%; color: white; display: grid; place-items: center; object-fit: cover; font-weight: 700; letter-spacing: -.04em; box-shadow: inset 0 0 0 1px rgba(255,255,255,.22); }
.online-dot { position: absolute; right: -2px; bottom: -1px; width: 10px; height: 10px; border-radius: 50%; background: #20c997; border: 2px solid var(--surface); }
.online-dot.connecting { background: #f2b84b; animation: presence-pulse 1.2s infinite; }
.online-dot.offline { background: #b2bec3; }
@keyframes presence-pulse { 50% { opacity: .45; transform: scale(.82); } }
</style>
