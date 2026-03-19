import React, { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { getChatHistory, getDialogs, getMe, getProfilePhoto, getChatFolders, sendMessage, subscribeToMessages, subscribeToPresence, subscribeToTyping } from '../../services/telegramClient'
import { motion, AnimatePresence } from 'framer-motion'
import './terminal-mode.css'

const HISTORY_BATCH_SIZE = 100
const HISTORY_TOP_THRESHOLD = 48
const STICK_TO_BOTTOM_THRESHOLD = 120
const EXPORT_BATCH_DELAY_MS = 140

export default function Dashboard() {
    const { selectedChatId, setPostLoginView, setSelectedChatId } = useStore()
    const [messages, setMessages] = useState([])
    const [dialogs, setDialogs] = useState([])
    const [myId, setMyId] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [activeTab, setActiveTab] = useState('all') // 'all', 'photo', 'video', 'archive'
    const [activeSection, setActiveSection] = useState('main') // 'main', 'chats'
    const [avatarUrls, setAvatarUrls] = useState({})
    const [chatFolder, setChatFolder] = useState(0) // 0 = regular, 1 = archive, 2+ = custom folders
    const [showChatMenu, setShowChatMenu] = useState(false)
    const [chatFolders, setChatFolders] = useState([])
    const [terminalMode, setTerminalMode] = useState(false)
    const [typingUsers, setTypingUsers] = useState({})
    const [draftMessage, setDraftMessage] = useState('')
    const [clockNowMs, setClockNowMs] = useState(() => Date.now())
    const [hasMoreHistory, setHasMoreHistory] = useState(true)
    const [loadingOlderHistory, setLoadingOlderHistory] = useState(false)
    const [showExportMenu, setShowExportMenu] = useState(false)
    const [isExportingHistory, setIsExportingHistory] = useState(false)
    const [exportedHistoryCount, setExportedHistoryCount] = useState(0)
    const [exportHistoryError, setExportHistoryError] = useState(null)
    const chatMenuRef = useRef(null)
    const exportMenuRef = useRef(null)
    const chatContainerRef = useRef(null)
    const allDialogsCache = useRef(null) // cache all dialogs for custom folder filtering
    const chatFoldersRef = useRef([]) // ref to avoid triggering re-fetches
    const activeChatIdRef = useRef(selectedChatId)
    const loadingOlderHistoryRef = useRef(false)
    const pendingScrollRestoreRef = useRef(null)
    const shouldScrollToBottomRef = useRef(false)
    const exportCancelRef = useRef(false)

    const getMessageIdKey = (message) => {
        if (message?.id === undefined || message?.id === null) return ''
        return message.id.toString()
    }

    const isNearBottom = (el) => {
        const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        return distanceToBottom <= STICK_TO_BOTTOM_THRESHOLD
    }

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

    const formatTimeWithSeconds = (value) => {
        return new Date(value).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        })
    }

    const formatTimeShort = (value) => {
        return new Date(value).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })
    }

    const getLastOnlineDisplayTime = (entity) => {
        const statusClass = entity?.status?.className
        if (statusClass === 'UserStatusOnline') {
            return formatTimeShort(clockNowMs)
        }

        if (statusClass === 'UserStatusOffline' && entity?.status?.wasOnline) {
            return formatTimeShort(entity.status.wasOnline * 1000)
        }

        return ''
    }

    const formatElapsedDuration = (seconds) => {
        const safe = Math.max(0, Math.floor(seconds || 0))
        const days = Math.floor(safe / 86400)
        const hours = Math.floor((safe % 86400) / 3600)
        const minutes = Math.floor((safe % 3600) / 60)
        const secs = safe % 60
        const hhmmss = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        return days > 0 ? `${days}d ${hhmmss}` : hhmmss
    }

    const sanitizeFileName = (value) => {
        const base = (value || 'chat_history').toString().trim()
        const safe = base
            .normalize('NFKD')
            .replace(/[^\w\- .()]+/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
        return safe || 'chat_history'
    }

    const getCurrentChatTitle = () => {
        const dialogTitle = dialogs.find(d => d.entity?.id?.toString() === selectedChatId)?.title
        if (dialogTitle) return dialogTitle
        if (selectedChatId === myId?.toString()) return 'Saved Messages'
        return `chat_${selectedChatId || 'unknown'}`
    }

    const formatExportMessageLine = (msg) => {
        const timestamp = msg?.date
            ? new Date(msg.date * 1000).toLocaleString('ru-RU', { hour12: false })
            : 'unknown_time'
        const senderName = msg?.out
            ? 'you'
            : (msg?.sender?.firstName || msg?.sender?.title || 'unknown')

        if (msg?.message && msg.message.trim().length > 0) {
            const safeText = msg.message.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            return `[${timestamp}] <${senderName}> ${safeText}`
        }

        const media = msg?.media
        if (media?.photo) return `[${timestamp}] <${senderName}> [photo]`
        if (media?.webpage) return `[${timestamp}] <${senderName}> [link] ${media.webpage.url || media.webpage.displayUrl || ''}`.trim()
        if (media?.document) {
            const attrs = Array.isArray(media.document.attributes) ? media.document.attributes : []
            const filenameAttr = attrs.find(a => a.className === 'DocumentAttributeFilename')
            const fileName = filenameAttr?.fileName || 'file'
            const mime = media.document.mimeType || 'application/octet-stream'
            return `[${timestamp}] <${senderName}> [document] ${fileName} (${mime})`
        }
        return `[${timestamp}] <${senderName}> [attachment]`
    }

    const collectFullChatHistory = async (chatId) => {
        const allMessages = []
        const seenIds = new Set()
        let offsetId = 0

        while (true) {
            if (exportCancelRef.current) {
                throw new Error('EXPORT_CANCELLED')
            }

            const batch = await getChatHistory(chatId, {
                limit: HISTORY_BATCH_SIZE,
                offsetId
            })

            if (!Array.isArray(batch) || batch.length === 0) break

            const uniqueBatch = batch.filter(msg => {
                const key = getMessageIdKey(msg)
                if (!key || seenIds.has(key)) return false
                seenIds.add(key)
                return true
            })

            if (uniqueBatch.length === 0) break

            allMessages.push(...uniqueBatch)
            setExportedHistoryCount(allMessages.length)

            const oldestMessage = uniqueBatch[uniqueBatch.length - 1]
            if (!oldestMessage?.id || batch.length < HISTORY_BATCH_SIZE) break
            offsetId = oldestMessage.id

            await delay(EXPORT_BATCH_DELAY_MS)
        }

        return allMessages
    }

    const handleExportFullHistory = async () => {
        const chatId = activeChatIdRef.current
        if (!chatId || isExportingHistory) return

        setExportHistoryError(null)
        setExportedHistoryCount(0)
        setIsExportingHistory(true)
        exportCancelRef.current = false

        try {
            const allMessagesNewestFirst = await collectFullChatHistory(chatId)
            if (allMessagesNewestFirst.length === 0) {
                throw new Error('EMPTY_HISTORY')
            }

            const chatTitle = getCurrentChatTitle()
            const generatedAt = new Date().toLocaleString('ru-RU', { hour12: false })
            const lines = allMessagesNewestFirst
                .slice()
                .reverse()
                .map(formatExportMessageLine)

            const content = [
                `Chat: ${chatTitle}`,
                `Chat ID: ${chatId}`,
                `Exported at: ${generatedAt}`,
                `Messages: ${allMessagesNewestFirst.length}`,
                '',
                ...lines
            ].join('\n')

            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            a.href = url
            a.download = `${sanitizeFileName(chatTitle)}_${stamp}.txt`
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
            setShowExportMenu(false)
        } catch (err) {
            if (err?.message === 'EXPORT_CANCELLED') {
                setExportHistoryError('Экспорт отменен')
            } else if (err?.message === 'EMPTY_HISTORY') {
                setExportHistoryError('В этом чате пока нет сообщений для экспорта')
            } else if (err?.message?.includes?.('FLOOD_WAIT')) {
                setExportHistoryError('Telegram временно ограничил частоту запросов. Попробуйте позже.')
            } else {
                setExportHistoryError('Не удалось экспортировать историю')
            }
        } finally {
            setIsExportingHistory(false)
            exportCancelRef.current = false
        }
    }

    // Keep ref in sync
    useEffect(() => { chatFoldersRef.current = chatFolders }, [chatFolders])
    useEffect(() => { activeChatIdRef.current = selectedChatId }, [selectedChatId])
    useEffect(() => {
        const timerId = window.setInterval(() => {
            setClockNowMs(Date.now())
        }, 1000)
        return () => window.clearInterval(timerId)
    }, [])

    useEffect(() => {
        let mounted = true
        async function fetchChats() {
            try {
                const me = await getMe()
                if (mounted) setMyId(me.id)
                let fetchedDialogs

                if (chatFolder <= 1) {
                    // Built-in folders: 0 = all chats, 1 = archive
                    try {
                        fetchedDialogs = await getDialogs(50, chatFolder)
                    } catch (e) {
                        console.warn('Failed to fetch folder', chatFolder, ':', e)
                        fetchedDialogs = await getDialogs(50, 0)
                    }

                    if (Array.isArray(fetchedDialogs)) {
                        const seen = new Set()
                        const unique = []
                        for (const d of fetchedDialogs) {
                            const eid = d.entity?.id?.toString()
                            // Skip deactivated or migrated legacy groups (avoids duplicates when a group was upgraded to a supergroup)
                            if (d.entity?.migratedTo || d.entity?.deactivated) continue

                            if (eid && !seen.has(eid)) {
                                seen.add(eid)
                                unique.push(d)
                            }
                        }
                        fetchedDialogs = unique

                        // Cache all dialogs when viewing folder 0
                        if (chatFolder === 0) {
                            allDialogsCache.current = fetchedDialogs
                        }
                    }
                } else {
                    // Custom folder — use cached dialogs or fetch once
                    const folders = chatFoldersRef.current
                    const folder = folders.find(f => f.id === chatFolder)

                    if (!allDialogsCache.current) {
                        try {
                            const [mainChats, archiveChats] = await Promise.all([
                                getDialogs(800, 0),
                                getDialogs(400, 1)
                            ])
                            const combined = [...(Array.isArray(mainChats) ? mainChats : []), ...(Array.isArray(archiveChats) ? archiveChats : [])]

                            // Deduplicate
                            const seen = new Set()
                            const unique = []
                            for (const d of combined) {
                                const eid = d.entity?.id?.toString()
                                if (d.entity?.migratedTo || d.entity?.deactivated) continue

                                if (eid && !seen.has(eid)) {
                                    seen.add(eid)
                                    unique.push(d)
                                }
                            }
                            allDialogsCache.current = unique
                        } catch (e) {
                            console.warn('Failed to fetch dialogs for filtering:', e)
                            allDialogsCache.current = []
                        }
                    }
                    fetchedDialogs = [...(allDialogsCache.current || [])]

                    if (folder && Array.isArray(fetchedDialogs)) {
                        const allIncluded = new Set([
                            ...folder.includePeers,
                            ...folder.pinnedPeers,
                        ])
                        fetchedDialogs = fetchedDialogs.filter(chat => {
                            const entityId = chat.entity?.id?.toString()
                            if (!entityId) return false

                            // Exclude explicit peers
                            if (folder.excludePeers.includes(entityId)) return false

                            // Always include explicit peers, bypassing type flags
                            if (allIncluded.has(entityId)) return true

                            // Exclude flags
                            const isArchived = chat.folderId === 1 || chat.dialog?.folderId === 1
                            if (folder.excludeArchived && isArchived) return false
                            if (folder.excludeMuted && chat.dialog?.notifySettings?.muteUntil > (Date.now() / 1000)) return false
                            if (folder.excludeRead && chat.unreadCount === 0) return false

                            // Match type flags
                            const entity = chat.entity
                            const className = entity?.className || ''
                            if (folder.groups && (className === 'Chat' || className === 'ChatForbidden' || (className === 'Channel' && entity.megagroup))) return true
                            if (folder.broadcasts && className === 'Channel' && !entity.megagroup) return true
                            if (folder.bots && entity?.bot) return true
                            if (folder.contacts && className === 'User' && !entity.bot && entity.contact) return true
                            if (folder.nonContacts && className === 'User' && !entity.bot && !entity.contact) return true

                            return false
                        })
                        // Pin pinned peers to top
                        if (folder.pinnedPeers.length > 0) {
                            const pinned = []
                            const rest = []
                            for (const d of fetchedDialogs) {
                                const eid = d.entity?.id?.toString()
                                if (eid && folder.pinnedPeers.includes(eid)) {
                                    pinned.push(d)
                                } else {
                                    rest.push(d)
                                }
                            }
                            // Sort pinned in the same order as pinnedPeers
                            pinned.sort((a, b) => {
                                const ai = folder.pinnedPeers.indexOf(a.entity?.id?.toString())
                                const bi = folder.pinnedPeers.indexOf(b.entity?.id?.toString())
                                return ai - bi
                            })
                            fetchedDialogs = [...pinned, ...rest]
                        }
                    }
                }

                if (!Array.isArray(fetchedDialogs)) fetchedDialogs = []
                if (mounted) {
                    setDialogs(fetchedDialogs)
                    // Load avatars in background
                    fetchedDialogs.forEach(async (chat) => {
                        const entity = chat.entity
                        if (!entity) return
                        const idStr = entity.id?.toString()
                        if (!idStr) return
                        if (avatarUrls[idStr]) return // already cached
                        try {
                            const url = await getProfilePhoto(entity)
                            if (mounted && url) {
                                setAvatarUrls(prev => ({ ...prev, [idStr]: url }))
                            }
                        } catch { /* ignore */ }
                    })
                }
            } catch (err) {
                console.error('Failed to fetch dialogs:', err)
            }
        }
        fetchChats()
        return () => { mounted = false }
    }, [chatFolder])

    // Subscribe to realtime presence updates
    useEffect(() => {
        if (activeSection !== 'chats') return

        let mounted = true
        let unsubscribe = null

        subscribeToPresence((update) => {
            if (!mounted || !update.userId || !update.status) return

            setDialogs(prevDialogs => {
                const newDialogs = [...prevDialogs]
                const chatIndex = newDialogs.findIndex(d => d.entity?.id?.toString() === update.userId)
                if (chatIndex !== -1) {
                    newDialogs[chatIndex] = {
                        ...newDialogs[chatIndex],
                        entity: {
                            ...newDialogs[chatIndex].entity,
                            status: update.status
                        }
                    }
                }
                return newDialogs
            })
        }).then(unsub => {
            unsubscribe = unsub
        })

        return () => {
            mounted = false
            if (unsubscribe) unsubscribe()
        }
    }, [activeSection])

    // Subscribe to realtime typing updates
    useEffect(() => {
        if (activeSection !== 'chats') return

        let mounted = true
        let unsubscribe = null

        subscribeToTyping((update) => {
            if (!mounted) return

            // Generate all possible variations of the chatId to guarantee a match
            // with how it's stored in the dialogs array, specifically for supergroups (-100).
            const rawChatId = update.chatId?.replace('-100', '')?.replace('-', '')

            const possibleIds = [
                update.chatId,
                rawChatId,
                `-${rawChatId}`,
                `-100${rawChatId}`
            ].filter(Boolean)

            let actionText = 'typing...'
            if (update.action) {
                if (update.action.includes('RecordAudio') || update.action.includes('RecordVoice')) actionText = 'recording voice...'
                else if (update.action.includes('RecordVideo')) actionText = 'recording video...'
                else if (update.action.includes('UploadPhoto')) actionText = 'sending photo...'
                else if (update.action.includes('UploadVideo')) actionText = 'sending video...'
                else if (update.action.includes('UploadDocument')) actionText = 'sending file...'
                else if (update.action.includes('ChooseSticker')) actionText = 'choosing sticker...'
            }

            setTypingUsers(prev => {
                const next = { ...prev }
                possibleIds.forEach(id => {
                    next[id] = { time: Date.now(), text: actionText }
                })
                return next
            })
        }).then(unsub => {
            unsubscribe = unsub
        })

        // Auto-clear typing status after 4 seconds
        const interval = setInterval(() => {
            setTypingUsers(prev => {
                const now = Date.now()
                const next = { ...prev }
                let changed = false
                Object.keys(next).forEach(key => {
                    const status = next[key]
                    const statusTime = typeof status === 'object' ? status.time : status
                    if (now - statusTime > 4000) {
                        delete next[key]
                        changed = true
                    }
                })
                return changed ? next : prev
            })
        }, 1000)

        return () => {
            mounted = false
            clearInterval(interval)
            if (unsubscribe) unsubscribe()
        }
    }, [activeSection])

    // Refresh folders & clear cache when entering chats section
    useEffect(() => {
        if (activeSection === 'chats') {
            allDialogsCache.current = null // invalidate cache
            getChatFolders().then(folders => {
                setChatFolders(folders)
            })
        }
    }, [activeSection])

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e) {
            if (chatMenuRef.current && !chatMenuRef.current.contains(e.target)) {
                setShowChatMenu(false)
            }
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
                setShowExportMenu(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [])

    // Close chat on Escape
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setSelectedChatId(null)
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [setSelectedChatId])

    const loadOlderHistory = async () => {
        const chatId = activeChatIdRef.current
        if (!chatId || loading || loadingOlderHistoryRef.current || !hasMoreHistory || messages.length === 0) return

        const oldestLoadedMessage = messages[messages.length - 1]
        const oldestMessageId = oldestLoadedMessage?.id
        if (!oldestMessageId) {
            setHasMoreHistory(false)
            return
        }

        const el = chatContainerRef.current
        pendingScrollRestoreRef.current = el
            ? { previousTop: el.scrollTop, previousHeight: el.scrollHeight }
            : null

        loadingOlderHistoryRef.current = true
        setLoadingOlderHistory(true)

        try {
            const olderMessages = await getChatHistory(chatId, {
                limit: HISTORY_BATCH_SIZE,
                offsetId: oldestMessageId
            })

            if (activeChatIdRef.current !== chatId) {
                pendingScrollRestoreRef.current = null
                return
            }

            if (!Array.isArray(olderMessages) || olderMessages.length === 0) {
                setHasMoreHistory(false)
                pendingScrollRestoreRef.current = null
                return
            }

            const knownIds = new Set(messages.map(msg => getMessageIdKey(msg)).filter(Boolean))
            const uniqueOlderMessages = olderMessages.filter(msg => {
                const key = getMessageIdKey(msg)
                return key && !knownIds.has(key)
            })

            if (uniqueOlderMessages.length === 0) {
                setHasMoreHistory(false)
                pendingScrollRestoreRef.current = null
                return
            }

            setMessages(prev => {
                const prevIds = new Set(prev.map(msg => getMessageIdKey(msg)).filter(Boolean))
                const trulyUniqueOlder = uniqueOlderMessages.filter(msg => {
                    const key = getMessageIdKey(msg)
                    return key && !prevIds.has(key)
                })

                if (trulyUniqueOlder.length === 0) {
                    pendingScrollRestoreRef.current = null
                    return prev
                }

                return [...prev, ...trulyUniqueOlder]
            })

            if (olderMessages.length < HISTORY_BATCH_SIZE) {
                setHasMoreHistory(false)
            }
        } catch (err) {
            console.error('Failed to load older chat history:', err)
            pendingScrollRestoreRef.current = null
        } finally {
            loadingOlderHistoryRef.current = false
            if (activeChatIdRef.current === chatId) {
                setLoadingOlderHistory(false)
            }
        }
    }

    const handleChatScroll = () => {
        const el = chatContainerRef.current
        if (!el || loading || loadingOlderHistoryRef.current || !hasMoreHistory) return
        if (el.scrollTop <= HISTORY_TOP_THRESHOLD) {
            loadOlderHistory()
        }
    }

    useEffect(() => {
        if (!selectedChatId) {
            exportCancelRef.current = true
            loadingOlderHistoryRef.current = false
            pendingScrollRestoreRef.current = null
            shouldScrollToBottomRef.current = false
            setMessages([])
            setHasMoreHistory(false)
            setLoadingOlderHistory(false)
            setLoading(false)
            setError(null)
            setShowExportMenu(false)
            setIsExportingHistory(false)
            setExportedHistoryCount(0)
            setExportHistoryError(null)
            return
        }

        let mounted = true
        loadingOlderHistoryRef.current = false
        pendingScrollRestoreRef.current = null
        shouldScrollToBottomRef.current = false
        setLoading(true)
        setError(null)
        setLoadingOlderHistory(false)
        setHasMoreHistory(true)

        const fetchHistory = async () => {
            try {
                const history = await getChatHistory(selectedChatId, { limit: HISTORY_BATCH_SIZE })
                if (mounted) {
                    const normalizedHistory = Array.isArray(history) ? history : []
                    setMessages(normalizedHistory)
                    setHasMoreHistory(normalizedHistory.length === HISTORY_BATCH_SIZE)
                    shouldScrollToBottomRef.current = true
                    setLoading(false)
                }
            } catch (err) {
                console.error('Failed to load chat history:', err)
                if (mounted) {
                    setError(err.message)
                    setLoading(false)
                    setHasMoreHistory(false)
                }
            }
        }
        fetchHistory()

        // Setup real-time listener for incoming messages
        let unsubscribe = null
        subscribeToMessages(selectedChatId, (newMessage) => {
            if (mounted) {
                const el = chatContainerRef.current
                if (!el || isNearBottom(el)) {
                    shouldScrollToBottomRef.current = true
                }

                const newMessageId = getMessageIdKey(newMessage)
                setMessages(prev => {
                    // Avoid duplicating already received updates
                    if (newMessageId && prev.some(m => getMessageIdKey(m) === newMessageId)) return prev

                    let next = prev
                    if (newMessage.out) {
                        // find a pending message with the same text to remove it
                        const pendingIdx = prev.findIndex(m => m.isPending && m.message === newMessage.message)
                        if (pendingIdx !== -1) {
                            next = [...prev]
                            next.splice(pendingIdx, 1)
                        }
                    }
                    return [newMessage, ...next]
                })
            }
        }).then(unsub => {
            unsubscribe = unsub
        })

        return () => {
            mounted = false
            exportCancelRef.current = true
            if (unsubscribe) unsubscribe()
        }
    }, [selectedChatId])

    const handleBack = () => {
        setPostLoginView('chats')
    }

    const handleSendMessage = async (e) => {
        if (e) e.preventDefault()
        if (!draftMessage.trim() || !selectedChatId) return

        const msgText = draftMessage
        setDraftMessage('')

        // Pending message to show in queue
        const pendingId = 'pending_' + Date.now() + Math.random();
        const pendingMsg = {
            id: pendingId,
            message: msgText,
            out: true,
            date: Math.floor(Date.now() / 1000),
            sender: { id: myId, firstName: 'Вы' },
            isPending: true
        }

        shouldScrollToBottomRef.current = true
        setMessages(prev => [pendingMsg, ...prev])

        try {
            await sendMessage(selectedChatId, msgText)

            // Failsafe: hide if it somehow never arrives via ws
            setTimeout(() => {
                setMessages(prev => prev.filter(m => m.id !== pendingId))
            }, 20000)
        } catch (err) {
            console.error('Failed to send message:', err)
            // Revert on failure
            setMessages(prev => prev.filter(m => m.id !== pendingId))
        }
    }

    const renderFileRows = () => {
        if (loading) {
            return <div className="p-8 text-center text-[#787c99]">Загрузка файлов...</div>
        }
        if (error) {
            return <div className="p-8 text-center text-red-400">Ошибка: {error}</div>
        }

        // Filter messages to only those with media/documents
        const fileMessages = messages.filter(msg => {
            if (!msg.media) return false;

            if (activeTab === 'all') return true;

            if (activeTab === 'photo') {
                return !!msg.media.photo;
            }

            if (msg.media.document) {
                const attributes = msg.media.document.attributes || [];
                if (activeTab === 'video') {
                    return attributes.some(a => a.className === 'DocumentAttributeVideo') || msg.media.document.mimeType?.startsWith('video/');
                }
                if (activeTab === 'archive') {
                    const mime = (msg.media.document.mimeType || '').toLowerCase();
                    return mime.includes('zip') || mime.includes('rar') || mime.includes('tar') || mime.includes('7z') || mime.includes('archive');
                }
            }
            return false;
        });

        if (fileMessages.length === 0) {
            return (
                <div className="flex-1 border-2 border-dashed border-[#5e5e75] rounded-3xl bg-[#16161e]/50 flex items-center justify-center p-8 text-center transition-all duration-300 hover:border-[#7aa2f7] hover:bg-[#16161e]/80 min-h-[300px]">
                    <div className="max-w-sm w-full mx-auto flex flex-col items-center">
                        <div className="mb-6 relative w-24 h-24 flex items-center justify-center">
                            <svg width="100" height="100" viewBox="0 0 120 120" fill="none" className="drop-shadow-[0_10px_20px_rgba(0,0,0,0.3)]">
                                <rect x="30" y="30" width="40" height="50" fill="#212129" stroke="#5e5e75" strokeWidth="2" transform="rotate(-15)" />
                                <rect x="50" y="30" width="40" height="50" fill="#2a2a35" stroke="#7aa2f7" strokeWidth="2" transform="rotate(10)" />
                                <circle cx="60" cy="60" r="15" fill="#9ece6a" opacity="0.8" />
                            </svg>
                        </div>
                        <p className="text-[#a1a1aa] text-lg mb-6 leading-relaxed">Перетащите сюда файлы для загрузки</p>
                    </div>
                </div>
            )
        }

        return (
            <div className="flex-1 overflow-y-auto scrollable bg-[#212129] rounded-2xl border border-[#2a2a35] relative list-wrapper">
                <div className="flex flex-col relative w-full h-full min-h-0">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            transition={{ duration: 0.1, ease: "easeOut" }}
                            className="flex flex-col w-full h-full min-h-0 divide-y divide-[#2a2a35]"
                        >
                            {fileMessages.map(msg => {
                                const media = msg.media
                                let typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                                let fileName = "Файл"
                                let fileSize = ""
                                let fileUrl = ""

                                if (media.document) {
                                    const attributes = media.document.attributes || []
                                    const filenameAttr = attributes.find(attr => attr.className === 'DocumentAttributeFilename')
                                    if (filenameAttr) {
                                        fileName = filenameAttr.fileName
                                    } else {
                                        // Fallback if it's a generic document without explicitly set file name (e.g. voice note, sticker)
                                        if (attributes.find(a => a.className === 'DocumentAttributeVideo')) fileName = "Видео"
                                        else if (attributes.find(a => a.className === 'DocumentAttributeAudio')) fileName = "Аудио"
                                        else if (attributes.find(a => a.className === 'DocumentAttributeSticker')) fileName = "Стикер"
                                    }

                                    fileSize = (media.document.size / 1024 / 1024).toFixed(2) + " MB"

                                    // Select icon based on attributes
                                    if (attributes.find(a => a.className === 'DocumentAttributeVideo')) {
                                        typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>
                                    } else if (attributes.find(a => a.className === 'DocumentAttributeAudio')) {
                                        typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                                    } else {
                                        typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                                    }
                                } else if (media.photo) {
                                    fileName = "Фотография"
                                    typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                                } else if (media.webpage) {
                                    fileName = media.webpage.title || "Веб-страница"
                                    fileUrl = media.webpage.url || media.webpage.displayUrl || ""
                                    typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                                }

                                const dateObj = new Date(msg.date * 1000)
                                const dateStr = dateObj.toLocaleDateString() + " " + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

                                return (
                                    <div
                                        key={msg.id}
                                        className="file-row w-full flex items-center justify-between px-6 py-4 hover:bg-[#16161e]/80 transition-colors group"
                                    >
                                        <div className="flex items-center gap-4 flex-1 min-w-0 pr-4">
                                            <div className="w-10 h-10 shrink-0 rounded-xl bg-white/5 flex items-center justify-center text-[#787c99] group-hover:text-blue-400 group-hover:bg-blue-500/10 transition-colors">
                                                <div className="w-5 h-5">{typeIcon}</div>
                                            </div>
                                            <div className="flex flex-col min-w-0 gap-1 overflow-hidden" style={{ flex: '1 1 auto', maxWidth: '300px' }}>
                                                <span className="text-[0.95rem] text-gray-200 font-medium whitespace-nowrap overflow-hidden text-ellipsis block w-full leading-tight" title={fileName}>
                                                    {fileName}
                                                </span>
                                                <div className="text-[0.75rem] text-gray-400/80 flex items-center gap-2 whitespace-nowrap">
                                                    {fileSize && <span>{fileSize}</span>}
                                                    {fileSize && <span className="w-1 h-1 rounded-full bg-white/20"></span>}
                                                    <span>{dateStr}</span>
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0 flex items-center shrink">
                                                {fileUrl && (
                                                    <a href={fileUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[0.8rem] text-blue-400/70 group-hover:text-blue-400 hover:!underline whitespace-nowrap overflow-hidden text-ellipsis max-w-full block" title={fileUrl}>
                                                        {fileUrl}
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                        <div className="file-actions opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center">
                                            <button className="p-2 bg-white/5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>
        )
    }

    // Keep scroll position when loading older history; otherwise stick to bottom only when needed.
    useLayoutEffect(() => {
        requestAnimationFrame(() => {
            const el = chatContainerRef.current
            if (!el) return

            if (pendingScrollRestoreRef.current) {
                const { previousTop, previousHeight } = pendingScrollRestoreRef.current
                const heightDiff = el.scrollHeight - previousHeight
                el.scrollTop = Math.max(0, previousTop + heightDiff)
                pendingScrollRestoreRef.current = null
                return
            }

            if (shouldScrollToBottomRef.current) {
                el.scrollTop = el.scrollHeight
                shouldScrollToBottomRef.current = false
            }
        })
    }, [messages, selectedChatId, loading, activeSection, terminalMode])

    const renderChatMessages = () => {
        if (loading) {
            return (
                <div className="flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-[#7aa2f7] border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-[#787c99] text-sm">Загрузка сообщений...</span>
                    </div>
                </div>
            )
        }
        if (error) {
            return <div className="flex-1 flex items-center justify-center text-red-400">Ошибка: {error}</div>
        }

        const chatMessages = [...messages].reverse()
        let lastDate = ''

        // ─── TERMINAL MODE: IRC-style log ───
        if (terminalMode) {
            return (
                <div ref={chatContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto scrollable bg-black">
                    <div className="px-3 py-2" style={{ fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6' }}>
                        {loadingOlderHistory && (
                            <div style={{ color: '#666', marginBottom: '6px' }}>--- загружаю более старые сообщения ---</div>
                        )}
                        {chatMessages.length === 0 ? (
                            <div style={{ color: '#555' }}>--- нет сообщений ---</div>
                        ) : (
                            chatMessages.map(msg => {
                                const dateObj = new Date(msg.date * 1000)
                                const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                const dateStr = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
                                const showDate = dateStr !== lastDate
                                lastDate = dateStr
                                const name = msg.out ? 'you' : (msg.sender?.firstName || msg.sender?.title || '???')

                                let textContent = msg.message;
                                let isJson = false;
                                if (!textContent) {
                                    try {
                                        textContent = JSON.stringify(msg.media || msg, (key, value) => typeof value === 'bigint' ? value.toString() : value);
                                        isJson = true;
                                    } catch (e) {
                                        textContent = '[unparseable attachment]';
                                    }
                                }

                                return (
                                    <React.Fragment key={msg.id}>
                                        {showDate && (
                                            <div style={{ color: '#555', margin: '4px 0' }}>--- {dateStr} ---</div>
                                        )}
                                        <div style={{ color: msg.out ? '#b0b0b0' : '#e0e0e0', display: 'flex', alignItems: 'flex-start', gap: '8px', opacity: msg.isPending ? 0.6 : 1 }}>
                                            <div style={{ flexShrink: 0 }}>
                                                <span style={{ color: '#666' }}>[{timeStr}]</span>{' '}
                                                {msg.isPending && <span style={{ color: '#d75f5f' }}>[QUEUED] </span>}
                                                <span style={{ color: msg.out ? '#5faf5f' : '#5fafff' }}>&lt;{name}&gt;</span>
                                            </div>
                                            <div style={{ flex: 1, wordBreak: 'break-word', whiteSpace: isJson ? 'pre-wrap' : 'normal', color: isJson ? '#9ea3c4' : 'inherit' }}>
                                                {textContent}
                                            </div>
                                        </div>
                                    </React.Fragment>
                                )
                            })
                        )}
                    </div>
                </div>
            )
        }

        // ─── NORMAL MODE: bubbles ───

        return (
            <div ref={chatContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto scrollable rounded-2xl bg-[#1a1b26] relative">
                <div className="flex flex-col gap-0 px-4 py-4">
                    {loadingOlderHistory && (
                        <div className="flex items-center justify-center py-2 text-[11px] text-[#787c99]">Загрузка старых сообщений...</div>
                    )}
                    {chatMessages.length === 0 ? (
                        <div className="flex items-center justify-center py-20 text-[#787c99] text-sm">Нет сообщений</div>
                    ) : (
                        chatMessages.map((msg, i) => {
                            const isOut = msg.out
                            const dateObj = new Date(msg.date * 1000)
                            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            const dateStr = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
                            const showDate = dateStr !== lastDate
                            lastDate = dateStr

                            const prevMsg = i > 0 ? chatMessages[i - 1] : null
                            const senderId = msg.sender?.id?.toString() || (isOut ? 'me' : '')
                            const prevSenderId = prevMsg?.sender?.id?.toString() || (prevMsg?.out ? 'me' : '')
                            const isContinuation = prevMsg && prevSenderId === senderId && !showDate

                            const senderName = isOut ? 'Вы' : (msg.sender ? (msg.sender.firstName || msg.sender.title || '') : '')

                            return (
                                <React.Fragment key={msg.id}>
                                    {showDate && (
                                        <div className="flex items-center justify-center my-3">
                                            <div className="px-4 py-1.5 rounded-full bg-[#2a2a35]/80 text-[#787c99] text-[11px] font-medium backdrop-blur-sm">
                                                {dateStr}
                                            </div>
                                        </div>
                                    )}
                                    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} ${isContinuation ? 'mt-[2px]' : 'mt-2'}`}>
                                        <div className={`max-w-[70%] flex flex-col ${isOut ? 'items-end' : 'items-start'}`}>
                                            {senderName && !isContinuation && (
                                                <span className={`text-[11px] font-semibold mb-1 px-2 ${isOut ? 'text-[#9ece6a]' : 'text-[#7aa2f7]'}`}>{senderName}</span>
                                            )}
                                            <div className={`relative px-3.5 py-2 transition-opacity duration-300 ${isOut
                                                ? `bg-[#7aa2f7] text-[#0f0f14] ${isContinuation ? 'rounded-2xl rounded-tr-lg' : 'rounded-2xl rounded-br-sm'}`
                                                : `bg-[#2a2a35] text-[#e4e4e7] ${isContinuation ? 'rounded-2xl rounded-tl-lg' : 'rounded-2xl rounded-bl-sm'}`
                                                }`} style={{ opacity: msg.isPending ? 0.7 : 1 }}>
                                                {msg.message ? (
                                                    <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.45]">{msg.message}</p>
                                                ) : (
                                                    <p className="text-[14px] italic opacity-60">[Вложение]</p>
                                                )}
                                                <div className={`flex items-center gap-1.5 mt-0.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                                                    <span className={`text-[10px] ${isOut ? 'text-[#0f0f14]/50' : 'text-[#787c99]'}`}>{timeStr}</span>
                                                    {isOut && (
                                                        msg.isPending ? (
                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-[#0f0f14]/60"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                                        ) : (
                                                            <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3.5 h-3.5 ${msg.views !== undefined ? 'text-[#0f0f14]/40' : 'text-[#0f0f14]/50'}`}>
                                                                <path d="M1.5 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </React.Fragment>
                            )
                        })
                    )}
                </div>
            </div>
        )
    }

    const navItems = [
        { id: 'all', label: 'Все файлы', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg> },
        { id: 'photo', label: 'Фото', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> },
        { id: 'video', label: 'Видео', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg> },
        { id: 'archive', label: 'Архивы', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg> },
    ]

    const metaBtnBaseClass = "inline-flex items-center justify-center gap-1.5 h-7 px-2.5 text-[11px] font-mono tracking-wide border transition-colors select-none"
    const editMetaBtnClass = terminalMode
        ? `${metaBtnBaseClass} border-[#333] bg-[#0d0d0d] text-[#8b95aa] hover:text-[#5fafff] hover:bg-[#131313]`
        : `${metaBtnBaseClass} rounded-md border-[#2f3b54] bg-[#151c2b] text-[#94a9d7] hover:text-[#d3e1ff] hover:bg-[#1a273b]`
    const exportMetaBtnClass = terminalMode
        ? `${metaBtnBaseClass} border-[#333] ${showExportMenu ? 'bg-[#151515] text-[#5fafff]' : 'bg-[#0d0d0d] text-[#8b95aa]'} hover:text-[#5fafff] hover:bg-[#151515]`
        : `${metaBtnBaseClass} rounded-md border-[#2f3b54] ${showExportMenu ? 'bg-[#1a273b] text-[#d3e1ff] border-[#4a638f]' : 'bg-[#151c2b] text-[#94a9d7]'} hover:text-[#d3e1ff] hover:bg-[#1d2c42]`
    const exportPanelClass = terminalMode
        ? "export-menu-panel absolute left-0 top-full mt-2 min-w-[340px] max-w-[420px] z-50"
        : "export-menu-panel absolute left-0 top-full mt-2 min-w-[340px] rounded-xl border border-[#2f3b54] bg-[#0f1624]/95 backdrop-blur-sm shadow-[0_18px_40px_rgba(0,0,0,0.42)] z-50 overflow-hidden"
    const exportActionClass = terminalMode
        ? "export-menu-action w-full flex items-center justify-between gap-3 text-left px-3 py-2 border border-[#27364f] text-[#c7ddff] bg-[#0a101a] hover:bg-[#0f1724] disabled:opacity-50 disabled:cursor-not-allowed"
        : "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-[#151c2b] border border-[#2f3b54] text-[#cfe0ff] hover:bg-[#1d2c42] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    const exportCancelClass = terminalMode
        ? "export-menu-cancel mt-1 text-[11px] px-2.5 py-1 border border-[#4a2f2f] text-[#ff9d9d] bg-[#170d0d] hover:bg-[#221111]"
        : "mt-2 text-[11px] px-2.5 py-1 rounded-md bg-[#d75f5f]/10 text-[#ff8a8a] border border-[#d75f5f]/30 hover:bg-[#d75f5f]/15 transition-colors"
    const exportHeadClass = terminalMode
        ? "export-menu-head"
        : "flex items-center justify-between gap-3 px-3 py-2 border-b border-[#2f3b54] bg-[#131d30]"
    const exportHeadTitleClass = terminalMode
        ? "export-menu-head-title"
        : "text-[11px] font-mono uppercase tracking-[0.08em] text-[#9ec4ff]"
    const exportHeadSubClass = terminalMode
        ? "export-menu-head-sub"
        : "text-[10px] font-mono text-[#6f86b4]"
    const exportBodyClass = terminalMode
        ? "export-menu-body"
        : "p-2.5 bg-[#0f1624]"
    const exportStatusClass = terminalMode
        ? "export-menu-status"
        : "mt-2 px-1 text-[11px] text-[#7d87ab] flex items-center gap-1.5"
    const exportStatusDotClass = terminalMode
        ? `export-menu-status-dot ${isExportingHistory ? 'is-running' : ''}`
        : `w-1.5 h-1.5 rounded-full ${isExportingHistory ? 'bg-[#7aa2f7]' : 'bg-[#4d6388]'}`
    const exportErrorClass = terminalMode
        ? "export-menu-error"
        : "mt-2 px-1 text-[11px] text-[#ff8a8a]"
    const exportTagClass = terminalMode
        ? "export-menu-tag"
        : "inline-flex items-center px-1.5 py-0.5 rounded border border-[#4c6491] text-[10px] text-[#9ec4ff] bg-[#121f36] font-mono"

    return (
        <>

            <div id="dashboard-view" className={`fixed inset-0 z-[2000] bg-[#1a1b26] text-white font-manrope overflow-hidden flex flex-col md:flex-row ${terminalMode ? 'terminal-mode' : ''}`}>
                <div className="flex h-full w-full bg-[#16161e]">
                    {/* Sidebar Rail */}
                    {terminalMode ? (
                        <aside className="w-[76px] flex flex-col items-center py-4 border-r border-[#5e5e75] bg-[#16161e]/90 z-10 shrink-0" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                            <div className="mb-6 text-center" style={{ color: '#666' }}>INS</div>
                            <div className="flex flex-col gap-1 w-full px-1">
                                <div
                                    onClick={() => setActiveSection('main')}
                                    className={`text-center py-2 cursor-pointer select-none ${activeSection === 'main' ? 'text-white' : 'text-[#787c99] hover:text-white'}`}
                                    style={{ fontFamily: 'monospace', fontSize: '11px', background: activeSection === 'main' ? '#111' : 'transparent' }}
                                >[H]</div>
                                <div
                                    onClick={() => setActiveSection('chats')}
                                    className={`text-center py-2 cursor-pointer select-none ${activeSection === 'chats' ? 'text-white' : 'text-[#787c99] hover:text-white'}`}
                                    style={{ fontFamily: 'monospace', fontSize: '11px', background: activeSection === 'chats' ? '#111' : 'transparent' }}
                                >[C]</div>
                            </div>
                            <div className="mt-auto flex flex-col gap-1 mb-2 w-full px-1">
                                <div
                                    onClick={() => setTerminalMode(prev => !prev)}
                                    className="text-center py-2 cursor-pointer select-none"
                                    style={{ fontFamily: 'monospace', fontSize: '11px', color: '#5fafff', background: '#111' }}
                                >[&gt;_]</div>
                                <div
                                    onClick={() => setPostLoginView(null)}
                                    className="text-center py-2 cursor-pointer select-none text-[#787c99] hover:text-white"
                                    style={{ fontFamily: 'monospace', fontSize: '11px' }}
                                >[X]</div>
                            </div>
                        </aside>
                    ) : (
                        <aside className="w-[76px] flex flex-col items-center py-6 border-r border-[#5e5e75] bg-[#16161e]/90 z-10 shrink-0">
                            <button className="logo-btn mb-8 flexitems-center justify-center transition-transform hover:scale-105" onClick={handleBack} title="Back to Chats">
                                <svg viewBox="0 0 64 64" fill="none" stroke="#e4e4e7" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="w-[44px] h-[44px]">
                                    <circle cx="32" cy="32" r="13" />
                                    <ellipse cx="32" cy="32" rx="26" ry="9" transform="rotate(-35 32 32)" strokeDasharray="20 8" />
                                    <ellipse cx="32" cy="32" rx="20" ry="5" transform="rotate(-35 32 32)" strokeWidth="2" opacity="0.6" strokeDasharray="4 4" />
                                    <circle cx="12" cy="42" r="3" fill="#e4e4e7" stroke="none" />
                                    <circle cx="56" cy="18" r="2.5" fill="#e4e4e7" stroke="none" />
                                </svg>
                            </button>
                            <div className="flex flex-col gap-6 w-full px-2">
                                <div
                                    onClick={() => setActiveSection('main')}
                                    className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl cursor-pointer select-none group transition-all duration-300 ${activeSection === 'main' ? 'text-white' : 'text-[#787c99] hover:text-white'}`}>
                                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[22px] h-[22px]"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg>
                                    <span className="text-[11px] whitespace-nowrap font-manrope">Главная</span>
                                </div>
                                <div
                                    onClick={() => setActiveSection('chats')}
                                    className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl cursor-pointer select-none group transition-all duration-300 ${activeSection === 'chats' ? 'text-white' : 'text-[#787c99] hover:text-white'}`}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px]"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                                    <span className="text-[11px] whitespace-nowrap font-manrope">Чаты</span>
                                </div>
                            </div>
                            <div className="mt-auto flex flex-col gap-4 mb-4">
                                <button onClick={() => setTerminalMode(prev => !prev)} className={`p-2.5 rounded-xl transition-colors ${terminalMode ? 'text-[#00ff41] bg-[#00ff41]/10' : 'text-[#787c99] hover:text-white hover:bg-white/5'}`} title="Терминальный режим">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px]">
                                        <polyline points="4 17 10 11 4 5"></polyline>
                                        <line x1="12" y1="19" x2="20" y2="19"></line>
                                    </svg>
                                </button>
                                <button onClick={() => setPostLoginView(null)} className="p-2.5 rounded-xl text-[#787c99] hover:text-white hover:bg-white/5 transition-colors" title="Выйти на сайт">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px]">
                                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                        <polyline points="16 17 21 12 16 7"></polyline>
                                        <line x1="21" y1="12" x2="9" y2="12"></line>
                                    </svg>
                                </button>
                            </div>
                        </aside>
                    )}

                    {/* Sidebar Explorer */}
                    <aside className="hidden md:flex flex-col w-[280px] border-r border-[#5e5e75] bg-[#16161e] shrink-0">
                        {terminalMode ? (
                            <>
                                <div className="h-[73px] flex shrink-0 items-center px-4 border-b border-[#5e5e75]" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                                    <span style={{ color: '#5fafff' }}>$</span>
                                    <span style={{ color: '#e0e0e0', marginLeft: '8px' }}>
                                        {activeSection === 'main' ? 'ls ~/files' : (
                                            chatFolder === 0 ? 'ls ~/chats' :
                                                chatFolder === 1 ? 'ls ~/archive' :
                                                    `ls ~/${(chatFolders.find(f => f.id === chatFolder)?.title || 'chats').toLowerCase()}`
                                        )}
                                    </span>
                                    {activeSection === 'chats' && (
                                        <div className="relative ml-auto" ref={chatMenuRef}>
                                            <button
                                                onClick={() => setShowChatMenu(prev => !prev)}
                                                style={{ fontFamily: 'monospace', fontSize: '12px', color: '#666', padding: '2px 6px', cursor: 'pointer', background: 'transparent', border: '1px solid #333' }}
                                            >[cd]</button>
                                            {showChatMenu && (
                                                <div className="absolute right-0 top-full mt-1 w-[200px] z-50 overflow-hidden max-h-[320px] overflow-y-auto" style={{ fontFamily: 'monospace', fontSize: '12px', background: '#0a0a0a', border: '1px solid #333' }}>
                                                    <div
                                                        onClick={() => { setChatFolder(0); setShowChatMenu(false) }}
                                                        style={{ padding: '4px 10px', cursor: 'pointer', color: chatFolder === 0 ? '#5fafff' : '#b0b0b0', background: chatFolder === 0 ? '#111' : 'transparent' }}
                                                    >{chatFolder === 0 ? '>' : ' '} ~/chats</div>
                                                    <div
                                                        onClick={() => { setChatFolder(1); setShowChatMenu(false) }}
                                                        style={{ padding: '4px 10px', cursor: 'pointer', color: chatFolder === 1 ? '#5fafff' : '#b0b0b0', background: chatFolder === 1 ? '#111' : 'transparent' }}
                                                    >{chatFolder === 1 ? '>' : ' '} ~/archive</div>
                                                    {chatFolders.length > 0 && (
                                                        <div style={{ borderTop: '1px solid #333', margin: '2px 0' }}></div>
                                                    )}
                                                    {chatFolders.map(folder => (
                                                        <div
                                                            key={folder.id}
                                                            onClick={() => { setChatFolder(folder.id); setShowChatMenu(false) }}
                                                            style={{ padding: '4px 10px', cursor: 'pointer', color: chatFolder === folder.id ? '#5fafff' : '#b0b0b0', background: chatFolder === folder.id ? '#111' : 'transparent' }}
                                                        >{chatFolder === folder.id ? '>' : ' '} ~/{folder.title.toLowerCase()}</div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="py-2 flex flex-col overflow-y-auto scrollable flex-1 min-h-0 terminal-list" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                                    {activeSection === 'main' && navItems.map(item => (
                                        <div
                                            key={item.id}
                                            onClick={() => setActiveTab(item.id)}
                                            style={{ padding: '3px 12px', cursor: 'pointer', color: activeTab === item.id ? '#5fafff' : '#b0b0b0', background: activeTab === item.id ? '#111' : 'transparent', flexShrink: 0 }}
                                        >{activeTab === item.id ? '>' : ' '} {item.label.toLowerCase()}/</div>
                                    ))}
                                    {activeSection === 'chats' && dialogs.map((chat, index) => {
                                        const idStr = chat.entity?.id?.toString() || Math.random().toString()
                                        const isMe = idStr === myId?.toString()

                                        const emojiRegex = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{3297}\u{3299}\u{303d}\u{00a9}\u{00ae}\u{2122}\u{23f3}\u{24c2}\u{23e9}-\u{23ef}\u{25b6}\u{23f8}-\u{23fa}]/gu
                                        const cleanStr = (chat.title || 'deleted').replace(emojiRegex, '').trim()
                                        const title = isMe ? 'saved_messages' : cleanStr.toLowerCase().replace(/\s+/g, '_').replace(/_+/g, '_').replace(/_$/, '')

                                        const isSelected = selectedChatId === idStr
                                        const unreadCount = chat.unreadCount || 0
                                        const msgTime = getLastOnlineDisplayTime(chat.entity)

                                        const isOnline = chat.entity?.status?.className === 'UserStatusOnline';

                                        return (
                                            <div
                                                key={idStr}
                                                onClick={() => setSelectedChatId(idStr)}
                                                className={`flex items-center gap-1.5 px-3 py-1.5 cursor-pointer shrink-0 transition-colors border-b border-[#1a1a1a] ${isSelected ? 'bg-[#111] text-[#5fafff]' : 'bg-transparent text-[#b0b0b0] hover:bg-[#0a0a0a] hover:text-[#ccc]'}`}
                                            >
                                                <span className="shrink-0 flex items-center justify-center w-2 mr-0.5" style={{ color: isSelected ? '#5fafff' : '#555' }}>
                                                    {isSelected ? '>' : ''}
                                                </span>
                                                <span className="shrink-0 flex items-center justify-center w-2" style={{ color: '#00ff41', fontSize: '10px' }}>
                                                    {isOnline ? '●' : ' '}
                                                </span>
                                                <span className="shrink-0 w-6 text-right mr-1.5" style={{ color: isSelected ? '#5fafff' : '#555' }}>
                                                    {index + 1}
                                                </span>
                                                <span className="truncate" style={{ color: typingUsers[idStr] ? '#5fafff' : 'inherit' }}>{title || 'unknown'}</span>
                                                {unreadCount > 0 && !typingUsers[idStr] && (
                                                    <span className="shrink-0" style={{ color: '#d75f5f' }}>({unreadCount})</span>
                                                )}
                                                <span className="shrink-0 ml-auto pl-2" style={{ color: typingUsers[idStr] ? '#5fafff' : '#444', fontStyle: typingUsers[idStr] ? 'italic' : 'normal' }}>
                                                    {typingUsers[idStr] ? (typeof typingUsers[idStr] === 'object' ? typingUsers[idStr].text : 'typing...') : msgTime}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="h-[73px] flex shrink-0 items-center justify-between px-6 border-b border-[#5e5e75]">
                                    <h2 className="text-[22px] font-manrope font-medium text-white drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)]">
                                        {activeSection === 'main' ? 'Главная' : (
                                            chatFolder === 0 ? 'Чаты' :
                                                chatFolder === 1 ? 'Архив' :
                                                    (chatFolders.find(f => f.id === chatFolder)?.title || 'Чаты')
                                        )}
                                    </h2>
                                    {activeSection === 'chats' && (
                                        <div className="relative" ref={chatMenuRef}>
                                            <button
                                                onClick={() => setShowChatMenu(prev => !prev)}
                                                className="flex items-center gap-1 p-1.5 rounded-lg text-[#787c99] hover:text-white hover:bg-white/5 transition-all"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-[18px] h-[18px] transition-transform duration-200 ${showChatMenu ? 'rotate-180' : ''}`}>
                                                    <polyline points="6 9 12 15 18 9"></polyline>
                                                </svg>
                                            </button>
                                            {showChatMenu && (
                                                <div className="absolute right-0 top-full mt-2 w-[200px] bg-[#1e1e2e] border border-[#5e5e75]/50 rounded-xl shadow-xl shadow-black/40 z-50 py-1.5 overflow-hidden max-h-[320px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                                                    <button
                                                        onClick={() => { setChatFolder(0); setShowChatMenu(false) }}
                                                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors ${chatFolder === 0 ? 'text-[#7aa2f7] bg-[#7aa2f7]/10' : 'text-[#a0a4b8] hover:text-white hover:bg-white/5'}`}
                                                    >
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                                                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                                        </svg>
                                                        Все чаты
                                                    </button>
                                                    <button
                                                        onClick={() => { setChatFolder(1); setShowChatMenu(false) }}
                                                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors ${chatFolder === 1 ? 'text-[#7aa2f7] bg-[#7aa2f7]/10' : 'text-[#a0a4b8] hover:text-white hover:bg-white/5'}`}
                                                    >
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                                                            <polyline points="21 8 21 21 3 21 3 8"></polyline>
                                                            <rect x="1" y="3" width="22" height="5"></rect>
                                                            <line x1="10" y1="12" x2="14" y2="12"></line>
                                                        </svg>
                                                        Архив
                                                    </button>
                                                    {chatFolders.length > 0 && (
                                                        <div className="border-t border-[#5e5e75]/30 my-1"></div>
                                                    )}
                                                    {chatFolders.map(folder => (
                                                        <button
                                                            key={folder.id}
                                                            onClick={() => { setChatFolder(folder.id); setShowChatMenu(false) }}
                                                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors ${chatFolder === folder.id ? 'text-[#7aa2f7] bg-[#7aa2f7]/10' : 'text-[#a0a4b8] hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            <span className="w-4 h-4 shrink-0 flex items-center justify-center text-[14px]">
                                                                {folder.emoji || '📁'}
                                                            </span>
                                                            <span className="truncate">{folder.title}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="py-4 flex flex-col gap-1.5 overflow-y-auto scrollable flex-1 min-h-0">
                                    {activeSection === 'main' && navItems.map(item => (
                                        <div
                                            key={item.id}
                                            onClick={() => setActiveTab(item.id)}
                                            className={`menu-item mx-4 flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl cursor-pointer select-none text-[0.9rem] font-medium transition-colors ${activeTab === item.id
                                                ? 'text-[#7aa2f7] bg-[#7aa2f7]/10'
                                                : 'text-[#787c99] hover:bg-white/5'
                                                }`}
                                        >
                                            {item.icon}
                                            <span>{item.label}</span>
                                        </div>
                                    ))}
                                    {activeSection === 'chats' && dialogs.map((chat) => {
                                        const idStr = chat.entity?.id?.toString() || Math.random().toString()
                                        const isMe = idStr === myId?.toString()
                                        const title = isMe ? "Saved Messages" : (chat.title || "Deleted Account")
                                        const msgText = chat.message?.message || ""
                                        const isSelected = selectedChatId === idStr

                                        const titleText = chat.title ? chat.title.trim() : "U"
                                        const initials = titleText ? Array.from(titleText)[0].toUpperCase() : "U"
                                        const gradients = [
                                            "from-blue-500 to-cyan-400",
                                            "from-purple-500 to-pink-400",
                                            "from-emerald-500 to-teal-400",
                                            "from-orange-500 to-amber-400",
                                            "from-rose-500 to-red-400"
                                        ]
                                        const colorIndex = Math.abs(parseInt(idStr.slice(-5) || '0', 16)) % gradients.length
                                        const avatarBg = isMe ? "bg-[#353545] border border-white/10" : `bg-gradient-to-br ${gradients[colorIndex]}`

                                        const msgTime = getLastOnlineDisplayTime(chat.entity)
                                        const unreadCount = chat.unreadCount || 0
                                        const avatarUrl = avatarUrls[idStr]

                                        return (
                                            <div
                                                key={idStr}
                                                onClick={() => setSelectedChatId(idStr)}
                                                className={`menu-item group flex mx-3 items-center gap-3.5 px-3 py-3 rounded-[16px] cursor-pointer select-none transition-all duration-200 ${isSelected
                                                    ? 'bg-[#7aa2f7]/15 ring-1 ring-[#7aa2f7]/30 shadow-sm'
                                                    : 'hover:bg-white/[0.04]'
                                                    }`}
                                            >
                                                <div className="relative shrink-0">
                                                    {avatarUrl ? (
                                                        <img
                                                            src={avatarUrl}
                                                            alt=""
                                                            className="w-[44px] h-[44px] rounded-full object-cover shadow-md transition-transform group-hover:scale-[1.04]"
                                                        />
                                                    ) : (
                                                        <div className={`w-[44px] h-[44px] rounded-full flex items-center justify-center text-white font-semibold text-[15px] shadow-md transition-transform group-hover:scale-[1.04] ${avatarBg}`}>
                                                            {isMe ? (
                                                                <svg viewBox="0 0 24 24" fill="currentColor" className="w-[20px] h-[20px]"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" /></svg>
                                                            ) : initials}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex flex-col min-w-0 flex-1 justify-center gap-[3px]">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className={`text-[14px] truncate font-medium tracking-[0.01em] ${isSelected ? 'text-[#7aa2f7]' : 'text-gray-100 group-hover:text-white transition-colors'}`}>
                                                            {title}
                                                        </span>
                                                        {msgTime && (
                                                            <span className={`text-[10px] shrink-0 font-medium ${unreadCount > 0 ? 'text-[#7aa2f7]' : 'text-[#5e5e75] group-hover:text-[#787c99]'} transition-colors`}>
                                                                {msgTime}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className={`text-[12px] truncate font-normal leading-[1.3] ${isSelected ? 'text-[#7aa2f7]/70' : 'text-[#787c99] group-hover:text-[#9ea3c4]'} transition-colors`}>
                                                            {msgText || "Нет сообщений"}
                                                        </span>
                                                        {unreadCount > 0 && (
                                                            <div className="shrink-0 flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#7aa2f7] text-[#16161e] text-[10px] font-bold shadow-sm">
                                                                {unreadCount > 99 ? '99+' : unreadCount}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </>
                        )}
                    </aside>

                    {/* Main Content Area */}
                    <main className="flex-1 flex flex-col bg-[#1a1b26] overflow-hidden min-w-0">
                        {terminalMode ? (
                            <header className="h-[73px] flex items-center px-4 border-b border-[#5e5e75] bg-[#16161e] shrink-0 overflow-hidden" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                                <span style={{ color: '#5fafff', flexShrink: 0 }}>$</span>
                                <span style={{ color: '#e0e0e0', marginLeft: '8px', flexShrink: 0 }}>
                                    {activeSection === 'main' ? 'cat' : 'tail -f'} {selectedChatId ? `chat_${selectedChatId.slice(-6)}` : 'stdin'}
                                </span>
                                <span style={{ color: '#333', marginLeft: '8px', flexShrink: 0 }}>|</span>
                                <span style={{ color: '#444', marginLeft: '8px', flexShrink: 0 }}>
                                    {activeSection === 'chats' && dialogs.find(d => d.entity?.id?.toString() === selectedChatId)?.title}
                                </span>
                                {activeSection === 'chats' && (
                                    <div className="flex-1 min-w-0 flex items-center gap-4 ml-6">
                                        <div className="flex-1 min-w-0 flex justify-start items-center gap-3 overflow-hidden" style={{ color: '#768199', fontSize: '12px' }}>
                                            {dialogs.filter(d => {
                                                const normalizedTitle = (d.title || '').toString().trim().toLowerCase()
                                                return (
                                                    (d.entity?.status?.className === 'UserStatusOnline' || d.entity?.status?.className === 'UserStatusOffline') &&
                                                    d.entity?.id?.toString() !== myId?.toString() &&
                                                    normalizedTitle !== 'telegram'
                                                )
                                            }).sort((a, b) => {
                                                const aOnline = a.entity?.status?.className === 'UserStatusOnline'
                                                const bOnline = b.entity?.status?.className === 'UserStatusOnline'
                                                if (aOnline && !bOnline) return -1
                                                if (!aOnline && bOnline) return 1
                                                const aTime = a.entity?.status?.wasOnline || 0
                                                const bTime = b.entity?.status?.wasOnline || 0
                                                return bTime - aTime
                                            }).slice(0, 8).map(d => {
                                                const isOnline = d.entity?.status?.className === 'UserStatusOnline'
                                                const wasOnline = d.entity?.status?.wasOnline
                                                const timeStr = (!isOnline && wasOnline) ? formatTimeWithSeconds(wasOnline * 1000) : ''
                                                const offlineAgo = (!isOnline && wasOnline)
                                                    ? formatElapsedDuration(Math.floor(clockNowMs / 1000) - wasOnline)
                                                    : ''
                                                const contactChipStyle = isOnline
                                                    ? { borderColor: '#263747', background: '#0a0f15' }
                                                    : { borderColor: '#32302c', background: '#11100d' }

                                                const emojiRegex = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{3297}\u{3299}\u{303d}\u{00a9}\u{00ae}\u{2122}\u{23f3}\u{24c2}\u{23e9}-\u{23ef}\u{25b6}\u{23f8}-\u{23fa}]/gu
                                                const title = (d.title || 'unknown').replace(emojiRegex, '').trim().toLowerCase().replace(/\s+/g, '_').replace(/_+/g, '_').replace(/_$/, '')

                                                return (
                                                    <div
                                                        key={d.entity.id.toString()}
                                                        className="flex items-center gap-1.5 shrink-0 border"
                                                        style={{ padding: '2px 7px', ...contactChipStyle }}
                                                        title={d.title + (isOnline ? ' (В сети)' : ` (Был в ${timeStr}, прошло ${offlineAgo})`)}
                                                    >
                                                        <span style={{ color: isOnline ? '#67be94' : '#c6a277', fontSize: '10px' }}>●</span>
                                                        <span className="truncate max-w-[116px]" style={{ color: isOnline ? '#cad6ec' : '#d8ccb9', fontWeight: 500 }}>{title}</span>
                                                        {!isOnline && timeStr && <span style={{ color: '#7f8faa', fontSize: '11px' }}>{timeStr}</span>}
                                                        {!isOnline && offlineAgo && <span style={{ color: '#66768f', fontSize: '10px' }}>+{offlineAgo}</span>}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                        <div
                                            className="shrink-0 flex items-center gap-2 pl-3 border-l border-[#243246]"
                                            style={{ fontFamily: 'monospace', fontSize: '12px', color: '#8096ba' }}
                                            title="Текущее время"
                                        >
                                            <span style={{ color: '#5f7599' }}>time</span>
                                            <span style={{ color: '#adc1de', fontWeight: 500 }}>{formatTimeWithSeconds(clockNowMs)}</span>
                                        </div>
                                    </div>
                                )}
                            </header>
                        ) : (
                            <header className="h-[73px] flex items-center justify-between px-6 border-b border-[#5e5e75] bg-[#16161e] shrink-0">
                                <div className="flex flex-1 items-center gap-4 max-w-xl">
                                    <div className="relative flex-1">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#787c99]"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                        <input type="text" placeholder="Поиск" className="w-full bg-[#1a1b26] border border-[#5e5e75] rounded-xl py-2.5 pl-10 pr-4 text-white text-sm outline-none focus:border-[#7aa2f7]" />
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 ml-4 shrink-0">
                                    <div className="w-[38px] h-[38px] rounded-full bg-gradient-to-r from-[#e0af68] to-[#db9d47] flex items-center justify-center text-[#1a1b26] font-bold text-sm shadow-[0_4px_10px_rgba(224,175,104,0.3)] cursor-pointer">
                                        MГ
                                    </div>
                                </div>
                            </header>
                        )}

                        <div className="p-6 md:p-8 flex flex-col gap-6 w-full flex-1 overflow-hidden min-h-0">
                            {activeSection === 'main' ? (
                                <>
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
                                        <div className="flex flex-col">
                                            <h2 className="text-2xl font-manrope font-medium text-white flex items-center gap-3">
                                                {navItems.find(i => i.id === activeTab)?.label}
                                            </h2>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-sm text-[#787c99] font-mono tracking-wide">ID: {selectedChatId || 'Облако'}</span>
                                                <button onClick={() => setPostLoginView('chats')} className="text-[11px] px-2 py-0.5 rounded bg-white/5 text-[#7aa2f7]/80 hover:bg-[#7aa2f7]/10 hover:text-[#7aa2f7] transition-colors shadow-sm">Изменить</button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 pb-2 border-b border-[#2a2a35]">
                                        <div className="flex bg-[#16161e] p-1 rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]">
                                            <button className="tab-pill px-4 py-1.5 rounded-lg text-sm font-medium bg-[#2a2a35] text-white shadow-[0_2px_8px_rgba(0,0,0,0.2)]">Файлы</button>
                                        </div>
                                        <div className="flex bg-[#16161e] p-1 rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]">
                                            <button className="view-btn p-2 rounded-lg bg-[#2a2a35] text-white shadow-[0_2px_8px_rgba(0,0,0,0.2)]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg></button>
                                        </div>
                                    </div>

                                    {renderFileRows()}
                                </>
                            ) : !selectedChatId ? (
                                <div className="flex-1 flex items-center justify-center text-[#787c99] h-full">
                                    {terminalMode ? (
                                        <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#555' }}>&gt; waiting for connection...</span>
                                    ) : (
                                        <div className="px-5 py-2.5 rounded-2xl bg-[#2a2a35]/50 text-sm font-medium">Выберите чат для просмотра</div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
                                    <div className="flex flex-col">
                                        <h2 className="text-2xl font-manrope font-medium text-white flex items-center gap-3">
                                            {dialogs.find(d => d.entity?.id?.toString() === selectedChatId)?.title || (selectedChatId === myId?.toString() ? "Saved Messages" : "Чат")}
                                        </h2>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                            <span className="text-sm text-[#787c99] font-mono tracking-wide">ID: {selectedChatId}</span>
                                            <button onClick={() => setPostLoginView('chats')} className={editMetaBtnClass}>Изменить</button>
                                            <div className="relative" ref={exportMenuRef}>
                                                <button
                                                    onClick={() => {
                                                        setShowExportMenu(prev => !prev)
                                                        setExportHistoryError(null)
                                                    }}
                                                    className={exportMetaBtnClass}
                                                >
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                                        <polyline points="7 10 12 15 17 10"></polyline>
                                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                                    </svg>
                                                    Export
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-3 h-3 transition-transform ${showExportMenu ? 'rotate-180' : ''}`}>
                                                        <polyline points="6 9 12 15 18 9"></polyline>
                                                    </svg>
                                                </button>
                                                {showExportMenu && (
                                                    <div className={exportPanelClass}>
                                                        <div className={exportHeadClass}>
                                                            <span className={exportHeadTitleClass}>Экспорт истории</span>
                                                            <span className={exportHeadSubClass}>plain text</span>
                                                        </div>
                                                        <div className={exportBodyClass}>
                                                            <button
                                                                onClick={handleExportFullHistory}
                                                                disabled={isExportingHistory}
                                                                className={exportActionClass}
                                                            >
                                                                <span className="inline-flex items-center gap-2 min-w-0">
                                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                                                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                                                        <polyline points="14 2 14 8 20 8"></polyline>
                                                                    </svg>
                                                                    <span className="truncate">Скачать всю историю</span>
                                                                </span>
                                                                <span className="inline-flex items-center gap-2 shrink-0">
                                                                    <span className={exportTagClass}>.txt</span>
                                                                    {isExportingHistory && (
                                                                        <span className={terminalMode ? "text-[11px] text-[#5fafff]" : "text-[11px] text-[#7aa2f7]"}>...</span>
                                                                    )}
                                                                </span>
                                                            </button>

                                                            <div className={exportStatusClass}>
                                                                <span className={exportStatusDotClass}></span>
                                                                <span>
                                                                    {isExportingHistory
                                                                        ? `Загрузка истории: ${exportedHistoryCount} сообщений`
                                                                        : `Готово к экспорту`}
                                                                </span>
                                                            </div>

                                                            {isExportingHistory && (
                                                                <button
                                                                    onClick={() => { exportCancelRef.current = true }}
                                                                    className={exportCancelClass}
                                                                >
                                                                    Отменить экспорт
                                                                </button>
                                                            )}

                                                            {exportHistoryError && (
                                                                <div className={exportErrorClass}>
                                                                    {exportHistoryError}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                    {renderChatMessages()}
                                    <form onSubmit={handleSendMessage} className={terminalMode ? "flex gap-2 shrink-0 border-t border-[#333] pt-2 mt-2" : "flex gap-3 shrink-0 p-2 bg-[#16161e] border border-[#5e5e75] rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] mt-auto"}>
                                        <input
                                            type="text"
                                            value={draftMessage}
                                            onChange={e => setDraftMessage(e.target.value)}
                                            placeholder={terminalMode ? "> TYPE YOUR MESSAGE..." : "Написать сообщение..."}
                                            className={terminalMode ? "flex-1 bg-black border border-[#333] text-[#00ff41] px-2 py-1 outline-none font-mono text-[13px] focus:border-[#5fafff]" : "flex-1 bg-transparent text-white px-3 py-2 outline-none placeholder-[#787c99]"}
                                        />
                                        <button
                                            type="submit"
                                            disabled={!draftMessage.trim()}
                                            className={terminalMode ? "px-4 font-mono text-[13px] text-[#5fafff] border border-[#333] bg-[#111] hover:bg-[#222]" : "w-10 h-10 shrink-0 flex items-center justify-center rounded-lg bg-[#7aa2f7] text-[#16161e] hover:bg-[#92b5ff] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"}
                                        >
                                            {terminalMode ? "[SEND]" : <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className="w-[18px] h-[18px] ml-0.5"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>}
                                        </button>
                                    </form>
                                </>
                            )}
                        </div>
                    </main>
                </div>
            </div >
        </>
    )
}
