// Runs in the page's own JS world (MAIN) before any page script. It wraps
// getDisplayMedia so every screen/window/tab capture the page starts is
// reported to bridge.js, together with what kind of surface was picked.
// Nothing about the captured media itself is read or sent anywhere.
(() => {
  const TAG = "__omarchyScreenshare"
  const proto = window.MediaDevices && window.MediaDevices.prototype
  if (!proto || typeof proto.getDisplayMedia !== "function" || proto.getDisplayMedia[TAG]) return

  const captures = new Map() // id -> { surface, since, tracks: Set<MediaStreamTrack> }
  const trackCapture = new WeakMap() // track -> capture id
  let nextId = 1
  let pollTimer = 0

  function live(capture) {
    for (const track of capture.tracks) {
      if (track.readyState === "live") return true
    }
    return false
  }

  function report() {
    for (const [id, capture] of captures) {
      if (!live(capture)) captures.delete(id)
    }

    const sessions = []
    for (const [id, capture] of captures) {
      sessions.push({ id, surface: capture.surface, since: capture.since })
    }

    window.postMessage({ [TAG]: true, sessions }, "*")

    // `ended` does not fire when the page itself stops or drops a track, so
    // re-check while anything is being shared.
    if (sessions.length > 0 && !pollTimer) {
      pollTimer = setInterval(report, 2000)
    } else if (sessions.length === 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = 0
    }
  }

  function adopt(id, track) {
    const capture = captures.get(id)
    if (!capture) return
    capture.tracks.add(track)
    trackCapture.set(track, id)
    track.addEventListener("ended", report)
  }

  const getDisplayMedia = proto.getDisplayMedia
  function wrappedGetDisplayMedia(...args) {
    return getDisplayMedia.apply(this, args).then((stream) => {
      const video = stream.getVideoTracks()[0]
      if (video) {
        const settings = typeof video.getSettings === "function" ? video.getSettings() : {}
        const id = nextId++
        captures.set(id, { surface: settings.displaySurface || "unknown", since: Date.now(), tracks: new Set() })
        for (const track of stream.getTracks()) adopt(id, track)
        report()
      }
      return stream
    })
  }
  wrappedGetDisplayMedia[TAG] = true
  proto.getDisplayMedia = wrappedGetDisplayMedia

  const trackProto = window.MediaStreamTrack.prototype

  const stop = trackProto.stop
  trackProto.stop = function(...args) {
    const result = stop.apply(this, args)
    if (trackCapture.has(this)) report()
    return result
  }

  // A clone keeps the capture running after the original is stopped.
  const clone = trackProto.clone
  trackProto.clone = function(...args) {
    const copy = clone.apply(this, args)
    const id = trackCapture.get(this)
    if (id !== undefined) adopt(id, copy)
    return copy
  }
})()
