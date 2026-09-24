// Collects captures from every frame and mirrors them to the native host,
// which writes them where the Omarchy bar widget can read them. The native
// port is kept open for the whole browser session: its presence tells the
// widget that the extension is working, and it keeps this worker alive.
const HOST = "io.github.alkin.screenshare"

const frames = new Map() // "tabId:frameId" -> { tabId, windowId, frameId, frameOrigin, sessions }
const tabs = new Map() // tabId -> { title, host }
let native = null
let retryDelay = 1000

function hostOf(url) {
  try {
    const parsed = new URL(url)
    return parsed.host || parsed.protocol.replace(/:$/, "")
  } catch (error) {
    return ""
  }
}

function snapshot() {
  const sessions = []
  for (const frame of frames.values()) {
    const tab = tabs.get(frame.tabId) || {}
    for (const session of frame.sessions) {
      sessions.push({
        tabId: frame.tabId,
        windowId: frame.windowId,
        frameId: frame.frameId,
        origin: tab.host || frame.frameOrigin,
        title: tab.title || "",
        surface: session.surface,
        since: session.since
      })
    }
  }
  return sessions
}

function push() {
  if (!native) return
  try {
    native.postMessage({ type: "state", sessions: snapshot() })
  } catch (error) {
    native = null
  }
}

function connectNative() {
  if (native) return
  const port = chrome.runtime.connectNative(HOST)
  native = port
  port.onMessage.addListener(onHostMessage)
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError
    if (native === port) native = null
    // Host not installed yet, or it exited: back off and try again.
    setTimeout(connectNative, retryDelay)
    retryDelay = Math.min(retryDelay * 2, 60000)
  })
  push()
}

async function onHostMessage(message) {
  retryDelay = 1000
  if (!message || message.cmd !== "focus") return
  const tabId = Number(message.tabId)
  try {
    const tab = await chrome.tabs.update(tabId, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
  } catch (error) {
    // Tab is gone; the next push drops it.
  }
}

async function refreshTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId)
    tabs.set(tabId, { title: tab.title || "", host: hostOf(tab.url || tab.pendingUrl || "") })
  } catch (error) {
    tabs.delete(tabId)
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "capture" || !port.sender || !port.sender.tab) return
  const tab = port.sender.tab
  const key = tab.id + ":" + (port.sender.frameId || 0)

  port.onMessage.addListener(async (message) => {
    const sessions = Array.isArray(message && message.sessions) ? message.sessions : []
    if (sessions.length === 0) {
      frames.delete(key)
    } else {
      frames.set(key, {
        tabId: tab.id,
        windowId: tab.windowId,
        frameId: port.sender.frameId || 0,
        frameOrigin: hostOf(port.sender.origin || port.sender.url || ""),
        sessions
      })
      await refreshTab(tab.id)
    }
    push()
  })

  port.onDisconnect.addListener(() => {
    frames.delete(key)
    push()
  })
})

function trackedTab(tabId) {
  for (const frame of frames.values()) if (frame.tabId === tabId) return true
  return false
}

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!trackedTab(tabId) || (change.title === undefined && change.url === undefined)) return
  await refreshTab(tabId)
  push()
})

chrome.tabs.onAttached.addListener((tabId, info) => {
  let changed = false
  for (const frame of frames.values()) {
    if (frame.tabId === tabId) {
      frame.windowId = info.newWindowId
      changed = true
    }
  }
  if (changed) push()
})

chrome.tabs.onRemoved.addListener((tabId) => {
  let changed = false
  for (const [key, frame] of frames) {
    if (frame.tabId === tabId) {
      frames.delete(key)
      changed = true
    }
  }
  tabs.delete(tabId)
  if (changed) push()
})

chrome.runtime.onStartup.addListener(connectNative)
chrome.runtime.onInstalled.addListener(connectNative)
connectNative()
