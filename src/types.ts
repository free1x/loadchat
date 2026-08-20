export interface Bootstrap {
  port: number
  serverName: string
  storagePath: string
  passwordEnabled: boolean
  adminPasswordEnabled: boolean
  allowedCidrs: string[]
  retentionDays: number
  maxFileSize: number
  maxStorageSize: number
  minFreeSpace: number
  maxConcurrentUploads: number
  maxDailyUploadBytes: number
  requireDeviceApproval: boolean
  shareMaxDays: number
  backupEnabled: boolean
  backupRetention: number
  logRetentionDays: number
  mdnsEnabled: boolean
  addresses: string[]
  primaryAddress: string
  authRequired: boolean
  adminLocalSetup?: boolean
  tlsEnabled?: boolean
  version: string
}

export interface Device {
  id: string
  nickname: string
  deviceName: string
  avatar: string
  ip: string
  online: boolean
  lastSeen: number
  encryptionPublicKey?: string
}

export interface Room {
  id: string
  name: string
  type: 'group' | 'direct'
  members: string[]
  admins?: string[]
  createdAt: number
}

export interface FileInfo {
  id: string
  originalName: string
  storedName: string
  mime: string
  size: number
  senderId: string
  roomId: string
  status: 'uploading' | 'complete' | 'failed'
  createdAt: number
  completedAt?: number
  uploadedChunks?: number
  totalChunks: number
  sha256?: string
}

export interface ChatMessage {
  id: string
  roomId: string
  senderId: string
  senderName: string
  type: 'text' | 'encrypted' | 'file' | 'system'
  content: string
  fileId?: string
  createdAt: number
  file?: FileInfo
  replyTo?: string
  editedAt?: number
  deletedAt?: number
  reply?: { id: string; senderName: string; content: string }
  reactions?: Record<string, string[]>
  encrypted?: boolean
}

export interface TransferItem {
  key: string
  uploadId?: string
  name: string
  size: number
  uploaded: number
  progress: number
  speed: number
  status: 'queued' | 'uploading' | 'paused' | 'complete' | 'error'
  direction: 'upload'
  error?: string
  file?: File
  roomId: string
  startedAt: number
  paused: boolean
}

export interface ServerStatus {
  uptime: number
  onlineUsers: number
  totalMessages: number
  totalFiles: number
  memory: { rss: number; heapUsed: number }
  disk: { available: number; total: number }
  platform: string
  node: string
  databaseSize?: number
  backups?: number
}

export interface ManagedDevice extends Device {
  approved: boolean
  blocked: boolean
  firstSeen: number
  approvedAt?: number
  approvedBy?: string
}

export interface BackupInfo {
  name: string
  size: number
  createdAt: number
}

export interface FileShare {
  id: string
  creatorId: string
  expiresAt: number
  maxDownloads: number
  downloadCount: number
  revokedAt?: number
  createdAt: number
}

export interface AuditEntry {
  id: string
  actorId: string
  action: string
  target: string
  ip: string
  detail: string
  createdAt: number
}

export interface AppNotice {
  id: string
  roomId: string
  senderName: string
  preview: string
  createdAt: number
}
