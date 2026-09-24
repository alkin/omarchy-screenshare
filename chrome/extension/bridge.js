// Isolated-world relay: forwards the capture list posted by inject.js to the
// service worker. A port is only opened while this frame is sharing, so idle
// tabs cost nothing.
(() => {
  const TAG = "__omarchyScreenshare"
  let sessions = []
  let port = null

  function send() {
    if (sessions.length === 0) {
      if (port) {
        port.postMessage({ sessions })
        port.disconnect()
        port = null
      }
      return
    }

    if (!port) {
      try {
        port = chrome.runtime.connect({ name: "capture" })
      } catch (error) {
        return // extension reloaded; this frame's context is gone
      }
      // The service worker may be restarted; reconnect and resend.
      port.onDisconnect.addListener(() => {
        port = null
        if (sessions.length > 0) setTimeout(send, 500)
      })
    }
    port.postMessage({ sessions })
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data[TAG] !== true) return
    const next = Array.isArray(event.data.sessions) ? event.data.sessions : []
    if (JSON.stringify(next) === JSON.stringify(sessions)) return
    sessions = next
    send()
  })
})()
