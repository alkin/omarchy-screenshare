// Runs in the page's own JS world (MAIN) before any page script. It wraps
// getDisplayMedia so every screen/window/tab capture the page starts is
// reported to bridge.js, together with what kind of surface was picked.
// Nothing about the captured media itself is read or sent anywhere.
//
// Page scripts share this world and run after us, so everything used after
// startup is captured now and only ever called through those references:
// a page that later patches prototypes (readyState, Promise.then,
// Array.prototype, JSON, events...) cannot make a live capture look ended
// or silence the report. Reports travel over a private channel (see
// bridge.js) that the page cannot observe or forge.
(() => {
  const apply = Reflect.apply
  const defineProperty = Object.defineProperty
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
  const hasOwn = Object.prototype.hasOwnProperty
  const dispatch = EventTarget.prototype.dispatchEvent
  const listen = EventTarget.prototype.addEventListener
  const unlisten = EventTarget.prototype.removeEventListener
  const CustomEventCtor = CustomEvent
  const then = Promise.prototype.then
  const now = Date.now
  const startTimer = setInterval
  const stopTimer = clearInterval
  const later = setTimeout
  const StreamProto = MediaStream.prototype
  const getTracks = StreamProto.getTracks
  const getVideoTracks = StreamProto.getVideoTracks
  const TrackProto = MediaStreamTrack.prototype
  const readyState = getOwnPropertyDescriptor(TrackProto, "readyState").get
  const getSettings = TrackProto.getSettings

  const HELLO = "omarchy-screenshare:hello"
  const READY = "omarchy-screenshare:ready"
  const ACK = "omarchy-screenshare:ack"
  const REPORT = "omarchy-screenshare:report"
  const MARK = Symbol("omarchy-screenshare")

  let channel = null
  let captures = [] // [{ id, surface, since, tracks: [] }]
  let nextId = 1
  let pollTimer = 0
  let lastReport = ""

  // Array appends that ignore setters the page may define on Array.prototype.
  function append(list, value) {
    defineProperty(list, list.length, { value, writable: true, enumerable: true, configurable: true })
  }

  // --- Private channel handshake (runs at document_start, before the page).
  function onHello(event) {
    if (channel) return
    channel = event.target
    apply(dispatch, channel, [new CustomEventCtor(ACK)])
    report()
  }
  function stopHandshake() {
    apply(unlisten, document, [HELLO, onHello, true])
  }
  apply(listen, document, [HELLO, onHello, true])
  if (!channel) apply(dispatch, document, [new CustomEventCtor(READY)])
  if (channel) stopHandshake()
  else later(stopHandshake, 0)

  // --- Capture tracking.
  function isLive(capture) {
    const tracks = capture.tracks
    for (let i = 0; i < tracks.length; i++) {
      if (apply(readyState, tracks[i], []) === "live") return true
    }
    return false
  }

  function surfaceOf(track) {
    let surface = ""
    try {
      surface = apply(getSettings, track, []).displaySurface
    } catch (error) {
      surface = ""
    }
    return surface === "monitor" || surface === "window" || surface === "browser" ? surface : "unknown"
  }

  function report() {
    const alive = []
    for (let i = 0; i < captures.length; i++) {
      if (isLive(captures[i])) append(alive, captures[i])
    }
    captures = alive

    // Built by hand: JSON.stringify would honour a page-defined toJSON.
    let json = "["
    for (let i = 0; i < alive.length; i++) {
      const capture = alive[i]
      json += (i ? "," : "") + '{"id":' + capture.id + ',"surface":"' + capture.surface + '","since":' + capture.since + "}"
    }
    json += "]"

    if (channel && json !== lastReport) {
      lastReport = json
      apply(dispatch, channel, [new CustomEventCtor(REPORT, { detail: json })])
    }

    // `ended` does not fire when the page itself stops or drops a track, so
    // re-check while anything is being shared.
    if (alive.length > 0 && !pollTimer) {
      pollTimer = startTimer(report, 2000)
    } else if (alive.length === 0 && pollTimer) {
      stopTimer(pollTimer)
      pollTimer = 0
    }
  }

  function captureOf(track) {
    for (let i = 0; i < captures.length; i++) {
      const tracks = captures[i].tracks
      for (let j = 0; j < tracks.length; j++) if (tracks[j] === track) return captures[i]
    }
    return null
  }

  function adopt(capture, track) {
    append(capture.tracks, track)
    apply(listen, track, ["ended", report])
  }

  function onStream(stream) {
    try {
      const video = apply(getVideoTracks, stream, [])[0]
      if (!video) return
      const capture = { id: nextId++, surface: surfaceOf(video), since: now(), tracks: [] }
      const tracks = apply(getTracks, stream, [])
      for (let i = 0; i < tracks.length; i++) adopt(capture, tracks[i])
      append(captures, capture)
      report()
    } catch (error) {
      // never let the indicator break the page's own call
    }
  }

  // The page handles the rejection (e.g. picker cancelled) on its own promise.
  function ignore() {}

  function replaceMethod(proto, name, wrapper) {
    defineProperty(proto, name, { value: wrapper, writable: true, enumerable: false, configurable: true })
  }

  // Patch one realm (this window, or a same-origin child window a page could
  // otherwise borrow an unwrapped getDisplayMedia from).
  function install(win) {
    let devicesProto, trackProto
    try {
      devicesProto = win.MediaDevices && win.MediaDevices.prototype
      trackProto = win.MediaStreamTrack && win.MediaStreamTrack.prototype
    } catch (error) {
      return // cross-origin
    }
    if (!devicesProto || !trackProto || apply(hasOwn, devicesProto, [MARK])) return
    defineProperty(devicesProto, MARK, { value: true })

    const getDisplayMedia = devicesProto.getDisplayMedia
    if (typeof getDisplayMedia === "function") {
      replaceMethod(devicesProto, "getDisplayMedia", function getDisplayMedia_() {
        const promise = apply(getDisplayMedia, this, arguments)
        apply(then, promise, [onStream, ignore])
        return promise
      })
    }

    const stop = trackProto.stop
    replaceMethod(trackProto, "stop", function stop_() {
      const result = apply(stop, this, arguments)
      if (captureOf(this)) report()
      return result
    })

    // A clone keeps the capture running after the original is stopped.
    const clone = trackProto.clone
    replaceMethod(trackProto, "clone", function clone_() {
      const copy = apply(clone, this, arguments)
      const capture = captureOf(this)
      if (capture) adopt(capture, copy)
      return copy
    })
  }

  install(window)

  for (const Element of [window.HTMLIFrameElement, window.HTMLFrameElement, window.HTMLObjectElement]) {
    if (!Element) continue
    for (const name of ["contentWindow", "contentDocument"]) {
      const descriptor = getOwnPropertyDescriptor(Element.prototype, name)
      if (!descriptor || !descriptor.get) continue
      const get = descriptor.get
      defineProperty(Element.prototype, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: function() {
          const value = apply(get, this, [])
          try {
            if (value) install(name === "contentWindow" ? value : value.defaultView)
          } catch (error) {
            // cross-origin or detached; nothing to patch
          }
          return value
        }
      })
    }
  }
})()
