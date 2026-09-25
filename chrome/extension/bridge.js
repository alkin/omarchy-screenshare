// Isolated-world relay: receives the capture list from inject.js and forwards
// it to the service worker. A port is only opened while this frame is
// sharing, so idle tabs cost nothing.
//
// The two scripts talk through a detached element that only they hold. It is
// handed to inject.js at document_start, before any page script exists, by
// dispatching a bubbling event from it while it is briefly attached. After
// that its events never reach the document, so the page can neither read nor
// forge the capture list (window.postMessage would let it do both).
(() => {
  const HELLO = "omarchy-screenshare:hello"
  const READY = "omarchy-screenshare:ready"
  const ACK = "omarchy-screenshare:ack"
  const REPORT = "omarchy-screenshare:report"
  const SURFACES = ["monitor", "window", "browser", "unknown"]

  const channel = document.createElement("omarchy-screenshare")
  let connected = false
  let sessions = []
  let port = null

  // Attach, announce and detach in one synchronous step.
  function offer() {
    if (connected) return
    const parent = document.documentElement || document
    parent.appendChild(channel)
    channel.dispatchEvent(new CustomEvent(HELLO, { bubbles: true, composed: true }))
    channel.remove()
  }

  function stopOffering() {
    document.removeEventListener(READY, offer, true)
  }

  channel.addEventListener(ACK, () => {
    connected = true
    stopOffering()
  })

  // inject.js may run before or after this script: if it ran first it hears
  // the offer below; if it runs later it asks with READY.
  document.addEventListener(READY, offer, true)
  offer()
  setTimeout(stopOffering, 0)

  function parseSessions(detail) {
    let raw
    try {
      raw = JSON.parse(String(detail))
    } catch (error) {
      return null
    }
    if (!Array.isArray(raw)) return null
    const list = []
    for (const item of raw) {
      if (!item || typeof item.id !== "number" || typeof item.since !== "number") return null
      if (!SURFACES.includes(item.surface)) return null
      list.push({ id: item.id, surface: item.surface, since: item.since })
    }
    return list
  }

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

  channel.addEventListener(REPORT, (event) => {
    if (!connected) return
    const next = parseSessions(event.detail)
    if (!next || JSON.stringify(next) === JSON.stringify(sessions)) return
    sessions = next
    send()
  })
})()
